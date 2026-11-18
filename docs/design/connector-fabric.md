# Connector fabric

Status: design for the owner's review. Nothing here is built. Board item "Connector fabric" (W2 Affairs+IM, seq 30): a server-side tool-shape verdict and a Coordinator connector path; the Composio routing for the consumer-app catalog is recorded in `docs/ops/launch-owner-actions.md` row 7 and `docs/research/duskbot-vs-cairn-2026-11-17.md` §4. Grounded on `origin/main` `7cc6dd1fc`. Prior art: dusk bot's `connector-verdict.ts` — a server-side allowlist that must hold even against a garbled model — and its Composio routing; the pattern is borrowed, not the code. No Composio API key is needed to review this page; the key is an owner action.

## 1. What the fabric is

One registry, one broker. A **connector** is any external app connection that ends as tools a model can call: an MCP server, a consumer app reached through the owner's own Composio account, or a direct per-app OAuth link. The registry is one row per connector on the existing `mcp_connector` table (`apps/server/src/db/schema.ts:1523`); the broker is a new in-server component that inspects every tool call before it leaves.

Three sources share the one record and one state machine:

| Source | Auth | New work |
|---|---|---|
| MCP server (shipped) | `none`, static headers/token, full MCP OAuth (PKCE S256, dynamic registration, refresh rotation) or the shared GitHub grant — 8-entry `MCP_CATALOG` plus custom https URLs (`packages/shared/src/records/mcp-connector.ts`, `apps/server/src/services/mcp-servers.ts`) | none |
| Composio toolkit | Owner's Composio key (`x-api-key`) on a tool-router session `mcp.url` — the existing static-header transport; the per-app OAuth runs on Composio's hosted flow (`session.authorize(toolkit)` → `redirect_url` → connected account ACTIVE), so Gmail-class tokens never enter this store | one connector row per toolkit; a small Composio adapter for session create, authorize and account status |
| Direct app OAuth | The MCP OAuth machinery is the template | later class, not this slice |

The broker sits where connector tools are exposed. It holds a cached `tools/list` per connector (names, input schemas, annotations — the probe already counts tools; the fabric also stores them), rejects a call whose connector, tool name or arguments do not match that list before any upstream request, and classes each call under the action registry (`free | confirm-once | send | submit | owner-only`, `packages/shared/src/action-registry.ts`). The verdict is enforced at dispatch, never by trusting that a tool was offered to the model.

## 2. How a connector becomes tools

Two delivery paths, one verdict:

- **Daemon step (shipped):** `stepConnectorEndpoints` resolves granted slugs into `mcpConnectors` endpoints on the machine token (`stepToken`, `apps/server/src/services/machine-step-token.ts`); the daemon mounts them as per-step MCP servers (`stepMcpEndpoints`, `apps/daemon/src/step-skill-tool.ts`). `needs_auth` or expired connectors are withheld (`withheldMcp`). Grant = every connector slug on a machine with `capabilities.mcpConnectors` — the 2026-11-16 ruling that every step gets every connector stands.
- **Coordinator step (new):** the broker generates `connector_<slug>__<tool>` tool definitions from the cached list beside `coordinatorToolDefs` (`apps/server/src/coordinator/runtime/tools.ts`), dispatches them through the same relay path (`executeRelayToolCall`), and applies the verdict server-side at dispatch. The Coordinator today has no connector path — only in-process chief tools.

## 3. States and transitions

Lifecycle view over the stored `status` (`unchecked | connected | needs_auth | error`) plus a new terminal `revoked`:

| Fabric state | Stored form | Meaning |
|---|---|---|
| `discovered` | no row | catalog entry or Composio toolkit listed, not added |
| `auth-required` | `needs_auth` | no usable credential: `unauthorized`, `reconnect`, `expired`, `refresh_rejected`, `forbidden`; or no ACTIVE Composio connected account |
| `authorizing` | `needs_auth` + pending flow | OAuth state issued (`OAuthDeps.states`, memory, 30-min TTL) or Composio account INITIATED; owner has not returned |
| `ready` | `connected` | probe passed, tool list cached |
| `degraded` | `error` | `timeout`, `unreachable`, `http_N`, `refresh_failed`, Composio down — transient, re-probe or refresh may clear it |
| `revoked` | `revoked` (new) | provider or Composio account revoked; no retry; owner reconnect is the only exit |

| From → to | Who drives it |
|---|---|
| `discovered` → `auth-required` | owner adds the connector (row created `unchecked` → first probe `needs_auth`), or adds a Composio toolkit with no connected account |
| `auth-required` → `authorizing` | owner starts sign-in (OAuth start route, GitHub device flow, or Composio `authorize` redirect) |
| `authorizing` → `ready` | callback/poll completes, cipher sealed, probe passes |
| `authorizing` → `auth-required` | denied, expired state, exchange failure, or Composio account stuck non-ACTIVE |
| any → `ready` | probe or refresh succeeds |
| `ready` → `degraded` | probe/refresh/dispatch failure |
| `degraded` → `ready` | next probe or `deliverableConnector` refresh succeeds |
| `ready`/`degraded`/`auth-required` → `revoked` | upstream says the grant is gone (Composio account revoked, `refresh_rejected` on a provider that signals revocation) — terminal, not retried |
| `revoked` → `authorizing` | owner reconnects; old cipher replaced |
| any → gone | owner deletes the row; endpoints stop being granted |

## 4. Paths that read or write this state

| Path | Reads | Writes | On failure |
|---|---|---|---|
| Settings REST (`/api/teams/:id/mcp-connectors*`, `apps/server/src/routes-resources.ts`) | rows, catalog, Composio toolkit list | rows, `unchecked` reset on target change | validation or conflict → no row |
| Probe `checkMcpConnector` | row, sealed headers/bearer | status, reason, `toolCount`, `checkedAt`, cached tool list — conditional on `updatedAt`/`authRevision`/`tokenGeneration` | maps to `needs_auth`/`error`; a lost race keeps the newer row |
| OAuth start/callback (`services/oauth.ts` `states` map, `/api/oauth/callback`) | pending state | `oauthCipher`, `oauthMeta`, `authRevision+1`, `tokenGeneration+1` | issuer/exchange/conflict → landing flag, no row change; restart drops pending back to `auth-required` |
| Composio adapter (new) | sealed key, connected-account status | session URL + key cipher on the row | Composio down → `degraded`; bad key → `auth-required` |
| Token delivery `stepConnectorEndpoints` | row, bearer; refresh if expiring within 10 min, 5 s bound | refreshed cipher, `tokenGeneration` | not deliverable → `withheldMcp`; step still runs |
| Broker dispatch (new) | cached tool list, action registry, autonomy tier | journal entry per external call | unknown connector/tool/args or unapproved class → rejected before dispatch, logged; upstream error → tool error result, turn continues |
| Owner UI | records, status | sign-in, reconnect, revoke, delete | none — display only |

## 5. Failure modes to cover at build time

| # | Mode | Handling |
|---|---|---|
| F1 | Token expires mid-turn | `deliverableConnector` refreshes under a 5 s bound before delivery; a call in flight fails as a tool error and the turn continues — never retried on a dead token |
| F2 | Composio unreachable | probe/dispatch fail → `degraded`; steps get `withheldMcp`; re-probe on the next check, no flap loop |
| F3 | Scope insufficient | upstream 403 → `needs_auth` `forbidden`; reconnect with a wider scope is an owner action; the broker still refuses the tool until then |
| F4 | Revocation mid-step | `refresh_rejected` → `needs_auth`; when the provider signals revocation → `revoked`; withheld on next delivery |
| F5 | Restart during authorize | pending OAuth state is memory-only → back to `auth-required`; Composio INITIATED is durable on their side and resumes by polling |
| F6 | Garbled or injected tool call | broker rejects unknown tool names, schema-invalid args and unapproved classes before any upstream request — the dusk verdict rule |
| F7 | Two connectors expose the same tool name | verdict keys on `(slug, tool)`; slug uniqueness is `assertSlugFree` plus `MCP_RESERVED_SLUGS` |

## 6. Secrets and the approval boundary

Secrets stay in the existing vault: connector headers and OAuth material are `SecretBox` ciphers on the row (`valuesCipher`, `oauthCipher`); the Composio API key is a team `secret` row on the mail-secret precedent — a name `openSecretGrants` and `get_secret` refuse to hand a step. Connector bearers reach a step only as endpoint headers on its own token response and are added to log redaction (`mcpConnectorSecretValues`).

The boundary is the action tier, not the connector: read-only tools are `free`; a tool whose call has an external effect (send, post, delete, pay) routes through the action registry's `send`/`submit`/`confirm-once` classes — `guarded` tier asks on a decision card, `full` runs and journals. Classification comes from the cached MCP annotations (`readOnlyHint`, `destructiveHint`) with an owner-pinnable per-tool override; absent annotations default to external — fail closed, never trust declared intent. Connector management itself (add, remove, sign in, revoke, overrides) is owner-only, the `set_secret` precedent: the agent may use a connector, never configure one. When the broker lands it joins `externalEntryAuth` in `packages/shared/merge-gate-paths.json`.

## 7. Config surface

The existing page (`/app/resources/mcp-servers`, `apps/web/src/resources/mcp-servers-page.tsx`) gains: a Composio key field (owner pastes it once, then the app catalog lists), an **Apps** section beside the static catalog with one row per toolkit, and per-row state (`auth-required`/`authorizing`/`ready`/`degraded`/`revoked`), reason, tool count and Connect/Reconnect/Remove. Sign-in reuses the existing authorize→return dialogs; for Composio the authorize URL is their `redirect_url` and completion is a poll on the connected account, not `/api/oauth/callback`. Owner actions: paste the key, click Connect per app, pin per-tool overrides, set the action tier (existing setting).

## 8. Not in the first slice

Per-step or per-agent connector grants (the every-step-every-connector ruling stands); direct per-app OAuth outside Composio; Composio `manage_connections` agent-driven connect tool; app webhooks and event triggers (the routines item, board seq 31); broker enforcement on the daemon step path — daemon machines already hold the raw endpoint inside the trust boundary, so the first broker gates only the in-server Coordinator; exposing connector tools on `mcp-face.ts` to outside MCP clients.

## 9. Open questions for the owner

- **Composio key storage:** recommend a non-grantable team `secret` row (mail-secret precedent — rotatable without touching connectors) over another sealed column on the connector row.
- **Connector granularity:** recommend one row per Composio toolkit — Gmail and Calendar get separate slugs, statuses and revokes — over one mega-connector; the shared session URL stays internal.
- **Missing tool annotations:** recommend fail closed to the external-action class (ask on `guarded`, journaled on `full`) over treating unannotated tools as free.
