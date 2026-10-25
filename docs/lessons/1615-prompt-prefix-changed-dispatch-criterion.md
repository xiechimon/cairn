---
Category: Appending a paragraph to the front of the prompt changed the "is the prompt empty" dispatch criterion, so a planning step restarted from failed with an empty plan slot fell back to the build slot
Source: #1615 re-review (2026-10-24)
Level: 2
Safeguard: the three "planning-step redispatch" cases in `retry-lessons.test.ts` pin the dispatch target; `dispatch-eligibility.ts` treats a first-round planning prompt with lessons as first round
Intercepts: 1
Recurrences: 0
Notes: negative control: without the criterion change the two "does not fall back to the build slot" cases went red (the claim took the step), green after the change; restarts with feedback still fall back
---
