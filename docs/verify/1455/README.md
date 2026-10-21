# #1455 evidence: an apps/web unit-test change selects no e2e specs

Base = `23a39da9` (origin/main). Branch = `claude/optimistic-albattani-r5pmfn`.

`scripts/e2e-affected.mjs` classifies `apps/web/test/` and `apps/web/vitest.config.ts` as the web unit-test layer, which selects no specs. The rule sits ahead of the unmapped-web fallback. Both paths are vitest-only (`apps/web/vitest.config.ts` includes `test/**/*.test.ts`). Neither is in the fixture build that playwright serves, and no file under `apps/web/e2e/` imports from `../test/` or reads `vitest.config.ts`. Every other unmapped `apps/web/**` path keeps the full-suite fallback, including `apps/web/DESIGN.md`, which several e2e specs read. `docs/spec/19-测试分层与受影响面.md` lists the exception next to the fallback rule. The "nothing to run" message names both vitest layers.

## Dry runs

`node scripts/e2e-affected.mjs --dry-run -- <path>` for the two target paths and three controls.

| path | `dry-run-old-leg.txt` (base) | `dry-run-new-leg.txt` (branch) |
|---|---|---|
| `apps/web/test/columns.test.ts` | FULL, 169/169 specs | none |
| `apps/web/vitest.config.ts` | FULL, 169/169 specs | none |
| `apps/web/src/board/columns.ts` (control) | board family + a11y-axe, 25/169 | same |
| `apps/web/DESIGN.md` (control) | FULL | FULL |
| `apps/web/public/avatar-robot-1.svg` (control) | FULL | FULL |

The new leg also runs a unit test and its source together: the source's 25 specs are selected and the test adds none.

No source or spec file changes, so no e2e run and no unit run. `pnpm lint` and `pnpm spec:parse` pass.
