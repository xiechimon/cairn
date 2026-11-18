# Shared GitHub grant: connection owns the credential, the MCP connector holds a reference

Status: accepted direction (research: `docs/research/github-shared-grant-design-2026-11-18.md`, prior art: `docs/research/github-auth-two-surfaces-2026-11-17.md`).

## Why

Today a team can hold two independent `ghu_`/`ghr_` device-flow grants on the same `cairnwright` App: `github_connection` (repo picker, server API calls, step git credentials) and the `github` MCP connector's sealed `oauthCipher` (agent MCP tools). Same App, same token type, same `offline_access` scope, two identical device dialogs. A live probe (2026-11-18) confirmed the remote MCP accepts a connection-style `ghu_` — 49 tools over `api.githubcopilot.com/mcp/`.

The merge must keep exactly one refresh writer: GitHub rotation invalidates the spent `ghr_` **and** the `ghu_` it replaced, so two storages of the same grant destroy each other. `github_connection` already has single-writer mechanics (`refreshChains` per-team dedup + `connectionGeneration` optimistic write, `github-connection.ts`); the connector's `refreshGithubApp` is the second writer this change deletes.

## State

- `github_connection` (teamId PK): the only token pair. `accessTokenCipher`, `refreshTokenCipher`, `accessTokenExpiresAt`, `refreshTokenExpiresAt`, `appClientId`, `connectionGeneration`, `disconnectedReason`, `login`, `githubUserId`, `scope`.
- `mcp_connector` row for catalog `github`: keeps `authKind='github-app'` — redefined to mean "bearer resolves from this team's `github_connection`" — plus `slug`, `url`, `status`, `statusReason`, `toolCount`, `checkedAt`, `label`, `oauthMeta`, `authRevision` (bind/reconnect optimistic guard only). `oauthCipher` is always NULL after this change; the column stays for `oauth`/`static` kinds.
- `githubConnectionDeviceStates` (oauth-state map): the only device-flow attempt map. Attempts gain an optional `target` tag so the connector sign-in can bind on completion.
- `oauthState.githubDevice`: shrinks to `{attemptId → {teamId, userId, target}}` bookkeeping (no device code, no grant). `GithubConnectorTarget` = `{kind:'new', slug}` | `{kind:'reconnect', connectorId, authRevision}`.

## Readers

| Reader | Resolves how |
| --- | --- |
| `checkMcpConnector` (probe) | `authKind='github-app'` → `connectionToken` on the team's row: `{token}` → probe; `{reason:'no-github-connection'\|'github-disconnected'}` → `needs_auth`/`reconnect`; `token-unreadable` → `needs_auth`/`reconnect`. |
| `deliverableConnector` / `stepConnectorEndpoints` | same resolution; `reason` → `null` → slug lands in `withheldMcp`. |
| `toConnectorRecord.account` | `github_connection.login` when connected; null otherwise. |
| `githubConnectorInstalled` | `githubUserHasInstallation` with the connection token; no usable token → 409. |
| repo picker / step credentials | unchanged — already read `github_connection`. |

`connectionToken` performs the expired-access-token refresh inline (single `refreshChains` flight per team, `connectionGeneration` write guard) — connector callers inherit refresh-for-free and never rotate anything themselves. `McpConnectorDeps` gains `githubFetch` + `oauthClient` so every construction site wires the same resolution (`routes-resources.mcpDeps`, `machine-step-token.connectorFields`).

## Writers

- `github_connection` is written only by: connection device poll completion (`pollGithubConnectionDevice` → `upsertGithubConnection`), connection OAuth callback, refresh rotation inside `connectionToken`, disconnect/delete routes, and the new adoption migration.
- Connector rows are written only by: `bindGithubConnector` (insert for `new`, revision check for `reconnect`), generic connector CRUD/check updates.

Deleted writers: `refreshGithubApp`, `saveGrant`'s cipher write, `sealGithubApp`, `openGithubApp`, `GithubAppSecrets`, the connector-side `refreshes` entry for `github-app` (`runRefresh` keeps the `oauth` branch).

## Sign-in transitions

**Connected already** (`hasGithubConnection` true): `GET /mcp-connectors/github` returns `connectionReady: true`; the web binds directly — `POST /mcp-connectors/github/bind {connectorId?}` → `new`: assert slug free + insert `authKind='github-app', oauthCipher=null` + `checkMcpConnector` → record (201). `reconnect`: row must be `authKind='github-app'` and `authRevision` must match → `checkMcpConnector` → record. No upstream call.

**Not connected**: `POST /mcp-connectors/github/device` delegates to `startGithubConnectionDevice` on the shared `githubConnectionDeviceStates` map and tags `oauthState.githubDevice[attemptId]` with the connector target. `POST .../device/:attempt` polls via `pollGithubConnectionDevice`; on `complete` it reads the tagged target, runs `bindGithubConnector`, runs `adoptGithubProfile` (same as the connection route), and returns `{status:'complete', connector}`. Terminal/denied/expired outcomes map through unchanged; `DELETE` removes the attempt from both maps.

Effect: one device authorization establishes the connection grant **and** the connector — no second dialog, and the same authorization simultaneously satisfies the repo picker. `request_oauth_on_install` stays an optional registration-level UX upgrade, out of scope.

## Migration of existing grants (boot, idempotent)

For every `mcp_connector` row with `authKind='github-app'` and `oauthCipher != null`: open the cipher; if the team has **no** `github_connection` row, `upsertGithubConnection` with `{login, githubUserId: userId, accessToken, refreshToken, accessTokenExpiresAt: expiresAt, scope: '', device:{clientId: <app clientId>, refreshTokenExpiresAt: refreshExpiresAt}}`; then set `oauthCipher=null`. If a connection row already exists, the connection wins — only the cipher is dropped. Runs once at server start (`index.ts`), after the context and secret box exist; a no-op on second run. Stale connector statuses self-heal on the next `checkMcpConnector`.

## Failure paths

- No connection row at delivery → `withheldMcp`; at probe → `needs_auth`/`reconnect`.
- `disconnectedReason` set → same as above (mirrors VS Code's session-removed → server-stop semantics).
- Upstream revoke mid-session → MCP probe sees 401 → existing probe error mapping (`error`/`forbidden`); delivery withholds on `expiresAt`/`reason` — no local re-mint.
- Concurrent deliveries while expired → single `refreshChains` rotation; all readers converge on the rotated pair.
- Stale `reconnect` target (`authRevision` bumped mid-sign-in) → 409, nothing written; raced slug on `new` → 409 via `assertSlugFree`.
- `connectionGeneration` guard already covers a connection refresh landing beside a reconnect.

## Tests (red-first)

On the old code each asserts today's wrong behavior, then flips post-merge:

1. `github-app` connector probe delivers the `github_connection` access token as bearer (today: reads its own cipher).
2. `stepConnectorEndpoints` for github slug uses the connection token; after the connection's refresh rotates, delivery carries the rotated `ghu_` — one upstream refresh call total.
3. Connection deleted/disconnected → connector check `needs_auth` → `withheldMcp` on delivery.
4. Boot adoption: sealed legacy cipher + no connection → `github_connection` populated, `oauthCipher=null`, connector probes connected without re-auth. With an existing connection → cipher dropped, connection untouched.
5. `POST /github/bind` with connection → creates connector `oauthCipher=null`, `status` from probe; without connection → 409.
6. Connector device sign-in writes `github_connection` and binds (`oauthCipher=null`, account=connection login).
7. `githubConnectorInstalled` reads installations with the connection token.

## Out of scope

- `request_oauth_on_install` combined install+authorize screen (GitHub requires the web flow, not device — registration-level UX upgrade).
- `github_app_authorization` webhook for upstream revocation (we detect on next probe/refresh instead).
- `refreshLeaseUntil` (currently written `null`, no writer enforces it) — flagged for a follow-up if cross-process refresh ever matters; `refreshChains` is per-process.
