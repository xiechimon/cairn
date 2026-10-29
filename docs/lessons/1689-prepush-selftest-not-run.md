---
Category: A prepush change was pushed after running only its own tests; `scripts/heavy-slots.test.mjs`, which copies `scripts/prepush.mjs` into a fixture repo and runs in the same CI step, went red because the fixture lacked the new gate script
Source: #1689 (2026-10-25)
Level: 2
Safeguard: `prepushPlan` runs the CI self-test files (`selfTests` in `scripts/prepush.mjs`, including `scripts/epic-done.test.mjs` last) when `.github/workflows/ci.yml`, any listed self-test or its adjacent `.mjs` source changes, preserving the existing script-prefix regex; `scripts/prepush.test.mjs` checks each trigger independently and pins the ordered list to the CI step; since 2026-10-29
Intercepts: 0
Recurrences: 1
Notes: Negative controls: the #1689 fixture without `english-only-gate.mjs` fails `scripts/heavy-slots.test.mjs` (CI run 40171261648). In #2158, reported CI run 40893286745 failed the CI-list pin after `epic-done.test.mjs` was added only to CI. Before the fix, `node --test --test-name-pattern='changes to prepush scripts run the CI self-test files locally' scripts/prepush.test.mjs` exited 1 with `AssertionError [ERR_ASSERTION]: .github/workflows/ci.yml` (1 test, 0 passed, 1 failed; local log `/tmp/2158-prepush-red.log`). The widened trigger and per-path regression cover workflow, self-test and source changes while retaining the web-only negative assertion. A level 1 shared owner for the CI and local test list would require changing the workflow outside this task's allowed paths; the recurrence event reports that escalation for follow-up.
---
