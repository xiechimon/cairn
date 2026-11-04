---
Category: A restoration fixture failed before its assertion because Git removed the deleted file parent directory
Source: #2023 repair of #1617 (2026-10-28)
Level: 2
Safeguard: The restoration case creates its parent before writing and requires a normal CLI exit plus the exact report; the negative-control validation in `docs/verify/1617/README.md` rejects fixture errors; since 2026-10-28
Intercepts: 0
Recurrences: 0
Notes: discarded-fixture-red.log is excluded from product acceptance. The corrected original-code run was checked for ERR_ASSERTION, the empty actual list and absence of ENOENT before its evidence was accepted.
---
