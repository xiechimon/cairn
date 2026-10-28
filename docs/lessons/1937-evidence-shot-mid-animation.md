---
Category: Browser evidence and geometry checks observed transient or cancelled animations
Source: #1937 (2026-10-27)
Level: 1
Safeguard: Panel evidence and model geometry poll native finite animation state; project-file shadow assertions use Playwright CSS polling for the final 1px ring; since 2026-10-28
Intercepts: 7
Recurrences: 3
Notes: Four panel failures included one cancelled-animation AbortError and three contrast checks. Nine compiled-fixture probes observed transient violations and zero after finite animations settled; all 22 panel cases passed. Model-menu waiting reproduced AbortError in three controlled native-animation cancellations, then passed state polling with both widths 439. The next complete run passed 1387 cases and read project-file shadow spread 0.837381px during its transition toward 1px. Its CSS assertion now waits for the same required 1px substring; all 18 project-page repetitions passed. Product animations, final style values, geometry requirements, and accessibility thresholds remain unchanged.
---
