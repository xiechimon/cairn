# #1583 review round 1: replay and red evidence

This round-one note is superseded by [round-two status](round2-status.md). Its
historical-replay and acceptance claims are invalid; retain it only as a record
of the rejected evidence.

PR #2036, round 1 of 2. This note records the 2026-10-23 replay required by the owner's
acceptance checklist and the red output for every blocking finding of the review gate.

## Replay fixture

`apps/server/test/fixtures/1583-2026-10-23-open.json` holds the input the sweep had that morning:

- 31 open tickets with title, body, labels, comments and timestamps, restored to their state at
  `2026-10-23T10:56Z` (the sixteen tickets the human closed that day are put back to `open`);
- 145 merged pull requests with title, body and merge time, backfilled from every `#N` the
  tickets, their comments and the spec ledger mention;
- the spec 28 §8 progress ledger, 59 rows, read from `docs/spec/28-bootstrap-closed-loop-self-authored-self-merged.md`.

Captured on 2026-10-27 with `gh api` / `gh pr view` against `xiechimon/cairn`. Ticket bodies,
labels and merged pull bodies do not change after the fact, so the restored snapshot is the input
the human actually saw; only the open/closed flag and the close comments are replayed.

## Replay result

`apps/server/test/scheduling-replay.test.ts` replays the fixture through `planSchedule`:

```
 ✓ the fixture holds the open tickets and the ledger as they stood that morning
 ✓ every ticket the human closed that morning is suggested for closure with a citation
 ✓ a close suggestion always names the merged pull, ledger row or ticket it rests on
 ✓ a ticket with unchecked acceptance boxes and no handed-over evidence is never closed
 ✓ no ticket whose dependency is still open lands in now
 ✓ the replay is deterministic: the same input yields the same groups
```

All four required tickets (#1394, #1403, #1528, #1555) land in the close group with evidence:

| ticket | evidence | what carried it |
|---|---|---|
| #1394 | ledger-line | the close comment records it as replaced by spec 28 / ADR 0021 |
| #1403 | ledger-line | the spec 28 §8 row naming #1403 and its merged segments |
| #1528 | handover #1546, #1547, #1548 | the close comment records the split into #1541-#1543, landing in those pull requests |
| #1555 | handover #1552, #1564, #1567 | the close comment records delivery by those pull requests |

## Red evidence per blocking finding

Each finding was reproduced by mutating the fix back out and re-running its test. All commands
ran under `flock /tmp/cairn-heavy.lock` from `apps/server` or `apps/web`.

### 1. Close bypassed the acceptance check (`plan.ts`)

Mutation: drop the `acceptanceBoxes` guard from `closeSignal`.

```
$ npx vitest run test/scheduling-plan.test.ts test/scheduling-replay.test.ts
 × a merged pull naming the ticket is not enough when acceptance boxes are unchecked
 × unchecked acceptance boxes block a close when the only evidence is a merged pull
 × a ticket with unchecked acceptance boxes and no handed-over evidence is never closed
 Tests  3 failed | 27 passed (30)
```

Restored: the three tests pass. A merged pull, a ledger row or a handover only carries a closure
past unchecked boxes when that evidence says the remaining work moved somewhere else; a bare
merged-pull mention does not.

### 2. Execution loaded the newest report, not the confirmed one (`execute.ts`)

Mutation: use `latestScheduleReport` instead of `scheduleReportById`.

```
$ npx vitest run test/scheduling-execute.test.ts
 × executes the report the human confirmed, not whatever is newest
 × an unknown or superseded report id is refused instead of falling back
 Tests  2 failed | 10 passed (12)
```

Restored: both pass. `ExecuteScheduleBody` now requires `reportId`; an unknown id is a 404
`schedule report not found`, a body without `reportId` is a 400, and the web card sends the id of
the report it rendered.

### 3. `ready-for-agent` kept on blocked and later tickets (`plan.ts`)

Mutation: restore the label rule that only removes the label inside the close group.

```
$ npx vitest run test/scheduling-plan.test.ts
 × a blocked ticket that carries ready-for-agent is offered its removal
 × a later ticket that carries ready-for-agent is offered its removal
 Tests  2 failed | 22 passed (24)
```

Mutation: drop the unlock tie-break from the ordering.

```
$ npx vitest run test/scheduling-plan.test.ts
 × a ticket that unlocks more tickets wins the tie over one that unlocks fewer
 Tests  1 failed | 23 passed (24)
```

Restored: all pass. The reason for a blocked ticket now names the polling risk next to the
unmet dependency, and the in-flight exception still suppresses any label change.

### 4. In-flight detection counted settled builds (`sweep.ts`)

Mutation: drop the terminal-phase filter from `inFlightIssues`.

```
$ npx vitest run test/scheduling-sweep.test.ts
 × counts an issue as being worked on only while its todo is in flight
 Tests  1 failed | 4 passed (5)
```

Restored: passes. A ticket whose only builds are `done`, `failed` or `closed` is no longer
reported as in flight.

### 5. Unparsed dependencies rendered as `[object Object]` (`project-schedule-card.tsx`)

Mutation: make `unparsedDepTexts` stringify the object.

```
$ npx vitest run test/schedule-card.test.ts
 × unparsed dependency texts keep the issue number attached for copying
 Tests  1 failed | 6 passed (7)
```

Restored: passes. The card renders each unparsed entry as its issue number plus the original
phrase through `ScheduleUnparsedDeps`, and the render test asserts the phrase appears and
`[object Object]` does not.

### 6. Tool surface: no label or close write, real registries

Mutation: add an issue-label write to `MCP_TOOL_REGISTRY`.

```
$ npx vitest run test/scheduling-tool-surface.test.ts
 × the MCP registry exposes no issue-label or issue-close tool
 × registers no scheduling execute tool and no GitHub issue write tool
 Tests  2 failed | 2 passed (4)
```

Restored: all four pass. The test checks the real `CHIEF_REMOTE_TOOLS` list, the real
`CHIEF_TOOL_CATEGORIES` read/write split, and the registry a booted MCP face actually exposes, not
just a name list.

## Full suite

```
$ flock /tmp/cairn-heavy.lock node scripts/prepush-vitest.mjs
 Test Files  358 passed (358)
      Tests  4770 passed (4770)
```

## Gates

```
$ node scripts/english-only-gate.mjs      -> 0 line(s) with Chinese text
$ node scripts/comment-discipline-gate.mjs -> 0 new comment line(s)
$ node scripts/single-use-helper-gate.mjs  -> 0 single-use helper(s)
$ pnpm lint                                -> Checked 1069 files, no fixes applied
$ pnpm -r typecheck                        -> all projects Done
$ pnpm spec:parse                          -> PASS
```
