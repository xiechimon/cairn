---
Category: A bundle verification command ran from the repository root and a buffered output probe missed the startup line
Source: #1686 (2026-10-27)
Level: 3
Safeguard: Use the server package working directory for build.mjs and collect complete child output before asserting startup
Intercepts: 1
Recurrences: 0
Notes: Both commands reported failure without a product defect; the corrected probe verified the bundled server and terminated its child
---
