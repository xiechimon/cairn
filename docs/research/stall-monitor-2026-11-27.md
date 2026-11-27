# Stall Monitor Prior Art

- Date: 2026-11-27
- Workstream: `stall-monitor`
- Constraint: the owner limited fresh research to research notes already in this repository plus the local Antigravity `swarm_monitor` skill, read-only.

## Sources

| Source | How it handles a stall | Trade-offs | Evidence |
|---|---|---|---|
| `docs/research/task-stall-root-causes-2026-11-09.md` | A wait must be structural: either a named actor is woken or the scheduler re-checks a stored condition. Prior art there (Linear, GitHub Actions, Temporal, Airflow, Buildkite) makes waiting/human input visible, system-driven and time-bounded. | Structural state avoids timer-only guesses, but requires every important wait to be represented. | Measured read in repo |
| `docs/research/task-retry-policy-2026-11-24.md` | Retries are classified and budgeted; repeated failures are parked with an explanation instead of retried forever. | Prevents retry storms, but a running turn that never finishes still needs a separate progress interrupt. | Measured read in repo |
| `docs/research/step-process-reaping-2026-11-24.md` | Process death and orphaned children are reaped by durable ownership plus sweeps. | This detects dead processes, not a live process whose model/tool loop is silent. | Measured read in repo |
| `docs/research/coordinator-responsiveness-2026-11-27.md` | Chat agents should acknowledge long work and expose step/tool progress; prior art uses streamed events or explicit progress messages. | Improves perceived responsiveness; it does not itself recover a dead turn. | Measured read in repo |
| `~/.gemini/antigravity/builtin/skills/swarm_monitor/SKILL.md` | Monitor does not do the work itself. It reads board state (`state`, `last_post_seq`, `wait_since`), addresses exactly one member who can unblock, does not repeat the same alert, re-alerts only after state changes or several ticks, and goes dormant when work is done. | Good dedupe/escalation discipline; it is a coordination loop, not a process supervisor. | Measured read local file |
| Existing Cairn daemon stream watchdog (`apps/daemon/src/stream-watchdog.ts`) | Daemon-side worker turns arm first-event, idle, body and duration timeouts; no event eventually stops the session and the retry policy decides whether to retry or fail. | Fast and close to the stream, but daemon-local; it cannot explain the stall in the task/Coordinator chat and does not cover in-server Coordinator turns uniformly. | Measured read source |
| Existing Cairn worker watchdog (`apps/server/src/services/worker-watchdog.ts`) | After 30 minutes without `lastProgressAt` it raises deduped condition notices and suppresses them while a worker question is pending. | Server-side and deduped, but notification-only, task-only, and it does not diagnose or heal. | Measured read source |

## Measured Cairn signals

Production SQLite (`/Users/ian/.cairn-server/server/server.db`) was sampled read-only on the Mac mini on 2026-11-27 (14-day `status = 'done'` steps with non-null `claimedAt` and `finishedAt`):

- `chief` / `antigravity` (n=125): avg tail 10.7s, max tail 30.5s, avg duration 34.6s
- `chief` / `devin` (n=13): avg tail 10.6s, max tail 25.4s, avg duration 24.4s
- `session` / `antigravity` (n=24): avg tail 17.6s, max tail 40.7s, avg duration 523.7s
- `session` / `claude-code` (n=11): avg tail 20.8s, max tail 37.6s, avg duration 644.9s
- `session` / `devin` (n=6): avg tail 15.6s, max tail 31.6s, avg duration 718.2s
- `session` / `unknown` (n=35): avg tail 284.8s, max tail 2341.0s, avg duration 452.5s

This confirms separate quiet windows for Coordinator turns (`chief`) and worker steps (`plan`/`build`/`session`/`merge`/`review`/`verify`) by runtime, with a conservative window for unknown runtimes (Measured aggregated from production `step` rows).

Cairn already writes `step.lastProgressAt` for transcript deltas/rows, tool reports and progress activity, throttled to one write per 30 seconds. Runner heartbeats still prove machine/process liveness, not model progress (Measured source plus production rows).

## Pattern that fits Cairn

One server-side monitor should own stall judgment across worker and Coordinator steps. The existing daemon stream watchdog stays as the low-level stream interrupt; the server monitor is the product mechanism that diagnoses what the user is waiting on, applies a bounded safe recovery, and writes the outcome once in the thread.

The monitor should use the swarm-monitor discipline: observe durable state, act on exactly one responsible target, dedupe by state, and cap repeated interventions. It should not become another executor or a second retry policy. Known structural waits (permission/question, quota/capacity, dead stream, missing host tools) get named handling; unknown silence gets a bounded restart once and then a plain user-facing report if it recurs.

## Concrete recommendation

Add a scheduler sweep that scans claimed worker and Coordinator steps whose `lastProgressAt ?? claimedAt ?? createdAt` is older than a runtime-specific quiet window. For each candidate:

1. If a permission/question is pending, do not interrupt the turn; post one deduped plain-line notice saying approval/input is needed.
2. If the latest persisted activity is retrying because of quota/capacity, stop the turn so the existing quota/fallback/retry machinery switches model according to the user's routing settings; note that action once.
3. If an ACP session reports missing Cairn host tools, end that turn and restart it with a fresh session rather than reusing the broken session; note that action once.
4. If there is no permission wait and no progress after the quiet window, treat it as a dead/silent turn: stop/end it and start a new one once. If the replacement also stalls, report rather than loop forever.
5. Preserve the daemon stream watchdog and existing crash/heartbeat sweeps; this monitor subsumes the user-facing stall role of `worker-watchdog` rather than duplicating its notices.

Code areas: `apps/server/src/services/scheduler.ts`, `worker-watchdog.ts`, a new `stall-monitor.ts`, `machines.ts` activity persistence, `step` schema/migration, shared `StepActivityReport`, daemon ACP host-tool reporting, and server tests beside the existing watchdog/scheduler tests.
