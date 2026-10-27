---
Category: ACP bridge tests asserted helper output without verifying a negotiated protocol turn
Source: #1611 (2026-10-24)
Level: 2
Safeguard: `apps/daemon/test/acp-stdio.test.ts` runs NDJSON through SDK 2.0.2 and validates emitted StepEvent records, history suppression, model configuration and cancellation
Intercepts: 2
Recurrences: 1
Notes: The original bridge fails all nine transport cases; the corrected bridge passes. Typecheck also catches SDK response inference and the ES2023 test-library boundary. On this host Gemini CLI 0.65.0 completes initialize with protocolVersion 1 on both sides; a tool-using turn still needs Gemini login.
---

