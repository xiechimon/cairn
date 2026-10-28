---
Category: Force-adding a new ignored skill did not let the normal commit hook re-stage it
Source: #1811 (2026-10-28)
Level: 1
Safeguard: The repository ignore configuration explicitly includes the verification skill directory so normal hook restaging succeeds; since 2026-10-28
Intercepts: 1
Recurrences: 0
Notes: The original ignore rules reject git add even after git add -f staged the skill. A real temporary-repository reproduction fails before the allowlist and passes with its single entry. The normal pre-commit hook remains enabled.
---
