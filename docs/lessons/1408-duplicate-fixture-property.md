---
Category: A bulk fixture configuration edit inserted an existing object property twice
Source: Ticket 1408 review round 2 (2026-10-30)
Level: 2
Safeguard: Biome noDuplicateObjectKeys rejects duplicate JavaScript object properties during pnpm lint
Intercepts: 0
Recurrences: 0
Notes: lint-round2-red.log records the actual duplicate timer property rejection; the duplicate was removed and lint rerun. The existing lint gate is the negative control; no new gate is claimed
---
