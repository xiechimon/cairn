---
Category: An unauthenticated Gemini CLI says `API key is missing`, and the login matcher ignored that sentence, so the step was reported as an initialize failure
Source: #1611 (2026-10-25)
Level: 2
Safeguard: `apps/daemon/test/acp.test.ts` failure mode 2 requires that sentence to contain the Gemini login hint
Intercepts: 1
Recurrences: 0
Notes: Negative control: before the matcher change the assertion received the raw API-key sentence (`docs/verify/1611/probe-gemini-auth-red.log`); after, the probe prints `Gemini login failed: run gemini and complete its login flow.`
---

