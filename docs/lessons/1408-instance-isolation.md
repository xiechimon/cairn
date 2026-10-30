---
Category: Deployment and restore hard-coded live unit and scratch instance settings
Source: Ticket 1408 dispatcher review (2026-10-30)
Level: 1
Safeguard: A shared mutation preflight rejects live defaults for custom units and requires the resolved DB under the server unit CAIRN_HOME before deploy, restore or resume; since 2026-10-30
Intercepts: 0
Recurrences: 1
Notes: Round 2 red.log rejects each live-default fallback for restore and resume; green.log verifies the shared preflight and configured instance paths.
---
