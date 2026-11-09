# Feature-design B1 plan and program handoff

## Context

Issue #3448 identifies this documentation-only batch. The old task runner archived/closed it on 2026-11-09; the owner then explicitly renewed this work in the direct session. No new issue is created. These B numbers belong to the feature-design registry, not the separate band-aid audit. No later batch is dispatched here; the program permits at most two batches in flight, in order. Tailnet remains the first implementation priority.

The full 55-row registry and B1–B12 list from #3447 were inspected. That prerequisite merged on 2026-11-08 and is now integrated on this session branch. The current base is `4618ba6b0`. Independent work was not stopped while the registry was open. No live Cairn instance is modified.

Research reused: [compaction](../research/coordinator-compaction-2026-11-07.md), [personal memory](../research/personal-agent-memory-2026-11-07.md). New source checks: [context](../research/coordinator-context-2026-11-08.md), [memory](../research/memory-2026-11-08.md). Other newly landed notes are not claimed as new B1 coverage.

Numbered overlap list (2026-11-09; title/body searches for memory, context compaction and feature registry; open issues/PRs, merged since 2026-11-02; exact planned paths):

1. #3448 is the existing same-purpose issue; no replacement issue is created. No same-purpose open PR or open PR on this session branch was found. The independent design/prototype paths have no open file overlap.
2. #3447 is the merged registry prerequisite. Reuse its schema and generator without changing their scope. #3449 landed existing research; do not duplicate those notes.
3. #3362/#3370/#3375/#3381/#3384/#3392/#3394 already implement summary/memory improvements. Preserve them. #3608 already removed Agent-first settings gating; the revised design must not dispatch that removal again.
4. Open #3487 covers Android intake/notifications; #3593 covers MCP inventory; #3614 restores other research. None designs B1 memory/context. Other search hits concern runtime workspace files, Tasks panel, relay hints or host temp files, not this ask.
5. Open registry edits: #3633 (`pi/task-161`, Feishu removal), #3631 (`pi/task-160`, commit-history retirement), #3629 (`pi/task-158`, feature-release removal), #3624 (`ops/deploy-drain`), #3618 (`cursor/computer-browser-capability-170a`), #3606 (`cursor/remove-team-tombstone-7717`), #3487 (`cairn/conv-01a1bc75-55c8-7565-84f8-dc8879517b12`). Proceed on the mandated branch because edits are restricted to the two B1 rows and generated outputs; retain other rows intact. Final file-overlap recheck also found #3623 (`web/tasks-panel-sections`), #3583 (`cairn/conv-01a1bf39-6f7e-79fc-90f1-2df4e9be5174`), #3471 (`server/stall-escalation`) and the #3636 Mergify queue branch. These change other registry rows/generated route coverage, not B1. Preserve their main-branch changes when synchronizing; never replace a complete generated map from a stale base.

## Changes

Deliver the context backend, row-backed memory backend baseline and source supplements only. No application, route, schema, provider, dependency or eval change is proposed. The memory frontend is superseded by #3666 and #3677; remove the old UI draft and its tracked prototype rather than keeping competing layouts or a reference-session requirement. Link the approved pending design in the registry and retain all other batches' coverage.

| Date | Owner decision | Effect on B1 |
|---|---|---|
| 2026-11-09 | #3666 owns the approved Claude Code layout: team memory in Coordinator settings, project memory in its settings memory tab, no count or bottom input; #3677 owns in-place editing | Keep context/backend documentation, remove superseded UI artifacts and the reference-video/session requirement; coordinator lifts the hold after this push |

### Original registry scopes for remaining tasks

R = research, F = frontend design, B = backend design. Only the missing slots are listed; preserve existing linked notes and n/a slots.

| Batch | Features and missing slots |
|---|---|
| B1 | Coordinator context/compaction B; Memory F+B |
| B2 | Daily report/retro F+B; Needs-you F+B; Phone push R+F+B; Questions R+B |
| B3 | Merge gate F; Plans/approval/review F; Steer/queue/stop R+F+B |
| B4 | Agent computer F+B; Orb isolation F; Own-key sandboxes R+F+B |
| B5 | Machine enrollment F+B; Remote access F; Tailnet login F |
| B6 | Desktop F+B; First run B; Mobile web/PWA R |
| B7 | Schedules R+F+B; Search/activity R+B; Sidebar B |
| B8 | Attachments R+F; Composer R+B; Project files/commits R+F+B |
| B9 | Harness profile F; MCP servers R; Quota wait F+B; Skills R |
| B10 | Account/team B; API keys R+F+B; Secrets F |
| B11 | Coordinator MCP R; Git hosting R+B; Server status R+F+B; Feature flags/releases R+F+B; Feishu R+F+B; Thread tags R |
| B12 | iOS R+F+B; Relay F+B; start near phase-2 graduation only |

This is the original #3447 handoff, not permission to resurrect retired surfaces. Subsequent retirement decisions in other PRs must be applied when those batches start.

## Edge cases

Canonical history cannot be erased by a failed summary. Test equal-timestamp boundaries, appended messages during folds, skipped older prefixes and restart/task replay. Memory scope must not leak across teams/projects/threads. Promotion and consolidation must revalidate their inputs. A failed read cannot look empty; failed mutations retain the fact. No hidden-mode, retry-loop or keep-alive mechanism is added.

The retained memory document describes the row-backed baseline, not a competing implementation brief for the MEMORY.md/files model approved in #3677. Its scope/versioning failure modes remain useful; where the future model differs, #3677 takes precedence. Do not restore the removed memory prototype or reopen its reference-access blocker.

## Verification

The superseded UI fixture and its screenshot matrix are removed from this PR; #3666 and #3677 own frontend evidence. The retained documents name the context/memory failure modes and tests to write before implementation.

Run targeted memory/context Vitest suites with `--maxWorkers=4`. Run generator and `--check`, `pnpm lint`, `pnpm typecheck`, `pnpm spec:parse`, and `pnpm prepush`. Commit through the bot wrapper, push the same branch, create one PR through the creation gate, inspect CI/cloud review on that head, and never merge. Do not mark the work complete merely because the feature-map check passes. The previous reference/owner blocker is superseded by the coordinator's decision. PR #3640 retains its hold until the coordinator confirms this scope reduction and lifts it; no agent merge or later-batch dispatch is requested.
