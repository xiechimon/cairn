---
Category: Restore preview missed writes committed while services were stopping
Source: Ticket 1408 (2026-10-30)
Level: 2
Safeguard: A regression injects a row during systemctl stop and requires the confirmed restore discard report to include it
Intercepts: 0
Recurrences: 0
Notes: restore-race-red.log records the original preview-before-stop failure; confirmed restores now stop writers before computing the report. Green output is in green.log.
---
