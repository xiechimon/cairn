---
Category: A new e2e spec copied the long header comment from a sibling spec; comment-discipline-gate reported 12 new comment lines
Source: #1626 e2e follow-up (2026-10-25)
Level: 2
Safeguard: `scripts/comment-discipline-gate.mjs`; the failure mode was rewritten into test names and assertions, leaving no comments; negative control: `apps/web/e2e/info-card-report.spec.ts` with the header comment reported 12, 0 after removal
Intercepts: 2
Recurrences: 0
Notes: Caught by the machine check; header comments of existing specs are not a template for new specs; #1684 same class (recurrence): the new spec's 18-line header plus 39 new comment lines across source/CSS were reported by the gate, 0 after removing them all (rationale recorded in docs/verify/1684/README.md)
---

