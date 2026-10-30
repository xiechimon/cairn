---
Category: A bundle verification command ran from the repository root and a buffered output probe missed the startup line
Source: #1686 (2026-10-27)
Level: 2
Safeguard: Use the server package working directory for build.mjs and collect complete child output before asserting startup; restore-drill resolves Node before HOME isolation and uses fixed startup markers with subprocess regression tests; since 2026-10-30
Intercepts: 1
Recurrences: 1
Notes: Ticket #2190 exposed a HOME-dependent Node shim failure misclassified as decryption failure. Regression tests exercise shim resolution, helper startup markers, wrong-key classification and stderr redaction. External executable failures cannot be excluded by types alone.
---
