---
Category: Panel evidence and contrast checks observed transient entry-animation frames
Source: #1937 (2026-10-27)
Level: 1
Safeguard: Screenshots and axe share a native animation-state polling boundary; cancelled animations cannot reject a captured finished promise
Intercepts: 5
Recurrences: 1
Notes: Four actual prepush failures included one cancelled-animation AbortError and three contrast checks. Nine compiled-fixture probes observed transient violations and zero after finite animations settled. The full 22-case panel suite passed after sharing the boundary. Infinite animations are ignored; no opacity, color threshold, animation, or accessibility assertion was changed.
---
