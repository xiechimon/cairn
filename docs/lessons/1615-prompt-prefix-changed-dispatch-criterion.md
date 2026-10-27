---
Category: Appending a paragraph to the front of the prompt changed the "is the prompt empty" dispatch criterion; when a planning step reran from failed with an empty plan slot, it fell back to the build slot
Source: #1615 review (2026-10-24)
Level: 2
Safeguard: The three "planning-step redispatch" cases in `retry-lessons.test.ts` pin the dispatch target; `dispatch-eligibility.ts` treats a first-round planning prompt carrying lessons as first round
Intercepts: 1
Recurrences: 0
Notes: Negative control: without changing the dispatch criterion the two "does not fall back to the build slot" cases go red (the claim took the step), all green after the change; restarts with feedback still fall back
---
