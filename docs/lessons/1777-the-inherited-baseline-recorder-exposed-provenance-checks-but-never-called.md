---
Category: The inherited baseline recorder exposed provenance checks but never called them before publishing scores
Source: #1777 (2026-10-26)
Level: 2
Safeguard: `recordWeekly` compares the recorded digest and worktree harness against `origin/main`; `baseline-record.test.ts` rejects absent provenance, mixed-model scores, and empty results
Intercepts: 2
Recurrences: 0
Notes: Negative controls: the inherited implementation accepted both inputs; both new tests failed before the recording guard was added; the empty-result negative control also failed before its guard
---
