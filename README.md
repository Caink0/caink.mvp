# AI Roommate Simulation Core — Phase 1

This technical spike implements one shared, event-driven simulation runtime. It intentionally has no polished UI: `npm run demo` prints the **God View** as runtime JSON.

## Architecture and flow

`Simulation` owns the shared world, virtual clock, event queue, observation router, action executor, and immutable-at-capture traces. Director events are queued, filtered by room visibility/audibility, converted to agent-specific contexts, sent through a provider adapter, validated, executed, and followed by a guarded self-activation. `speak` creates a `SPEECH_EVENT`, routed only to its target; `move` updates the shared location.

The OpenAI adapter uses the Responses API with strict JSON Schema. It is deliberately separate from simulation logic. Failures never fall back: provider, parsing, validation, and execution errors pause the simulation and create an error record.

## Run

Requires Node.js 20+ and a real OpenAI API credential:

```bash
cp .env.example .env
export OPENAI_API_KEY='...'
export OPENAI_MODEL='gpt-4.1-mini' # optional
npm run demo
```

The demo injects `客廳突然停電`, invokes real agents, processes generated speech/activations, and prints the complete state and God View traces. Keep credentials outside Git.

```bash
npm test
```

Tests use a deterministic provider fixture solely to test runtime mechanics; it is not evidence of a real provider invocation and does not satisfy AC-01.

## Contracts

Agent input contains `character`, `current_state`, `needs`, one filtered `observation`, and `relevant_memories: []`. Output contains `interpretation`, `intent`, an action (`speak`, `move`, or `wait`), and `next_activation.after_minutes` (5–360 simulation minutes). Memory retrieval is intentionally deferred.
