---
Category: A queued verification or snapshot update was treated as completed before its result arrived
Source: #1753 (2026-10-25)
Level: 3
Safeguard: Read the command completion and its output before applying the next dependent change or reporting completion
Intercepts: 2
Recurrences: 0
Notes: The original source was restored before the queued negative-control tests ran; their completed logs showed the old protected-path blockers, the human-only chief prompt, and dropped review answers. A premature snapshot-update report was corrected while the updater was still waiting for the lock. Repository checks cannot inspect what an agent observed in an earlier turn.
---
