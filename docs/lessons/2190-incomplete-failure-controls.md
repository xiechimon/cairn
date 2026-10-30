---
Category: Supplemental restore edge assertions were added after implementation rather than in the initial red test set
Source: Ticket 2190 (2026-10-30)
Level: 2
Safeguard: Explicit fixture regressions for invalid SQLite, attachment size, missing key, live DB scratch equality and strict machine fields
Intercepts: 0
Recurrences: 0
Notes: Initial 17 cases ran red before implementation; supplemental passing cases cannot establish test-first ordering. The first review-round red invocation supplied an unsupported mode; the focused rerun reproduced the intended content failures before implementation. They make these edge behaviors executable, while the acceptance record explicitly limits the process claim.
---

Round 2 adds red-before-fix controls for archive age, mode status, API thread reads, dependency preflight and safe backup diagnostics. An initial new age fixture renamed the input before the shared runner copied it; corrected to copy the archive before the authoritative red run. No acceptance claim uses that harness failure.
