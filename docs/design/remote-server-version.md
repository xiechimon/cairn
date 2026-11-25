# Remote server version display and automatic update

## For someone who installed Cairn today

You can use the Cairn desktop app in two ways: against the server on your own Mac, or connected to a Cairn server running on another computer (for example, a Mac mini that stays on at home). When you connect to another computer, every page, button and task you interact with comes from that remote server, not from the app shell on your laptop.

Previously, Cairn only showed the version of the app installed on your laptop. If your laptop updated to 0.1.721 while your Mac mini was still running an older build, About and Settings still claimed 0.1.721, and server-side fixes never reached you until someone walked over to the Mac mini and updated it by hand.

Now Cairn always shows one version — the version of the server you are actually using — in About, Settings and the update control. If your desktop app is newer than the remote server, Cairn quietly asks the remote computer's own updater to update itself. It never interrupts a running task or an active reply; it waits until the remote host is safe to restart, shows a single quiet status line while it happens, and reloads the page to the new version without losing anything you typed.

What you need to know: no extra accounts, keys or payments are asked of you. The remote computer downloads the signed Cairn release from the same public GitHub Releases feed it already uses. Coordination state lives in two small JSON files (`host-update-request.json` and `host-update-status.json`, mode `0600`, no secrets) inside the remote host's Cairn home directory.

Where you can get stuck: if the remote computer is running an older server that predates this feature, runs Cairn from a CLI or read-only location without a desktop updater, or its update fails, Cairn shows one plain sentence with a single action telling you what to do next — either retry, or update Cairn on that computer and check again.

## Why

Measured in live use: the owner's laptop desktop app reported `0.1.721` while connected in remote mode to a Mac mini server built a day earlier, with no visible server version anywhere in About, Settings or the sidebar update button. Server-side fixes did not reach the remote session until someone manually updated the remote host.

## Scenarios

| Situation | What the user sees | What Cairn does | Wait / cost |
|---|---|---|---|
| Desktop app in local mode | Server version (build version + short commit) in About, Settings and update tooltip; existing local updater unchanged | Reads `GET /api/server/version` from local server; runs existing local updater and idle-update watch | None |
| Desktop app in remote mode, server version >= app version | Remote server's version + commit in About, Settings and update tooltip; no status bar | Probes `GET /api/server/version`; sets macOS About panel options; leaves remote host alone | One lightweight GET |
| Desktop app in remote mode, server older, remote host idle | Quiet single-line status (`Updating remote host to X…` → `Remote host is restarting…`), then page reloads at new version with drafts intact | App calls `POST /api/server/update`; remote host's existing desktop updater or `app.cairn.updater` downloads, verifies signature, swaps bundle, restarts server/app; client polls until new version answers, flushes drafts, reloads in place without stealing focus | Download + one server restart |
| Remote host has a running task step or active Coordinator turn | Quiet status line (`Remote host is busy; it will update when idle`) | Remote host downloads and stages the update but holds swap until active turns and claimed steps drop to 0 (and idle rule passes); then swaps and restarts | Waits for active work to finish |
| Remote host runs resident launchd service with desktop app closed | Same quiet status line and automatic reload | Server writes `host-update-request.json` and kicks existing `app.cairn.updater` via `launchctl kickstart`; `background-updater.mjs` runs `runBackgroundUpdate`, swaps bundle, kickstarts `app.cairn.host` | Download + one resident restart |
| User is typing in composer or an input when remote server finishes restarting | Typed text stays intact after reload | Drafts persist to `localStorage` on every keystroke; before reload the page flushes pending drafts and defers reload until IME composition ends | < 1 s |
| Remote server predates this feature (no `/api/server/version`) | About shows Unknown (never the local app's version); one plain sentence + single action (`Check again`), rendered by preload fallback if the old web bundle lacks the UI | Detects HTTP 404 on `/api/server/version`; does not loop; clicking `Check again` re-probes | One GET |
| Remote host has no updater (CLI, container, dev build, read-only app) | Remote server's version in About and Settings; one plain sentence + single action (`Check again`) | `GET /api/server/version` reports `updater.supported: false`; client does not trigger an update | One GET |
| Remote update fails (offline, no newer release published yet, bad signature, restart timeout) | Remote server's version in About and Settings; one plain sentence + single action (`Retry` or `Check again`) | Stops auto-retrying for this `(appVersion, serverVersion)` pair until user clicks retry or reconnects | None after failure |
| Plain browser (no desktop shell) | Server version + commit in Settings | Reads `GET /api/server/version`; no mismatch auto-update | One GET |

## Wire protocol

### `GET /api/server/version`

Authenticated via existing API auth (owner token, browser session, paired device, or open when `CAIRN_AUTH=off`). `Cache-Control: no-store`. Never exposes filesystem paths or raw error strings.

```ts
interface ServerVersionResponse {
  version: string | null; // build semver (e.g. "0.1.721"), null if unknown
  commit: string | null;  // short git SHA (7-40 hex chars), null if unavailable
  busy: boolean;          // true if any chief_thread.activeRun != null or step.status = 'claimed'
  updater: {
    supported: boolean;
    state:
      | 'idle'
      | 'checking'
      | 'downloading'
      | 'waiting-idle'
      | 'installing'
      | 'restarting'
      | 'up-to-date'
      | 'unsupported'
      | 'failed';
    targetVersion: string | null;
    percent: number | null;
    reason:
      | 'no-updater'
      | 'development'
      | 'not-in-applications'
      | 'read-only'
      | 'low-battery'
      | 'blocked'
      | 'offline'
      | 'no-release'
      | 'signature-refused'
      | 'failed'
      | null;
    updatedAt: number | null;
  };
}
```

Version resolution priority on the server (`apps/server/src/services/server-version.ts`):
1. `CAIRN_SERVER_VERSION` / `CAIRN_SERVER_COMMIT` env overrides (used by embedded desktop spawn and isolated tests).
2. Build-time constants injected by `apps/server/build.mjs` (`VERSION` / `CAIRN_BUILD_VERSION` and `RELEASE_SHA` / `GITHUB_SHA` / `git rev-parse --short=7 HEAD`).
3. Ancestor `.app/Contents/Info.plist` `CFBundleShortVersionString` when running from a packaged macOS bundle.
4. `apps/server/package.json` version (dev/CLI fallback) and `deploy.json` commit SHA if present.

### `POST /api/server/update`

Authenticated via existing API auth (cookie writes automatically require `sameOriginPageWrite`; remote Electron main fetches send `Origin: <remoteOrigin>`). Body: `{ targetVersion?: string }` (informational semver only; the host never accepts download URLs, paths or commands from the caller).

Response (`202` when accepted or already running, `200` when unsupported):
```ts
{ accepted: boolean; updater: ServerVersionResponse['updater'] }
```

Idempotency & rate limiting:
- If the host updater is already in an active phase (`checking`, `downloading`, `waiting-idle`, `installing`, `restarting`), returns `{ accepted: true, updater }` without spawning a second run.
- If a request was written within the cooldown window (30 s) and is still pending, returns `{ accepted: true, updater }` without re-triggering.
- If no updater is available (`supported === false`), returns `200 { accepted: false, updater }` with `state: 'unsupported'`.

## Host coordination state (single path)

No second updater is created. The server coordinates with the existing `apps/desktop` updater (`createUpdater` + `createIdleWatch` when the desktop app is running; `background-updater.mjs` / `app.cairn.updater` when only the resident launchd host is running) using two single-writer atomic JSON files in `<CAIRN_HOME>` (mode `0600`, temp file + rename):

1. `<CAIRN_HOME>/host-update-request.json` — written only by `apps/server`:
   `{ id, requestedVersion, requestedAt }`
2. `<CAIRN_HOME>/host-update-status.json` — written only by the host updater (`apps/desktop/src/main.ts` or `apps/desktop/src/background-updater.ts`):
   `{ pid, kind, supported, blocker, state, targetVersion, percent, reason, handledRequestId, updatedAt }`

Wakeup paths:
- Embedded desktop server (`CAIRN_OWNER_CHANNEL=ipc`): server writes `host-update-request.json` and posts `{ type: 'cairn:host-update-request', id, requestedVersion }` on `process.parentPort` for immediate wakeup.
- Resident server with desktop app open: desktop `main.ts` watches `host-update-request.json` (plus 5 s poll fallback) and drives its existing `updater.check()` + `watchIdleUpdate`.
- Resident server with desktop app closed (`CAIRN_MANAGED_BY=launchd` and `app.cairn.updater.plist` present): server writes `host-update-request.json` and calls `launchctl kickstart gui/<uid>/app.cairn.updater` (without `-k` so an active run is never killed). If `background-updater` holds on `resident-busy`, it records `waiting-idle` and exits; the server re-kicks `app.cairn.updater` once `isServerBusy(db)` becomes `false` (throttled by cooldown).

Idle rule reuse (`apps/desktop/src/idle-update.ts`):
- `IdleSample` gains optional `remoteRequested?: boolean` and `serverBusy?: boolean`.
- `serverBusy === true` holds the update (`hold: 'steps'`) just like local running steps.
- When `remoteRequested === true`, the safety holds (`ready`, `guardSettled`, `turnInFlight`, `dialogOpen`, `stepsInFlight`, `serverBusy`) remain strictly enforced, and once the remote machine is safe and not actively being typed on (`locked || !cairnFocused || inputIdleMs >= 10_000`), `createIdleWatch` returns `{ apply: true, trigger: 'remote-request' }`.

## States and transitions

Host updater state:
```
idle ──request──▶ checking ──▶ downloading ──▶ waiting-idle ──▶ installing ──▶ restarting ──▶ (new process: idle)
                     │              │               │               │              │
                     ▼              ▼               ▼               ▼              ▼
                 up-to-date      failed          (waits)         failed         failed
                 unsupported
```

Client remote-version controller (`apps/desktop/src/remote-version.ts`):
```
local (inactive)
probing ──200, remote >= app──▶ current
        ──200, remote < app, supported──▶ updating (polls /api/server/version)
            ──restarting / transient network error──▶ restarting (polls until version advances)
            ──version advanced──▶ reloading (flush drafts + reload webContents) ──▶ current
            ──unsupported / failed / timeout──▶ unsupported | failed
        ──200, remote < app, !supported──▶ unsupported
        ──404──▶ old-server
        ──401──▶ awaiting-auth (re-probes on cairn_auth cookie change)
```

## Every reader and writer

| File / state | Writer(s) | Reader(s) |
|---|---|---|
| `apps/server/src/build-info.ts` (bundled) | `apps/server/build.mjs` | `readServerVersion` |
| `<CAIRN_HOME>/host-update-request.json` | `apps/server` (`POST /api/server/update`) | `apps/server` (dedupe/idle re-kick), `apps/desktop/src/main.ts`, `apps/desktop/src/background-updater.ts` |
| `<CAIRN_HOME>/host-update-status.json` | `apps/desktop/src/main.ts` (local mode), `apps/desktop/src/background-updater.ts` | `apps/server` (`GET /api/server/version`, `POST /api/server/update`) |
| `<userData>/update-state.json` & `update.lock` | Existing `updater.ts`, `launch-update.ts`, `background-update.ts` (unchanged) | Existing updater modules (unchanged) |
| `RemoteVersionState` (in-memory in client `main.ts`) | `createRemoteVersionController` in `apps/desktop/src/main.ts` | `app.setAboutPanelOptions`, `appMenuTemplate`, `desktop-update:state` & `desktop-update:remote-state` IPC, `preload.ts` fallback bar |
| `GET /api/server/version` (in web UI) | `apps/server` | `AccountPage`, `DesktopHostPanel`, `DesktopUpdateButton`, `RemoteUpdateBar` |

## Failure behavior and compatibility

| Failure / compatibility case | System behavior | User-facing copy & action |
|---|---|---|
| Old server without `/api/server/version` (404) | Client records `old-server`, sets About to Unknown, stops auto-trigger; `preload.ts` renders quiet fallback bar if loaded old web bundle did not mount `RemoteUpdateBar` | `这台远程主机版本较旧，无法自动更新，请在该电脑上更新 Cairn。` / `This remote host is too old to update automatically. Update Cairn on that computer.` + `重新检查` / `Check again` |
| Server has `/api/server/version` but `updater.supported === false` | Client displays actual server version, records `unsupported`, does not trigger update | `这台远程主机无法自动更新，请在该电脑上手动更新 Cairn。` / `This remote host cannot update automatically. Update Cairn on that computer.` + `重新检查` / `Check again` |
| Remote host cannot reach GitHub Releases (`reason: 'offline'`) | Stops auto-retry for this version pair | `远程主机无法连接更新服务，请稍后重试。` / `The remote host could not reach the update service.` + `重试` / `Retry` |
| Client app version is newer than latest published release (`reason: 'no-release'` or `up-to-date` while still older) | Stops auto-retry for this version pair so no loop occurs | `远程主机尚无可用的新版本。` / `No newer release is available for the remote host yet.` + `重新检查` / `Check again` |
| Download/verify/swap fails or restart exceeds timeout (120 s) | Transitions to `failed`, stops auto-retry until user acts | `远程主机未能完成更新。` / `The remote host could not finish updating.` + `重试` / `Retry` |
| Stale `host-update-status.json` from dead updater PID (> 10 min or dead PID) | Server ignores stale active state and projects `idle` (or `failed` if request went unhandled) | Next check/request proceeds cleanly |
| Old desktop app connected to new server | Old app never calls `/api/server/version` or `/api/server/update`; server behaves identically to before | Unchanged |
| Reload while user has unsaved input | `DraftSync` writes to `localStorage` on every keystroke; before reload the page dispatches `cairn:prepare-reload` to flush drafts and waits briefly if IME composition is active | Page reloads to new version with text preserved |
