export class ProviderError extends Error {}

export class OpenAIProvider {
  constructor({ apiKey = process.env.OPENAI_API_KEY, model = process.env.OPENAI_MODEL || "gpt-4.1-mini", baseUrl = "https://api.openai.com/v1" } = {}) {
    this.name = "openai";
    this.model = model;
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async invoke(context) {
    if (!this.apiKey) throw new ProviderError("OPENAI_API_KEY is required");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(`${this.baseUrl}/responses`, {
        method: "POST",
        signal: controller.signal,
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(buildResponsesRequest(context, this.model))
      });
      if (!response.ok) throw new ProviderError(`OpenAI HTTP ${response.status}: ${await response.text()}`);
      const body = await response.json();
      return extractResponseText(body);
    } catch (error) {
      throw error instanceof ProviderError ? error : new ProviderError(error.message);
    } finally {
      clearTimeout(timer);
    }
  }
}

export const decisionJsonSchema = {
  type: "object", additionalProperties: false,
  required: ["interpretation", "intent", "action", "next_activation"],
  properties: {
    interpretation: { type: "string", minLength: 1 },
    intent: { type: "string", minLength: 1 },
    action: {
      anyOf: [
        {
          type: "object", additionalProperties: false,
          required: ["type", "target", "content", "destination", "activity"],
          properties: {
            type: { enum: ["speak"] },
            target: { enum: ["Alice", "Bob", "Carol"] },
            content: { type: "string", minLength: 1 },
            destination: { type: "null" },
            activity: { type: "null" }
          }
        },
        {
          type: "object", additionalProperties: false,
          required: ["type", "target", "content", "destination", "activity"],
          properties: {
            type: { enum: ["move"] },
            target: { type: "null" },
            content: { type: "null" },
            destination: { enum: ["living_room", "bedroom", "kitchen", "work"] },
            activity: { type: "null" }
          }
        },
        {
          type: "object", additionalProperties: false,
          required: ["type", "target", "content", "destination", "activity"],
          properties: {
            type: { enum: ["wait"] },
            target: { type: "null" },
            content: { type: "null" },
            destination: { type: "null" },
            activity: { type: "null" }
          }
        },
        {
          type: "object", additionalProperties: false,
          required: ["type", "target", "content", "destination", "activity"],
          properties: {
            type: { enum: ["start_activity"] },
            target: { type: "null" },
            content: { type: "null" },
            destination: { type: "null" },
            activity: { enum: ["eat", "sleep", "work", "rest", "leisure"] }
          }
        }
      ]
    },
    next_activation: { type: "object", additionalProperties: false, required: ["after_minutes"], properties: { after_minutes: { type: "number", minimum: 5, maximum: 360 } } }
  }
};

export function buildResponsesRequest(context, model) {
  return {
    model,
    instructions: "You are a simulated roommate living autonomously. Decide only from the supplied needs, schedule context, state, and observation. A schedule is a strong commitment, not a forced script: you may comply, delay, or deviate. Known agents are Alice, Bob, and Carol. Speak to another known agent, move to living_room, bedroom, kitchen, or abstract work, start one allowed activity, or wait.",
    input: JSON.stringify(context),
    text: { format: { type: "json_schema", name: "agent_decision", strict: true, schema: decisionJsonSchema } }
  };
}

export function extractResponseText(body) {
  const text = body.output_text ?? body.output?.flatMap(item => item.content ?? []).find(item => item.type === "output_text")?.text;
  if (!text) throw new ProviderError("OpenAI response contained no output text");
  return text;
}

export function parseDecision(raw) {
  let value;
  try { value = typeof raw === "string" ? JSON.parse(raw) : raw; }
  catch (error) { throw new Error(`invalid JSON: ${error.message}`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("decision must be an object");
  for (const key of ["interpretation", "intent"]) if (typeof value[key] !== "string" || !value[key]) throw new Error(`${key} must be a non-empty string`);
  const action = value.action;
  if (!action || !["speak", "move", "wait", "start_activity"].includes(action.type)) throw new Error("action.type must be speak, move, wait, or start_activity");
  if (action.type === "speak" && (typeof action.target !== "string" || typeof action.content !== "string" || !action.content)) throw new Error("speak requires target and content");
  if (action.type === "move" && (typeof action.destination !== "string" || !action.destination)) throw new Error("move requires destination");
  if (action.type === "start_activity" && !["eat", "sleep", "work", "rest", "leisure"].includes(action.activity)) throw new Error("start_activity requires a supported activity");
  const minutes = value.next_activation?.after_minutes;
  if (typeof minutes !== "number" || minutes < 5 || minutes > 360) throw new Error("next_activation.after_minutes must be between 5 and 360");
  return value;
}
