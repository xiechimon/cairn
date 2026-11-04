---
Category: Verification heading labels were discarded before the labeled-item parser could read them
Source: PR #2038 (2026-10-28)
Level: 2
Safeguard: `packages/shared/test/plan-contract.test.ts` exercises the real contract entry point for inline and fenced heading checks at levels three through six, plus grouping and section boundaries
Intercepts: 0
Recurrences: 0
Notes: The original PR source fails ten heading regressions; the corrected source passes all 49 contract tests. The test inputs reach both section extraction and item splitting, so testing the inner splitter alone cannot mask the defect.
---
