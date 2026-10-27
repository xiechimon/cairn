---
Category: An evidence archive invocation used a documented wrapper path absent from the checkout
Source: PR #1839 review (2026-10-28)
Level: 2
Safeguard: Resolve the verification entry point from the checked-out file inventory and run archive as a separate checked prerequisite before staging evidence paths
Intercepts: 1
Recurrences: 0
Notes: The absent scripts/vp.mjs invocation failed and explicit git add refused the missing evidence path, so no commit was produced. The existing .claude/skills/verify-cairn/scripts/vp.mjs entry archived successfully. No verification or publication gate was bypassed.
---
