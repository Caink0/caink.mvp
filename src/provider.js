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
        body: JSON.stringify({
          model: this.model,
          instructions: "You are a simulated roommate. Decide only from the supplied context. Return a valid decision matching the JSON schema. Actions are speak, move, or wait.",
          input: JSON.stringify(context),
          text: { format: { type: "json_schema", name: "agent_decision", strict: true, schema: decisionJsonSchema } }
        })
      });
      if (!response.ok) throw new ProviderError(`OpenAI HTTP ${response.status}: ${await response.text()}`);
      const body = await response.json();
      const text = body.output_text ?? body.output?.flatMap(item => item.content ?? []).find(item => item.type === "output_text")?.text;
      if (!text) throw new ProviderError("OpenAI response contained no output text");
      return text;
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
      type: "object", additionalProperties: false,
      required: ["type", "target", "content", "destination"],
      properties: {
        type: { enum: ["speak", "move", "wait"] },
        target: { type: ["string", "null"] },
        content: { type: ["string", "null"] },
        destination: { type: ["string", "null"] }
      }
    },
    next_activation: { type: "object", additionalProperties: false, required: ["after_minutes"], properties: { after_minutes: { type: "number", minimum: 5, maximum: 360 } } }
  }
};

export function parseDecision(raw) {
  let value;
  try { value = typeof raw === "string" ? JSON.parse(raw) : raw; }
  catch (error) { throw new Error(`invalid JSON: ${error.message}`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("decision must be an object");
  for (const key of ["interpretation", "intent"]) if (typeof value[key] !== "string" || !value[key]) throw new Error(`${key} must be a non-empty string`);
  const action = value.action;
  if (!action || !["speak", "move", "wait"].includes(action.type)) throw new Error("action.type must be speak, move, or wait");
  if (action.type === "speak" && (typeof action.target !== "string" || typeof action.content !== "string" || !action.content)) throw new Error("speak requires target and content");
  if (action.type === "move" && (typeof action.destination !== "string" || !action.destination)) throw new Error("move requires destination");
  const minutes = value.next_activation?.after_minutes;
  if (typeof minutes !== "number" || minutes < 5 || minutes > 360) throw new Error("next_activation.after_minutes must be between 5 and 360");
  return value;
}
