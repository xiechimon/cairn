---
Category: A socket fixture waited for readiness after its child had already failed
Source: Ticket 2057 (2026-10-30)
Level: 2
Safeguard: The stale socket fixture races readiness against child exit so startup failure rejects immediately
Intercepts: 0
Recurrences: 0
Notes: socket-blocked.log records the original readiness timeout after sandbox EPERM; the final integration run must report the early exit rather than time out
---

The first runtime attempt exposed a harness error: waiting only for stdout hid the fixture's early startup failure. The fixture now observes both startup and exit. Runtime socket permission checks remain unverified in the restricted sandbox.
