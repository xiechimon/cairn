---
Category: Python deployment fixtures used default host paths instead of their scratch instance
Source: Ticket 1408 review round 1 (2026-10-30)
Level: 2
Safeguard: The shared Python fixture always passes its environment and asserts the resolved module DB matches the fixture DB
Intercepts: 0
Recurrences: 0
Notes: fixture-environment-red.log records false leftover acceptance and missing default ROOT; green.log verifies the fixture environment assertion
---
