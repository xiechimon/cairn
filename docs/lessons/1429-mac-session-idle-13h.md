---
Category: Work dispatched to a Mac session sat idle and stalled with no one noticing; the thread was silent for 13 hours, and both sides started working at once as soon as ian spoke
Source: #1429 (2026-10-24)
Level: 5
Safeguard: memory `rc-dispatch-needs-checkin`: check back on dispatched work on a timer, take it back and do it yourself when stalled, and stop the remote session first when taking it back
Intercepts: 0
Recurrences: 0
Notes: a thread-orchestration behavior CI cannot see
---
