---
Category: When inserting a new component in front of an existing one, the neighbouring `ClaudeMark` JSDoc was left sitting on the new component's head
Source: #1611 (2026-10-25)
Level: 3
Safeguard: review diffs by walking each comment against the declaration it sits next to
Intercepts: 0
Recurrences: 0
Notes: whether a comment fits its declaration is not machine-checkable; the comment was moved back to `ClaudeMark`
---
