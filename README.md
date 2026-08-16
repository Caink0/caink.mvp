# AI Roommate Simulation Core — Autonomous Life Foundation

This technical spike extends the shared Phase 1 runtime so Alice, Bob, and Carol can begin and continue life without a Director world event. It intentionally has no production UI, persistence, memory retrieval, or social scoring.

## Architecture and flow

`Simulation` still owns one shared world, virtual clock, sorted event queue, observation router, action executor, and God View traces. Phase 2 adds:

- `bootstrapAutonomy()`, which queues staggered initial `AGENT_ACTIVATION` events for all three agents.
- Agent-specific recurring commitments compiled into targeted `SCHEDULE_EVENT` start/end events.
- Deterministic Needs progression driven only by Simulation Time.
- A finite `start_activity` action alongside `speak`, `move`, and `wait`.
- `runUntil()` event/activation guards for deterministic long runs and bounded live verification.

Schedules are strong decision context, never scripts. A schedule event wakes the agent and supplies the commitment, but the engine accepts compliance, delay, or deviation. `work` is an abstract external location: agents there receive no apartment observations, and no workplace world or NPC simulation is created.

## Needs and activities

Needs use 0–100 and are clamped after every update. Per simulation hour:

| Need | Deterministic change |
|---|---:|
| Energy | -2 |
| Hunger | +4 |
| Social pressure | +1.5 |
| Stress | +0.5 |

Finite activity effects are immediate and deterministic:

| Activity | Effect |
|---|---|
| `eat` | Hunger -35 |
| `sleep` | Energy +30, Stress -5 |
| `work` | Energy -5, Stress +8 |
| `rest` | Energy +10, Stress -15 |
| `leisure` | Social pressure -10, Stress -10 |

Needs and schedules influence the provider decision; neither forces an action.

## Run

Requires Node.js 20+ and a real OpenAI API credential:

```bash
export OPENAI_API_KEY='...'
export OPENAI_MODEL='gpt-4.1-mini' # optional
npm run demo
```

`.env.example` lists supported variables for reference. The runtime reads exported variables directly and does not load env files itself.

The demo injects no Director event. It bootstraps autonomy at a Monday 09:00 simulation time and permits exactly one real provider activation. Pending schedule and self-activation events remain queued, which proves the autonomous chain without risking an API loop.

```bash
npm test
```

Tests use deterministic providers to cover both Phase 1 mechanics and a guarded 24-hour autonomous simulation. Fixtures are not evidence of real provider invocation.

## Agent context and trace contract

Provider context contains `character`, runtime `current_state`, current `needs`, one isolated `observation`, `schedule_context`, and `relevant_memories: []`. Memory remains intentionally deferred.

Every activation trace records `activation_source`, `needs_before`, `needs_after`, `schedule_context`, `current_activity`, provider/model, interpretation, intent, structured action, world change, next activation, latency, and status. `world.activation_count` and the latest bounded-run result remain visible in God View.
