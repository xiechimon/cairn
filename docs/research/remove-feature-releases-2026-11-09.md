# Remove feature releases (#3482)

## Main-source research

Baseline: `origin/main` at `0719ece9fc6c07f8c69c3dcb02a4cacb55ed1c16`. This is deletion of an explicitly unwanted feature, not a new mechanism; the designated primary source is main itself. No external product behavior is introduced.

| Source | Observed behavior | Decision and trade-off |
| --- | --- | --- |
| [Flag service](https://github.com/xiechimon/cairn/blob/0719ece9fc6c07f8c69c3dcb02a4cacb55ed1c16/apps/server/src/services/feature-flags.ts) | Measured: per-user override, then global override, then first-user default. No business caller uses `flag`, `releaseFlag` or `setUserFlag` outside the flag routes and tests. | Delete the service, not an always-true replacement. |
| [Resource routes](https://github.com/xiechimon/cairn/blob/0719ece9fc6c07f8c69c3dcb02a4cacb55ed1c16/apps/server/src/routes-resources.ts) | Measured: provider test permission reuses `isOwner`; both listing capability and POST permission require it. | Extract the unchanged first-user check to `services/instance-owner.ts`; do not broaden permission. |
| [Account page](https://github.com/xiechimon/cairn/blob/0719ece9fc6c07f8c69c3dcb02a4cacb55ed1c16/apps/web/src/routes/account-page.tsx) | Measured: live accounts mount the release card unconditionally. | Delete the component, mount, translations and obsolete mocks. Keep account and Feishu controls unchanged. |
| [Migration 0100](https://github.com/xiechimon/cairn/blob/0719ece9fc6c07f8c69c3dcb02a4cacb55ed1c16/apps/server/drizzle/0100_feature_flag.sql) | Measured: all release state belongs to one table with two partial unique indexes and an outgoing user foreign key. | Append a DROP TABLE migration; preserve historical migrations and the frozen agent-layer oracle. Release settings are intentionally lost. |
| [Feature registry](https://github.com/xiechimon/cairn/blob/0719ece9fc6c07f8c69c3dcb02a4cacb55ed1c16/.claude/skills/verify-cairn/feature-map.json) | Measured: feature-releases has its own row; REST and table registries expose the retired mechanism. | Remove entries and regenerate their derived documents and snapshots. |

Inference: no retained feature needs a flag-dependent branch collapsed, since there is no production flag evaluation call site. Repository-wide searches must confirm that again after deletion.

Overlap checked via GitHub CLI: #3469 is merged and touches no flag sites; #3471 is open and shares only translations, shared snapshots and the generated feature map. Relay, tags, project files and Feishu removal remain independent tasks.

## State and failure design

The owner moved execution out of the task runner; no Coordinator review is available. This document records the deletion design before implementation. Protected migration and registry changes stay on `coordinator-hold` pending the external orchestration handoff.

| Read/write path | Transition and expected behavior | Test |
| --- | --- | --- |
| Existing database: global and per-user enabled/disabled flags | Migration drops the table and indexes; users and unrelated state stay byte-for-byte equivalent. | Upgrade migration with all flag scopes and foreign-key integrity check. |
| Fresh database and repeated migration | Final database contains no flag table or indexes; migration replay is a no-op. | Fresh and repeated migration assertions. |
| GET list and POST release, owner and non-owner | No handler; both return the standard API 404, with no writes or compatibility shim. | HTTP removal cases for both identities. |
| Provider capability and connection test | First inserted user remains the owner, missing and later users remain non-owners. | Instance owner regression plus existing provider-test authorization cases. |
| Account route, reload and narrow/dark variants | No release card, input, release action or flag request. Existing language and notification controls stay usable. | Live account deletion e2e and existing account-controls tests. |
| Shared REST, DB and feature registries | No retired routes/table/feature entry. | Registry assertions and regenerated shared snapshots. |

SQLite executes the new statement inside Drizzle's migration transaction. A migration error propagates and prevents successful startup; no catch-and-continue behavior is added. No secret values, new configuration or replacement switch are introduced. Rollback requires restoring a pre-migration database backup as well as old code if release settings are wanted back.

## UI brief

Surface: settings, account. Goal: remove feature-release management entirely.
Rules: C3, C6, V4, V10, R1. Reference opened: `docs/design/references/settings/t3code-general.jpg`, simple divided user settings without a release form. Draft exempt: deletion of one settings card, no new surface.

| Component | Empty/loading/error/offline | Long content/pending question | 390px and dark |
| --- | --- | --- | --- |
| Removed release card | No state exists after deletion; no fetch or blank space | No state exists after deletion | Absent in all viewport/theme combinations |
| Retained account settings | Existing controls unchanged; real server with auth off | Long names unchanged; questions have no account-specific state | Capture light/dark desktop and phone; assert no horizontal overflow |

Acceptance: red-first targeted tests; no flag runtime implementation or registration; a populated database upgrades safely; real account screenshots and retired API 404s; lint, typecheck, spec parse and prepush; CI and cloud review on the pushed head. Remaining visual or provider limits must be explicit in the PR.
