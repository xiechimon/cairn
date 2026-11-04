# Audited intake delivery evidence

Implementation PR: https://github.com/xiechimon/cairn/pull/2899

Tested implementation commit: ed22eea79418be8dc751c24921b4b9420f8030ca.

Original requirement: https://github.com/xiechimon/cairn/blob/3e1bde9971ce50552be344dd49396e82dbbd0a6c/docs/research/research-loop-plan.md#12-decisions

The source screenshots come directly from the original GitHub requirement. The implementation screenshots come from official Swagger UI v5.34.1 executing the real Coordinator messages GET against an isolated Cairn Hono server and disk SQLite database.

| Requirement | Actual API observation | Check |
| --- | --- | --- |
| Every tier-2 report requires citation checking. | Before the mock audit, the original report has zero intake items. | Unchecked intake is withheld. |
| Daily intake lists at most five items. | A new scheduler instance delivers five of seven supported mock candidates to the original report; another tick still returns five. | Delivery survives restart, keeps the original report and respects its five-item budget. |

Source and checker model reports are mocked. Hono HTTP, SQLite persistence, the citation gate, scheduler restart and report refresh are real. The factual support of the synthetic claims, a real independent-vendor model check, metered search, production authentication and raw provider-response model identity are not verified. No homemade HTML report is used.

The before/after JSON and runtime receipt record the actual API responses and assertions. The manifest identifies the exact tested commit and image hashes. All probe state was isolated and cleaned afterward.

209 targeted tests and package typecheck pass. Affected E2E has 1235 passes and two gallery light/dark failures; both exact failures reproduce on clean main5af926739 without these changes. No gallery baseline changed.
