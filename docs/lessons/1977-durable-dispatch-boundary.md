---
Category: Crash tests missed the interval between durable claim and dispatch invocation
Source: Issue #1977 (2026-10-28)
Level: 2
Safeguard: Process exit immediately after claim commit plus restarted requests and durable launch-count assertions
Intercepts: 0
Recurrences: 0
Notes: review-red.log fails the old claimed state; the durable uncertain state prevents retries before acknowledgment
---
