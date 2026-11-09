# Verify evidence implementation: persistence prior art

Read this before implementing the four rollout steps in [the accepted design](../design/verify-evidence-out-of-tree.md). This note checks persistence mechanisms; it does not reopen the accepted product decision.

Evidence labels: **Observed** means original text or installed source read on 2026-11-09; **Inferred** means derived from those observations. No runtime acceptance is claimed here.

## Sources and comparison

The relevant designated source is SQLite and the installed persistence tool's own source from the host-ops row of `research/SOURCES.md`. This change introduces no host service, Docker, VPN, model API, UI reference, or CI mechanism. Their designated sources do not apply.

| Source | Mechanism | Trade-off and application | Evidence |
| --- | --- | --- | --- |
| [Accepted design, PR #3513](https://github.com/xiechimon/cairn/pull/3513), merged 2026-11-09 UTC | Project mode defaults to `attachments`; first verify enqueue snapshots it on the build; existing cairn project receives a one-time `repository` migration. | Preserve four sequential PRs and fail closed between steps 2 and 3. No repository-name decision in runtime readers. | Observed: PR body and complete local design. |
| [SQLite ALTER TABLE](https://sqlite.org/lang_altertable.html#alter_table_add_column) | Adding a non-null column requires a non-null default; ordinary column additions update schema without rewriting all content. | `project.evidenceStore` can use `NOT NULL DEFAULT 'attachments'`; nullable build state remains unset until enqueue. | Observed: official text fetched through agent-reach's Jina Reader route. |
| [Drizzle ORM 0.45.2 SQLite dialect](https://github.com/drizzle-team/drizzle-orm/blob/0.45.2/drizzle-orm/src/sqlite-core/dialect.ts) | Installed `SQLiteSyncDialect.migrate` executes migrations newer than the recorded timestamp in one transaction, records each migration, rolls back on error. | Put the one-time data update in the new migration rather than boot-time application logic; use a journal timestamp after the prior migration. | Observed: installed `drizzle-orm@0.45.2` `better-sqlite3/migrator.js` and `sqlite-core/dialect.js`. |
| [Cairn project-group migration test](../../apps/server/test/project-group-migration.test.ts) | Migrate a temporary database to the predecessor, seed existing rows, migrate to current, insert a new row, then migrate again. | Reuse the established testing pattern to prove the exception affects only rows present at upgrade and never overrides a later owner setting. | Observed: complete test source. |
| [Cairn project settings](../../packages/shared/src/records/project.ts), [service](../../apps/server/src/services/projects.ts), [record mapper](../../apps/server/src/services/git.ts), [routes](../../apps/server/src/routes-projects.ts) | Strict Zod PATCH schema, service `carriesKey` check and update, explicit response mapping. | Adding only a database column would leave the API unchanged; all existing boundaries need the field. | Observed: shared schema and route source; service update path and record mapper. |
| Implementation choice | Follow the existing SQL migration, shared enum, service update, and response mapper path. | Avoid a second settings endpoint or a runtime name-based fallback. | Inferred from the preceding rows and mandated by the accepted design. |

## Step 1 handoff

- Add a required project setting and a nullable build column. The build column is storage only in step 1; first-enqueue write-once behavior belongs to step 2. **Observed**: rollout order and invariant 6 in the design.
- Cover new project defaults, the existing cairn exception, unrelated repositories and forks, fresh post-migration cairn projects, owner edits surviving a repeated migration, valid PATCH values, invalid PATCH values, and response serialization. **Inferred**: these are the entry paths and failure boundaries of the accepted setting design.
- Keep snapshots independent of the live project setting. Do not backfill the nullable build column or populate it when creating a build. **Observed**: invariant 6 requires snapshotting at the first verify enqueue.
- The migration directory is protected by [the path policy](../../packages/shared/merge-gate-paths.json); the implementation PR needs the user-requested `coordinator-hold`. **Observed**: protected `**/drizzle/**` pattern.

For later rollout steps, use the accepted design's tests and TLA+ requirement directly. This persistence note makes no claim that prompts, daemon rewind, attachment gates, or comments work before their own runtime verification.
