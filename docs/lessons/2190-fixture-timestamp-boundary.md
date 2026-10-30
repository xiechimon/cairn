---
Category: A hand-computed fixture timestamp missed the backup boundary by one day
Source: #2190 (2026-10-30)
Level: 2
Safeguard: Boundary regression derives milliseconds from an explicit UTC date rather than a hand-computed epoch; since 2026-10-30
Intercepts: 0
Recurrences: 0
Notes: relationships-boundary-fixture-error.log records the discarded test error; the drill correctly accepted a post-backup row. The corrected test requires a row at the actual cutoff.
---
