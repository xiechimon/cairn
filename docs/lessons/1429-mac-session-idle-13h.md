---
Category: Work dispatched to a Mac session sat idle with nobody noticing; the thread was silent for 13 hours; the moment ian spoke, both sides started working at once
Source: #1429 (2026-10-24)
Level: 5
Safeguard: Memory `rc-dispatch-needs-checkin`: after dispatching, check back on a timer; if stalled, take it back and do it yourself, stopping the remote session first when taking it back
Intercepts: 0
Recurrences: 0
Notes: Thread-orchestration behavior, invisible to CI
---
