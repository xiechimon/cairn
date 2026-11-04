# Terminal citation-check recovery evidence

Implementation: https://github.com/xiechimon/cairn/pull/2908

Exact tested commit: 85d7ae24208f9cd93c3020849091e62d99be343f.

Original requirement: https://github.com/xiechimon/cairn/blob/3e1bde9971ce50552be344dd49396e82dbbd0a6c/docs/research/research-loop-plan.md#12-decisions

The requirement screenshots are direct captures of the original GitHub document. The implementation screenshots show official Swagger UI v5.34.1 executing an actual GET against the isolated Cairn Hono server and disk SQLite database.

| Requirement | Actual API observation | Check |
| --- | --- | --- |
| Audit every tier-2 report. | A malformed terminal citation audit leaves the original report with zero intake items. | Invalid output does not authorize intake. |
| Daily intake lists at most five items. | The invalid checker is replaced on the same todo; after a supported mock audit, a new scheduler instance updates the original report with five of seven candidates. | Recovery delivers supported items under the original shared cap. |
| Deliver the report once. | A repeated scheduler tick keeps five items and the original report ID and timestamp. | Recovery does not duplicate the report. |

Source/checker model reports are mocked. HTTP, Hono, SQLite persistence, checker lifecycle, citation validation, scheduler restart and original report refresh are real. No homemade HTML report is used. Real independent-vendor model auditing, metered search, production authentication and wire response model identity remain unverified.

199 related tests pass, including real SQLite close/reopen controls for malformed, incomplete, inflight and valid audits; 33 citation tests pass after the final cleanup refinement. Normal commit hooks and 21 prepush checks pass. New-head CI remains required; the prior affected E2E run had 1235 passes and two gallery failures also reproduced on clean main5af926739.

The JSON files are actual API responses and a runtime assertion receipt. The manifest binds image hashes and tested commit. All isolated probe processes and temporary database state were cleaned.
