---
Category: Adding coordinator tables omitted the shared table registry and broke migration rewind coverage
Source: Issue #1977 (2026-10-28)
Level: 2
Safeguard: Existing schema-name equality and upgrade replay tests run through prepush Vitest before completion
Intercepts: 0
Recurrences: 0
Notes: The initial prepush run failed both schema assertions; registering internal tables and rewinding later migrations restores both without weakening assertions
---
