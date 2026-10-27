---
Category: Follow-up messages were sent to a reviewer that had already ended its turn, so waiting for a new review did not start any work
Source: #1794 (2026-10-27)
Level: 3
Safeguard: The host collaboration tool contract distinguishes `send_message` from `followup_task`; inspect `list_agents` before waiting and use `followup_task` to activate a completed reviewer with the current source SHA
Intercepts: 0
Recurrences: 0
Notes: The external chat scheduler is outside the repository's code and tests, so a repository lint or unit test cannot enforce this tool sequence. Reading the live status exposed the idle reviewer, and an explicit follow-up resumed the source-bound review. No host scheduler change is claimed.
---
