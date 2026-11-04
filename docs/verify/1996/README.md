# #1996 verification evidence index — review-gate fix round

The independent review gate blocked the first head (`88cd0380`) with four findings; three were code-level and are fixed on this branch, the fourth needs evidence. This directory archives the test-first proof for the three code fixes. The fourth finding (acceptance-checklist evidence for the live measurement) is split: the failing-test output the checklist demands is here, and the daily omarchy loop that produces the live report is out of repo by the checklist's own assignment.

`fix-tests-red.log`: the three fix test suites run against the first head's `reliability-report.ts`, before the fix commit. All four new tests fail for the stated reason:

- `replay report redacts and truncates error messages like the database report does`: the pre-fix replay path copied `errorMessage` into JSON and Markdown unchanged, so the fake `ghp_` token survived the report.
- `replay classification ages a build against the report window end, not zero`: the pre-fix replay path classified with `ageMs: 0` and printed `ageHours: 0`, so a week-old build with no error and no PR stayed `active` instead of `stuck-waiting`.
- `replay classification hits stuck-waiting at the six-hour boundary`: same classifier gap at the 6 h boundary itself.
- `a failure recorded only on a failed step gets its cause, not active or stuck`: the pre-fix step query read only `status`, so a build whose failure lived only in the `plan-residual-<stepId>` message (the path `applyStepFailure` takes when a delivered plan is parked at the confirm gate) came back `stuck-waiting` instead of its real cause `git`.

`fix-tests-green.log`: the same suites against the fixed source, 31 tests across the five reliability files, all green.

The fixes themselves:

1. `sanitizeErrorMessage` is now the single sanitization path (redact secrets, truncate to 300 chars) shared by the database report and the replay report; the replay path no longer copies `errorMessage` raw.
2. `buildReplayReport` ages every entry against the report window end (`window.until - entry.createdAt`) instead of hardcoding zero, and prints the real `ageHours`; the six-hour boundary is covered by two tests.
3. `buildReliabilityReport` reads the `plan-residual-<stepId>` messages of failed steps and feeds their content into the classifier, with a seeded-database test for the failure that only exists on a step.
