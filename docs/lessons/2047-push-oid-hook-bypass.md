---
Category: Replacing a branch ref with an object ID in push arguments bypassed a branch-gated pre-push check
Source: PR #2047 repair (2026-10-28)
Level: 2
Safeguard: A real pre-push hook in `apps/daemon/test/git.test.ts` rejects the named work branch and must still raise GitPushHookError
Intercepts: 0
Recurrences: 0
Notes: The object-ID repair made the new hook control resolve incorrectly. Restoring the named-ref push makes it reject with the existing hook error type, while requested-branch rechecks reject observed local ref changes.
---
