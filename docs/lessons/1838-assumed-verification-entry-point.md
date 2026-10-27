---
Category: An isolated tool invocation assumed an entry point or dependency existed
Source: PR #1839 and PR #1933 reviews (2026-10-28)
Level: 1
Safeguard: Resolve the runtime with command -v and pass its absolute path to the dispatcher; preserve the inherited PATH when prepending a private tool directory. Resolve entry points and relative imports from the committed inventory; module loading and explicit staging block missing dependencies or evidence
Intercepts: 3
Recurrences: 2
Notes: The absent scripts/vp.mjs invocation failed and explicit git add refused the missing evidence path, so no commit was produced. The existing .claude/skills/verify-cairn/scripts/vp.mjs entry archived successfully. A later isolated dispatcher copy failed with ERR_MODULE_NOT_FOUND because dispatch-dedupe.mjs was omitted. Copying its committed relative dependency allowed the dispatcher to produce a live status record. A later review launch replaced PATH with a fixed list that omitted the installed Node runtime; env failed before review and the dispatcher reported no live process. Resolving the runtime before dispatch and preserving the inherited PATH produced a verified live status record. These failures were blocked before the dependent action; no verification or publication gate was bypassed.
---
