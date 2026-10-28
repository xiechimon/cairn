---
Category: Evaluation attempts could accept ephemeral storage or an unrepresentable deadline
Source: Issue #1977 (2026-10-28)
Level: 2
Safeguard: Lifecycle tests reject nonpersistent database paths and invalid or overflowing timestamps before dispatch
Intercepts: 1
Recurrences: 0
Notes: The previous implementation fails the negative control; validation runs before claiming or superseding an attempt
---
