# MCP connectors

Status: revision 3, accepted by the owner (mon X) on 2026-11-15. Baseline `origin/main` at `36aa6dc1a`. An independent read-only reviewer reviewed revision 1 on 2026-11-15 (3 blockers, 11 should-fix) and re-checked revision 2 (gate placement, refresh compare, PR order, 9 new items); revision 3 answers both rounds (see "Review answers") and the reviewer's verdict on revision 2 was ready for the owner's decisions once those were fixed. The owner accepted all six decisions listed at the end. On 2026-11-16 the owner replaced per-step grants with "on for every agent step" ("use it if it works, skip it if not, show no settings"); Decision 1, the Wire grant bullets, the Frontend and owner decision 6 below describe that. Research: [mcp-connectors-2026-11-15](../research/mcp-connectors-2026-11-15.md).

## Problem

Settings → `MCP` lists only what the server host's `~/.claude.json` holds, and the empty state tells the owner to edit that file by hand. mon X asked for what Claude.ai connectors and Amp's `Integrations & MCP` offer: a catalog of common public services (GitHub, Cloudflare and so on) connected with one click, an `添加 MCP 服务器` button for anything else, connection status, and no hand-written JSON. Connected servers must reach agents without further setup. Personal Cairn only; credentials stay on the owner's machines (the Cairn server and its Runners) and go to no third party except the service they belong to.

## This partly reverses spec 13

[Spec 13](../spec/13-resources-view-localization.md) (2026-09-28) deleted the `mcp_server` table on purpose: header and env secrets had been sealed in the server database and sent to the daemon on every step, while the daemon's own config already held them. It made `~/.claude.json` the only source and the wire carry slugs only.

Since then the personal `secret` table does what spec 13 removed for MCP: sealed with `SecretBox`, opened in `openSecretGrants`, sent per claimed step on `GET /api/machine/token`. Provider keys, the GitHub connection and Claude subscriptions follow the same pattern. And OAuth cannot live in a file the harness owns: access tokens expire and refresh tokens rotate, so one always-on process must refresh and store them; the server already does this for the GitHub connection (`github-connection.ts`).

Connectors therefore add a server-managed source next to the local file, which keeps its current behavior. Cairn never writes `~/.claude.json`. Spec 13's promise "the server DB has no copy of MCP secrets" is restated for connectors when this ships.

## Decisions

1. **Two sources, one slug namespace.** A slug resolves to a connector (server database) or a local entry (a Runner's `~/.claude.json`). Every agent step gets every MCP server it can reach: the local entries its Runner reports and, on a Runner that declares `mcpConnectors`, every connector of the team. There is no grant setting; the `mcpServers` columns on routing rules and work policies stay in the database unread. The route override's `requiredCapabilities.mcpServers` is a placement requirement, not a grant, and keeps offering local entries only. When a slug is both, the connector wins on a daemon that declares `mcpConnectors`, and the daemon writes one `[mcp]` line naming the shadowed local entry; fixed precedence, never recency. A new connector takes the catalog id as slug, or the next free `-2`, `-3` suffix when a local entry or connector already holds it, editable before saving. `cairn` is reserved (the daemon's host tool server, `HOST_MCP_SERVER_NAME`).
2. **Credentials are sealed by the existing `SecretBox` and keyfile** in the connector's own row, as `github_connection`, `provider` and `claude_subscription` hold theirs. They are not `secret` rows, because a `secret` row can be granted to a step and read back with `get_secret`; a connector credential must reach only the MCP client.
3. **What leaves the server.** Only what an MCP request needs: a static header value or an OAuth access token. Refresh tokens and registered client secrets never leave the server process. They reach a Runner only for a claimed agent step, in the token response.
4. **OAuth with the installed SDK, called step by step.** A server bridge uses only these `@modelcontextprotocol/sdk` 1.30.0 `client/auth.js` functions: `discoverOAuthProtectedResourceMetadata`, `discoverAuthorizationServerMetadata`, `registerClient`, `startAuthorization`, `exchangeAuthorization`, `refreshAuthorization`. It never uses `auth()` or a transport `authProvider`, which refresh, wipe or restart authorization on their own and would bypass the single-flight and compare-and-set below. The bridge adds what 1.30.0 lacks against the spec: always send `resource`; refuse an authorization server whose metadata lacks S256; check `iss` on the callback when advertised, and for a custom server require that its authorization server advertises `iss` (RFC 9207), so a code another vendor sends without `iss` cannot be relayed to an owner-added server's token endpoint (OAuth mix-up, RFC 9700 4.4). Registration is dynamic (DCR) with `application_type` `native` for a loopback origin and `web` for `https`; it is keyed by issuer and redirect URI and redone when either changes. A non-loopback `http://` origin cannot be an OAuth redirect, so there the token form is the only choice. A server that offers only Client ID Metadata Documents or pre-registration shows `需要你自己的 OAuth 应用` with client id and secret fields and the redirect URI to register; Cairn cannot host a public CIMD document.
5. **Server-side MCP needs a seam exception.** AGENTS.md keeps MCP access behind `apps/daemon/src/backend/` except the in-server Coordinator runtime, and `biome.json` lets only `services/mcp-face.ts` import the SDK on the server. The OAuth bridge and the status check need the SDK on the server, in `services/mcp-servers.ts` (already a security surface). This adds that file to both rules and needs the owner's approval.
6. **Owner-only writes.** `/api/teams/:id/mcp-connectors` joins `OWNER_ONLY_PATTERNS`. No Coordinator tool creates, edits, connects or grants a connector; the read tool `mcp_servers` lists connectors with names, URL without query and status only.
7. **v1 is remote connectors.** Catalog entries and custom remote URLs. A local command (stdio) or loopback URL runs on one Runner, so its connector carries a `machineId`, only that machine may claim steps that use it, and the server does not check it; this comes as a later PR (PR 6). The Coordinator gets connectors in PR 7 through an MCP client in `coordinator/runtime/` (the existing seam exception): with `coordinatorInServer` on by default, Runners never claim Coordinator steps, and the in-server runtime has no MCP client today. Until PR 7, the in-server Coordinator has no connectors; the page does not mention it.

## Catalog

A static list in `packages/shared/src/records/mcp-catalog.ts`: id, name, description, endpoint URL, auth kinds, token label and help link, options (each sets a header or a query parameter), docs link. No remote catalog fetch. A catalog connector's URL is the catalog URL plus its chosen options and cannot be edited otherwise.

| Entry | Endpoint | Connect with |
|---|---|---|
| GitHub | `https://api.githubcopilot.com/mcp/` | personal access token; options: read-only (`X-MCP-Readonly`), toolsets (`X-MCP-Toolsets`) |
| Cloudflare | `https://mcp.cloudflare.com/mcp` | browser sign-in, or API token |
| Linear | `https://mcp.linear.app/mcp` | browser sign-in, or API key |
| Notion | `https://mcp.notion.com/mcp` | browser sign-in |
| Sentry (beta) | `https://mcp.sentry.dev/mcp` | browser sign-in |
| Supabase (beta) | `https://mcp.supabase.com/mcp` | browser sign-in, or access token; options: project ref, read-only |
| Context7 | `https://mcp.context7.com/mcp` | none, or API key |
| Hugging Face | `https://huggingface.co/mcp` | none, browser sign-in, or token |

GitHub has no dynamic registration, so v1 offers its token form only. Cairn's GitHub connection token is not reused: it carries `repo` scope for Git work and would reach every agent holding the connector. Vercel, Figma, Slack and Atlassian need vendor approval, a public client document or an admin step and are left out. No sign-in flow was completed against a vendor yet; PR 2's proof runs one per "browser sign-in" entry, and an entry that fails ships token-only.

## Persisted state

New table `mcp_connector`, one migration, no change to existing tables:

| Column | Meaning |
|---|---|
| `id`, `teamId` | `teamId` is the personal workspace (compatibility name, as in `secret`) |
| `slug` | unique per team, `[a-z0-9-]{1,40}`, not `cairn`; tools appear as `mcp__<slug>__<tool>` |
| `label`, `catalogId` | `catalogId` null for a custom server |
| `url` | `https://` only in v1; no userinfo |
| `headerNames` | json string array; the only header information the list returns |
| `valuesCipher` | sealed JSON of static header values, null when none |
| `authKind` | `none`, `static` or `oauth` |
| `oauthMeta` | json, non-secret: resource, issuer, token endpoint, redirect URI, granted scope |
| `oauthCipher` | sealed JSON: registered client id and secret, access token, refresh token, access expiry |
| `status`, `statusReason`, `toolCount`, `checkedAt` | `unchecked` (written on insert, before the first check), `connected`, `needs_auth`, `error`; reason is a fixed code plus a short message with no credential |
| `authRevision` | bumped only by a new authorization (reconnect) or an origin change; header and label edits leave it alone |
| `tokenGeneration` | bumped by every token refresh and every new authorization |
| `createdAt`, `updatedAt` | |

Pending authorization (PKCE verifier, `state`, the intended slug, URL and options, the `authRevision` of an existing row when reconnecting, the origin) lives only in the existing in-memory `oauthStates` map as a new kind `mcp-connector`: 30-minute TTL, single use. A new OAuth connector's row is created in the callback, so an abandoned flow or a server restart leaves nothing behind. Client registrations are cached in memory by issuer and redirect URI so repeated attempts do not register again; the one used is sealed into the row in the callback.

## States

| From | To | When |
|---|---|---|
| none | `unchecked`, then `connected` or `error` | static or no-auth connector saved, then checked |
| none | `connected` or `error` | OAuth callback: code exchanged, row created with sealed tokens, then checked; slug taken meanwhile → nothing created, error landing |
| `connected`, `error`, `needs_auth` | same row, new tokens | reconnect (owner clicks `重新连接`, e.g. another account): callback writes only if `authRevision` still equals the one in the state entry, then bumps it and `tokenGeneration` |
| any OAuth row | `needs_auth` | owner changes a custom URL's origin: tokens dropped, `authRevision` bumped |
| `connected` | `needs_auth` | refresh answered `invalid_grant`, the check got 401 with a fresh token, or 403 `insufficient_scope` (reason names the scope; reconnect asks for granted plus challenged scopes) |
| `connected` | `error` | network or non-auth failure in check or refresh; credentials kept |
| `error` | `connected` | a check, or a refresh on the token path, succeeded |
| any | deleted | owner disconnects: row and ciphers deleted. No revocation call in v1: SDK 1.30.0 has none, and a hand-written RFC 7009 client is not worth it here. The UI says the vendor-side grant stays until revoked there. |

Refresh is single-flight per connector inside the server process. A refresh writes its result only if `authRevision` and `tokenGeneration` still match what it read, then bumps `tokenGeneration`. A reconnect or origin change during a refresh therefore wins and the refresh's tokens are dropped, which is right because they belong to the replaced authorization. A header or label edit bumps neither, so it can never discard a rotated pair the vendor has already consumed. Refresh starts when the access token has less than 10 minutes left.

The status check connects with a static `Authorization` header passed through `requestInit` and lists tools. It runs on save, on callback, on `重新检查`, and never refreshes; with an expired token it first asks the refresh single-flight.

## Wire

- **One grant function.** `stepMcpGrant(machine)` returns the slugs a step may use: the Runner's reported `capabilities.mcpServers` plus, when it declares `mcpConnectors`, every team connector, lowercased and de-duplicated; empty for digest and mail turns. Below the MCP version gate the claim payload still omits `mcpServers` (`undefined`, as `claimMcpSlugs` does today, so an old daemon keeps its local MCP) and the token response carries no connectors. Both the claim payload and the token response use it.
- **No claim gate.** A Runner without `mcpConnectors` simply gets no connector slugs, for worker and Coordinator steps alike; no step waits for a newer Runner and no system note is posted.
- **Token response.** `MachineTokenResponse` gains `mcpConnectors?: McpEndpoint[]` (existing `mcpEndpointSchema`, http only in v1) and `withheldMcp?: string[]`. Filled only for a `claimed` step, for every team connector. A static or no-auth connector is delivered unless `needs_auth`. An OAuth connector in `needs_auth` is withheld. Otherwise, when its access token has less than 10 minutes left, the token path tries the refresh single-flight with a 5-second bound and falls back to the old token while it is still valid; with no valid token the slug goes to `withheldMcp`. The call never fails because of a connector. A successful refresh here moves `error` to `connected`.
- **Daemon.** Declares `mcpConnectors: true`. `stepMcpEndpoints` mounts a connector only if its slug is in `claimed.mcpServers`, preferring it over the local file; a slug in `withheldMcp` logs `[mcp] <slug>: reconnect it in settings`. Connector header values join the runner's `credentialRedactor` list, and the same redactor rewrites every MCP server log message (`notifications/message`) before pi appends it to the machine-wide `mcp.log`, so a server that echoes a header or a tool argument writes the redaction marker where the credential was. An older daemon does not declare `mcpConnectors`, so the server sends it no connector slugs or tokens and its schema strip has nothing to drop.
- **Mid-step expiry.** A token handed out at step start is not refreshed during the step. The runner already re-calls `client.token(stepId)` for App credentials; reusing it on an MCP 401 is a later change. Known limit.
- **Orb guests.** The host daemon parses the token reply with its `machineTokenResponseSchema` and the relay forwards that to the guest unparsed (`relay.ts`); a guest always runs the host's release. A local Orb guest therefore receives connector tokens in plaintext, like `secrets` today. A remote sandbox (`openRelayStream` providers, such as E2B) runs on a third party's machines, so the host relay removes `mcpConnectors` from the reply for those and lists the slugs in `withheldMcp`. The secret-gateway PR must add both fields to its planned allowlist and move connector headers to `http` delivery; until then local guests see the values, which is an owner decision.

## Every path that reads or writes connector state

One test per row.

| # | Path | Behavior |
|---|---|---|
| 1 | `POST /api/teams/:id/mcp-connectors` (static or none) | owner only; validates slug, `https` URL without userinfo, header names; seals values; checks |
| 2 | `PATCH` | owner only; catalog URL immutable; a custom URL whose origin changes must carry new values and drops OAuth tokens and bumps `authRevision` (row becomes `needs_auth`); checks |
| 3 | `DELETE` | owner only; deletes; grants naming the slug resolve to "not found" lines |
| 4 | `POST …/oauth/start` (new or reconnect) | owner only; discovery, registration reuse or redo, PKCE; state entry; returns authorization URL |
| 5 | `GET /api/oauth/callback` kind `mcp-connector` | state consumed once; `iss` check; exchange; create or compare-and-set; check; lands on settings with result |
| 6 | `POST …/:cid/check` | owner only; check; writes status |
| 7 | `GET /api/teams/:id/mcp-servers` | local entries plus connectors with `source`, `status`; names only, never a value; the route override picker filters to `source: local` |
| 8 | Coordinator `mcp_servers` tool | same projection, URL without query; no write tool |
| 9 | `stepMcpGrant` from worker claim and worker token | same slugs on both (local entries plus every connector on a capable Runner); mail and digest empty; below version gate empty |
| 10 | `chiefClaimPayload`, `chiefStepToken` (Coordinator on a Runner, `coordinatorInServer` off) | same function; in-server Coordinator untouched until PR 7 |
| 11 | No claim gate | a Runner without `mcpConnectors` claims the step and gets only its local entries |
| 12 | Capability parse | `mcpConnectors` survives `parseReportedCapabilities` |
| 13 | Token path refresh | single-flight; 5 s bound; withheld on failure, never throws; generation compare-and-set |
| 14 | Daemon resolution | only slugs in `claimed.mcpServers`; connector over local file; shadow and withheld lines |
| 15 | Redaction and logs | connector values redacted in transcripts and logs; no value in server logs, errors, status reasons or `[mcp]` lines |
| 16 | Orb guest | local guest mounts the connector; remote sandbox gets it in `withheldMcp` only |
| 18 | Coordinator on an old Runner | turn runs with local entries only, no note; thread not stalled |
| 17 | Step retry, fallback model, continued session | each new step asks for its own token and grant; no state carried in the session |

## Security notes

- The server fetches owner-supplied URLs and URLs from discovery metadata. Discovery, registration and token endpoints must be `https` and follow no redirect to another origin; the public-address check runs at connect time inside the `fetchFn` every chosen SDK function accepts, so DNS rebinding cannot pass it.
- An access token is sent only to the connector URL's origin, matching the `resource` it was issued for.
- On a host step, grants are not a boundary between steps: an agent runs as the daemon's user and can read the machine credential and other processes. Claude Code's SDK also puts MCP headers on its command line (`--mcp-config`), readable in `/proc` by that user. This is the same exposure as `~/.claude.json` and plaintext secrets today; connectors do not make it smaller.
- MCP tool results are third-party text and stay untrusted. Per-tool approval inside a connector (Claude.ai's Always allow, Needs approval, Blocked; Amp's Allow, Ask First, Disabled) is not in v1; access is per connector, and read-only options are offered where the catalog entry has them.
- The OAuth callback is exempt from session auth (browser redirect); the single-use, 30-minute `state` (`newRecordId(32)`, about 190 bits) from the owner's own start request is what authorizes it, as for the existing GitHub and provider flows.

## Frontend

Settings → `MCP` becomes `连接器与 MCP`:

- `已连接`: one row per connector with status only (`已连接 · 12 个工具`, `需要重新连接`, `连接失败：…`), `重新检查`, `重新连接`, `断开`. No word about which work uses it: a connected connector is used by every task and review.
- `目录`: catalog cards with `连接`. Sign-in opens the provider page; token entries open a small form with a help link. After success the dialog closes; nothing asks which work may use it.
- `本机配置`: today's read-only list from `~/.claude.json`.
- `添加 MCP 服务器` (top right): name, URL, header rows (values write-only, never shown again). A server that answers 401 with OAuth metadata offers `用浏览器登录` instead of headers.

Page draft and reference shots (Amp `Integrations & MCP` from mon X's recording, Claude.ai connectors) precede the web PR, per `apps/web/DESIGN.md`.

## PR plan

| PR | Content | Security surface |
|---|---|---|
| 0 | this design and the research note | no |
| 1 | shared catalog and record schemas, migration, connector service (CRUD, sealing, projection), owner-only routes, the status check; seam exception in `biome.json` and AGENTS.md | yes (`token-auth.ts`, `mcp-servers.ts`) |
| 2 | OAuth start and callback, registration cache, refresh single-flight; live sign-in proof per catalog entry, which needs the owner's vendor accounts | yes (`oauth.ts`, `mcp-servers.ts`) |
| 3 | daemon: wire fields in the shared schema, declare capability, resolution and precedence, withheld lines, redaction, remote-sandbox strip in the relay; harmless without server data | yes (`machine-client.ts`) |
| 4 | server wire: `stepMcpGrant`, worker gate, chief note, capability parse, token fields, list merge with `source` and the override picker filter | yes (`machine*.ts`) |
| 5 | web: page, add dialog, catalog cards; feature-map row; e2e. 5b: connectors on for every step, grant settings removed (server, 2026-11-16) | 5b yes (`machine*.ts`) |
| 6 | machine-bound connectors: stdio command and loopback URL with `machineId`, claim gate by machine | yes |
| 7 | Coordinator connectors: MCP client in `coordinator/runtime/` using server-held tokens | yes |

Each security-surface PR gets `/security-review` on its head and the `Security review (<head>): …` line. PR 1 to 5 are the v1 the request describes for remote services; 6 and 7 follow.

## Review answers

| Finding | Answer |
|---|---|
| B1 dispatch and compatibility | claim gate plus capability parse (Wire); override stays a requirement on local entries only (Decision 1, row 7) |
| B2 Coordinator inert | v1 tasks only, Coordinator disabled with reason, PR 7 (Decision 7) |
| B3 SDK self-refresh, revision too broad | step-by-step SDK functions only; `authRevision` and `tokenGeneration`; reconnect row (Decision 4, States) |
| 1 relay allowlist | described as it is; gateway follow-up and owner decision (Wire) |
| 2 grant computed twice | `stepMcpGrant`; daemon mounts only claimed slugs |
| 3 sticky `error` | delivery by token validity; bounded token-path refresh; never throws |
| 4 exposure | redaction, argv and host-boundary notes (Wire, Security) |
| 5 value bound to origin | row 2 |
| 6 stdio machine-bound | PR 6 with `machineId`; out of v1 |
| 7 slug collisions | suffix and reserved `cairn` |
| 8 seam rule | Decision 5, owner approval |
| 9 revocation | dropped |
| 10 catalog unverified | PR 2 live proof; failing entries token-only |
| 11 PR split | daemon PR lands before the server wire and list merge; check and seam move to PR 1 |
| Round 2: B1, N1 | worker gate in `workerIneligibility`; Coordinator not gated, slugs dropped with a note |
| Round 2: B3 | refresh compares `authRevision` and `tokenGeneration`; header edits bump neither |
| Round 2: 3, 5, N2-N9 | `needs_auth` withheld and refresh-first; origin change → `needs_auth`; remote sandbox stripped; `unchecked` kept; options may set query parameters; relay sentence fixed; state entropy; registration cache; connect-time address check |
| Nits | row created in callback; `http` non-loopback origin token-only; grant sheet names work policies; URL userinfo refused, query hidden in projection; mid-step refresh noted |

## Owner decisions

All six accepted by mon X on 2026-11-15.

1. Accept the spec 13 reversal: the server database holds MCP connector credentials, sealed with the existing `SecretBox`.
2. Approve the seam exception: `services/mcp-servers.ts` may use the MCP SDK on the server (Decision 5).
3. Accept that connector tokens reach host steps and Orb guests in plaintext until the secret gateway carries them, as `secrets` do today.
4. Confirm v1 scope: remote connectors for tasks first (PR 1 to 5); local command connectors (PR 6) and Coordinator connectors (PR 7) after.
5. Confirm the first catalog of eight, with GitHub token-only.
6. Superseded 2026-11-16: no grants, so no task waits for a newer Runner; an older Runner runs it without connectors.

## Out of scope

Workspace or shared connectors, a remote catalog, per-tool approval, refresh during a running step, writing `~/.claude.json`, revocation at the vendor, Client ID Metadata Documents, and secret-gateway delivery.
