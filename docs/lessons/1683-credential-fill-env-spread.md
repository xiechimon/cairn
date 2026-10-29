---
Category: A daemon test spread `process.env` into a real `git credential fill`; pushing through a wrapper that sets `GIT_CONFIG_*` (credential.helper reset) made it fail only inside the pre-push hook
Source: #1683 push (2026-10-25)
Level: 2
Safeguard: `apps/daemon/test/git.test.ts` drops inherited `GIT_CONFIG_COUNT/KEY_n/VALUE_n/PARAMETERS` before spawning git; negative control: old test fails 1/64 with `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=credential.helper GIT_CONFIG_VALUE_0=`, fixed test passes 64/64; `scrubGateEnv` in `scripts/scrub-git-env.mjs` drops every `*_BASE_SHA` and `PREPUSH_FORCE_FULL` before `scripts/prepush.test.mjs` and `scripts/heavy-slots.test.mjs` spawn prepush in a temporary repository (#2174)
Intercepts: 0
Recurrences: 0
Notes: Tests that spawn git must not inherit the caller's git config env. Recurred on #2174: CI's prepush step env (`ENGLISH_ONLY_BASE_SHA`, and `PREPUSH_FORCE_FULL=true` on push) reached prepush children in temporary repositories; negative control: `PREPUSH_FORCE_FULL=true ENGLISH_ONLY_BASE_SHA=<main sha> node --test scripts/prepush.test.mjs` failed 3/45 before and passes 46/46 after
---
