import assert from "node:assert/strict";
import test from "node:test";
import { createWorld, EventType, Simulation } from "../src/simulation.js";

const fullAction = action => ({ target: null, content: null, destination: null, activity: null, ...action });
const decision = (action = { type: "wait" }, after = 60) => ({
  interpretation: "I considered my current life context.",
  intent: "Choose an autonomous next step.",
  action: fullAction(action),
  next_activation: { after_minutes: after }
});

class ContextProvider {
  constructor(decide = () => decision()) {
    this.decide = decide;
    this.contexts = [];
    this.name = "test-autonomy";
    this.model = "deterministic-fixture";
  }
  async invoke(context) {
    this.contexts.push(structuredClone(context));
    return JSON.stringify(this.decide(context, this.contexts.length - 1));
  }
}

const simWith = (start = "2026-01-05T08:55:00.000Z", decide) => {
  const provider = new ContextProvider(decide);
  return { sim: new Simulation({ world: createWorld(start), provider, now: () => 100 }), provider };
};

function enqueueAliceSchedule(sim, phase = "start", scheduled_at = "2026-01-05T09:00:00.000Z") {
  const commitment = sim.world.agents.Alice.schedule[0];
  return sim.enqueue(EventType.SCHEDULE, {
    scheduled_at,
    source: "schedule",
    payload: { agent: "Alice", schedule_id: commitment.id, phase, commitment: structuredClone(commitment) }
  });
}

test("autonomy bootstrap creates staggered initial agent activations without a director event", () => {
  const { sim } = simWith();
  sim.bootstrapAutonomy({ horizonHours: 24 });
  const activations = sim.world.events.filter(event => event.type === EventType.ACTIVATION && event.payload.reason === "bootstrap");
  assert.deepEqual(activations.map(event => event.payload.agent), ["Alice", "Bob", "Carol"]);
  assert.deepEqual(activations.map(event => event.scheduled_at), ["2026-01-05T08:55:00.000Z", "2026-01-05T09:00:00.000Z", "2026-01-05T09:05:00.000Z"]);
  assert.equal(sim.world.events.some(event => event.type === EventType.WORLD), false);
});

test("different schedules enqueue start and end events at simulation time", () => {
  const { sim } = simWith();
  sim.enqueueScheduleEvents(14);
  const scheduleEvents = sim.world.events.filter(event => event.type === EventType.SCHEDULE);
  const at = (agent, phase) => scheduleEvents.find(event => event.payload.agent === agent && event.payload.phase === phase)?.scheduled_at;
  assert.equal(at("Alice", "start"), "2026-01-05T09:00:00.000Z");
  assert.equal(at("Alice", "end"), "2026-01-05T18:00:00.000Z");
  assert.equal(at("Bob", "start"), "2026-01-05T13:00:00.000Z");
  assert.equal(at("Carol", "start"), "2026-01-05T10:00:00.000Z");
});

test("schedule is a constraint and a wait decision does not force movement", async () => {
  const { sim, provider } = simWith();
  enqueueAliceSchedule(sim);
  sim.resume();
  assert.equal(await sim.advance(5), 1);
  assert.equal(sim.world.agents.Alice.current_state.location, "living_room");
  assert.equal(provider.contexts[0].observation.type, "schedule_event");
  assert.equal(provider.contexts[0].schedule_context.current_commitment.id, "alice-office");
});

test("agent can comply with schedule by choosing move to abstract work", async () => {
  const { sim } = simWith(undefined, () => decision({ type: "move", destination: "work" }));
  enqueueAliceSchedule(sim);
  sim.resume();
  await sim.advance(5);
  assert.equal(sim.world.agents.Alice.current_state.location, "work");
});

test("external agent does not observe apartment events or recover history later", () => {
  const { sim } = simWith();
  sim.world.agents.Alice.current_state.location = "work";
  const event = sim.injectWorldEvent({ content: "客廳的燈閃爍。", location: "living_room", visible: true, audible: true });
  assert.equal(sim.observation(event, "Alice"), null);
  sim.world.agents.Alice.current_state.location = "living_room";
  const laterContext = sim.context("Alice", { type: "scheduled_activation", content: "return_home" });
  assert.equal(JSON.stringify(laterContext).includes("燈閃爍"), false);
});

test("needs progress deterministically with simulation time", async () => {
  const { sim } = simWith();
  sim.resume();
  await sim.advance(60);
  assert.deepEqual(sim.world.agents.Alice.needs, { energy: 60, hunger: 44, social: 56.5, stress: 28.5 });
});

test("needs are clamped to the 0 through 100 range", async () => {
  const { sim } = simWith();
  sim.world.agents.Alice.needs = { energy: 1, hunger: 99, social: 99, stress: 99 };
  sim.resume();
  await sim.advance(24 * 60);
  assert.deepEqual(sim.world.agents.Alice.needs, { energy: 0, hunger: 100, social: 100, stress: 100 });
});

test("updated needs and schedule context reach the provider and God View trace", async () => {
  const { sim, provider } = simWith();
  sim.progressNeedsTo("2026-01-05T09:00:00.000Z");
  sim.world.simulation_time = "2026-01-05T09:00:00.000Z";
  const event = sim.enqueue(EventType.ACTIVATION, { source: "test", payload: { agent: "Alice", reason: "bootstrap" } });
  sim.resume();
  await sim.processDue({ maxEvents: 1 });
  assert.equal(provider.contexts[0].needs.hunger, sim.world.traces[0].needs_before.hunger);
  assert.equal(provider.contexts[0].schedule_context.current_commitment.id, "alice-office");
  assert.equal(sim.world.traces[0].activation_source, "bootstrap");
  assert.equal(sim.world.traces[0].current_activity, "idle");
  assert.equal(sim.world.activation_count, 1);
  assert.equal(event.status, "processed");
});

test("start_activity changes runtime activity and needs deterministically", () => {
  const { sim } = simWith();
  const trigger = sim.enqueue(EventType.ACTIVATION, { source: "test", payload: { agent: "Alice", reason: "bootstrap" } });
  const change = sim.execute("Alice", fullAction({ type: "start_activity", activity: "eat" }), trigger);
  assert.equal(sim.world.agents.Alice.current_state.activity, "eat");
  assert.equal(sim.world.agents.Alice.needs.hunger, 5);
  assert.equal(change.needs_after.hunger, 5);
});

test("schedule event wakes agent before a later self-scheduled activation", async () => {
  const { sim } = simWith(undefined, () => decision({ type: "wait" }, 60));
  sim.enqueue(EventType.ACTIVATION, { source: "autonomy", payload: { agent: "Alice", reason: "bootstrap" } });
  enqueueAliceSchedule(sim);
  sim.resume();
  const run = await sim.runUntil("2026-01-05T09:01:00.000Z", { maxEvents: 10, maxActivations: 10 });
  assert.deepEqual(sim.world.traces.map(trace => trace.activation_source), ["bootstrap", "schedule"]);
  const selfScheduled = sim.world.events.find(event => event.type === EventType.ACTIVATION && event.payload.reason === "self_scheduled");
  assert.equal(selfScheduled.scheduled_at, "2026-01-05T09:55:00.000Z");
  assert.equal(run.reached_until, true);
});

test("24h deterministic autonomous simulation completes within guards without director input", async () => {
  const choose = context => {
    if (context.observation.type === "schedule_event" && context.observation.phase === "start") {
      if (context.character.name === "Alice") return decision({ type: "wait" }, 180);
      if (context.character.name === "Bob") return decision({ type: "move", destination: "work" }, 180);
      return decision({ type: "start_activity", activity: "work" }, 180);
    }
    if (context.observation.type === "schedule_event" && context.observation.phase === "end" && context.current_state.location === "work") {
      return decision({ type: "move", destination: "living_room" }, 180);
    }
    if (context.needs.hunger >= 70) return decision({ type: "start_activity", activity: "eat" }, 180);
    return decision({ type: "wait" }, 180);
  };
  const { sim } = simWith(undefined, choose);
  sim.bootstrapAutonomy({ horizonHours: 24 });
  sim.resume();
  const run = await sim.runUntil("2026-01-06T08:55:00.000Z", { maxEvents: 200, maxActivations: 100 });

  assert.deepEqual(run, { events: run.events, activations: run.activations, reached_until: true, guard_hit: null });
  assert.ok(run.events > 20 && run.events < 200);
  assert.ok(run.activations > 20 && run.activations < 100);
  assert.equal(sim.world.events.some(event => event.type === EventType.WORLD), false);
  assert.ok(sim.world.traces.some(trace => trace.activation_source === "bootstrap"));
  assert.ok(sim.world.traces.some(trace => trace.activation_source === "schedule"));
  assert.ok(sim.world.traces.some(trace => trace.activation_source === "self_scheduled"));
  assert.ok(sim.world.traces.some(trace => trace.agent === "Alice" && trace.activation_source === "schedule" && trace.structured_action.type === "wait"));
  assert.ok(sim.world.traces.some(trace => trace.agent === "Bob" && trace.world_state_change.to === "work"));
  assert.equal(sim.world.events.some(event => event.status === "processing"), false);
  assert.equal(sim.world.errors.length, 0);
});
