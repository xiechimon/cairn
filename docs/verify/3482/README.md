# Feature release removal verification

Requirement: [#3482](https://github.com/xiechimon/cairn/issues/3482). Design and main-source audit: [removal research](../../research/remove-feature-releases-2026-11-09.md).

## Runtime proof

Before: isolated server and Vite from main commit `0719ece9fc6c07f8c69c3dcb02a4cacb55ed1c16`, with one private and one globally released flag seeded in its scratch database. After: this branch's real server booted from a SQLite backup of that database. No request touched the owner's running instance.

| Observation | Before | After |
| --- | --- | --- |
| GET `/api/flags` | 200, two flags | 404, standard API not-found response |
| POST `/api/flags/beta/release` | Existing release route, covered by baseline tests | 404, no replacement handler |
| Stored release state | Two rows, table and two indexes | No table or indexes |
| User rows | Seeded owner | Identical after upgrade |
| SQLite foreign-key check | Valid | No errors |
| Live account page | Release list and key input | Neither rendered; no flag requests on load or reload |
| Viewports and themes | Main desktop capture | 1440px and 390px, light and dark; no horizontal overflow |

Screenshots are pinned to evidence commit `6ec4a00dd3fb304f9f3db340f377dd01ec104e60` under `docs/verify/3482/` on the PR asset branch. They include before, four after states, a t3code comparison and the generated API call transcript screenshot.

## Automated evidence

Red first: seven server cases failed on retained tables/indexes, owner/member GET and POST status, and registrations. Two web cases failed on the mounted manager and its translations.

| Command or scope | Result |
| --- | --- |
| Targeted Vitest: removal, instance owner, provider connection, schema, staged boot migration, i18n coverage, vocabulary and shared snapshots; `--maxWorkers=4` | 9 files, 178 tests passed |
| Targeted Vitest: archive migration and removal/ownership; `--maxWorkers=4` | Passed, including the migration journal newline contract |
| `pnpm --filter @cairn/web e2e:affected apps/web/e2e/account-release-removal.spec.ts apps/web/e2e/account-controls.spec.ts` | 19 tests passed; four removal cases use a real server with auth off; existing account controls include fixtures/mocked APIs |
| Node test runner: e2e affected selector and PR screenshot selector | Passed |
| `pnpm lint`, `pnpm typecheck`, `pnpm spec:parse`, `pnpm prepush` | Passed before push |

The deletion audit leaves flag references only in historical migrations/snapshots, the frozen migration oracle, historical research, and removal tests/design. The active feature registry, screenshot route-source registry, e2e selector, REST registry and table registry have been updated.

## Limits and process intercepts

No real provider, external account or production database was exercised. The migration intentionally destroys obsolete release preferences; restoring those preferences requires the previous code and a database backup. Relay, tags, project files and Feishu removal are outside this change.

Existing checks intercepted a stale e2e selector prefix during the test rename and a formatting difference before commit. The selector regression now names the retained live account removal flow, so the obsolete mapping cannot silently drop its coverage. An interrupted asset checkout was repaired only in its newly created scratch worktree after confirming its stale index lock had no holder; no implementation or other lane changes were reset.
