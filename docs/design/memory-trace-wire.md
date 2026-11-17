# Memory trace wire — "used this turn" in the UI

## Problem

`chiefTurnContext` computes `memoryTrace` every turn (teamMemoryIds,
projectMemoryIds, recalledMemoryIds, plus omitted counts). It is spread
into the `coordinator memory injected` log line and then dropped. The
sidebar memory dialog shows what memory exists but cannot show what the
last turn actually used.

## State

`step.memoryTrace` — new JSON column on the existing `step` table,
`NULL` by default. Shape mirrors the log payload:

```ts
{
  teamMemoryIds: string[],
  teamMemoriesOmitted: number,
  projectMemoryIds: string[],
  projectMemoriesOmitted: number,
  recalledMemoryIds: string[],
}
```

## Writers and readers

- **Write**: `apps/server/src/coordinator/index.ts`, at the point that
  already logs `coordinator memory injected` (context is built once per
  step run, both the in-server pi path and the machine-claim path pass
  through it). One `UPDATE step SET memoryTrace = ? WHERE id = ?` — the
  step row already exists; no new state machine. A step retried after
  the write rewrites the same column with the new run's trace; the last
  write wins, matching "what the latest attempt used".
- **Read**: `GET /api/teams/:id/chief/memory-usage` returns the newest
  `kind='chief'` step for the team whose `memoryTrace IS NOT NULL`:
  `{ stepId, threadId, createdAt, ...trace }`, or `{ usage: null }`
  when no traced turn exists yet.
- **Render**: `MemoryPanel` (`project === null` scope only) gains a
  "Used this turn" section above the injected/searchable groups. It
  resolves each id against the already-loaded memories list. An id that
  is gone (deleted, superseded, team switched) renders dimmed as
  `已失效`; `usage === null` hides the section (no placeholder block).

## Failure paths

- Old servers wrote no column value — `NULL` → `usage: null` → section
  hidden. Backward compatible both directions: an old web against a new
  server simply never calls the route.
- The trace is point-in-time: it names what was injected, not whether
  the model acted on it. The section title is "Used this turn" and
  nothing stronger.
- IDs are resolved client-side against the memories list; a stale or
  foreign id can never crash the panel — worst case it renders as
  "Memory no longer valid" or is skipped.
- Omitted counts stay truthful: they report index overflow at inject
  time, not a UI state.
- Cross-thread: the route picks the team's newest traced chief step
  regardless of which thread the dialog overlays. The label is scoped
  to "latest turn" semantics; the response carries `threadId` so a
  later UI can attribute it.

## Non-goals

- Per-message/per-turn history of usage (aggregation across turns).
- Asserting the model *used* a memory in its reply text.
- Machine-claimed turn parity beyond the shared write point — the same
  `chiefTurnContext` covers it.
