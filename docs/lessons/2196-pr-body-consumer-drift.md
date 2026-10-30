---
Category: The PR body contract migration left stale consumer expectations and restored automatic decision labeling
Source: #2196 (2026-10-30)
Level: 2
Safeguard: scripts/agent-rules.test.mjs checks the current merge wording and scripts/pr-tasks-gate.test.py executes the workflow decision script with a recording gh stub; since 2026-10-30
Intercepts: 0
Recurrences: 0
Notes: Negative controls reproduced the stale Acceptance expectation and the needs-decision write for unchecked tasks. The corrected workflow only disarms auto-merge for an existing decision label. CI and prepush retain the existing combined evidence test entry point.
---
