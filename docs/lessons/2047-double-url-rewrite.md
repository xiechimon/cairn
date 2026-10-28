---
Category: Reusing an expanded Git URL applied insteadOf rules twice and certified a different repository
Source: PR #2073 repair of #2047 (2026-10-28)
Level: 2
Safeguard: Real-Git controls in `apps/daemon/test/git.test.ts` cover chained rewrites, ordinary aliases and multiple configured fetch URLs
Intercepts: 0
Recurrences: 0
Notes: Draft f379788e falsely resolves the rejecting chained-rewrite control. The repaired fetch preserves the raw URL, and the current four-file suite passes 112 tests including the alias and hook controls.
---
