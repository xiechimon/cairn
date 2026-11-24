# Google Antigravity Subscription Integration Design

## Goals

1. Integrate Google Antigravity (`antigravity` runtime via `agy acp`) using the T3 Runner-subscription model plus Cairn explicit subscription records (`antigravity_subscription`), working across all Cairn step kinds (`build`, `plan`, `session`, `merge`, `review`, `verify`, `chief`, `digest`, `mail`, and `info-cards`).
2. Keep the host's native `agy` login usable, while allowing a sealed Gemini API key or an explicitly supplied Google OAuth access token. Do not attribute a host's catalog to an individual subscription.
3. Run a managed `antigravity-acp` binary downloaded from the ACP Registry under `~/.cairn/tools/antigravity` (shared install logic in `@cairn/shared/antigravity-install`); a locally installed `agy` on `PATH` is deliberately not picked up.

## Desktop Sign-In Credential Handoff

The default desktop flow signs in with a fresh OAuth profile and sends the access token and its expiration directly from the main process to the bundled server. See [Desktop local credential handoff](desktop-local-credential-handoff.md) for lifecycle and error handling. No access token, refresh token, or local profile data crosses into the renderer. OAuth catalog discovery does not require an API key, routing rule, or Runner.

Dispatch-facing subscription helpers do not import Runner routing or the probe-authorization module. The resource route supplies the authorization grant. An account's catalog is independent of its active dispatch state: changing the active account does not change which credential its picker reads. Expired, absent, or unusable credentials give a labeled fallback. The account detail shows saved picks, not a merged Runner catalog.

## Architecture and States

### Subscription Record States (`antigravity_subscription`)

- Each team stores 0..N named `antigravity_subscription` rows with:
  - `id`, `teamId`, `label`
  - `tokenCipher`: nullable AES-GCM encrypted credential. `null` uses the host login. API keys retain their existing sealed format. A newly supplied Google OAuth access token with an explicit expiration is sealed with a non-secret personal OAuth format marker; existing records are not reinterpreted.
  - `enabledAt`: timestamp (`null` = disabled; partial unique index on `teamId WHERE enabledAt IS NOT NULL` guarantees at most one active Antigravity account per team)
  - `expiresAt`, `createdAt`
- `AntigravitySubscription` wire view exposes `hasToken: boolean` (derived from `tokenCipher !== null`) and `oauthPersonal: true` only for personal OAuth. The latter lets Settings offer sign-in for an expired OAuth account without treating an expired API key as renewable. No decrypted secrets are returned.
- `step.antigravitySubscriptionId` binds the enabled `antigravity_subscription` row atomically inside the `claimStep` / `claimPendingChiefStep` SQLite transaction.

### Runner Binary & Capability Lifecycle

- `antigravityManaged` resolves the runtime binary from the managed root only (`CAIRN_AGY_PATH` is an explicit override on the desktop/login path): the daemon ignores a locally installed `agy` so steps and OAuth run the same checksummed binary.
  1. `currentAntigravityManagedInstall` reads `current.json` then version directories, verifying the `.install-complete` marker (`binSha256`, containment inside the version dir).
  2. `ensureAntigravityManagedInstall` downloads from the ACP Registry (`antigravity-acp` / `antigravity`), extracts `.tar.gz` or `.zip` into staging, verifies SHA-256 (`archiveSha256` + `binSha256`), refuses binaries that escape the staging dir, and writes `.install-complete` + `current.json` atomically under a `.install.lock` single-flight.
- Capability probe (`agy acp --log-file <tempLog>`):
  - Performs ACP `initialize` and bounded `session/new` (5s timeout).
  - Extracts `version` (`agentInfo.version`), `models` (`configOptions[category='model']`), and `authenticated` (`session/new` succeeded vs authentication-required error).
  - Advertises `capabilities.antigravity = { installed, version, authenticated, source, models }` on machine heartbeat.

### Authentication Modes & Seatbelt Confinement

| Mode | Condition | Server / Dispatch | Daemon Execution |
| --- | --- | --- | --- |
| Host keyring (`tokenCipher = null`) | `hasToken === false` | Requires enabled subscription AND an online Runner reporting `antigravity.authenticated === true` (or explicit home override). | No `GEMINI_API_KEY` env override; `HOME` is Cairn's `agent-homes/antigravity`, which links the user's sign-in files (see `agent-config-isolation.md`). macOS `confine-session` allows `antigravity` read-only access to `~/Library/Keychains`. Keychain writes remain denied. |
| Token fallback (`tokenCipher !== null`) | `hasToken === true` | Eligible on any Runner with `antigravity.installed === true` regardless of host Keychain login. | Server sends ephemeral `antigravityToken` on `stepToken` (`claimed` only). Daemon writes `GEMINI_API_KEY` and points `HOME` at Cairn's `agent-homes/antigravity-api-key` with `modelProvider: gemini` (`agy` ignores `GEMINI_HOME`); macOS Seatbelt omits `~/Library/Keychains` read access. |
| Personal OAuth | The creation API receives a Google access token and `expiresAt` | Only a runner advertising isolated OAuth profiles can claim steps; the credential is rejected after expiry. | The runner writes a private file-storage profile under the step's scratch directory. It does not link the runner login or pick up Google credentials from its environment. Cairn does not request or store a refresh token. |
| Unauthenticated & no token | Neither active | Dispatch blocks with `'antigravity-subscription'` (or `'runtime'` if `agy` missing). Step preflight refuses with Chinese setup instructions. | Not spawned. |

### Account Catalog

- Only a selected subscription with a usable API key can start a Runner probe. Runner eligibility uses the installation, route capabilities and confinement, not the active subscription or the Runner’s host login. A Runner can qualify through an explicit Antigravity route that pins it, or as the team's normal default Runner when an eligible unpinned Antigravity rule applies. With no Antigravity rule, neither a default nor a sole Runner qualifies. An ambiguous default or a rule pinned to another Runner does not grant access. The server captures grants and stream identities for the connected eligible Runners. It sends a disposable probe ID to an idle candidate or queues in arrival order when all candidates are busy. A queued request can wait up to 35 seconds; a dispatched request has its own 35-second limit (covering the daemon's 30-second full-CLI probe). The queue exists only in memory. Aborting the request removes it; disconnection invalidates that stream identity. If no captured candidate is still available, the picker receives the labeled fallback.
- Only the assigned Runner’s authenticated connection can claim the key once and return a result once. The selected subscription’s credential and that Runner’s route grant are rechecked at dispatch, claim, and result acceptance. Changing the active account does not revoke the probe. A changed grant rejects a result submission with HTTP 409; the picker receives the labeled fallback. The Runner uses a probe-only home and the same API-key settings as a step; it does not link native login files. It combines ACP model selects, matching-session updates and legacy model IDs, deduplicating exact IDs only. Advertised group labels travel in the probe result; the server only infers a pool from the ID when the Runner does not report a label.
- For a personal OAuth subscription, the server sends only that subscription's bearer to Google's `fetchAvailableModels` endpoint. `retrieveUserQuotaSummary` can supply labels, never extra model IDs. The provider identifier or recognized model family can label a known consumer pool where the summary has no per-model bucket. The catalog describes account entitlement, not a capability guarantee for every installed ACP version. These are internal Google endpoints; redirects are disallowed and both requests are bounded. No credential, quota balance, or upstream response is persisted by the catalog reader.
- A host-login row (`tokenCipher = null`) has no separate stored credential: its upstream picker lists the deduplicated models reported by online, non-retired Runners whose host Antigravity login is authenticated (`capabilities.antigravity.authenticated === true`), and falls back when no authenticated Runner reports models. Stored-credential rows (personal OAuth or API key) never fall back to a Runner's host catalog.

### First-Time Host Login States (Option A)

The desktop Google OAuth login runs outside confined task sessions. The desktop app drives `agy acp` over stdio in a private home. The separate host-keyring mode still uses the Runner's existing native sign-in; a new desktop sign-in never writes to that profile.

| State | How it is detected | What the user sees | Mechanism |
| --- | --- | --- | --- |
| `agy` not installed | `antigravity:status` reports `installed: false, canLogin: true` when the platform has a registry binary | Settings dialog shows “Install and sign in to Antigravity” (downloads first, then opens the browser) | `antigravityLogin` runs `ensureAntigravityManagedInstall` under `~/.cairn/tools/antigravity` before spawning, single-flight via `.install.lock`; desktop emits `antigravity:login-progress` `installing` |
| Installed, not logged in | `installed: true, loggedIn: false` | Settings dialog and subscription detail show “Sign in to Antigravity on this Mac” | Same IPC; progress phase `authenticating` fires when `authenticate` is sent and the browser opens |
| Login in progress | `login-progress` events | A spinner tracks installation and browser sign-in; Cancel calls `antigravity:cancel-login` | Single `flight` token on the desktop; cancellation returns `{ ok: false, reason: 'cancelled' }` |
| Login succeeded | `authenticate` succeeds and the private profile contains a valid, unexpired access token | The subscription is saved and its picker lists account entitlements | Desktop main terminates and awaits ACP, removes the profile, and sends the access token and expiry to the owner-only API; IPC returns only metadata |
| Login cancelled / failed | `cancelled`, `no-binary`, `busy`, `timeout`, `spawn`, `exit`, `failed` | Plain-language reason plus a retry button; the API-key paste path stays available | `AntigravityLoginOutcome` reasons map to per-reason copy |
| Host sign-in lost later | Every online Runner with `antigravity.installed` reports `authenticated === false` | The board says the Runner has no usable Antigravity sign-in; subscription details offer re-login | `antigravityRunnersSignedOut` on `useMachines` capabilities; `AntigravityRelogin` re-runs the same IPC and triggers verification again |
| Personal OAuth bearer expired | The existing subscription has `oauthPersonal: true` and `expiresAt` has passed | In desktop Settings, sign in again with the same Google account, then open its model picker. No new payment, key, or subscription is needed. | The owner-only `attach-oauth` endpoint checks the new bearer against the stored Google subject before changing the encrypted bearer and expiry. The ID, enabled selection and picked models are unchanged. Verification and subsequent probes use the renewed bearer. |
| Personal OAuth renewal fails or is cancelled | Sign-in fails, a task is still using the account, another sign-in already saved a fresh bearer, or Google cannot confirm the same account | A failed renewal leaves the account and picks unchanged. A legacy connection without a saved subject must be connected as a new account after expiry. | The endpoint rejects an API key, a fresh existing bearer, a missing subject or a different subject. There is no background refresh or retry. An expired bearer is never sent to the entitlement API. |

The create and initial-attach APIs resolve the Google subject and remaining bearer lifetime using the fixed Google tokeninfo endpoint with redirects disabled and a bounded deadline. Neither value comes from the renderer. The stored expiry is no later than either the tokeninfo bound or the supplied expiry. The subject and bearer share one versioned, encrypted value so a write cannot separate them. Existing unversioned OAuth values remain readable until their expiry but have no proof of identity for renewal. The step payload, list, verification and discovery expose no subject. Renewal re-reads the row and validates its credential, label, expiry and running-task state in the same write transaction after the network check; deletion, credential changes and new running tasks cannot race past the check.

### Mode & Confinement Invariants

- Cairn never passes `--dangerously-skip-permissions` to `agy acp`.
- For unrestricted worker steps (`!readOnly && !lockedDown && !remoteToolsOnly`), `acp.ts` selects ACP `'auto'` mode when available and approves permissions via Cairn's `allow-once` policy.
- For restricted steps (`chief`, `review`, `digest`, `mail`, `info-cards`), `acp.ts` selects `'plan'` / `'default'` mode when offered, strips external `mcpServers`, and enforces `readOnly` / `remoteToolsOnly` inside `requestPermission`.
- Other confined harnesses (`claude-code`, `codex`, `gemini`, `pi`, `devin`) remain completely denied from reading `~/Library/Keychains`.

## Failure Behavior

- Bad/corrupted registry checksum: staging directory removed, returns previous cached install or `null`.
- Verification click (`POST /verify`) with `tokenCipher = null`: checks connected online Runners reporting `capabilities.antigravity.installed`; succeeds only if an online Runner reports `authenticated === true`, else returns `ok: false, reason: 'missing_local_login'`.
- Switching enabled subscription (`enabledAt` changes): automatic continuation holds (`accountHeld` / `chiefLastRanOnOtherAccount`) force a fresh ACP session instead of resuming under the wrong account.
- Disabling, deleting, replacing or attaching a credential to a subscription with a claimed step requires that step to finish first. A new connection can still be saved inactive while the enabled one is expired but referenced by a claimed step.
- A worker or Coordinator claim without a valid Antigravity subscription at claim time leaves the step pending, even if the connection was valid when Runner eligibility was first checked. Step credential delivery refuses an absent, missing or expired binding; only a valid host-login connection can deliberately supply no token.

## Test Matrix (One Test per Path)

1. `shared/antigravity-local`: parses raw tokens, `GEMINI_API_KEY=...` assignments, JSON `{ GEMINI_API_KEY }`, rejects empty/unrelated strings, and validates `DEFAULT_ANTIGRAVITY_MODELS`.
2. `daemon/confine-session`: macOS Seatbelt grants `antigravity` read-only `Library/Keychains` only without a `GEMINI_API_KEY`, denies Keychains writes (`ISOLATION_RC === 0`), and denies `Library/Keychains` reads for all other harnesses.
3. `daemon/antigravity-managed`: ignores a local `agy` binary (managed copy or nothing), falls back to `.zip`/`.tar.gz` registry archive with checksum verification, rejects corrupted checksum, probes models & auth status.
4. `daemon/antigravity-acp`: starts `agy` ACP over stdio MCP, sets `GEMINI_API_KEY` and a Cairn `HOME` when `antigravityToken` present, selects `'auto'` vs `'plan'` mode cleanly without `--dangerously-skip-permissions`, adapts `thought_level`, enforces `readOnly`/`remoteToolsOnly`, and passes `step-preflight`.
5. `server/antigravity-subscriptions`: CRUD + optional `token` (`hasToken: false` vs `true`), partial unique active constraint, `refuseWhileRunning` 409, verification of both host login and token modes.
6. `server/antigravity-claim`: worker + Coordinator (`chief`) claim bind `antigravitySubscriptionId`, deliver `antigravityToken` only while claimed (or omit when host keyring mode), block when `antigravity-subscription` missing or unauthenticated host, and hold/reset session on account switch.
7. `desktop + web`: `cairnDesktop.antigravity` IPC probe/login behind `fromOwnPage`, managed-install-first login with `login-progress` phases, mono icon rendering, subscription management UI + board login banner (expired, expiring and signed-out), subscription detail re-login, model routing integration, and `antigravity-local-login.spec.ts` Playwright flow.
8. `shared/antigravity-install`: registry download + checksum verification + atomic marker install, staging cleanup on corrupt archives, untrusted archive host rejection, unsupported platform `null`, and `currentAntigravityManagedInstall` reuse without re-download; the daemon `antigravity-managed` suite covers the same behaviour through the shared installer.
