# Antigravity Usage Polling

## Newcomer overview

When someone installs Cairn and connects an Antigravity subscription in **Settings → Providers** (either through a host runner sign-in with `agy acp --login` or portable Google OAuth sign-in), they immediately want to know how much 5-hour and weekly quota remains across their Gemini and Claude/GPT model pools before starting tasks.

- **Where you meet it**:
  - **Settings → Providers**: each Antigravity subscription row shows a compact remaining-quota badge (`剩 X%`) for its tightest active window, and its detail panel displays the **Quota** (`额度`) card with separate bars and reset countdowns for `gemini-5h`, `gemini-weekly`, `3p-5h`, and `3p-weekly`.
  - **Desktop Tray**: when today's token usage is non-zero and an enabled subscription reports quota windows, the tray usage row surfaces the tightest remaining/used quota summary alongside Claude.
- **What you must already know**:
  - Only **host-login** and **portable Google OAuth** Antigravity subscriptions expose subscription quota windows. API-key-only connections (`AIza...`) are skipped and continue to display the 24-hour run count only.
  - Polling runs `agy --output-format json -p "/usage"` on an eligible online runner, which returns cached/account quota directly with `num_turns: 0` and `total_tokens: 0` (no model tokens are spent).
- **Where data is stored**:
  - Latest parsed quota windows are cached as JSON on `antigravity_subscription.quotaWindows` in the server SQLite database.
  - For portable OAuth accounts, the daemon materializes a short-lived isolated home directory via `createCredentialProfile(cairnHome)` (`AGY_CLI_FORCE_FILE_TOKEN_STORAGE=1`) and removes it unconditionally in `finally`.
- **When it fails**:
  - If the runner is offline, lacks `antigravityUsage` capability, `agy` times out (> 25s), or the OAuth token is expired/revoked, Cairn preserves the last cached `quotaWindows` (filtering out windows whose `resetsAt` has already passed) and avoids overwriting valid quota with empty data.

## Scenarios

| Situation | What the user sees | What the system does | Wait & cost |
|---|---|---|---|
| Enabled OAuth or Host subscription with online runner | 4 quota windows (`Gemini · 5 小时`, `Gemini · 每周`, `Claude / GPT · 5 小时`, `Claude / GPT · 每周`) and tightest row badge | Server dispatches `antigravity.usage` over runner SSE, runner claims single-use payload, spawns `agy --output-format json -p "/usage"`, posts parsed windows, persists `quotaWindows` | ~5–7s on probe; 0 tokens |
| API-key Antigravity subscription | 24h run count only (`用量`), no quota bars | `refreshAntigravityQuota` / `pollAllAntigravityQuotas` skips API-key rows without dispatching a probe | 0ms, 0 cost |
| Fresh windows already stored (`observedAt` < 5m old, `force` false) | Existing quota bars immediately | Returns DB-cached windows without dispatching to runner | < 5ms |
| Repeated refresh within 60s cooldown (`force` false) | Same quota bars | Deduplicates concurrent calls via in-flight promise or returns cached list within 60s window | < 5ms |
| Host-login subscription with bound runner offline or missing local login | Previously cached non-expired windows (or none if never probed) | Skips or fails with `not-found`/`auth`; does not clear prior valid windows | 0ms if offline; ~5s if `agy` rejects auth |
| OAuth credential expired or revoked | Previously cached non-expired windows | Daemon exits with `failure: 'auth'`, deletes temp profile in `finally`, server leaves `quotaWindows` unchanged | <= 25s, 0 tokens |
| `agy -p "/usage"` hangs or exits non-zero | Previously cached non-expired windows | Daemon aborts/kills child process group at 25s timeout, deletes temp profile, reports `timeout`/`upstream` | <= 25s |
| Stored window whose `resetsAt <= now` | Expired window hidden on next read | `listAntigravitySubscriptions` filters out expired windows (`resetsAt !== null && resetsAt <= now`) | 0ms |
| Background periodic polling | Fresh quota stays visible even without opening Providers | Server runs `pollAllAntigravityQuotas` ~15s after boot and every 5 minutes (`ANTIGRAVITY_QUOTA_POLL_MS`) | Background, 0 tokens |

## State Transitions

Per-subscription quota state transitions:

```text
idle ──(refresh / background poll)──▶ probing ──(ok: windows parsed)──▶ fresh (observedAt = now, < 5m)
  ▲                                      │                                   │
  │                                      └──(failed / timeout / offline)──▶ failed (preserve prior quotaWindows)
  │                                                                          │
  └──────────────────────────(>= 5m elapsed or force=true or expired reset)──┘
                                         ▲
                                    stale (>= 5m)
```

In-memory per-DB `WeakMap<Db, Map<string, { at: number; done: Promise<void> }>>` enforces:
- **In-flight deduplication**: concurrent callers for the same subscription await the active `done` promise.
- **Cooldown (`ANTIGRAVITY_QUOTA_REFRESH_MS = 60_000`)**: repeated non-forced requests within 60 seconds do not re-spawn `agy`.
- **Freshness (`ANTIGRAVITY_QUOTA_FRESH_MS = 5 * 60_000`)**: non-forced requests skip probing when any stored window has `now - observedAt < 5 * 60_000`.

## Read / Write Paths & Authorization

1. **DB Schema**: `antigravity_subscription.quotaWindows` (`ClaudeSubscriptionQuotaWindow[] | null`, migration `0259_antigravity_quota_windows.sql`).
2. **Read paths**:
   - `listAntigravitySubscriptions` (`apps/server/src/services/antigravity-subscriptions.ts`) filters `row.quotaWindows` by `resetsAt === null || resetsAt > now` and returns `windows`.
   - `GET /api/teams/:id/antigravity-subscriptions` and `POST /api/teams/:id/antigravity-subscriptions/quota` return `AntigravitySubscriptionListEntry[]`.
3. **Probe dispatch & claim security** (`apps/server/src/services/antigravity-usage-probes.ts`, `apps/server/src/routes-machine.ts`):
   - **Capability gate**: runners advertise `capabilities.antigravityUsage = true` when the `antigravity.usage` handler is registered.
   - **Host-login routing**: dispatches only to the subscription's resolved `runnerId` (online, `antigravityUsage: true`, `antigravity.installed === true`, `antigravity.authenticated === true`).
   - **OAuth routing**: dispatches to any online non-retired team runner with `antigravityUsage: true` and `antigravity?.installed !== false`.
   - **Single-use claim**: `POST /api/machine/antigravity/usage/:requestId/claim` requires the assigned `machineId` and matching active `connectionId`, consumes the claim generator once, returns `Cache-Control: no-store`, and re-verifies `isAuthorized(machineId)`.
   - **Result submission**: `POST /api/machine/antigravity/usage/:requestId/result` requires the same assigned `machineId` + `connectionId`, requires prior claim, re-verifies `isAuthorized(machineId)` (returning `409 probe-authorization-changed` if revoked mid-probe), and resolves the server promise.
   - **Write guard**: before persisting `quotaWindows`, the server verifies `isAuthorized(probed.machineId)` and checks that the row's `tokenCipher`, `runnerId`, and `enabledAt` did not change while the probe was in flight.
4. **Daemon execution & cleanup** (`apps/daemon/src/backend/antigravity-usage.ts`, `apps/daemon/src/agent-config.ts`):
   - `writeAntigravityOAuthCredential` writes both `.gemini/antigravity-acp/antigravity-oauth-token` and `.gemini/antigravity-cli/antigravity-oauth-token`.
   - `probeAntigravityUsage` spawns `install.binPath` with `['--output-format', 'json', '-p', '/usage']`, `stdio: ['ignore', 'pipe', 'pipe']`, `windowsHide: true`, and a 25s timeout (`SIGKILL` process group on timeout/abort).
   - For `mode === 'oauth'`, `createCredentialProfile(cairnHome)` creates an isolated temp directory with `AGY_CLI_FORCE_FILE_TOKEN_STORAGE=1`, `GEMINI_CLI_HOME=<home>`, and `GEMINI_HOME=<home>/.gemini`, and always invokes `profile.cleanup()` in `finally`.
   - For `mode === 'host'`, `prepareAntigravityHome({ cairnHome, realHome, apiKey: false })` links/materializes host credentials inside Cairn's managed `antigravity` home without mutating `~/.gemini`.
