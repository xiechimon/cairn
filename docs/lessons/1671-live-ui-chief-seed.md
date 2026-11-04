---
Category: Live acceptance seed configured the task assignment but omitted the Chief binding required by UI Start
Source: #1671 actual card acceptance for PR #1928 (2026-10-28)
Level: 2
Safeguard: The isolated live harness binds its synthetic Chief and reads the binding back before declaring the task ready; since 2026-10-28
Intercepts: 0
Recurrences: 0
Notes: The real UI Start produced a missing-Chief error with agent null. Only the disposable team's Chief binding was patched to the existing acceptance Agent; the read-back passed and forwarding request count stayed zero. The task was not started through an API. Assignment alone cannot satisfy orchestrateTodo -> sendChiefMessage -> requireBoundAgent, so the seed checks that dependency explicitly.
---
