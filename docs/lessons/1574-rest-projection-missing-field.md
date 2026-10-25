---
Category: Memory history was persisted, but the REST explicit projection missed the new field
Source: #1574 (2026-10-24)
Level: 2
Safeguard: `m4b-memory.test.ts` updates through the real worker HTTP relay and then reads the old body back through the REST list
Intercepts: 1
Recurrences: 0
Notes: real negative control: the old toMemoryRecord had no history and the HTTP integration assertion went red; green after filling the projection; shared history stays optional for compatibility with old servers, and the boundary test constrains new servers
---
