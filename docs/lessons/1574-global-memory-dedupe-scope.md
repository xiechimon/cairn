---
Category: Global-memory updates only deduped against other global entries, so turning a global memory into a project memory's body let that project inject a duplicate
Source: #1574 (2026-10-24)
Level: 2
Safeguard: the global-to-project-body case in `memory-dedupe.test.ts`; `updateMemoryEntry` compares a global entry against all projects with the same Agent and team
Intercepts: 1
Recurrences: 0
Notes: real negative control: reverting the comparison scope to the entry's own projectId turned the case red (both chief and worker shapes), green after restoring
---
