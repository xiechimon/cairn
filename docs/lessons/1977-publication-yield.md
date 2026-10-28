---
Category: Function constructor checks cannot prevent ordinary callbacks from yielding publication
Source: Issue #1977 (2026-10-28)
Level: 1
Safeguard: Replace publication callbacks with bounded synchronous command execution and reject callback adapters before invocation
Intercepts: 0
Recurrences: 0
Notes: review-red.log captures the Promise-returning callback negative control; lifecycle tests cover command timeout and revoked completion
---
