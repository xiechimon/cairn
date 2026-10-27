---
Category: Identity authentication read connection metadata before checking that a socket existed, causing 500 instead of token fallback
Source: #1762 (2026-10-26)
Level: 2
Safeguard: `apps/server/test/token-auth.test.ts` verifies missing peer metadata returns 401 without a token and 200 with a valid token
Intercepts: 1
Recurrences: 0
Notes: Negative control returned 500; guarding the connection metadata makes both assertions pass
---
