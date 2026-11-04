---
Category: Structural edits introduced an extra closing parenthesis in a test and an unreachable return in gate recognition
Source: Issue 1956 (2026-10-28)
Level: 2
Safeguard: Node test collection and Biome noUnreachable run before acceptance; the CLI suite also runs in local and CI prepush
Intercepts: 2
Recurrences: 1
Notes: Node rejected the malformed filter expression; Biome then rejected a leftover unconditional return during gate simplification
---
