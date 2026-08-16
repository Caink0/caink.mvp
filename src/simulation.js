import { parseDecision } from "./provider.js";

export const EventType = Object.freeze({
  WORLD: "WORLD_EVENT",
  ACTIVATION: "AGENT_ACTIVATION",
  SPEECH: "SPEECH_EVENT",
  SCHEDULE: "SCHEDULE_EVENT"
});

export const Activity = Object.freeze({ EAT: "eat", SLEEP: "sleep", WORK: "work", REST: "rest", LEISURE: "leisure" });

export const NEED_RATES_PER_HOUR = Object.freeze({ energy: -2, hunger: 4, social: 1.5, stress: 0.5 });
export const ACTIVITY_NEED_EFFECTS = Object.freeze({
  [Activity.EAT]: { hunger: -35 },
  [Activity.SLEEP]: { energy: 30, stress: -5 },
  [Activity.WORK]: { energy: -5, stress: 8 },
  [Activity.REST]: { energy: 10, stress: -15 },
  [Activity.LEISURE]: { social: -10, stress: -10 }
});

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const clampNeed = value => Math.max(0, Math.min(100, Number(value.toFixed(4))));
const addMinutes = (iso, minutes) => new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
const minutesAt = time => {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};

export function createWorld(start = "2026-01-01T09:00:00.000Z") {
  const profile = (name, location, schedule) => ({
    character: { name, background: `${name} shares the apartment.`, personality: "considerate and practical", likes: [], dislikes: [], current_goal: "respond appropriately" },
    current_state: { location, activity: "idle" },
    needs: { energy: 62, hunger: 40, social: 55, stress: 28 },
    schedule
  });
  const weekdays = ["mon", "tue", "wed", "thu", "fri"];
  return {
    simulation_time: start,
    status: "paused",
    speed: 1,
    activation_count: 0,
    autonomy_bootstrapped: false,
    agents: {
      Alice: profile("Alice", "living_room", [{ id: "alice-office", type: "work", start: "09:00", end: "18:00", days: weekdays, location: "work" }]),
      Bob: profile("Bob", "living_room", [{ id: "bob-late-shift", type: "work", start: "13:00", end: "21:00", days: weekdays, location: "work" }]),
      Carol: profile("Carol", "bedroom", [{ id: "carol-remote", type: "remote_work", start: "10:00", end: "16:00", days: ["mon", "wed", "fri"], location: "living_room" }])
    },
    locations: { living_room: {}, bedroom: {}, kitchen: {}, work: { abstract_external: true } },
    objects: {},
    events: [],
    traces: [],
    errors: []
  };
}

export class Simulation {
  constructor({ world = createWorld(), provider, now = () => Date.now() }) {
    this.world = world;
    this.provider = provider;
    this.now = now;
    this.sequence = 0;
  }

  id(prefix) { return `${prefix}-${++this.sequence}`; }

  enqueue(type, { scheduled_at = this.world.simulation_time, source, location = null, payload = {} }) {
    const event = { id: this.id("event"), type, scheduled_at, source, location, payload, status: "pending" };
    this.world.events.push(event);
    this.world.events.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
    return event;
  }

  injectWorldEvent({ content, location, visible = true, audible = false }) {
    return this.enqueue(EventType.WORLD, { source: "director", location, payload: { content, visible, audible } });
  }

  dueEvents() {
    return this.world.events.filter(event => event.status === "pending" && event.scheduled_at <= this.world.simulation_time);
  }

  bootstrapAutonomy({ horizonHours = 24, staggerMinutes = [0, 5, 10] } = {}) {
    if (this.world.autonomy_bootstrapped) return [];
    const events = Object.keys(this.world.agents).map((agent, index) => this.enqueue(EventType.ACTIVATION, {
      scheduled_at: addMinutes(this.world.simulation_time, staggerMinutes[index] ?? index * 5),
      source: "autonomy",
      location: this.world.agents[agent].current_state.location,
      payload: { agent, reason: "bootstrap" }
    }));
    events.push(...this.enqueueScheduleEvents(horizonHours));
    this.world.autonomy_bootstrapped = true;
    return events;
  }

  enqueueScheduleEvents(horizonHours = 24) {
    const from = new Date(this.world.simulation_time);
    const until = new Date(from.getTime() + horizonHours * 3_600_000);
    const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
    const existing = new Set(this.world.events.filter(event => event.type === EventType.SCHEDULE).map(event => `${event.payload.agent}:${event.payload.schedule_id}:${event.payload.phase}:${event.scheduled_at}`));
    const events = [];

    while (cursor <= until) {
      const day = DAY_NAMES[cursor.getUTCDay()];
      for (const [agentId, agent] of Object.entries(this.world.agents)) {
        for (const commitment of agent.schedule ?? []) {
          if (!commitment.days.includes(day)) continue;
          for (const phase of ["start", "end"]) {
            const [hours, minutes] = commitment[phase].split(":").map(Number);
            const scheduled = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate(), hours, minutes)).toISOString();
            const key = `${agentId}:${commitment.id}:${phase}:${scheduled}`;
            if (new Date(scheduled) < from || new Date(scheduled) > until || existing.has(key)) continue;
            events.push(this.enqueue(EventType.SCHEDULE, {
              scheduled_at: scheduled,
              source: "schedule",
              payload: { agent: agentId, schedule_id: commitment.id, phase, commitment: structuredClone(commitment) }
            }));
            existing.add(key);
          }
        }
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return events;
  }

  observers(event) {
    return Object.entries(this.world.agents).filter(([name, agent]) => {
      const isInEventRoom = agent.current_state.location === event.location;
      if (!isInEventRoom || this.world.locations[event.location]?.abstract_external) return false;
      if (event.type === EventType.SPEECH) return name !== event.payload.speaker;
      return Boolean(event.payload.visible || event.payload.audible);
    }).map(([name]) => name);
  }

  observation(event, agent) {
    if (!this.observers(event).includes(agent)) return null;
    return {
      type: event.type === EventType.WORLD ? "world_event" : "speech_event",
      content: event.type === EventType.SPEECH ? `${event.payload.speaker} says: ${event.payload.content}` : event.payload.content
    };
  }

  currentCommitment(agentId, at = this.world.simulation_time) {
    const date = new Date(at);
    const day = DAY_NAMES[date.getUTCDay()];
    const minute = date.getUTCHours() * 60 + date.getUTCMinutes();
    const commitment = (this.world.agents[agentId].schedule ?? []).find(item => item.days.includes(day) && minute >= minutesAt(item.start) && minute < minutesAt(item.end));
    return commitment ? structuredClone(commitment) : null;
  }

  scheduleContext(agentId) {
    const upcoming = this.world.events
      .filter(event => event.type === EventType.SCHEDULE && event.status === "pending" && event.payload.agent === agentId && event.payload.phase === "start" && event.scheduled_at > this.world.simulation_time)
      .slice(0, 3)
      .map(event => ({ scheduled_at: event.scheduled_at, ...structuredClone(event.payload.commitment) }));
    return { current_commitment: this.currentCommitment(agentId), upcoming_commitments: upcoming };
  }

  context(agentId, observation) {
    const agent = this.world.agents[agentId];
    return {
      character: structuredClone(agent.character),
      current_state: structuredClone(agent.current_state),
      needs: structuredClone(agent.needs),
      observation,
      schedule_context: this.scheduleContext(agentId),
      relevant_memories: []
    };
  }

  activationSource(trigger) {
    if (trigger.type === EventType.SCHEDULE) return "schedule";
    if (trigger.type === EventType.SPEECH) return "speech";
    if (trigger.type === EventType.WORLD) return "world_event";
    return trigger.payload.reason === "bootstrap" ? "bootstrap" : "self_scheduled";
  }

  async activate(agentId, trigger, observation) {
    const activationId = this.id("activation");
    const context = this.context(agentId, observation);
    const started = this.now();
    const trace = {
      activation_id: activationId,
      activation_source: this.activationSource(trigger),
      agent: agentId,
      trigger_event: structuredClone(trigger),
      observation,
      relevant_memory: [],
      needs_before: structuredClone(context.needs),
      schedule_context: structuredClone(context.schedule_context),
      provider: this.provider.name,
      model: this.provider.model,
      status: "running"
    };
    this.world.activation_count += 1;
    this.world.traces.push(trace);
    try {
      const decision = parseDecision(await this.provider.invoke(context));
      Object.assign(trace, { interpretation: decision.interpretation, intent: decision.intent, structured_action: decision.action });
      trace.world_state_change = this.execute(agentId, decision.action, trigger);
      trace.needs_after = structuredClone(this.world.agents[agentId].needs);
      trace.current_activity = this.world.agents[agentId].current_state.activity;
      const nextAt = addMinutes(this.world.simulation_time, decision.next_activation.after_minutes);
      const next = this.enqueue(EventType.ACTIVATION, { scheduled_at: nextAt, source: agentId, location: this.world.agents[agentId].current_state.location, payload: { agent: agentId, reason: "self_scheduled" } });
      trace.next_activation = structuredClone(next);
      trace.latency_ms = this.now() - started;
      trace.status = "success";
      return trace;
    } catch (error) {
      this.world.status = "paused";
      const failure = { simulation_time: this.world.simulation_time, agent: agentId, trigger_event: trigger.id, provider: this.provider.name, model: this.provider.model, error_type: error.constructor.name, error_detail: error.message };
      this.world.errors.push(failure);
      Object.assign(trace, { needs_after: structuredClone(this.world.agents[agentId].needs), current_activity: this.world.agents[agentId].current_state.activity, latency_ms: this.now() - started, status: "failed", error: failure });
      throw error;
    }
  }

  applyNeeds(agentId, effects) {
    const needs = this.world.agents[agentId].needs;
    for (const [need, delta] of Object.entries(effects)) needs[need] = clampNeed(needs[need] + delta);
  }

  execute(agentId, action, trigger) {
    const agent = this.world.agents[agentId];
    if (action.type === "move") {
      const from = agent.current_state.location;
      if (!this.world.locations[action.destination]) throw new Error(`unknown destination: ${action.destination}`);
      agent.current_state.location = action.destination;
      return { path: `agents.${agentId}.current_state.location`, from, to: action.destination };
    }
    if (action.type === "speak") {
      if (!this.world.agents[action.target]) throw new Error(`unknown speech target: ${action.target}`);
      const event = this.enqueue(EventType.SPEECH, { source: agentId, location: agent.current_state.location, payload: { speaker: agentId, target: action.target, content: action.content, audible: true } });
      return { created_event: event.id, type: EventType.SPEECH };
    }
    if (action.type === "start_activity") {
      const effects = ACTIVITY_NEED_EFFECTS[action.activity];
      if (!effects) throw new Error(`unknown activity: ${action.activity}`);
      const from = agent.current_state.activity;
      const needsBefore = structuredClone(agent.needs);
      agent.current_state.activity = action.activity;
      this.applyNeeds(agentId, effects);
      return { path: `agents.${agentId}.current_state.activity`, from, to: action.activity, needs_before: needsBefore, needs_after: structuredClone(agent.needs) };
    }
    return { type: "wait", changed: false, trigger: trigger.id };
  }

  progressNeedsTo(targetTime) {
    const from = new Date(this.world.simulation_time).getTime();
    const to = new Date(targetTime).getTime();
    if (to <= from) return;
    const hours = (to - from) / 3_600_000;
    for (const agentId of Object.keys(this.world.agents)) {
      this.applyNeeds(agentId, Object.fromEntries(Object.entries(NEED_RATES_PER_HOUR).map(([need, rate]) => [need, rate * hours])));
    }
  }

  async dispatch(event, { maxActivations = Infinity } = {}) {
    let routed;
    if (event.type === EventType.ACTIVATION) {
      routed = [[event.payload.agent, { type: "scheduled_activation", content: event.payload.reason }]];
    } else if (event.type === EventType.SCHEDULE) {
      routed = [[event.payload.agent, {
        type: "schedule_event",
        content: `Scheduled ${event.payload.commitment.type} ${event.payload.phase} at ${event.payload.commitment[event.payload.phase]}.`,
        phase: event.payload.phase,
        commitment: structuredClone(event.payload.commitment)
      }]];
    } else {
      routed = this.observers(event).map(agent => [agent, this.observation(event, agent)]);
    }
    if (routed.length > maxActivations) return { processed: false, activations: 0 };

    event.status = "processing";
    try {
      for (const [agent, observation] of routed) await this.activate(agent, event, observation);
      event.status = "processed";
      return { processed: true, activations: routed.length };
    } catch (error) {
      event.status = "failed";
      throw error;
    }
  }

  async processDue({ maxEvents = Infinity, maxActivations = Infinity } = {}) {
    if (this.world.status !== "running") return 0;
    const activationStart = this.world.activation_count;
    let count = 0;
    while (this.world.status === "running" && count < maxEvents) {
      const event = this.dueEvents()[0];
      if (!event) break;
      const remaining = maxActivations - (this.world.activation_count - activationStart);
      const result = await this.dispatch(event, { maxActivations: remaining });
      if (!result.processed) break;
      count += 1;
    }
    return count;
  }

  async runUntil(until, { maxEvents = 1_000, maxActivations = 500 } = {}) {
    if (this.world.status !== "running") return { events: 0, activations: 0, reached_until: false, guard_hit: "paused" };
    const target = new Date(until);
    if (target < new Date(this.world.simulation_time)) throw new Error("runUntil target must not be before simulation time");
    const activationStart = this.world.activation_count;
    let events = 0;
    let guardHit = null;

    while (this.world.status === "running") {
      const next = this.world.events.find(event => event.status === "pending");
      if (!next || new Date(next.scheduled_at) > target) break;
      if (events >= maxEvents) { guardHit = "maxEvents"; break; }
      const activations = this.world.activation_count - activationStart;
      if (activations >= maxActivations) { guardHit = "maxActivations"; break; }
      if (next.scheduled_at > this.world.simulation_time) {
        this.progressNeedsTo(next.scheduled_at);
        this.world.simulation_time = next.scheduled_at;
      }
      const result = await this.dispatch(next, { maxActivations: maxActivations - activations });
      if (!result.processed) { guardHit = "maxActivations"; break; }
      events += 1;
    }

    if (!guardHit && this.world.status === "running" && target > new Date(this.world.simulation_time)) {
      const targetIso = target.toISOString();
      this.progressNeedsTo(targetIso);
      this.world.simulation_time = targetIso;
    }
    const result = { events, activations: this.world.activation_count - activationStart, reached_until: !guardHit && this.world.simulation_time === target.toISOString(), guard_hit: guardHit };
    this.world.last_run = structuredClone(result);
    return result;
  }

  resume() { this.world.status = "running"; }
  pause() { this.world.status = "paused"; }

  async advance(minutes, options) {
    if (this.world.status !== "running") return 0;
    const target = addMinutes(this.world.simulation_time, minutes * this.world.speed);
    const result = await this.runUntil(target, options);
    return result.events;
  }
}
