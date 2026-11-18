# Retire the D60 legacy agent-layer copy and boot leftovers (#5347)

Remove the frozen `apps/server/src/legacy/agent-layer/` oracle copy (~2,850
`@ts-nocheck` lines), the two-start `migrateThrough('0119_agent_layer_backup')`
temp-dir slice in `db/client.ts`, `db/legacy-export.ts`, the
`migration-oracle:full` script and its fixture, the unused `CAIRN_ROUTING_RULES`
env, and the expired local-merge fallback scans in `autonomousMergePolicy`. Gate
the three unguarded boot backfills behind `data_migration` one-shot markers.

## Why now

The layer was frozen at D60 (agent table dropped by `0120_drop_agents`,
migrations now at 0205). `biome.json` itself says the copy may be deleted once
0116 has been live for a release. The two-start boot pays a journal read plus a
temp-dir copy of 119 SQL files on every open. The fallback scans in
`autonomousMergePolicy` re-read 24 h of `message`/`step` rows matching shapes no
writer has produced since the admission table existed.

## Boundary

- **Ancient DBs fail loudly, not silently.** `0120_drop_agents.sql` aborts the
  migration when `data_migration` lacks `drop-agents` and `agent` still has
  rows. With the two-start code gone, a database last opened before the 0116 era
  (with live agent rows) hits that guard on `migrate()` and the process exits
  with the migration error — the intended retirement edge. Empty `agent`
  tables and every DB already past 0120 migrate normally.
- `legacy_agent_backup` (the 0119 snapshot table) stays; dropping dead tables is
  #5348's batch.
- `mcpServerRecordSchema` stays: the issue lists it as dead, but it is the live
  wire contract of `GET /api/teams/:id/mcp-servers` (`listMcpServers` returns
  `McpServerRecord[]`; web `api.get<McpServerRecord[]>` consumes it).
- `migrateUpTo` test helper stays — it stages old schemas for migration tests
  and has no dependency on the legacy modules.

## Changes

- Delete `src/legacy/agent-layer/{data-migration,db,dispatch-eligibility,
  routing-migration,routing-rules,schema}.ts`, `src/db/legacy-export.ts`,
  `scripts/migration-oracle-full.mjs`, `test/fixtures/legacy-oracle/`, and the
  tests that exist only to cover them: `legacy-export.test.ts`,
  `migration-boot-stages.test.ts`, `migration-0115-oracle.test.ts`.
- `db/client.ts`: `migrateDatabase` becomes `migrate(db, full folder)` +
  `foldMemoryIndexes`; `openDbWithHandle` loses `legacyExportDir` and
  `migrationLogger` opts (the logger only fed the agent-layer run).
- `index.ts`: `openDbWithHandle(config.dbPath)`; the three boot backfills run
  under `data_migration` markers, inserted after each successful run
  (`token-usage-cost-backfill`, `machine-concurrency-backfill`,
  `owner-checkpoints-seed`), following the `skills-home-v1` pattern. The gate
  lives at the call site so the services stay ungated — their tests call them
  repeatedly on one database.
- `autonomous-merge.ts`: `autonomousMergePolicy` counts only
  `autonomousMergeAdmission` rows; the 24 h `message` regex scan
  (`PR #\d+ 已由 cairn 经 GitHub 合并`, `local-merge-result`) and the done
  `kind='merge'` step scan go away, since no writer has produced those shapes
  since admissions existed.
- `biome.json`: drop both `**/legacy/agent-layer/*` restricted-import entries
  and both `apps/server/src/legacy/**` override includes.
- `package.json`: drop `migration-oracle:full`.
- `docs/configuration.md`: drop the `CAIRN_ROUTING_RULES` row; the flag has no
  reader left. `canary-stack.mjs` drops the env it passes.
- Test rewrites: `github-label-migration.test.ts` and
  `correction-classification.test.ts` replace the
  `migrateUpTo(0119) + runAgentLayerDataMigration + migrateUpTo(target)` staging
  with a direct `migrateUpTo(target)` (neither seeds `agent` rows, so the data
  migration was a no-op marker write for them). `deleted-tables-unreferenced`
  drops its legacy-path exclusion. `comment-discipline-allowlist.json`,
  `vitest-shard-weights.json` and `test-tmpdir-inventory.md` lose entries for
  deleted files.

## Semantics of the backfill markers

- `seedOwnerCheckpoints` only heals pre-column `todo` rows; new rows are
  reconciled by `reconcileOwners` (its filter already includes NULL
  `lastNotifiedOwner`). One-shot is exact.
- `backfillMachineConcurrency` re-derives `maxConcurrent` for non-overridden
  machines. One-shot freezes existing machines at the first gated boot's
  recommendation; new machines still get the recommendation at insert via
  `machineConcurrencyPatch`.
- `backfillTokenUsageCost` heals rows written while `provider.models[].cost`
  was absent. After the marker, rows written before rates existed stay NULL —
  `usage-daily` already recomputes costs live from current rates; the stored
  columns feed trajectory export and the autonomy spend cap. Writers populate
  cost at insert whenever rates exist.
- Marker rows are written only after the run returns; a crash re-runs the
  (idempotent) backfill on next boot.
