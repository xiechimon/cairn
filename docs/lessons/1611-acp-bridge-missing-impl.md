---
Category: The ACP bridge's first version wrote tests first and shipped without the implementation file; the type shape was then caught by the compiler
Source: #1611 (2026-10-24)
Level: 2
Safeguard: the affected tests, daemon typecheck and Biome check together validate the new bridge surface
Intercepts: 1
Recurrences: 0
Notes: negative control: the missing-file test went red; wrong SDK fields and an un-narrowed union went red in typecheck; tests, typecheck and lint all green after the fix
---
