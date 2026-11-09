# GitHub-label isolation proof

The [cutover design](../../research/github-label-isolation-3481.md) was [approved by the coordinator](https://github.com/xiechimon/cairn/pull/3767#issuecomment-6751469789) before implementation. This segment preserves GitHub metadata before generic categories are retired; it does not close #3481.

## Production-entry-point upgrade and restart

[Identifier-free observations](labels-live-main-0142/result.json) come from a separately started production server with an isolated data directory, auth off and the in-server Coordinator disabled. The fixture database was migrated with the installed Drizzle migrator through main's 0142 before starting the real server. A pre-cutover backup was kept in scratch. Observation connections were read-only. The server was stopped and restarted through the owned-process helper; no live-instance writes, model call or GitHub request occurred.

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

The earlier [main-0140 observations](labels-live-evidence/result.json) are retained as historical evidence rather than overwritten. The current probe repeats the same behavioral assertions from main 0142.

## Red-first and regression evidence

Before production edits, sixteen state/migration/orchestration cases failed: the dedicated tables were absent, and a generic category incorrectly selected the GitHub bug path. Three mapper cases failed because the dedicated ids were dropped. Two existing shared-schema snapshots rejected the new task field; their diffs were inspected before updating them. The only snapshot additions are the dedicated record and optional task ids, including their event projection.

After merging main, the initial Coordinator separation test correctly rejected the old test's now-forbidden title/private-id arguments. The updated regression first proves private-id input is rejected, then uses the valid generic-only mutation and proves dedicated correction state survives. Main's sealed-owner-request and title-finality behavior was retained in the claim conflict resolution.

The final related selection uses `pnpm exec vitest run --changed origin/main` with seventeen explicit contract paths, `--maxWorkers=4 --no-file-parallelism --testTimeout=120000`, and passes 330 cases in sixteen files. Git's import graph does not select the journal regression that loads metadata from disk; it passed in the preceding complete targeted selections, which passed 271 cases in fifteen files plus 60 compatibility cases in two files (331 distinct cases across seventeen contracts). Coverage includes every approved reader/writer row: upgrade/restart/provenance/rollback; sync and import; claims and metadata; REST/Coordinator/MCP isolation; record/mapper contracts; correction; bug routing; project moves and cascading deletion.

The explicitly scoped affected-browser command selects the GitHub issue surface plus six real-server/account/token specs:

```sh
pnpm --filter @cairn/web e2e:affected -- apps/web/e2e/project-github-issues.spec.ts apps/server/src/services/github-issues.ts
```

All 26 tests in seven specs pass. The issue picker is fixture/mock evidence, not proof of real GitHub. Shared-record and mapper changes conservatively select a broader default e2e surface; the full suite remains CI's responsibility. No full local-suite or real-provider pass is claimed.

## Migration and limits

Main advanced during development to 0141_task_request and 0142_step_owner_messages. The branch merged main `39964999b78ae6ea9783095193e0d1face99022f` and regenerated this migration as 0143 with fresh timestamp 1794262958833, above main's maximum 1794259278282. Its snapshot chains to main 0142's id b2232e95-df50-4c40-b8c9-0b4476d55c87. A full snapshot comparison proves the predecessor schema is unchanged except the two dedicated tables and identity metadata. The evidence-store predecessor guard is unchanged from main.

The migration uses native SQLite constraints to abort missing project, label or task provenance, and its failed-cutover regression proves that new tables, copies and association removal all roll back. Generic vocabulary rows remain intact. A code-only downgrade does not restore old label-association reads: use the pre-migration backup or a separately verified reverse-copy migration.

The web changes carry metadata only; no component, style, route, shortcut or UI copy changes. The mapper preserves legacy records without the optional field and separates ordinary and GitHub ids. No visual redesign or newly rendered label state is claimed. Generic tags, seeding, mutation parameters, settings UI and registry/docs retirement remain for the following segment.
