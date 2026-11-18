# Google Antigravity Subscription Integration Design

## Goals

1. Integrate Google Antigravity (`antigravity` runtime via `agy acp`) using the T3 Runner-subscription model plus Cairn explicit subscription records (`antigravity_subscription`), working across all Cairn step kinds (`build`, `plan`, `session`, `merge`, `review`, `verify`, `chief`, `digest`, `mail`, and `info-cards`).
2. Keep the host's native `agy` OS Keychain / SQLite login usable out of the box (`tokenCipher = null`), while also allowing optional manual token fallback (`GEMINI_API_KEY` stored sealed in `tokenCipher`).
3. Prefer a locally installed `agy` binary when present and fall back to a managed download from the ACP Registry (`antigravity-acp`) under `~/.local/share/cairn/antigravity`.

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

- `antigravityManaged` resolves the runtime binary in priority order:
  1. Explicit `CAIRN_AGY_PATH` / `agyPath` override or standard local paths (`~/.local/bin/agy`, `/opt/homebrew/bin/agy`, `/usr/local/bin/agy`, `PATH`).
  2. Managed download from ACP Registry (`antigravity-acp` / `antigravity`), extracting `.tar.gz` or `.zip` into staging, verifying SHA-256 (`archiveSha256` + `binSha256`) and writing `.install-complete` + `current.json` atomically.
- Capability probe (`agy acp --log-file <tempLog>`):
  - Performs ACP `initialize` and bounded `session/new` (5s timeout).
  - Extracts `version` (`agentInfo.version`), `models` (`configOptions[category='model']`), and `authenticated` (`session/new` succeeded vs authentication-required error).
  - Advertises `capabilities.antigravity = { installed, version, authenticated, source, models }` on machine heartbeat.

### Authentication Modes & Seatbelt Confinement

| Mode | Condition | Server / Dispatch | Daemon Execution |
| --- | --- | --- | --- |
| Host keyring (`tokenCipher = null`) | `hasToken === false` | Requires enabled subscription AND an online Runner reporting `antigravity.authenticated === true` (or explicit home override). | No `GEMINI_API_KEY` env override; `GEMINI_HOME` unset. macOS `confine-session` allows `antigravity` only read-only traversal/read access to `~/Library/Keychains` + `~/.gemini`. Keychain writes remain denied. |
| Token fallback (`tokenCipher !== null`) | `hasToken === true` | Eligible on any Runner with `antigravity.installed === true` regardless of host Keychain login. | Server sends ephemeral `antigravityToken` on `stepToken` (`claimed` only). Daemon writes `GEMINI_API_KEY` and creates per-step temp `GEMINI_HOME`; macOS Seatbelt omits `~/Library/Keychains` read access and isolates state to the step temp `GEMINI_HOME`. |
| Unauthenticated & no token | Neither active | Dispatch blocks with `'antigravity-subscription'` (or `'runtime'` if `agy` missing). Step preflight refuses with Chinese setup instructions. | Not spawned. |

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
2. `daemon/confine-session`: macOS Seatbelt grants `antigravity` read-only `Library/Keychains` only when `GEMINI_HOME` is unset, denies Keychains writes (`ISOLATION_RC === 0`), and denies `Library/Keychains` reads for all other harnesses.
3. `daemon/antigravity-managed`: detects local binary first, falls back to `.zip`/`.tar.gz` registry archive with checksum verification, rejects corrupted checksum, probes models & auth status.
4. `daemon/antigravity-acp`: starts `agy` ACP over stdio MCP, sets `GEMINI_API_KEY` + isolated `GEMINI_HOME` when `antigravityToken` present, selects `'auto'` vs `'plan'` mode cleanly without `--dangerously-skip-permissions`, adapts `thought_level`, enforces `readOnly`/`remoteToolsOnly`, and passes `step-preflight`.
5. `server/antigravity-subscriptions`: CRUD + optional `token` (`hasToken: false` vs `true`), partial unique active constraint, `refuseWhileRunning` 409, verification of both host login and token modes.
6. `server/antigravity-claim`: worker + Coordinator (`chief`) claim bind `antigravitySubscriptionId`, deliver `antigravityToken` only while claimed (or omit when host keyring mode), block when `antigravity-subscription` missing or unauthenticated host, and hold/reset session on account switch.
7. `desktop + web`: `cairnDesktop.antigravity` IPC probe/login behind `fromOwnPage`, mono icon rendering, subscription management UI + board login banner, model routing integration, and `antigravity-local-login.spec.ts` Playwright flow.
