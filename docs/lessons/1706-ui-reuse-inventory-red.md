---
Category: #1706 CI went red in `apps/web/test/ui-reuse-inventory.test.ts` (new `skeleton.tsx` missing from `COMPONENTS.md`); local pre-push ran only `vitest --changed`, which selects tests by import graph and never picks tests that read sources from disk
Source: #1706 (2026-10-25)
Level: 2
Safeguard: `scripts/prepush.mjs` runs the whole `@cairn/web` unit suite (about 2s) whenever an `apps/web/` path changes; `scripts/prepush.test.mjs` pins it
Intercepts: 0
Recurrences: 0
Notes: Negative control: on 216da877 `vitest --changed` passed while `pnpm --filter @cairn/web test` failed on `ui-reuse-inventory.test.ts:63`
---
