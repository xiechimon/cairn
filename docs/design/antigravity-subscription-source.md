# Google Antigravity Subscription Integration Design

## Goals

1. Integrate Google Antigravity (`antigravity` runtime via `agy acp`) using the T3 Runner-subscription model plus Cairn explicit subscription records (`antigravity_subscription`), working across all Cairn step kinds (`build`, `plan`, `session`, `merge`, `review`, `verify`, `chief`, `digest`, `mail`, and `info-cards`).
2. Keep the host's native `agy` OS Keychain / SQLite login usable out of the box (`tokenCipher = null`), while also allowing optional manual token fallback (`GEMINI_API_KEY` stored sealed in `tokenCipher`).
3. Run a managed `antigravity-acp` binary downloaded from the ACP Registry under `~/.cairn/tools/antigravity` (shared install logic in `@cairn/shared/antigravity-install`); a locally installed `agy` on `PATH` is deliberately not picked up.

## Architecture and States

### Subscription Record States (`antigravity_subscription`)

- Each team stores 0..N named `antigravity_subscription` rows with:
  - `id`, `teamId`, `label`
  - `tokenCipher`: nullable AES-GCM encrypted string (`null` when relying on local host keyring auth; non-null when user supplies a fallback `GEMINI_API_KEY`)
  - `enabledAt`: timestamp (`null` = disabled; partial unique index on `teamId WHERE enabledAt IS NOT NULL` guarantees at most one active Antigravity account per team)
  - `expiresAt`, `createdAt`
- `AntigravitySubscription` wire view exposes `hasToken: boolean` (derived from `tokenCipher !== null`) and never returns decrypted secrets.
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
| Unauthenticated & no token | Neither active | Dispatch blocks with `'antigravity-subscription'` (or `'runtime'` if `agy` missing). Step preflight refuses with Chinese setup instructions. | Not spawned. |

### First-Time Host Login States (Option A)

The host-level Google OAuth login runs outside any confined session: the desktop app launches `agy acp` on the host and drives `initialize` + `authenticate` over stdio (`antigravity:login` IPC behind `fromOwnPage`). Confined task sessions only ever consume the resulting OS Keychain/SQLite login through the read-only `~/Library/Keychains` grant.

| State | How it is detected | What the user sees | Mechanism |
| --- | --- | --- | --- |
| `agy` not installed | `antigravity:status` reports `installed: false, canLogin: true` when the platform has a registry binary | Settings dialog shows “Install and sign in to Antigravity” (downloads first, then opens the browser) | `antigravityLogin` runs `ensureAntigravityManagedInstall` under `~/.cairn/tools/antigravity` before spawning, single-flight via `.install.lock`; desktop emits `antigravity:login-progress` `installing` |
| Installed, not logged in | `installed: true, loggedIn: false` | Settings dialog and subscription detail show “Sign in to Antigravity on this Mac” | Same IPC; progress phase `authenticating` fires when `authenticate` is sent and the browser opens |
| Login in progress | `login-progress` events | A spinner tracks installation and browser sign-in; Cancel calls `antigravity:cancel-login` | Single `flight` token on the desktop; cancellation returns `{ ok: false, reason: 'cancelled' }` |
| Login succeeded | `authenticate` response has no error | Subscription created with `token: null` (host keyring); verification turns green and steps can run | `importKey` then create; the verify hook retries `missing_local_login` (~3 × 12 s) while the Runner heartbeat re-probes `authenticated` |
| Login cancelled / failed | `cancelled`, `no-binary`, `busy`, `timeout`, `spawn`, `exit`, `failed` | Plain-language reason plus a retry button; the API-key paste path stays available | `AntigravityLoginOutcome` reasons map to per-reason copy |
| Login expired / lost later | Every online Runner with `antigravity.installed` reports `authenticated === false` | The board says the Runner has no usable Antigravity sign-in; subscription details offer re-login | `antigravityRunnersSignedOut` on `useMachines` capabilities; `AntigravityRelogin` re-runs the same IPC and triggers verification again |

### Mode & Confinement Invariants

- Cairn never passes `--dangerously-skip-permissions` to `agy acp`.
- For unrestricted worker steps (`!readOnly && !lockedDown && !remoteToolsOnly`), `acp.ts` selects ACP `'auto'` mode when available and approves permissions via Cairn's `allow-once` policy.
- For restricted steps (`chief`, `review`, `digest`, `mail`, `info-cards`), `acp.ts` selects `'plan'` / `'default'` mode when offered, strips external `mcpServers`, and enforces `readOnly` / `remoteToolsOnly` inside `requestPermission`.
- Other confined harnesses (`claude-code`, `codex`, `gemini`, `pi`, `devin`) remain completely denied from reading `~/Library/Keychains`.

## Failure Behavior

- Bad/corrupted registry checksum: staging directory removed, returns previous cached install or `null`.
- Verification click (`POST /verify`) with `tokenCipher = null`: checks connected online Runners reporting `capabilities.antigravity.installed`; succeeds only if an online Runner reports `authenticated === true`, else returns `ok: false, reason: 'missing_local_login'`.
- Switching enabled subscription (`enabledAt` changes): automatic continuation holds (`accountHeld` / `chiefLastRanOnOtherAccount`) force a fresh ACP session instead of resuming under the wrong account.
- Disabling or deleting a subscription while `step.status = 'claimed'` references `step.antigravitySubscriptionId`: returns `409 Conflict` (`running-tasks`).

## Test Matrix (One Test per Path)

1. `shared/antigravity-local`: parses raw tokens, `GEMINI_API_KEY=...` assignments, JSON `{ GEMINI_API_KEY }`, rejects empty/unrelated strings, and validates `DEFAULT_ANTIGRAVITY_MODELS`.
2. `daemon/confine-session`: macOS Seatbelt grants `antigravity` read-only `Library/Keychains` only without a `GEMINI_API_KEY`, denies Keychains writes (`ISOLATION_RC === 0`), and denies `Library/Keychains` reads for all other harnesses.
3. `daemon/antigravity-managed`: ignores a local `agy` binary (managed copy or nothing), falls back to `.zip`/`.tar.gz` registry archive with checksum verification, rejects corrupted checksum, probes models & auth status.
4. `daemon/antigravity-acp`: starts `agy` ACP over stdio MCP, sets `GEMINI_API_KEY` and a Cairn `HOME` when `antigravityToken` present, selects `'auto'` vs `'plan'` mode cleanly without `--dangerously-skip-permissions`, adapts `thought_level`, enforces `readOnly`/`remoteToolsOnly`, and passes `step-preflight`.
5. `server/antigravity-subscriptions`: CRUD + optional `token` (`hasToken: false` vs `true`), partial unique active constraint, `refuseWhileRunning` 409, verification of both host login and token modes.
6. `server/antigravity-claim`: worker + Coordinator (`chief`) claim bind `antigravitySubscriptionId`, deliver `antigravityToken` only while claimed (or omit when host keyring mode), block when `antigravity-subscription` missing or unauthenticated host, and hold/reset session on account switch.
7. `desktop + web`: `cairnDesktop.antigravity` IPC probe/login behind `fromOwnPage`, managed-install-first login with `login-progress` phases, mono icon rendering, subscription management UI + board login banner (expired, expiring and signed-out), subscription detail re-login, model routing integration, and `antigravity-local-login.spec.ts` Playwright flow.
8. `shared/antigravity-install`: registry download + checksum verification + atomic marker install, staging cleanup on corrupt archives, untrusted archive host rejection, unsupported platform `null`, and `currentAntigravityManagedInstall` reuse without re-download; the daemon `antigravity-managed` suite covers the same behaviour through the shared installer.
