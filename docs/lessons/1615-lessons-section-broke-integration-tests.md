---
Category: The new prompt paragraph broke two existing integration tests: a failed restart with only a failure reason still got the lessons paragraph appended and the m7 feedback reconciliation mismatched; a blank-feedback pure restart round was stuffed with the lessons paragraph, breaking #720's prompt-is-null invariant
Source: #1615 pre-push prepush (2026-10-24)
Level: 2
Safeguard: `integration/test/m7-failed-send-e2e.test.ts` and `restart-blank-feedback-e2e.test.ts` went red in the full integration run under prepush; `retry-lessons.test.ts` added the "blank-feedback pure restart" and "only failure reason" cases; the lessons paragraph only appears in restarts with user feedback and only when at least one prior-round record exists besides lessons
Intercepts: 2
Recurrences: 0
Notes: negative control: both integration tests actually ran red before the change (m7's llmSawFeedback false, the blank-feedback case's prompt non-null) and green after; the root cause was running only the server unit tests locally, not the affected integration tests
---
