import { OpenAIProvider } from "./provider.js";
import { createWorld, Simulation } from "./simulation.js";

const simulation = new Simulation({ world: createWorld("2026-01-05T09:00:00.000Z"), provider: new OpenAIProvider() });
simulation.bootstrapAutonomy({ horizonHours: 24 });
simulation.resume();
let run;
try {
  run = await simulation.runUntil("2026-01-05T09:05:00.000Z", { maxEvents: 3, maxActivations: 1 });
  simulation.pause();
} catch (error) {
  console.error(`Simulation paused: ${error.message}`);
}
// Director injects no world event; the one-activation guard prevents an autonomous API loop.
console.log(JSON.stringify({ run, world: simulation.world }, null, 2));
if (simulation.world.status === "paused" && simulation.world.errors.length) process.exitCode = 1;
