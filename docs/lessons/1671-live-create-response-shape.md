---
Category: Live harness parsed an id-only creation response as a full Agent record
Source: #1671 final harness preflight (2026-10-28)
Level: 1
Safeguard: Agent and project creation results use the shared record schemas narrowed to their id field; the live harness removes its owned private directory on every process exit; since 2026-10-28
Intercepts: 0
Recurrences: 0
Notes: The zero-request seed replay exposed the full-record parser rejecting the actual id-only create response. The narrowed schema matches the route contract and the repeatable readiness check validates Chief binding and zero requests before any operator action. The failed startup's private directory was removed.
---
