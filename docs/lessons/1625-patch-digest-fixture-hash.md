---
Category: The local patch digest test initially reused the hash of the local patch text for an old fixture constant, corrupting the existing cross-check at the same time; typecheck also caught first that the config write-back dropped existing auto settings
Source: #1625 (2026-10-25)
Level: 2
Safeguard: The digest test keeps the hash of the local text separate from the stock fixture hash; `pnpm typecheck` pins that the config write-back must satisfy the full auto-settings shape
Intercepts: 2
Recurrences: 0
Notes: Negative control: reusing the wrong hash turns the digest cross-check red; without the auto-settings defaults TypeScript rejects the write-back, and the checks turn green after the fix
---
