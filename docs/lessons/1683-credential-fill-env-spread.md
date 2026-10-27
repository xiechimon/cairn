---
Category: A daemon test spread `process.env` into a real `git credential fill`; pushing through a wrapper that sets `GIT_CONFIG_*` (credential.helper reset) made it fail only inside the pre-push hook
Source: #1683 push (2026-10-25)
Level: 2
Safeguard: `apps/daemon/test/git.test.ts` drops inherited `GIT_CONFIG_COUNT/KEY_n/VALUE_n/PARAMETERS` before spawning git; negative control: old test fails 1/64 with `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=credential.helper GIT_CONFIG_VALUE_0=`, fixed test passes 64/64
Intercepts: 0
Recurrences: 0
Notes: Tests that spawn git must not inherit the caller's git config env
---
