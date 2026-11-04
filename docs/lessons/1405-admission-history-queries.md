---
Category: Merge evaluation materialized unrelated transcript, step and build history
Source: #1405 (2026-10-30)
Level: 2
Safeguard: The large-message-table regression asserts UTC bounds in executed query shapes and rejects standalone build scans; dedicated indexed admission rows hold reservations
Intercepts: 0
Recurrences: 0
Notes: The original unbounded message query fails the SQL-shape regression in review-1-red.log. A previous-day admission now suppresses delayed legacy rows through a SQL join; review-1-dedup-red.log records the negative control.
---
