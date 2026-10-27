---
Category: Writing the Unicode-fold negative-control case, `ſ` was put where no `s` occurs (`docs/pr-revieſ.md` folds back to `pr-revies`, not a protected path); the case went red because the fixture was wrong, not because the gate missed it
Source: #1621 (2026-10-24)
Level: 2
Safeguard: The doc-folding case in `apps/server/test/merge-gate-paths.test.ts` first applies NFKC plus lowercase to each variant and asserts the folded ASCII name itself hits protection, so a wrong fixture reports "folds to" instead of pretending the gate missed it
Intercepts: 2
Recurrences: 0
Notes: Negative control: putting `docs/pr-revieſ.md` back in the list makes the new assertion report `docs/pr-revieſ.md folds to docs/pr-revies.md`; it goes green with `docſ/pr-review.md`
---

