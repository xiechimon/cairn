# CN-8 scheduled traj:reflect → traj:curate

## Claim

With `CAIRN_TRAJ_REFLECT_CURATE=1` and reflector env set, the server scheduler runs reflect then curate once per UTC day on the daily trajectory export, and can optionally open GitHub issues for new `kind=guard` candidates.

## Artifacts

| File | What it shows |
|---|---|
| `summary.txt` | Before (module missing on main) vs after (vitest / lint / typecheck) |
| `vitest.log` | `trajectory-reflect-curate` + export/outcome slot tests green |
| `vocabulary.log` | `ENV_VARS` vocabulary exhaustiveness green |
| `lint.log` | `pnpm lint` exit 0 |
| `typecheck.log` | `pnpm typecheck` exit 0 |

## Commands

```sh
git show origin/main:apps/server/src/trajectory-reflect-curate.ts
# fatal: path exists on disk, but not in 'origin/main'

pnpm --filter @xiechimon/cairn exec vitest run \
  test/trajectory-reflect-curate.test.ts \
  test/trajectory-export.test.ts \
  test/trajectory-outcome-backfill.test.ts
pnpm --filter @cairn/shared exec vitest run test/vocabulary.test.ts
pnpm lint
pnpm typecheck
```
