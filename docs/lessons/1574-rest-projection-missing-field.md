---
Category: Memory history was persisted, but the REST explicit projection missed the new field
Source: #1574 (2026-10-24)
Level: 2
Safeguard: `m4b-memory.test.ts` updates through the real worker HTTP relay, then reads the old body back through the REST list
Intercepts: 1
Recurrences: 0
Notes: Real negative control: the old toMemoryRecord had no history and the HTTP integration assertion went red; green after the projection was completed; shared history stays optional for old-server compatibility, with the boundary test constraining new servers
---

