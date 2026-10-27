---
Category: Batch export treated one build's dirty data as a whole-batch failure: first a missing session, then an unresolvable model with multi-billed models, empty baseSha or agentId, messages missing role, corrupt session JSON
Source: #1514 (2026-10-24)
Level: 2
Safeguard: Windowed export constructs and validates each build one by one; failures are counted by reason into `skipped=N (session_missing=a, session_invalid=b, schema_invalid=c)` and skipped; `--build` single export still errors and exits; `trajectory-export.test.ts` plants six dirty-data builds of each kind in a window and asserts the counts and that the rest are written as usual
Intercepts: 2
Recurrences: 1
Notes: Negative control: the second-round implementation only skipped missing sessions, so the same test went red with exit code 1 on the schema-failure build; passing after skipping by reason
---

