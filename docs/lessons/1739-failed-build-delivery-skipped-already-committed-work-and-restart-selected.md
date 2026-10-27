---
Category: Failed build delivery skipped already committed work and restart selected main without a PR
Source: #1739 (2026-10-25)
Level: 2
Safeguard: `integration/test/build-failure-preservation.test.ts` checks real pushed Git refs, both commit hashes in the fallback report, changes API files, and restart into a fresh workspace; runner timeout tests distinguish progress budgets from the absolute environment override
Intercepts: 2
Recurrences: 0
Notes: Negative control: the original daemon left the remote branch absent and restart created a second build; the original duration timer failed a continuously progressing build. All pass after preserving commits and reusing the checkpointed build.
---
