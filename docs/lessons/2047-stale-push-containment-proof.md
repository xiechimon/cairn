---
Category: A rejected push was reported as delivered using a stale tracking ref or an unrelated checked-out HEAD
Source: PR #2047 (2026-10-28)
Level: 2
Safeguard: Real-Git regressions in `apps/daemon/test/git.test.ts` cover missing and narrowed mappings, requested-branch changes, hook changes, distinct destinations and the actual fetched tip
Intercepts: 0
Recurrences: 0
Notes: Eight controls fail on the original PR source. The repair uses a unique proof ref, captures the destination before the push and rejects observed source changes; the final 96-test same-file suite passes.
---
