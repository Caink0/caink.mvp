import { OpenAIProvider } from "./provider.js";
import { Simulation } from "./simulation.js";

const simulation = new Simulation({ provider: new OpenAIProvider() });
simulation.injectWorldEvent({ content: "客廳突然停電", location: "living_room", visible: true, audible: false });
simulation.resume();
try {
  await simulation.processDue();
} catch (error) {
  console.error(`Simulation paused: ${error.message}`);
}
// This JSON is the Phase-1 God View: every value originates in the live runtime.
console.log(JSON.stringify(simulation.world, null, 2));
if (simulation.world.status === "paused" && simulation.world.errors.length) process.exitCode = 1;
