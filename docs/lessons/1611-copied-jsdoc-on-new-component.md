---
Category: When inserting a new component in front of an existing one, the neighboring `ClaudeMark`'s JSDoc was left on the new component's head as well
Source: #1611 (2026-10-25)
Level: 3
Safeguard: When reviewing the diff, compare each comment against the declaration it sits next to, one by one
Intercepts: 0
Recurrences: 0
Notes: Whether comment content fits the declaration cannot be machine-checked; the comment has been moved back to `ClaudeMark`
---
