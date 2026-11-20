# Migrations run with foreign keys off, checked after

## Why

`0236_chubby_boom_boom.sql` rebuilds `im_connection` (`__new_im_connection` → copy → `DROP TABLE im_connection` → rename). Its own `PRAGMA foreign_keys = OFF` is a no-op because Drizzle's synchronous SQLite migrator wraps every pending migration in one `BEGIN`/`COMMIT`, and SQLite cannot change foreign-key enforcement inside a transaction. On a real database with rows in `im_pairing_request`, `im_seen_inbound` or `im_turn_origin`, the `DROP` raises `FOREIGN KEY constraint failed` and the server exits on startup (0.1.536 outage).

## Decision

Follow SQLite's 12-step table-rebuild procedure at the one place that sits outside the migrator's transaction: the runner. `migrateDatabase` in `apps/server/src/db/client.ts` disables `foreign_keys` on the underlying `better-sqlite3` handle (`db.$client`) before `migrate()`, restores it in a `finally`, then runs `PRAGMA foreign_key_check` and throws if it reports rows. Individual `.sql` files stay untouched — they are immutable once shipped.

Single path: the toggle applies to every migration batch, not just files that declare rebuilds. Turning enforcement off does not change the semantics of migrations that do not need it, and keying it to file content would add a second mechanism to keep correct.

## States and transitions

- `foreign_keys` starts ON (`openConnection` sets it). `migrateDatabase` reads the current value, turns it OFF only when it was ON, and always restores the original value, including when `migrate()` throws.
- On `migrate()` success: `foreign_key_check` runs while restored to ON. Empty result → `foldMemoryIndexes` runs as before. Non-empty → throw; the migration committed but produced or surfaced an inconsistent graph, and startup must fail loudly rather than serve a broken schema.
- On `migrate()` failure: the pragma is restored and the original error propagates; `foreign_key_check` is skipped because the batch rolled back.
- `openDbWithHandle`, `openDb` and `migratedImage` all funnel through `migrateDatabase`, so file-backed and in-memory databases get the same behavior.

## Failure behavior

- A rebuild of a referenced table now succeeds mid-batch because enforcement is off during the batch; integrity is proven by the post-batch check.
- A migration that genuinely breaks referential integrity (bad copy, wrong rename) surfaces as the `foreign_key_check` error at startup instead of silently shipping a corrupt graph.
- Nothing is written outside the migrator's own transaction, so a failed batch still rolls back atomically.

## Bug class and coverage

`apps/server/test/im-connection-migration.test.ts` pins the class: two rebuild tests seed a realistic owner graph (`im_connection` plus `im_pairing_request`, and after `0209` also `im_seen_inbound`/`im_turn_origin`, plus `tag`/`todo_tag` for the `0202` retire) before the remaining migrations run, and a static scan walks the journal to list every `DROP TABLE` whose target was both created and referenced earlier — today exactly `0195`, `0202` (child dropped first, legal order, still exercised by the seeded rows) and `0236`.
