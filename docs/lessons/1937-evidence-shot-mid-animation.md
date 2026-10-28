---
Category: Browser evidence and geometry checks observed transient or cancelled animations
Source: #1937 (2026-10-27)
Level: 1
Safeguard: Panel screenshots, axe, and model-menu geometry poll native finite animation state without capturing rejectable finished promises; since 2026-10-28
Intercepts: 6
Recurrences: 2
Notes: Four panel prepush failures included one cancelled-animation AbortError and three contrast checks. Nine compiled-fixture probes observed transient violations and zero after finite animations settled. The full 22-case panel suite passed after sharing the boundary. A later full run passed 1387 cases and failed model-menu geometry before its assertions with the same AbortError. Three controlled native-animation cancellations reproduced the old rejection and passed state polling with menu scrollWidth and clientWidth both 439. Infinite animations are ignored; product animations and geometry assertions remain unchanged.
---
