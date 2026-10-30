---
Category: Commands could proceed while a killed deployment retained a durable claim barrier
Source: Ticket 1408 dispatcher review (2026-10-30)
Level: 2
Safeguard: Deploy, check and restore refuse saved drain state before work and explicit resume reports restored pause values and removed barriers
Intercepts: 0
Recurrences: 0
Notes: red.log captures missing recovery diagnostics; green.log verifies command refusal, unchanged database bytes and explicit recovery.
---
