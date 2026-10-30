---
Category: An eval harness scored an arm that never ran, and read an artifact before the step that produced it settled.
Source: 1966 (2026-10-23)
Level: 2
Safeguard: revision-grade.mts gates every metric on executed(arm) (step status done plus a non-empty artifact), so a missing or failed arm yields 0 for both revision_ok and control_flipped and explains itself as a harness error; revision-arm.mts waits until no new step is pending, claimed or waiting_quota, not merely until one step settled.
Intercepts: 0
Recurrences: 1
Notes: Negative controls in integration/test/plan-revision.test.ts: "a missing or failed arm never scores as a pass" and "a failed control arm alone is a harness error, not a successful control". Both red under the pre-fix code: an absent control arm satisfied the "control failed the requirements" test vacuously and scored control_flipped=1, which reports a successful control experiment out of no data. The wait predicate was red under the paired execution test, which read plan version 1 while the revision step that writes version 2 was still running. Level 1 is not reached here because the arm result type still permits a null artifact; carrying the executed state in the type would need a wider refactor of the shared stack helpers.
---
