# Fleet Auto-Update (Desktop, Resident Server, and Standalone Runner) — plan, 2026-11-27

> **Owner decision (2026-11-27):** `「同意自动更新」`, answering `"用户难道每次更新都要同时更新两个app吗？"` / `"如果有多台电脑难道要更新多台吗"`.
> **Prior art:** [`docs/research/auto-update-2026-11-27.md`](../research/auto-update-2026-11-27.md) and [`docs/research/version-skew-2026-11-25.md`](../research/version-skew-2026-11-25.md).

## User scenario

Someone who installed Cairn today on two or three computers — for example, a home Mac mini running the resident Cairn server (`app.cairn.host`), a laptop running the Cairn desktop app connected to that Mac mini, and a standalone Linux or macOS Runner (`npm i -g @xiechimon/cairn-cli` or standalone archive) executing tasks — should never have to walk over to each computer and update it by hand.

When Cairn publishes a new release, every writable computer follows it automatically without interrupting active work: the Mac mini server discovers the release on its own (even with no laptop open), pauses new task/reply claims while draining active work, snapshots its database before booting the new version, swaps, and confirms 30 seconds of healthy operation; any connected standalone Runner learns from its regular presence heartbeat that a newer compatible Runner archive is published, downloads and verifies it in the background, drains active work before swapping via a thin supervisor loop, and reconnects; and a laptop app connected to a newer server catches up on its own at idle. The user sees at most one quiet status line while it happens, never an interrupting dialog or a mid-task restart.

**What you need to know:** Cairn asks for no extra accounts, API keys, or payments. All downloads come from Cairn's public GitHub Releases feed (`DESKTOP_MANIFEST_URL` and sibling `runner-latest.json`) and are verified by SHA-256 (plus Cairn's signing certificate for macOS `.app` bundles). Update state lives in `0600` JSON files (`<userData>/update-state.json`, `<CAIRN_HOME>/host-update-*.json`, and `<CAIRN_HOME>/self-update/state.json`) with no secrets.

**Where you can get stuck:** If a new version crashes or fails its 30-second startup health check on a headless Mac mini or standalone Runner, Cairn automatically restores the previous working version (and on the Mac mini, restores the pre-update SQLite snapshot while keeping the failed database aside without deleting user data), blocks that broken version from auto-installing again, and shows one plain line explaining the rollback (`Retry` on the remote bar lets you retry explicitly). If a standalone Runner or server runs from a read-only or externally managed location (`homebrew`, Docker, or a source dev checkout), Cairn never tries to overwrite it and keeps today's clear one-line `"Needs a Cairn update"` / manual-update message.

## Why

1. Previously, only a *newer* laptop app connecting in remote mode could nudge an *older* remote server (`POST /api/server/update`); a headless Mac mini server never checked `DESKTOP_MANIFEST_URL` on its own, and an older laptop connected to a newer Mac mini never accelerated its own catch-up check.
2. `apps/desktop/src/background-update.ts` checked `residentBusy()` without holding `deploy_lease` (leaving a TOCTOU window where new work could start before restart) and left `state.installed` unconfirmed when the GUI was closed, wedging headless Mac mini hosts on `'unconfirmed'` forever with zero automatic rollback or DB snapshot protection.
3. Standalone `apps/daemon` Runners had no self-update, active-work drain, install-origin classification, or rollback mechanism, leaving multi-computer setups stuck showing `"Needs a Cairn update"`.

## Scenarios

| Situation | What the user sees | What Cairn does | Wait / cost |
|---|---|---|---|
| New release published while home Mac mini runs headless (GUI closed) | Nothing unless watching remote status (at most one quiet line if laptop is open) | Server release watcher polls `DESKTOP_MANIFEST_URL`, kicks `app.cairn.updater`, acquires `deploy_lease`, confirms `busy === false`, snapshots SQLite (`preupdate-*.db`), swaps `.app`, restarts `app.cairn.host`, confirms 30s sustained health, releases lease | Background download + 1 idle restart |
| New Mac mini resident server crashes or fails health check (incl. after DB migration) | One quiet line on laptop: `"Remote host X could not start; Cairn restored Y."` + `Retry` | `background-updater` detects 3 probe failures or 90s deadline; moves failed DB aside (`failed-*.db`) and restores `preupdate-*.db` ONLY if no domain writes landed after the snapshot (if domain writes landed, keeps newer `server.db` and rolls back `.cairn-previous/Cairn.app` only), restarts `app.cairn.host`, verifies restored health, writes `blocked` + `rollback` notice (or `rollback-failed` preserving both DB backups if old code cannot boot migrated DB) | 1 automatic rollback; zero silent data loss |
| Power drop between bundle renames on Mac mini | App restarts cleanly on next half-hour/boot | `app.cairn.updater` `RUN_OR_REMOVE` restores `.cairn-previous/Cairn.app` if main binary is missing before ever removing its plist | Automatic recovery |
| Laptop app connects to a newer remote server (or newer `latestRelease`) | At most one quiet tooltip/status (`Updates to X when you step away`) | `remote-version` queries `GET /api/server/version?schema=2`, nudges `updater.check()` immediately when `serverVersion > appVersion` or `latestRelease > appVersion`, and re-checks on focus/hourly | Background download + idle swap |
| Standalone Runner (`npm i -g` / archive) is older while a step or computer call is running | Runners row shows one line (`Updating to X when idle`) while active work finishes | Server returns `update: { targetVersion }` in `POST /api/machine/presence`; Runner verifies `runner-latest.json` has a valid matching-arch asset, downloads + SHA-256 verifies + smoke-tests it, then pauses new claims, drains active steps/computer/screen calls, swaps via exit `75`, and confirms 30s probation | 0 interrupted steps; 1 fast restart |
| Standalone Runner fails to boot or crashes during probation vs server temporarily offline | Runners row shows one line (`X failed to start; rolled back to Y`) on binary crash; stays waiting quietly if server is offline | Thin launcher (`self-update-bootstrap.ts`) distinguishes startup/pre-`booted` failure (immediate rollback to `previousVersion`, marks `X` blocked) from post-`booted` server outage (keeps waiting without blaming new binary) | 1 automatic rollback on bad build; `machine.json` preserved |
| Runner or server is `homebrew`, `docker`, `development`, `desktop-bundled`, or `read-only` | Runners row / Remote bar keeps today's clear manual-update line (`Needs a Cairn update` / `Update Cairn on that computer`) | `classifyRunnerInstall` / `updateBlocker` reports `supported: false` with exact reason; downloads nothing and never pauses claiming | 0 downloads |

## Scope

1. **Server release watcher & single-path Runner presence signaling (`apps/server`)**: Periodically poll `DESKTOP_MANIFEST_URL` (`release-watcher.ts`), automatically trigger `requestHostUpdate` when a newer release exists and `updater.supported === true` (skipping `blocked` / failed versions), expose optional `latestRelease` and `rollbackNotice` on `GET /api/server/version?schema=2` (keeping bare `GET /api/server/version` 100% v1 strict-compatible), and return optional `update: { targetVersion }` inside existing `POST /api/machine/presence` responses when `max(latestRelease, serverVersion)` exceeds the Runner's `runnerReleaseVersion` (or `runnerNeedsUpdate`) and the Runner is not already `rolled-back` / `blocked` on that version. No separate SSE update event is added.
2. **Headless resident server drain, DB snapshot, health guard & rollback (`apps/desktop`)**: Update `resident-host.ts`, `background-update.ts`, `background-updater.ts`, `updater-agent.ts`, and `update-state.ts` so headless updates fail-closed on probe/token errors, acquire `deploy_lease` (`PUT /api/server/deploy/lease`, 120s TTL) before checking `busy === false` and before swap, snapshot `<CAIRN_HOME>/server/server.db` before booting the new version, keep `deploy_lease` held across the 30s sustained health probation (`90s` hard deadline, `newPid !== previousPid` + version match), release lease and prune `.cairn-previous` + snapshot on success, or on failure restore `.cairn-previous/Cairn.app` and check domain writes since snapshot: if zero domain writes occurred after the snapshot, move the failed DB to `failed-*.db` and restore `preupdate-*.db`; if domain writes occurred after the snapshot, keep the newer `server.db` (never discarding user writes) and perform code-only rollback (`rolled-back-code`), falling back to `rollback-failed` without looping (and preserving both DB files) if old code fails to start. Fix `RUN_OR_REMOVE` to restore `.cairn-previous/Cairn.app` if present, and track `guardOwner` / `guardPid` / `attemptId` under `update.lock` so GUI and background agent never race.
3. **Bidirectional laptop remote-mode catch-up (`apps/desktop`)**: Update `remote-version.ts`, `host-update.ts`, `update-core.ts`, and `main.ts` to query `GET /api/server/version?schema=2` (tolerant of v1 servers lacking new fields), trigger `created.check()` when `serverVersion > appVersion` or `latestRelease > appVersion`, re-probe on connect / auth change / focus (>=10 min) / hourly timer (and cancel on host switch via `stop()`), preserve un-expired `rollback` notices in `host-update-status.json`, pass `force: true` on manual `Retry` in `POST /api/server/update`, and honor `CAIRN_UPDATE_FEED_URL` (`dev-tooling`) for isolated testing.
4. **Standalone Runner self-update, active-work drain & supervised rollback (`apps/daemon`, `apps/desktop/scripts/release-manifest.mjs`, `.github/workflows/desktop-release.yml`)**: Bake `RUNNER_RELEASE_VERSION` in `apps/daemon/build.mjs` (keeping `DAEMON_VERSION` `0.2.3` unchanged), publish `cairn-runner-<ver>-<platform>-<arch>.tar.gz|.zip` archives and sibling `runner-latest.json` alongside unchanged `desktop-latest.json`, classify install origins (`managed` incl. writable `npm i -g`/standalone vs `desktop-bundled`/`homebrew`/`docker`/`development`/`read-only`), verify `runner-latest.json` has a matching-arch asset before staging, download + SHA-256 + size + path-traversal + `--version` smoke-test in background (30-min backoff on missing/bad artifact without blocking claims), pause new claims only once ready, drain active steps + retryable awaiting-uploads (ignoring exhausted stranded journals) + `activeAntigravityVerifies` + `computerDispatcher.activeCount()` + `screens.activeCount()` (with 30-min drain timeout fallback), swap via exit `75` to the thin launcher (`self-update-bootstrap.ts` inside `cli.ts`), distinguish `booted` vs 30s `confirmed` health with `attemptId`, roll back to `previousVersion` (or base binary if newer `npm i -g` / broken slot) on crash/pre-`booted` failure, and handle `SIGTERM` cleanly during drain/probation.
5. **Minimal single-line UI (`apps/web`, `apps/desktop/src/preload.ts`)**: Show at most one compact line for Runner auto-update / rollback in `MachineRowView` and for remote host rollback in `RemoteUpdateBar` / `preload.ts` fallback (`RemoteUpdateBar` owns the bar when mounted), keeping read-only manual-update copy intact.
6. **Unchanged behavior**: `DAEMON_VERSION` (`0.2.3`) and `cliVersionAtLeast` gates, `desktop-latest.json` strict schema, bare `GET /api/server/version` v1 response, local embedded desktop update flow, and the owner's `scripts/ops/deploy-watch.sh` stay unchanged.

## States and transitions

```
Resident background-updater (headless):
  idle ─▶ checking ─▶ downloading ─▶ verifying ─▶ acquire deploy_lease
                                                      ├─ busy/probe-err ─▶ release lease ─▶ waiting-idle (re-kick on idle)
                                                      └─ idle ─▶ snapshot server.db ─▶ swap .app ─▶ restart resident
                                                                    └─ probing (newPid, targetVersion, 30s ok / 90s cap)
                                                                          ├─ healthy ─▶ release lease, clear installed, prune prev+snap
                                                                          └─ 3 fails / 90s ─▶ [domain writes after snapshot?]
                                                                                                ├─ no  ─▶ restore .app + preupdate.db (keep failed-*.db)
                                                                                                └─ yes ─▶ keep server.db, restore .app only (rolled-back-code)
                                                                                              ▶ restart prev, write blocked + rollback, release lease (or rollback-failed)

Standalone Runner (self-update + thin launcher):
  [classifyRunnerInstall]
    ├─ unsupported (desktop-bundled / homebrew / docker / development / read-only) ─▶ supported=false (manual hint)
    └─ writable standalone ─▶ [baseVersion >= activeVersion? clear activeVersion]
        └─ idle ─(presence update.targetVersion, asset in runner-latest.json)─▶ downloading ─▶ sha256+smoke ─▶ ready
              └─(pause new claims, drain active steps/uploads/computer/screen; 30m cap)─▶ pending=target, exit 75
                    └─(thin launcher clears healthy.json, spawns target with attemptId)
                          ├─ child writes booted ─▶ client.me()+presence() ok for 30s ─▶ confirmed (prune old slots)
                          ├─ server unreachable after booted ─▶ keep waiting (no false rollback)
                          ├─ crash / pre-booted 60s timeout ─▶ restore previousVersion, block target, relaunch
                          └─ SIGTERM/SIGINT ─▶ forward signal, exit 0 cleanly (no rollback)
```

## Every reader and writer

| State / contract | Writer(s) | Reader(s) |
|---|---|---|
| `<userData>/update-state.json` (incl. `guardOwner`, `guardPid`, `attemptId`, `dbSnapshot`) | `updater.ts`, `launch-update.ts`, `background-update.ts`, `main.ts` (`VersionGuard`) | `updater.ts`, `launch-update.ts`, `background-update.ts`, `main.ts` |
| `<userData>/update.lock` & `<bundle dir>/.cairn-previous/Cairn.app` | `update-lock.ts` (`app` / `background-updater`), `update-swap.ts`, `updater-agent.ts` (`RUN_OR_REMOVE`), `main.ts` | `launch-update.ts`, `background-update.ts`, `main.ts`, `updater-agent.ts` |
| `deploy_lease` table (`<CAIRN_HOME>/server/server.db`), `<CAIRN_HOME>/server/preupdate-*.db`, `<CAIRN_HOME>/server/failed-*.db` | `routes-deploy.ts` (`deploy-lease.ts`), `background-updater.ts` (snapshot/restore/keep `failed-*.db` on rollback) | `machine-claim.ts` (`claimStep`), `coordinator-steps.ts` (`claimHead`), `background-updater.ts` (domain-write check before DB restore) |
| `runner-latest.json` & `desktop-latest.json` | `apps/desktop/scripts/release-manifest.mjs` (CI `publish` job) | `apps/server/src/services/release-watcher.ts`, `apps/desktop/src/update-core.ts`, `apps/daemon/src/self-update.ts` |
| `<CAIRN_HOME>/host-update-request.json` | `apps/server/src/services/server-version.ts` (`POST /api/server/update` + `release-watcher.ts`) | `server-version.ts`, `apps/desktop/src/host-update.ts`, `main.ts`, `background-updater.ts` |
| `<CAIRN_HOME>/host-update-status.json` (incl. optional `rollback`) | `apps/desktop/src/host-update.ts` via `main.ts` & `background-updater.ts` | `server-version.ts` (`GET /api/server/version`, `release-watcher.ts`), `host-update.ts` |
| `<CAIRN_HOME>/self-update/state.json` (`activeVersion`, `previousVersion`, `pending`, `blocked`, `notice`), `healthy.json`, `.lock`, `<CAIRN_HOME>/self-update/versions/<ver>/` | `apps/daemon/src/self-update.ts`, `apps/daemon/src/self-update-bootstrap.ts` | `self-update.ts`, `self-update-bootstrap.ts` (executes active slot & prunes old slots), `machine-loop.ts` |
| `machine.capabilities.runnerReleaseVersion` & `runnerAutoUpdate` | `apps/daemon/src/machine-loop.ts` → `MachineClient.presence` → `routes-machine.ts` → `machines.ts` (`markPresence`) | `routes-machine.ts`, `machines.ts` (`toMachineRecord`), `apps/web/src/resources/machine-row.tsx` |
| `GET /api/server/version` (`?schema=2`), `POST /api/server/update`, `POST /api/machine/presence` | `apps/server/src/services/release-watcher.ts`, `server-version.ts`, `routes-core.ts`, `routes-machine.ts` | `apps/desktop/src/remote-version.ts`, `apps/daemon/src/machine-loop.ts`, `apps/web` |

## Edge cases

| Edge case | What the user sees | Proving test | Slice/Status |
|---|---|---|---|
| Server release watcher discovers newer release on `DESKTOP_MANIFEST_URL` (`supported: true` vs `supported: false` vs `blocked` / rollback vs offline) | Writable host auto-triggers update without `force`; read-only or rolled-back host does not loop; offline feed logs safely | `apps/server/test/release-watcher.test.ts` | this change |
| `GET /api/server/version` v1 vs `?schema=2`, manual `force: true` retry on blocked version, and `POST /api/machine/presence` `update.targetVersion` | Old v1 desktop clients parse bare `/api/server/version` cleanly; outdated Runners get `update.targetVersion` while current/rolled-back/unsupported Runners do not | `apps/server/test/server-version.test.ts` | this change |
| Headless resident server acquires `deploy_lease`, snapshots DB, fails closed on probe/auth error, confirms 30s sustained health, coordinates `guardOwner`/`guardPid` without GUI race, reconciles leftover `state.installed`, and restores `.cairn-previous` in `RUN_OR_REMOVE` | Subsequent releases never wedge on `'unconfirmed'`; new work cannot enter mid-swap; GUI opening during background probation does not race or delete `.cairn-previous`; power-drop between renames self-heals plist | `apps/desktop/scripts/background-update.test.ts` | this change |
| Headless resident server crashes or fails 3 health probes after DB migration (untouched DB vs post-snapshot domain writes), or double-faults on rollback (`rollback-failed`) | Untouched DB restores `.app` + `preupdate-*.db` (keeping `failed-*.db`); post-snapshot domain writes keep `server.db` (`rolled-back-code`) and never silently lose user data; failed version is blocked and `rollback` notice persists | `apps/desktop/scripts/background-update.test.ts` | this change |
| Remote laptop connected to newer server or seeing newer `latestRelease` (`?schema=2` vs v1 server fallback), host switch cancellation, `force: true` retry, and remote rollback notice | Newer remote server or release triggers laptop `created.check()` at idle; switching host drops stale probes; `RemoteUpdateBar` shows one quiet line on rollback | `apps/desktop/scripts/remote-version.test.ts` | this change |
| Standalone Runner install classification (`desktop-bundled`, `homebrew`, `docker`, `development`, `read-only` vs writable `npm i -g` / archive) and manual base-binary upgrade override | Read-only/package/dev installs report `supported: false` with exact reason and download nothing; manual `npm i -g` upgrade >= `activeVersion` switches to new base | `apps/daemon/test/self-update.test.ts` | this change |
| Standalone Runner artifact validation (`runner-latest.json` missing arch / 404 / corrupt SHA-256 / path escape / smoke-test fail / 30-min backoff) and active-work drain (active step, `computer`/`screen`, ignoring exhausted stranded uploads, 30-min drain cap) | Missing or corrupt artifact never pauses task claims; active steps and computer calls finish before swap; exhausted upload journals do not wedge drain forever | `apps/daemon/test/self-update.test.ts` | this change |
| Standalone Runner thin launcher exit `75` hot-swap, `booted` vs 30s `confirmed` `attemptId` probation, crash rollback vs server-outage patience, `SIGTERM` clean stop, and double-fault fallback | Startup crash immediately rolls back to `previousVersion`, blocks bad version, and reconnects; server outage after `booted` waits without false rollback; `cairn stop` exits 0 | `apps/daemon/test/self-update.test.ts` | this change |
| Runners row and Remote update bar single-line presentation across updating, waiting-idle, rolled-back, read-only manual states, and `RemoteUpdateBar` vs `preload.ts` priority | At most one quiet line for auto-updating/rolled-back hosts, clear manual-update text for read-only Runners, and no duplicate bar | `apps/web/test/machine-row-update.test.ts`, `apps/web/test/remote-version.test.ts` | this change |
| `release-manifest.mjs` preserves strict `desktop-latest.json` schema and writes sibling `runner-latest.json` when Runner archives exist | Existing Mac/Win desktop feed remains 100% compatible while Runner feed exposes per-OS/arch checksums | `scripts/desktop-release.test.mjs` | this change |

## Out of scope

- Auto-updating Cairn inside immutable Docker containers (`docker pull` remains the container upgrade path).
- Automatically running `brew upgrade` for Homebrew-managed installs (keeps clear manual-update notice).
- Windows headless resident service (`app.cairn.host` is macOS `launchd`; Windows desktop keeps quit-time update).
- Modifying the owner's personal `scripts/ops/deploy-watch.sh` / `deploy-self.sh` tooling.

## Review

- Verdict: PASS
- Plan-SHA256: 360190e5e68eccdaabc028f756ca99a6bb54a318f5d90355753518f03aa8623c
- Author-Model: gemini-4-neon
- Reviewer: openai-codex/gpt-6.2-sol (plan review + confirm-only pass)
- Reviewer-Model: openai-codex/gpt-6.2-sol
- Findings: Initial plan review raised 9 findings (DB migration vs rollback, deploy_lease idle drain, crash-window RUN_OR_REMOVE & single guard owner, Runner drain/probation, npm install ownership & matching-arch assets, remote ?schema=2 backward compatibility & UI priority, reader/writer completeness, red-first test mapping, simplified single presence signaling); all 9 fixed and confirmed PASS in confirm-only pass.

