# docs/verify/1240 — pr-tasks gate evidence

Issue #1240. User's ruling: 「有些 pr tasks 你都没做完你就 merge 了，以后
不要出现了」. The gate judges the PR body's `## Acceptance` section: it
must carry at least one task-list item, and none may be unchecked.

Built fixture-first: `expected-verdicts.md` recorded every verdict before
`scripts/pr-tasks-gate.py` existed. Any mismatch between an expectation
and a recorded run means the script is wrong, not the expectation.

## Fixture verdicts (expected vs recorded)

| fixture | expected | recorded (`gate-<name>.txt`) |
|---|---|---|
| no-section | RED no-tasks | RED no-tasks |
| prose-only | RED no-tasks | RED no-tasks |
| unchecked | RED unchecked-task, 2 offenders with lines | RED unchecked-task lines 20, 21 |
| all-checked | GREEN | GREEN |
| codeblock-task | RED no-tasks (fenced box invisible, existence unmet) | RED no-tasks |
| indented-nested | RED unchecked-task, 2 offenders | RED unchecked-task lines 20, 22 |
| uppercase-x | GREEN (`[X]` is checked) | GREEN |
| comment-wrapped | RED no-tasks | RED no-tasks |
| exemption | GREEN | GREEN |
| empty-checkbox | RED unchecked-task | RED unchecked-task line 20 |
| template-untouched | RED unchecked-task (live seed unchecked) | RED unchecked-task line 43 |

11/11 match. The four scenarios the ticket asked for pair up as:
无 tasks 红 (no-section, prose-only) / 有空框红 (unchecked) / 全勾绿
(all-checked) / 代码块含空框绿-or-red (codeblock-task: the fenced box is
not counted as a task, so the gate reds on no-tasks, never on the fenced
box itself).

## Real-corpus sweep (`merged-replay.txt`)

Last 14 merged PR bodies (1239...1222) replayed through the gate:

- #1239 GREEN (its own Acceptance was already a full checklist).
- #1235, #1234, #1232 RED unchecked-task — the exact failure the user
  reported: PRs merged with unchecked boxes, named with line numbers.
- The remaining 10 RED no-tasks — the prose-only shape (#1229/#1233
  style) that carries no machine-judgeable completion signal. This is
  the intended behavior change; the template seed and the pr-pacman
  skill update land in the same commit set so new lanes write checklists
  from the start.

## Open-PR sweep (`open-prs.txt`)

0 open PRs at 2026-10-12T02:37:18Z; nothing to fix retroactively.

## Promotion note

Done on 2026-10-21 (#1440): `pr-evidence` is in the required checks, pinned to the Actions app; the live list is read back in ADR 0007. The note below is history.

The `pr-evidence` job (now carrying both steps) is not yet a
branch-protection required check. After merge, add `pr-evidence` to the
required checks (contexts: `check`, `pack-smoke`, `e2e-gate`,
`pr-evidence`). Do it after merge with open lanes' bodies confirmed
passing, per the workflow's own comment. This promotion also makes the
existing sections/links checks hard-required — the repo's documented
trajectory, and what the user's ruling asks for.
