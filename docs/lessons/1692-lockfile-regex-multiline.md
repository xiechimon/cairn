---
Category: The new lockfile-pin test's first red was for the wrong reason: the scan regex missed the multiline flag and matched zero packages, so the sanity assertion fired instead of the missing-dependency assertion; a red phase must fail at the intended assertion, and the failure output was read only after a full run
Source: #1692 (2026-10-25)
Level: 2
Safeguard: `apps/daemon/test/published-deps.test.ts` opens with a `size > 0` sanity assertion over the packages the lockfile scan resolves, so an empty or broken scan fails loudly at the named check instead of passing vacuously or failing downstream
Intercepts: 1
Recurrences: 0
Notes: Negative control: dropping the `m` flag from the scan regex turns the sanity assertion red (`expected 0 to be greater than 0`), restoring the flag goes green, both re-run this round
---

