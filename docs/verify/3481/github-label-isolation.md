# GitHub-label isolation proof

The [cutover design](../../research/github-label-isolation-3481.md) was [approved by the coordinator](https://github.com/xiechimon/cairn/pull/3767#issuecomment-6751469789) before implementation. This segment preserves GitHub metadata before generic categories are retired; it does not close #3481.

## Production-entry-point upgrade and restart

[Identifier-free observations](labels-live-main-0143/result.json) come from a separately started production server with an isolated data directory, auth off and the in-server Coordinator disabled. The fixture database was migrated with the installed Drizzle migrator through main's 0143 before starting the real server. A pre-cutover backup was kept in scratch. Observation connections were read-only. The server was stopped and restarted through the owned-process helper; no live-instance writes, model call or GitHub request occurred.

| Clause | Observed result |
| --- | --- |
| Exact label preservation | Original ids, project ownership, names, colors, creation times and versions match after migration and restart. |
| Moved GitHub origin | Its association is in dedicated storage even though its current project is local. |
| Shared ordinary vocabulary | The ordinary task retains both generic links; only the GitHub-origin link moves. |
| API projection | GET returns HTTP 200 with dedicated ids separate from generic ids; the internal correction flag is absent. |
| Generic patch isolation | HTTP 200; an attempted public dedicated-id replacement does not change dedicated associations. |
| Correction completion | HTTP 409 without delivered-head evidence. |
| Ordinary completion | HTTP 200; no GitHub labels acquired. |
| Restart/integrity | Dedicated and generic association counts stay stable; foreign_key_check returns zero rows. |

The earlier [main-0140 observations](labels-live-evidence/result.json) and [main-0142 observations](labels-live-main-0142/result.json) are retained as historical evidence rather than overwritten. The current probe repeats the same behavioral assertions from main 0143.

## Red-first and regression evidence

Before production edits, sixteen state/migration/orchestration cases failed: the dedicated tables were absent, and a generic category incorrectly selected the GitHub bug path. Three mapper cases failed because the dedicated ids were dropped. Two existing shared-schema snapshots rejected the new task field; their diffs were inspected before updating them. The only snapshot additions are the dedicated record and optional task ids, including their event projection.

After merging main, the initial Coordinator separation test correctly rejected the old test's now-forbidden title/private-id arguments. The updated regression first proves private-id input is rejected, then uses the valid generic-only mutation and proves dedicated correction state survives. Main's sealed-owner-request and title-finality behavior was retained in the claim conflict resolution.

The earlier related selection uses `pnpm exec vitest run --changed origin/main` with seventeen explicit contract paths, `--maxWorkers=4 --no-file-parallelism --testTimeout=120000`, and passes 330 cases in sixteen files. Vitest's import graph does not select the journal regression that loads metadata from disk; it passed in the preceding complete targeted selections, which passed 271 cases in fifteen files plus 60 compatibility cases in two files (331 distinct cases across seventeen contracts). Coverage includes every approved reader/writer row: upgrade/restart/provenance/rollback; sync and import; claims and metadata; REST/Coordinator/MCP isolation; record/mapper contracts; correction; bug routing; project moves and cascading deletion.

Initial CI caught a missed registry consumer: explicit local path filters had excluded the database/wire inventory contracts. The dedicated tables are now registered in `DB_TABLES`, and the association is join-only. Two inventory cases failed before that fix; the inspected storage snapshot adds exactly those two names. The vocabulary, schema-table equality and shared snapshots pass together: 131 cases across three files. Exact counts and inventory equality remain enforced; no check was weakened.

After merging main's blocked-by changes, five upgrade cases failed before regenerating the label migration above main 0143. The incoming blocked-by test also caught its own assumption that no later migration changes schema; its schema comparison now stops at its named migration, while its final full-upgrade/restart check remains. The combined label, correction, import, worker, orchestration, blocked-by, migration, storage/wire and mapper selection passes 436 cases across twenty files with the same worker limits. The post-merge changed selection passes 435 cases in nineteen files; the disk-loaded journal guard passed explicitly.

The explicitly scoped affected-browser command selects the GitHub issue surface plus six real-server/account/token specs:

```sh
pnpm --filter @cairn/web e2e:affected -- apps/web/e2e/project-github-issues.spec.ts apps/server/src/services/github-issues.ts
```

All 26 tests in seven specs pass. The issue picker is fixture/mock evidence, not proof of real GitHub. Shared-record and mapper changes conservatively select a broader default e2e surface; the full suite remains CI's responsibility. No full local-suite or real-provider pass is claimed.

## Migration and limits

Main advanced again with 0143_blocked_by_hold. The branch merged main `07855f55f3bcb457a614fdc58f60f99f905c2213` and regenerated this migration as 0144 with fresh timestamp 1794268721640, above main's maximum 1794262262264. Its snapshot chains to main 0143's id 69b5c8c3-067f-4f56-84f9-9dc26026df03. A full snapshot comparison proves the predecessor schema is unchanged except the two dedicated tables and identity metadata; cutover SQL is byte-identical to the previously reviewed migration. The evidence-store predecessor guard is unchanged from main.

The migration uses native SQLite constraints to abort missing project, label or task provenance, and its failed-cutover regression proves that new tables, copies and association removal all roll back. Generic vocabulary rows remain intact. A code-only downgrade does not restore old label-association reads: use the pre-migration backup or a separately verified reverse-copy migration.

The web changes carry metadata only; no component, style, route, shortcut or UI copy changes. The mapper preserves legacy records without the optional field and separates ordinary and GitHub ids. No visual redesign or newly rendered label state is claimed. Generic tags, seeding, mutation parameters, settings UI and registry/docs retirement remain for the following segment.
