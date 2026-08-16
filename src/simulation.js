import { parseDecision } from "./provider.js";

export const EventType = Object.freeze({ WORLD: "WORLD_EVENT", ACTIVATION: "AGENT_ACTIVATION", SPEECH: "SPEECH_EVENT" });

export function createWorld(start = "2026-01-01T09:00:00.000Z") {
  const profile = (name, location) => ({
    character: { name, background: `${name} shares the apartment.`, personality: "considerate and practical", likes: [], dislikes: [], current_goal: "respond appropriately" },
    current_state: { location, activity: "idle" }, needs: { energy: 62, hunger: 40, social: 55, stress: 28 }
  });
  return { simulation_time: start, status: "paused", speed: 1, agents: { Alice: profile("Alice", "living_room"), Bob: profile("Bob", "living_room"), Carol: profile("Carol", "bedroom") }, locations: { living_room: {}, bedroom: {}, kitchen: {} }, objects: {}, events: [], traces: [], errors: [] };
}

export class Simulation {
  constructor({ world = createWorld(), provider, now = () => Date.now() }) { this.world = world; this.provider = provider; this.now = now; this.sequence = 0; }
  id(prefix) { return `${prefix}-${++this.sequence}`; }
  enqueue(type, { scheduled_at = this.world.simulation_time, source, location = null, payload = {} }) {
    const event = { id: this.id("event"), type, scheduled_at, source, location, payload, status: "pending" };
    this.world.events.push(event); this.world.events.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)); return event;
  }
  injectWorldEvent({ content, location, visible = true, audible = false }) { return this.enqueue(EventType.WORLD, { source: "director", location, payload: { content, visible, audible } }); }
  dueEvents() { return this.world.events.filter(event => event.status === "pending" && event.scheduled_at <= this.world.simulation_time); }
  observers(event) {
    return Object.entries(this.world.agents).filter(([name, agent]) => {
      const isInEventRoom = agent.current_state.location === event.location;
      if (!isInEventRoom) return false;
      if (event.type === EventType.SPEECH) return name !== event.payload.speaker;
      return Boolean(event.payload.visible || event.payload.audible);
    }).map(([name]) => name);
  }
  observation(event, agent) {
    if (!this.observers(event).includes(agent)) return null;
    return { type: event.type === EventType.WORLD ? "world_event" : "speech_event", content: event.type === EventType.SPEECH ? `${event.payload.speaker} says: ${event.payload.content}` : event.payload.content };
  }
  context(agentId, observation) { const agent = this.world.agents[agentId]; return { character: structuredClone(agent.character), current_state: structuredClone(agent.current_state), needs: structuredClone(agent.needs), observation, relevant_memories: [] }; }
  async activate(agentId, trigger, observation) {
    const activationId = this.id("activation"), context = this.context(agentId, observation), started = this.now();
    const trace = { activation_id: activationId, agent: agentId, trigger_event: structuredClone(trigger), observation, relevant_memory: [], provider: this.provider.name, model: this.provider.model, status: "running" };
    this.world.traces.push(trace);
    try {
      const decision = parseDecision(await this.provider.invoke(context));
      Object.assign(trace, { interpretation: decision.interpretation, intent: decision.intent, structured_action: decision.action });
      trace.world_state_change = this.execute(agentId, decision.action, trigger);
      const nextAt = new Date(new Date(this.world.simulation_time).getTime() + decision.next_activation.after_minutes * 60_000).toISOString();
      const next = this.enqueue(EventType.ACTIVATION, { scheduled_at: nextAt, source: agentId, location: this.world.agents[agentId].current_state.location, payload: { agent: agentId, reason: "self_scheduled" } });
      trace.next_activation = structuredClone(next); trace.latency_ms = this.now() - started; trace.status = "success";
      return trace;
    } catch (error) {
      this.world.status = "paused";
      const failure = { simulation_time: this.world.simulation_time, agent: agentId, trigger_event: trigger.id, provider: this.provider.name, model: this.provider.model, error_type: error.constructor.name, error_detail: error.message };
      this.world.errors.push(failure); Object.assign(trace, { latency_ms: this.now() - started, status: "failed", error: failure }); throw error;
    }
  }
  execute(agentId, action, trigger) {
    if (action.type === "move") { const from = this.world.agents[agentId].current_state.location; if (!this.world.locations[action.destination]) throw new Error(`unknown destination: ${action.destination}`); this.world.agents[agentId].current_state.location = action.destination; return { path: `agents.${agentId}.current_state.location`, from, to: action.destination }; }
    if (action.type === "speak") { if (!this.world.agents[action.target]) throw new Error(`unknown speech target: ${action.target}`); const event = this.enqueue(EventType.SPEECH, { source: agentId, location: this.world.agents[agentId].current_state.location, payload: { speaker: agentId, target: action.target, content: action.content, audible: true } }); return { created_event: event.id, type: EventType.SPEECH }; }
    return { type: "wait", changed: false, trigger: trigger.id };
  }
  async dispatch(event) {
    event.status = "processing";
    try {
      if (event.type === EventType.ACTIVATION) await this.activate(event.payload.agent, event, { type: "scheduled_activation", content: event.payload.reason });
      else {
        // Capture every observation before an earlier observer can mutate the world.
        const routed = this.observers(event).map(agent => [agent, this.observation(event, agent)]);
        for (const [agent, observation] of routed) await this.activate(agent, event, observation);
      }
      event.status = "processed";
    } catch (error) { event.status = "failed"; throw error; }
  }
  async processDue() { if (this.world.status !== "running") return 0; let count = 0; while (this.world.status === "running") { const event = this.dueEvents()[0]; if (!event) break; await this.dispatch(event); count++; } return count; }
  resume() { this.world.status = "running"; }
  pause() { this.world.status = "paused"; }
  async advance(minutes) { if (this.world.status !== "running") return 0; this.world.simulation_time = new Date(new Date(this.world.simulation_time).getTime() + minutes * 60_000 * this.world.speed).toISOString(); return this.processDue(); }
}
