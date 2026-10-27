---
Category: An isolated tool invocation assumed an entry point or dependency existed
Source: PR #1839 review (2026-10-28)
Level: 2
Safeguard: Resolve entry points and relative imports from the committed inventory; Node module loading and explicit git staging block missing tool dependencies or evidence
Intercepts: 2
Recurrences: 1
Notes: The absent scripts/vp.mjs invocation failed and explicit git add refused the missing evidence path, so no commit was produced. The existing .claude/skills/verify-cairn/scripts/vp.mjs entry archived successfully. A later isolated dispatcher copy failed with ERR_MODULE_NOT_FOUND because dispatch-dedupe.mjs was omitted. Copying its committed relative dependency allowed the dispatcher to produce a live status record. Both failures were blocked before the dependent action; no verification or publication gate was bypassed.
---
