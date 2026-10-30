---
Category: A bundle verification command ran from the repository root and a buffered output probe missed the startup line
Source: #1686 (2026-10-27)
Level: 2
Safeguard: Use the server package working directory for build.mjs and collect complete child output before asserting startup; restore-drill resolves Node before HOME isolation and uses fixed startup markers with subprocess regression tests; since 2026-10-30
Intercepts: 1
Recurrences: 1
Notes: Both commands reported failure without a product defect; the corrected probe verified the bundled server and terminated its child. Ticket #2190 repeated the class: a HOME-dependent Node shim failed before decryption, but the drill reported decrypt failed. Red and green node:test logs cover the actual shim pattern, helper startup classification, wrong-key classification and withheld unknown stderr. Protection is raised from instructions to executable regressions. Level 1 cannot prevent an external executable from failing at runtime; the fixed marker protocol makes classification observable and tests enforce it. The recurrence event uses local-task-2190 because no PR is authorized. During this round the ledger record CLI was initially called without its required event file and then without the required pr field; its validation rejected both. Its baseline freezing also touched unrelated entries; those generated additions were removed after checking the diff.
---
