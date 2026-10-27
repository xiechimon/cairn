---
Category: Untraced children retained enforcement but escaped denial auditing
Source: Issue #1985 (2026-10-27)
Level: 1
Safeguard: Seccomp rejects CLONE_UNTRACED and disables clone3 so descendants cannot escape ptrace, verified by a compiled negative control wherever Linux x86_64 with gcc and ldd is present
Intercepts: 1
Recurrences: 0
Notes: A compiled child-process negative control missed the violation before the filter and records the rejected clone after it
---
