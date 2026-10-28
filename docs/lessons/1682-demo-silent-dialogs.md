---
Category: Demo resource forms and OAuth selection closed without explaining that changes were not saved
Source: PR #1769 review and browser reproduction (2026-10-28)
Level: 2
Safeguard: Browser cases submit the secret and provider forms and select OAuth in the compiled demo, asserting the notice and zero backend traffic
Intercepts: 3
Recurrences: 0
Notes: The two form cases failed before their notice calls, and the OAuth case independently failed before its notice call. The existing production and ordinary-fixture callbacks keep their behavior. These checks use only explicit nonsecret demo values and do not contact a provider.
---
