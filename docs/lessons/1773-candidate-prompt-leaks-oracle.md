---
Category: A new evaluation prompt supplied a version value used by its decision oracle
Source: PR #1879 candidate revision (2026-10-28)
Level: 2
Safeguard: The existing memory-regression case-data test rejects every include and exclude marker present in a prompt; since 2026-10-28
Intercepts: 1
Recurrences: 0
Notes: The real i07 candidate failed the criterion-leak test because its prompt supplied 0.5.0. The corrected prompt asks the model to find the changed version in repository sources. All 201 grading and database-seeding controls passed with the same oracle and unchanged guard. The red and green logs are committed under docs/verify/1773. Real-model qualification remains pending.
---
