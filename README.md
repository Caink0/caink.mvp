# AI Roommate Simulation Core — Phase 1

This technical spike implements one shared, event-driven simulation runtime. It intentionally has no polished UI: `npm run demo` prints the **God View** as runtime JSON.

## Architecture and flow

`Simulation` owns the shared world, virtual clock, event queue, observation router, action executor, and immutable-at-capture traces. Director events are queued, filtered by room visibility/audibility, converted to agent-specific contexts, sent through a provider adapter, validated, executed, and followed by a guarded self-activation. Perceptible world events stay within their room. `speak` creates a face-to-face `SPEECH_EVENT` for the same-room target and bystanders; `move` updates the shared location.

The OpenAI adapter uses the Responses API with strict JSON Schema. It is deliberately separate from simulation logic. Failures never fall back: provider, parsing, validation, and execution errors pause the simulation and create an error record.

## Run

Requires Node.js 20+ and a real OpenAI API credential:

```bash
export OPENAI_API_KEY='...'
export OPENAI_MODEL='gpt-4.1-mini' # optional
npm run demo
```

`.env.example` lists the supported variables for reference. The runtime reads exported environment variables directly and does not load `.env` files itself.

The demo injects `客廳突然停電`, routes it to one observer, performs exactly one real provider activation, and prints the complete state and God View traces. The one-activation bound proves the live Phase 1 chain without consuming API calls from pending speech or self-scheduled events. Keep credentials outside Git.

```bash
npm test
```

Tests use a deterministic provider fixture solely to test runtime mechanics; it is not evidence of a real provider invocation and does not satisfy AC-01.

## Contracts

Agent input contains `character`, `current_state`, `needs`, one filtered `observation`, and `relevant_memories: []`. Output contains `interpretation`, `intent`, an action (`speak`, `move`, or `wait`), and `next_activation.after_minutes` (5–360 simulation minutes). Memory retrieval is intentionally deferred.
