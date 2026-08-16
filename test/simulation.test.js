import assert from "node:assert/strict";
import test from "node:test";
import { parseDecision } from "../src/provider.js";
import { createWorld, EventType, Simulation } from "../src/simulation.js";

const decision = (action = { type: "wait", target: null, content: null, destination: null }, after = 10) => ({ interpretation: "I noticed it", intent: "respond safely", action, next_activation: { after_minutes: after } });
class ScriptedProvider {
  constructor(outputs) { this.outputs = [...outputs]; this.contexts = []; this.name = "test-scripted"; this.model = "deterministic-fixture"; }
  async invoke(context) { this.contexts.push(structuredClone(context)); const value = this.outputs.shift(); if (value instanceof Error) throw value; return JSON.stringify(value); }
}
const simWith = (...outputs) => new Simulation({ world: createWorld(), provider: new ScriptedProvider(outputs), now: () => 100 });

test("event queue processes only due events and pause freezes consumption", async () => {
  const sim = simWith(decision()); sim.enqueue(EventType.ACTIVATION, { scheduled_at: "2026-01-01T09:05:00.000Z", source: "test", payload: { agent: "Alice", reason: "check" } });
  sim.resume(); assert.equal(await sim.processDue(), 0); assert.equal(await sim.advance(5), 1);
  sim.pause(); const pending = sim.enqueue(EventType.ACTIVATION, { source: "test", payload: { agent: "Alice", reason: "paused" } }); await sim.processDue(); assert.equal(pending.status, "pending");
});

test("observation router isolates a visible, inaudible room event", () => {
  const sim = simWith(); const event = sim.injectWorldEvent({ content: "客廳桌上的玻璃杯突然掉到地上。", location: "living_room", visible: true, audible: false });
  assert.deepEqual(sim.observers(event), ["Alice", "Bob"]); assert.equal(sim.observation(event, "Carol"), null);
  const carolContext = sim.context("Carol", { type: "scheduled_activation", content: "routine" }); assert.equal(JSON.stringify(carolContext).includes("玻璃杯"), false);
});

test("structured decision validation accepts valid and rejects invalid output", () => {
  assert.equal(parseDecision(JSON.stringify(decision())).action.type, "wait"); assert.throws(() => parseDecision('{"action":'), /invalid JSON/); assert.throws(() => parseDecision(decision(undefined, 2)), /between 5 and 360/);
});

test("move mutates shared world state", async () => {
  const sim = simWith(decision({ type: "move", target: null, content: null, destination: "kitchen" })); const event = sim.injectWorldEvent({ content: "go", location: "living_room" });
  await sim.activate("Alice", event, sim.observation(event, "Alice")); assert.equal(sim.world.agents.Alice.current_state.location, "kitchen"); assert.equal(sim.world.traces[0].world_state_change.to, "kitchen");
});

test("Alice speech creates an event which activates Bob", async () => {
  const sim = simWith(decision({ type: "speak", target: "Bob", content: "你那邊也停電了嗎？", destination: null }), decision());
  const trigger = sim.injectWorldEvent({ content: "客廳突然停電", location: "living_room" }); await sim.activate("Alice", trigger, sim.observation(trigger, "Alice"));
  trigger.status = "processed"; const speech = sim.world.events.find(event => event.type === EventType.SPEECH); assert.ok(speech); sim.resume(); await sim.processDue();
  assert.equal(sim.provider.contexts[1].character.name, "Bob"); assert.match(sim.provider.contexts[1].observation.content, /Alice says/);
});

test("successful activation schedules guarded next activation", async () => {
  const sim = simWith(decision()); const trigger = sim.injectWorldEvent({ content: "event", location: "living_room" }); const trace = await sim.activate("Alice", trigger, sim.observation(trigger, "Alice"));
  assert.equal(trace.next_activation.type, EventType.ACTIVATION); assert.equal(trace.next_activation.scheduled_at, "2026-01-01T09:10:00.000Z");
});

test("invalid agent response pauses simulation and records failure trace", async () => {
  const sim = simWith({ nope: true }); const trigger = sim.injectWorldEvent({ content: "event", location: "living_room" }); sim.resume();
  await assert.rejects(sim.activate("Alice", trigger, sim.observation(trigger, "Alice")), /interpretation/); assert.equal(sim.world.status, "paused"); assert.equal(sim.world.traces[0].status, "failed"); assert.equal(sim.world.errors.length, 1);
});
