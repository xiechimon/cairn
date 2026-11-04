---
Category: The new prompt paragraph broke two existing integration tests: a failed restart with feedback appended the lessons paragraph even with only the failure reason, breaking m7's feedback reconciliation; a blank-feedback pure restart round got the lessons paragraph stuffed in, breaking #720's empty-prompt invariant
Source: #1615 pre-push (2026-10-24)
Level: 2
Safeguard: `integration/test/m7-failed-send-e2e.test.ts` and `restart-blank-feedback-e2e.test.ts` went red in the prepush full integration run; `retry-lessons.test.ts` adds the "blank-feedback pure restart" and "only a failure reason" cases; the lessons paragraph appears only in restarts with user feedback and with at least one previous-round record other than lessons
Intercepts: 2
Recurrences: 0
Notes: Negative control: both integration tests were actually red before the change (m7's llmSawFeedback false, the blank-feedback case's prompt non-null), both green after; the root cause was running only the server unit tests locally, not the affected integration tests
---
