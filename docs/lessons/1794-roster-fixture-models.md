---
Category: The in-product merge-gate test named author and reviewer models that are not in the vendor roster (`claude-author`, `gpt-reviewer`). After independence is decided by vendor, an unknown vendor stays blocked, so a bound review still reported `independent-review-missing`
Source: #1794 rebase (2026-10-26)
Level: 2
Safeguard: `apps/server/test/merge-gate-product.test.ts` uses roster ids from different vendors (`claude-opus-4-8` and `gpt-5.4`)
Intercepts: 1
Recurrences: 0
Notes: Negative control: the old ids fail `modelsAreIndependent` because both vendors are null; the roster ids clear `independent-review-missing`
---
