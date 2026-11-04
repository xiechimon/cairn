---
Category: A private parser helper and a fixture factory each had only one call site
Source: PR #2030 pre-push (2026-10-28)
Level: 2
Safeguard: The existing single-use-helper gate rejects these definitions; parsing and fixture text stay at their call sites
Intercepts: 2
Recurrences: 0
Notes: The actual pre-push run rejected both helpers. After inlining them, the same gate reports zero violations and the 29-case review suite still passes.
---
