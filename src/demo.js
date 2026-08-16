import { OpenAIProvider } from "./provider.js";
import { Simulation } from "./simulation.js";

const simulation = new Simulation({ provider: new OpenAIProvider() });
const event = simulation.injectWorldEvent({ content: "客廳突然停電", location: "living_room", visible: true, audible: false });
const [agent] = simulation.observers(event);
simulation.resume();
try {
  if (!agent) throw new Error("Director event had no observer");
  await simulation.activate(agent, event, simulation.observation(event, agent));
  event.status = "processed";
  simulation.pause();
} catch (error) {
  console.error(`Simulation paused: ${error.message}`);
}
// Bounded to one real activation so pending speech/self-activation cannot create an API loop.
console.log(JSON.stringify(simulation.world, null, 2));
if (simulation.world.status === "paused" && simulation.world.errors.length) process.exitCode = 1;
