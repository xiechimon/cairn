---
Category: Global-memory dedup only compared against other global entries; changing a global memory's body to a project memory's body injected a duplicate into that project
Source: #1574 (2026-10-24)
Level: 2
Safeguard: `memory-dedupe.test.ts` has the global-to-project body case; `updateMemoryEntry` compares a global entry against all projects of the same Agent and team
Intercepts: 1
Recurrences: 0
Notes: Real negative control: narrowing the comparison back to the entry's own projectId turns that case red (both chief and worker forms), green after restoring it
---
