# Claude Code session stop settles before it returns

Problem: `ClaudeSessionHandle.stop()` (`apps/daemon/src/backend/claude-code.ts`)
ended stdin, fired `interrupt()` without waiting, and called `finish()`, which
ended the event stream at once. The runner treats the end of `handle.events`
as the end of the session and reports the step; the server writes the
`stopped` phase only after that report (`build-stop.ts`). So a step could read
"stopped" while the Claude Code CLI was still exiting and a background shell
it started (`run_in_background`, a dev server, `sleep 120`) kept running,
reparented to init once the CLI died. A session that ended on its own had the
same gap: the CLI kills its hold-back tasks when stdin closes, but nothing
confirmed it, and a shell that escaped the CLI's cleanup outlived the step.

Rule agreed between the task-panel and state-machine lanes (plan §5a): a step
is ended only after (1) the query and the CLI process have exited, (2)
background subagents are discarded, (3) background commands are killed and
reaped. A timeout force-kills and still settles, so a stop can never hang.

## State

Per session handle:

- `stopping` — a stop was requested (user stop, watchdog, quota trip, retry
  storm, model unavailable, background-wait limit). Set synchronously first,
  so no continuation turn or held `done` survives it.
- `settled: Promise<void> | null` — the one release in flight. Every path that
  ends the session awaits the same promise; the release runs once.
- `exited: Promise<void>` — resolves on the CLI child's `exit` event. The
  child comes from the daemon's own spawn wrapper, which every session now
  uses. Without a child (tests that mock `query`), it is the end of the SDK
  message loop.
- `tree: ProcessTree | null` — `apps/daemon/src/process-tree.ts`, rooted
  at the CLI pid, remembering every descendant seen in a snapshot. On Linux a
  marker variable in the CLI environment (`CAIRN_SESSION_TREE`) also finds
  descendants that were reparented before any snapshot saw them.

## Release sequence

`release(interrupt)`:

1. Snapshot the tree (the CLI is the parent of its background shells only
   while it is alive; after it exits they reparent and only the snapshot
   still names them).
2. If `interrupt`: `q.interrupt()`, bounded by `INTERRUPT_MS` (5 s). Cairn does
   not declare `perTaskStopAffordance`, so the CLI's interrupt also kills its
   background agents and shells and emits their `task_notification` frames.
3. Snapshot again (catches commands started up to the interrupt), then end
   stdin.
4. Wait for `exited`, bounded by `EXIT_GRACE_MS` (10 s): the CLI's own shutdown
   flushes the transcript and kills its tasks.
5. `tree.kill()`: SIGTERM to every remembered process still alive (the CLI
   itself if step 4 timed out), SIGKILL after `KILL_GRACE_MS` (3 s), until
   none but zombies remain. Without a known child (spawn not yet done, or a
   mocked query) steps 4 and 5 are replaced by `q.close()`, the SDK's own
   terminate.
6. Wait for `exited` again, bounded by `KILL_GRACE_MS`.
7. `finish()`: settle still-running background rows (`stopped` when
   `stopping`, else `orphaned`), reject pending steers, end the event stream,
   abort the controller.

Worst case: 5 + 10 + 3 + 3 s plus a few `ps` calls, about 21 s; a CLI that
exits on EOF settles in well under a second.

## Paths that end a session

| Path | Calls | Interrupt |
| --- | --- | --- |
| `stop()` (all stop triggers in `step-pass-events.ts`, `step-pass-controls.ts`, `step-stops.ts`) | `release(true)` and returns its promise | yes |
| background-wait limit (20 min, `holdForBackground`) | releases the held `done`, sets `stopping`, `release(true)` | yes |
| natural end: final `done`, the pump snapshots the tree before ending stdin | pump `finally` awaits `release(false)` | no |
| terminal `error` / `message_stop`, SDK throw, CLI crash | pump `finally` awaits `release(false)` | no |

The pump's `finally` never ends the stream itself: it awaits the shared
release, so a stop that is mid-release keeps the stream open until the tree is
reaped, and the runner's report follows the reaping.

## Failure behavior

- `interrupt()` rejects (CLI already gone, stdin closed) or hangs: ignored
  after the bound; the sequence continues.
- CLI ignores stdin EOF or SIGTERM: step 5 SIGKILLs it.
- A descendant ignores SIGTERM: SIGKILL. A process stuck in an uninterruptible
  state cannot be reaped by anyone; the sequence still settles after the
  bounded retries in `ProcessTree.kill`.
- `ps` fails: the snapshot is empty; the CLI is still awaited and killed, and
  only escaped descendants can remain (logged nowhere; same as before).
- `stop()` called twice, or during a natural end: both await the same release.
- A pid recycled between snapshot and kill: the same exposure the computer
  host's `ProcessTree` already accepts; the window is the release itself.

## Out of scope

The server side (`build-stop.ts`, transition table, `todo_transition` rows)
already writes `stopped` only after the runner's report; this change makes
that report true. Other backends (pi, ACP, engine TUI) keep their own `stop()`.

## Tests

`apps/daemon/test/claude-code-stop-settles.test.ts`, against a fake CLI
(`test/fixtures/fake-claude-stop.mjs`) that starts a background command in
its own process group which outlives the CLI unless someone kills it:

- `stop()` resolves only after the CLI has exited and the background command
  is dead, and the event stream ends after that, not before.
- a CLI that ignores EOF and SIGTERM is SIGKILLed after the grace and `stop()`
  still resolves.
- a session that ends on its own reaps a background command the CLI left
  behind before the event stream ends.
- `claude-background-subagent.test.ts`: the wait-limit path and a stop on a
  CLI that never ends its message stream settle through the same bounded
  release.
