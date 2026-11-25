# Cairn Version-Skew Compatibility Contract and Update Design

> **Prior art:** [`docs/research/version-skew-2026-11-25.md`](../research/version-skew-2026-11-25.md).
> **Related in-flight lanes:** `fix-claim-gen-compat` (`0aa637eac`, `692e7d5d8`), `fix-ag-banner-skew` (`bbf7d78bd`), `fix-remote-update`, and `remote-version` (`1a7ac932d`, design note `remote-server-version.md` on that branch).

## For someone who installed Cairn today

Cairn has three parts that do not restart at the same time:

1. **The Cairn desktop app** on your laptop (`apps/desktop`), which only restarts when you quit or leave your computer idle.
2. **The Cairn server and web page** (`apps/server` + `apps/web`), which may run embedded inside your desktop app, as a resident background service on a home Mac mini, or on a remote Linux host / Docker container. Every page you see inside the desktop app or browser comes from this server.
3. **Runners** (`apps/daemon`), either bundled inside the desktop app or running standalone on other machines via CLI/`launchd` to execute tasks.

If you connect your laptop's Cairn app to a remote Mac mini server, or leave a standalone runner running for weeks, those three parts can be on different versions. Previously, when they drifted:

- **Stranded tasks:** a newer server required a `claimGeneration` number that an older runner did not send, so every callback returned `409` and the task sat stuck for up to 30 minutes (`fix-claim-gen-compat`).
- **False "open in desktop app" prompts:** a newer web page looked for a new desktop bridge method on an older desktop shell, saw `undefined`, and told you to "open this page in the desktop app" while you were already inside the desktop app (`fix-ag-banner-skew`).
- **Dead update button in remote mode:** the sidebar still showed "Update to X", but clicking it silently did nothing because remote mode blocked `desktop-update:install` (`fix-remote-update`).
- **Wrong version display & stale remote server:** About and Settings showed the laptop app's version instead of the remote server's version, and a newer laptop app never asked an older remote server to update (`remote-version`).

**What you need to know:** Cairn asks for no extra accounts, API keys, or payments. All updates use the existing signed GitHub Releases feed (`DESKTOP_MANIFEST_URL`) and existing Cairn server authentication. Version coordination metadata uses small `0600` JSON files inside `<CAIRN_HOME>` and `<userData>` with no secrets.

**Where you can get stuck:** If a standalone server or runner is installed via a read-only path, container, or package manager (`brew`, Docker, dev checkout) that cannot self-update, Cairn cannot upgrade it automatically. Instead of silently failing or showing a dead button, Cairn shows **which component is out of date** and gives one clear **"Update Cairn"** action (or a single manual-update instruction plus **"Check again"** when auto-update is unsupported).

## Why

Measured in live use on 2026-11-25:

- A server running post-`claimGeneration` code handed a step claim to an older runner; the runner's `heartbeat` / `tool` / `done` calls failed with HTTP `409`, stranding the Coordinator thread until the abandoned sweep fired (`fix-claim-gen-compat`, commit `0aa637eac`).
- Opening the Antigravity re-sign-in flow on a remote server from an older desktop shell (`< desktop-v0.1.729`) hit a missing `window.cairnDesktop.antigravity.signIn` bridge method or disabled IPC, leaving either a dead primary button or a bogus `"open in desktop app"` message (`fix-ag-banner-skew`, commit `bbf7d78bd`).
- Clicking the update button in the desktop app while connected to a remote server invoked `desktop-update:install`, which checked `if (!allowLocalCredentials) return undefined` (`apps/desktop/src/main.ts:1359`), silently dropping the click (`fix-remote-update`).
- Connecting a newer desktop app (`0.1.721`) to a day-older Mac mini server displayed `0.1.721` everywhere and never triggered the remote host's updater (`remote-version`, `remote-server-version.md` on that branch).

## Compatibility Contract

### 1. Who pins whom

| Pair | Authority & pinning direction | Rationale |
|---|---|---|
| **Web UI ↔ Server** | **1:1 coupled (Server owns Web UI).** The desktop app always loads the connected server's `origin` (`apps/server` serves `apps/web/dist`), never a local fallback bundle from the desktop shell. | Guarantees the browser/renderer UI matches the server's REST/SSE APIs without commit-pinning the server to the client. |
| **Desktop Shell ↔ Server (local embedded)** | **1:1 bundled.** `apps/desktop` spawns the `apps/server` and embedded `apps/daemon` inside its own `.app` bundle. | Never skews unless attached to a resident `launchd` host (`attachedToResident`), which behaves like a local-origin resident server. |
| **Desktop Shell ↔ Remote Server** | **Server is workspace authority; Shell is native host.** Neither side forces a 1:1 commit match. Both expose versions (`appVersion` vs `GET /api/server/version`) and negotiate over an explicit bridge contract. | Multiple clients (laptop, mobile browser, desktop) share one persistent server database; VS Code-style per-commit server spawning would fragment state. |
| **Page (`apps/web`) ↔ Shell (`apps/desktop/src/preload.ts`)** | **Capability-negotiated bridge.** `preload.ts` exposes a frozen `window.cairnDesktop.shell` descriptor (`shellVersion`, `bridgeVersion`, `capabilities`); the page adapts or prompts **"Update Cairn"**. | The page advances on the server's clock while `preload.ts` advances on the desktop shell's restart clock. |
| **Runner (`apps/daemon`) ↔ Server** | **Server is claim authority; Runner declares protocol & capabilities.** Runners send `cliVersion` and `capabilities.*`, including `runnerProtocolVersion`; the server selects compatible behavior inside the window and refuses claims below the floor. | Prevents older runners from taking steps whose fences or endpoints they cannot complete. |

### 2. Protocol version negotiation

#### A. Page ↔ Shell bridge (`window.cairnDesktop`)

`apps/desktop/src/preload.ts` exposes a frozen metadata object on `window.cairnDesktop.shell`:

```ts
export interface DesktopShellDescriptor {
  shellVersion: string;          // e.g. "0.1.729"
  bridgeVersion: number;         // monotonic integer, bumped on preload/IPC contract changes
  capabilities: {
    updateInstall: boolean;      // true in both local and remote mode (post fix-remote-update)
    remoteServerUpdate: boolean; // supports remote-version controller
    antigravitySignIn: boolean;  // supports antigravity.signIn in local & remote mode
    hostSwitch: boolean;         // supports desktop-host IPC
    localProviders: boolean;     // local-only provider scan/import
  };
}
```

Web code in `apps/web/src/desktop-shell.ts` classifies the environment into **three distinct states** (never collapsing "old shell" into "plain browser"):

1. **Plain browser** (`window.cairnDesktop === undefined` and UA lacks `DESKTOP_SHELL_USER_AGENT`): Cairn UI is desktop-only for desktop-exclusive operations; native flows (Antigravity/Devin local sign-in & import, local-provider import, local runner reconnect, own-computer permissions, desktop update triggers) do not render and no `"Open in Cairn desktop app"` browser-fallback copy appears (non-desktop web paths such as Claude/Devin/Gemini credential paste and mobile Web Push remain active).
2. **Desktop shell, capability present** (`shell.capabilities[feature] === true`, or for pre-`shell` legacy shells `typeof bridge?.[method] === 'function'`): run the native flow normally.
3. **Desktop shell, capability missing OR `shell` descriptor missing OR `bridgeVersion < serverMinBridgeVersion`**: **never** show `"open in desktop app"` and **never** render a dead button. Show one clear **"Update Cairn"** action wired to `desktopUpdates()` (or explicit manual-update guidance if `desktopUpdates()` itself is absent or `status === 'unsupported'`).

For `fix-ag-banner-skew` (`bbf7d78bd`), `antigravityBridge()` currently checks `typeof bridge?.signIn === 'function'`. Under this contract, when `isDesktopShell()` is true and `antigravityBridge() === null` (or `cairnDesktop.shell` is missing), `AntigravityReloginDialog` renders the **"Update Cairn"** action instead of `"Open this page in the Cairn desktop app"`.

#### B. Runner ↔ Server claim & registration (`apps/daemon` ↔ `apps/server`)

Runners report on `POST /api/machine/enroll` and `POST /api/machine/presence` (implemented in `packages/shared/src/records/machine-capabilities.ts`):

- `cliVersion: string` (the daemon version, `apps/daemon/src/version.ts`)
- `capabilities.runnerProtocolVersion: number`: `RUNNER_PROTOCOL_VERSION`, a monotonic integer starting at `1`. A runner that omits it, or sends anything other than a non-negative integer, is protocol `0`. It travels inside `capabilities`, so it is stored and replaced with every presence like the other flags, and an older binary started on the same machine (a rollback) lowers it at once.
- `capabilities.claimGeneration: true`: the claim-generation fence, unchanged.

A runner sends presence before it claims or recovers anything after every start, so the claim path reads the stored row and needs no field of its own.

Server rules:

1. **Below the floor** (`runnerProtocolOf(capabilities) < MIN_SUPPORTED_RUNNER_PROTOCOL`):
   - `POST /api/machine/tasks/claim` answers `426` with `{ code: 'runner-out-of-window' }` before it touches any step (`apps/server/src/routes-machine.ts`).
   - Routing treats the runner as ineligible (`runner-outdated` in `dispatch-eligibility.ts` and `machine-routing.ts`), so an unpinned step goes to another runner and a step pinned to it waits with the queue reason `runner-outdated`: "Queued: Cairn on {machine} is too old. This continues once it is updated".
   - Heartbeat, token, tool, upload and done calls for a step the runner already holds are not refused: the floor stops new work, never work in flight.
   - The machine stays online; the Runners list shows "Takes new tasks after a Cairn update" instead of "Needs a Cairn update".
   - The runner logs one line ("update Cairn on this computer") and keeps its normal claim backoff, capped at 30 s; it does not crash or log a failure per retry.
2. **Inside the window, below current** (`MIN_SUPPORTED_RUNNER_PROTOCOL <= v < RUNNER_PROTOCOL_VERSION`): the runner claims and finishes normally; `claimGenerationAccepted` accepts generationless calls only while the stored row lacks `claimGeneration`; the Runners list shows "Needs a Cairn update" (`runnerNeedsUpdate`).
3. **Current**: fenced claims; every step call carries the generation.

`MIN_SUPPORTED_RUNNER_PROTOCOL` is `0` today: no runner in use is below the floor. It is raised only by a change that removes a server path older runners need, and that change keeps at least 30 days of runner releases inside the window.

Removing a runner feature never removes the server half a runner inside the window still waits on. Runners from before `desktop-v0.1.712` read their `capabilities.confinement` report back before they start, so the server keeps storing and returning it (`legacyConfinementReportSchema`); that field and its schema go when the floor rises above `0`.

#### Runner ↔ Server edge cases

Every pairing, mode and condition for this part, with the expected result, its test and the red-on-main evidence: [`version-skew-edge-cases/runner-claim.md`](version-skew-edge-cases/runner-claim.md) (R1–R18).

### 3. Compatibility windows

Modeled on Cursor's two-tier policy (`warn` then `block`) and Tailscale's monotonic `CapabilityVersion`:

| Boundary | Full / Green | Soft-Warn Window (Usable, prompts update) | Hard Block (Out of Window) |
|---|---|---|---|
| **Desktop Shell ↔ Server** | `bridgeVersion >= serverRecommendedBridgeVersion` and `serverVersion <= appVersion` (or equal) | `MIN_SUPPORTED_BRIDGE_VERSION <= bridgeVersion < serverRecommendedBridgeVersion` (minimum **30 days / 30 desktop releases** backward support). Non-blocking top banner / Settings badge `"Update Cairn"`; missing individual bridge capabilities degrade inline to `"Update Cairn"`. | `bridgeVersion < MIN_SUPPORTED_BRIDGE_VERSION` (only bumped on breaking auth, transport, or data-safety changes). Full-surface callout with single **"Update Cairn"** button; no broken partial UI. |
| **Runner ↔ Server** | `runnerProtocolVersion >= RECOMMENDED_RUNNER_PROTOCOL` and `claimGeneration === true` | `MIN_SUPPORTED_RUNNER_PROTOCOL <= runnerProtocolVersion < RECOMMENDED_RUNNER_PROTOCOL` (minimum **30 days** backward support for additive protocol evolutions). Server adapts via capability flags; Runners list shows **"Update Cairn"** / auto-updater triggers at idle. | `runnerProtocolVersion < MIN_SUPPORTED_RUNNER_PROTOCOL`. Server **refuses step claims before assignment**; runner enters `update-required` wait (no crash loop, no stranded steps); Runners list shows single **"Update Cairn"** status/action. |
| **Newer Shell ↔ Older Remote Server** | `remote.version >= app.version` (semver) | Remote server is older, `updater.supported === true`: `remote-version` automatically triggers `POST /api/server/update` and shows one quiet status line (`Updating remote host…` → reloads in place when idle). | Remote server is older and either `remote.version < MIN_SUPPORTED_SERVER_VERSION` or `updater.supported === false` (or `404` on `/api/server/version`): shows real server version (or `Unknown`), one plain sentence naming the remote computer, and one **"Check again"** / **"Retry"** action. |

### 4. Who updates whom, and when

Every component updates **only when idle** (never interrupting an active Coordinator turn, claimed runner step, or user typing/IME composition), unless the user explicitly clicks **"Update Cairn"**:

1. **Desktop shell + embedded server + embedded local runner (`apps/desktop`)**:
   - Checked hourly and on window focus by `createUpdater` (`apps/desktop/src/updater.ts`).
   - Staged in the background; applied on quit or when `createIdleWatch` (`apps/desktop/src/idle-update.ts`) confirms `turnInFlight === false && stepsInFlight === 0 && !dialogOpen` while locked/away/idle.
   - Works identically in **local mode and remote mode** (`fix-remote-update` removes the `!allowLocalCredentials` guard on `desktop-update:install`).
2. **Remote host running Cairn desktop or resident `launchd` service (`remote-version`)**:
   - When the laptop's desktop shell is newer than the remote server (`GET /api/server/version`), `createRemoteVersionController` (in `remote-version.ts` on `remote-version`) posts `POST /api/server/update`.
   - The remote host stages the signed release from `DESKTOP_MANIFEST_URL`, holds swap until `busy === false` (0 active Coordinator turns and 0 claimed steps), swaps and restarts via `app.cairn.updater` / `createUpdater`, and the laptop reloads the page once the new version answers (preserving `localStorage` drafts).
3. **Standalone CLI / `launchd` runners (`apps/daemon`)**:
   - Desktop-managed local runner restarts automatically with the desktop bundle.
   - Standalone `launchd` / self-hosted runners check for updates (or react to `updateAvailable` from `POST /api/machine/presence`) when **0 steps are currently claimed**, bounded by a 12-hour restart cooldown (matching Amp's `amp --no-tui` rule) and preserving `machine.json` credentials (`692e7d5d8` runner-home isolation). Package-managed or dev runners (`homebrew`, `npm`, source checkout) report `canAutoUpdate: false` so the Runners UI tells the owner to update that machine instead of looping.

### 5. What the user sees when out of window

One consistent rule across every surface (sidebar update control, top status bar, Antigravity/local dialogs, About/Settings, Runners list):

- **Single primary action:** **`Update Cairn`** (`更新 Cairn`) when the local shell or remote host can self-update. Clicking it immediately transitions into live progress (`Checking…` → `Downloading X%` → `Installing…` → `Restarting…`), never a no-op.
- **No dead buttons:** If `bridgeVersion` or `updater.supported` prevents in-app self-update (e.g., `/Volumes/` AppTranslocation, read-only install, or self-hosted Docker/CLI server without updater), **never** render an `"Update Cairn"` button that silently fails. Replace it with one plain sentence stating *which machine* needs updating and one **`Check again`** (or **`Retry`** after transient failure) button.
- **No wrong-context copy:** Inside Electron (`DESKTOP_SHELL_USER_AGENT` or `window.cairnDesktop` present), never tell the user `"Open this page in the Cairn desktop app"`.

## States and Transitions

### Client Remote-Version & Bridge Negotiation (`remote-version.ts` + `apps/web`)

```
[boot / connect]
   │
   ├─ local embedded ──▶ shell + server + runner share bundle version (local updater only)
   │
   └─ remote origin
         │
         ▼
     [probing GET /api/server/version]
         ├─ 404 (pre-version server) ──▶ old-server (About: Unknown; preload/web quiet bar + "Check again")
         ├─ 401                      ──▶ awaiting-auth (re-probes on cairn_auth cookie change)
         ├─ 200, remote < app & updater.supported
         │     ──▶ POST /api/server/update ──▶ updating (polls) ──▶ waiting-idle (if busy)
         │     ──▶ restarting ──▶ reloading (flush drafts + reload) ──▶ current
         ├─ 200, remote < app & !updater.supported
         │     ──▶ unsupported ("Update Cairn on that computer" + "Check again")
         └─ 200, remote >= app
               ├─ shell.bridgeVersion < server.minBridgeVersion ──▶ hard-block ("Update Cairn" in shell)
               ├─ shell missing capability or < recommended     ──▶ soft-warn ("Update Cairn" bar + inline upgrade)
               └─ shell in green range                          ──▶ current
```

### Runner Claim Negotiation (`apps/daemon` ↔ `apps/server`)

```
[runner boots] ──▶ POST /api/machine/presence (cliVersion, capabilities incl. runnerProtocolVersion)
                      │
                      ├─ v < MIN_SUPPORTED_RUNNER_PROTOCOL
                      │     ──▶ server marks outOfWindow=true; claim returns 426 (never claims step)
                      │         runner idles/auto-updates (or awaits manual update)
                      │
                      └─ v >= MIN_SUPPORTED_RUNNER_PROTOCOL
                            ├─ capabilities.claimGeneration !== true
                            │     ──▶ claim allowed; claimGenerationAccepted allows legacy fence;
                            │         UI marks "Needs a Cairn update" + runner schedules idle auto-update
                            └─ full capabilities
                                  ──▶ normal fenced claim (generation required on all step calls)
```

## Every Reader and Writer

| State / contract | Writer(s) | Reader(s) |
|---|---|---|
| `window.cairnDesktop.shell` (`DesktopShellDescriptor`) | `apps/desktop/src/preload.ts` | `apps/web/src/desktop-shell.ts`, `antigravity-subscriptions.tsx`, `desktop-update.tsx` |
| `desktop-update:install` IPC handler | `apps/desktop/src/main.ts` (`serveUpdates`, enabled in both local & remote mode) | `apps/web/src/board/desktop-update.tsx`, `preload.ts` |
| `GET /api/server/version` & `POST /api/server/update` | `server-version.ts` (`remote-version` branch), `apps/server/src/routes-core.ts` | `remote-version.ts` (`remote-version` branch), `apps/web` (`AccountPage`, `DesktopHostPanel`, `RemoteUpdateBar`) |
| `<CAIRN_HOME>/host-update-request.json` | `apps/server` (`POST /api/server/update`) | `apps/server`, `apps/desktop/src/main.ts`, `apps/desktop/src/background-updater.ts` |
| `<CAIRN_HOME>/host-update-status.json` | `apps/desktop/src/main.ts` (local host), `apps/desktop/src/background-updater.ts` | `apps/server` (`GET /api/server/version`, `POST /api/server/update`) |
| `machine.capabilities` (incl. `runnerProtocolVersion`, `claimGeneration`) | `apps/daemon/src/machine-loop.ts` (`POST /presence`, `POST /enroll`) | `apps/server` (`routes-machine.ts` claim, `machine-claim-scope.ts`, `dispatch-eligibility.ts`, `machine-routing.ts`, `step-queue.ts`), `apps/web/src/resources/machine-row.tsx` |
| `<userData>/update-state.json` & `update.lock` | `apps/desktop/src/updater.ts`, `apps/desktop/src/launch-update.ts`, `apps/desktop/src/background-update.ts` | `apps/desktop/src/updater.ts`, `apps/desktop/src/main.ts` (`VersionGuard` rollback & notice) |

## Scenarios and Tests (One Test per Path)

| Scenario | What the user sees | What the system does | Wait / cost | Test (one per path) |
|---|---|---|---|---|
| **1. Old desktop app + New server (in soft-warn window, missing bridge capability)** | Non-blocking `"Update Cairn"` bar; opening a feature whose capability is missing (e.g. Antigravity re-sign-in on `< v0.1.729`) shows **"Update Cairn"** inline — never `"Open in desktop app"`. | Web reads `cairnDesktop.shell` (or detects UA + missing capability); invokes `cairnDesktop.update.check()`/`install()` on click; falls back to `window.cairnDesktop.update` in remote mode too (`fix-remote-update`). | 1 click + shell relaunch | Planned in `apps/web/test` (`desktop-bridge-skew.test.ts`): UA has `DESKTOP_SHELL_USER_AGENT`, `cairnDesktop.antigravity.signIn` absent → renders `"Update Cairn"`, never `"Open in desktop app"`, clicking invokes `update.install()`. |
| **2. Old desktop app + New server (out of bridge window)** | Full-surface banner/dialog with single **`Update Cairn`** button and live download progress; local drafts preserved. | `server.minBridgeVersion > shell.bridgeVersion` triggers hard-block gate; clicking `Update Cairn` runs `desktop-update:install` regardless of `local` vs `remote` mode (`fix-remote-update`). | Download + relaunch | Planned in `apps/desktop/scripts` (`remote-update-install.test.ts`): `allowLocalCredentials = false` (remote mode) still executes `desktop-update:install` and emits progress states (`downloading` → `ready` → `restarting`). |
| **3. New desktop app + Old server (remote host with updater)** | About & Settings show the **remote server's** older version; quiet status line (`Updating remote host…` → `Remote host is restarting…`), then seamless reload with typed text intact. | `createRemoteVersionController` (`remote-version`) probes `GET /api/server/version`, posts `POST /api/server/update`, waits if `busy === true`, polls until new version answers, flushes drafts (`cairn:prepare-reload`), reloads `webContents`. | Download + 1 remote restart | `remote-version.test.ts` on `remote-version` (`apps/desktop/scripts`): older remote `GET /api/server/version` triggers `POST /api/server/update`, waits through `waiting-idle` while `busy: true`, reloads on version bump. |
| **4. New desktop app + Old server (pre-`/api/server/version` 404)** | About shows `Unknown` (never the laptop app's version); one quiet line (`This remote host is too old to update automatically. Update Cairn on that computer.`) + **`Check again`**. | `remote-version` handles HTTP `404` once without retry loop; `preload.ts` renders quiet fallback bar if old web bundle lacks `RemoteUpdateBar`. | 1 GET | `remote-version.test.ts` on `remote-version` (`apps/desktop/scripts`): HTTP `404` enters `old-server` state, sets About to `Unknown`, stops polling until user clicks `Check again`. |
| **5. Old runner daemon + New server (within window, pre-`claimGeneration`)** | Task runs and finishes normally; Runners list shows **`Needs a Cairn update`** (`fix-claim-gen-compat`). | Server `claimGenerationAccepted` accepts generationless requests only when `capabilities.claimGeneration !== true`; managed runner schedules idle self-update after step completion. | 0 extra wait | `machine-claim-protocol-skew.test.ts` on `fix-claim-gen-compat` (`0aa637eac`): legacy runner without `claimGeneration` claims and finishes step without `409`; `machine-row` renders `machine-needs-update`. |
| **6. Old runner daemon + New server (out of window, `v < MIN_SUPPORTED_RUNNER_PROTOCOL`)** | Task does **not** get stranded on that runner (routes to a capable runner or waits clearly); Runners list marks the old runner **`Update Cairn`** (`out-of-window`). | `POST /api/machine/tasks/claim` returns `426` without claiming; runner stays `online` for visibility, stops claiming in a loop, and triggers idle updater if supported. | 0 stranded steps | `apps/server/test/machine-claim-window.test.ts`: runner below the floor gets `426` on claim, the step stays `pending` with queue reason `runner-outdated`, the machine stays online. Edge cases R1–R17 in `version-skew-edge-cases/runner-claim.md`. |
| **7. Remote mode (desktop shell connected to remote server — bridge + update + runner isolation)** | Sidebar Update button updates the laptop shell; Antigravity re-sign-in signs in directly on the Mac and saves to the remote server (`fix-ag-banner-skew`); laptop local runner stays isolated from any CLI runner on the same Mac (`692e7d5d8`). | `desktop-update:install` allowed in remote mode (`fix-remote-update`); `antigravity:sign-in` active in remote mode (`bbf7d78bd`); desktop uses its own `runner-home` when `~/.cairn` belongs to another server (`692e7d5d8`). | 0 dead buttons | [`apps/web/e2e/providers-subscription-relogin.spec.ts`](../../apps/web/e2e/providers-subscription-relogin.spec.ts) + `local-runner-home.test.ts` (`692e7d5d8`) + planned remote-mode update IPC test. |
| **8. Self-hosted server owner who updates late (`updater.supported === false` / Docker / CLI)** | About & Settings show the self-hosted server's real version; one plain sentence (`This remote host cannot update automatically. Update Cairn on that computer.`) + **`Check again`**. No endless spinner or broken auto-update loop. | `GET /api/server/version` returns `updater: { supported: false, reason: 'no-updater' \| 'development' }`; client stops auto-triggering; server stays usable inside compatibility window and warns cleanly when shell or runner crosses floor. | 1 GET | `server-version.test.ts` + `remote-version.test.ts` on `remote-version`: `supported: false` enters `unsupported` state, sends zero `POST /api/server/update` requests. |
| **9. Plain browser (no desktop shell)** | Settings shows connected server's version + commit; desktop-only native flows (Antigravity/Devin local sign-in & import, local runner reconnect, own-computer permissions, shell update bar) do not render (`null`); zero `"Open in Cairn desktop app"` fallback copy. Non-desktop flows (credential paste, Web Push) remain usable. | `window.cairnDesktop` is `undefined` and UA lacks `DESKTOP_SHELL_USER_AGENT`. | 0 dead controls | [`apps/web/test/desktop-capability-skew.test.ts`](../../apps/web/test/desktop-capability-skew.test.ts) & [`docs/design/version-skew-edge-cases/page-shell-capability.md`](./version-skew-edge-cases/page-shell-capability.md). |
| **10. Remote update failure or restart timeout** | Quiet status line explains failure (`The remote host could not finish updating.`) with a single **`Retry`** button; no auto-retry storm. | `remote-version` stops polling on `failed` or `120 s` restart timeout for that `(appVersion, serverVersion)` pair until user clicks `Retry`. | Stops on failure | `remote-version.test.ts` on `remote-version`: `updater.state === 'failed'` or 120 s restart timeout transitions to `failed` and halts polling until `retry()`. |

> **Edge-case matrix (`part = remote-version`):** [`docs/design/version-skew-edge-cases/remote-version.md`](version-skew-edge-cases/remote-version.md).
> **Edge-case matrix (`part = server-self-deploy`):** [`docs/design/version-skew-edge-cases/server-self-deploy.md`](version-skew-edge-cases/server-self-deploy.md).
> **Edge-case matrix (`part = page-shell-capability`):** [`docs/design/version-skew-edge-cases/page-shell-capability.md`](version-skew-edge-cases/page-shell-capability.md).

## In-Flight Lanes Mapped to This Contract

- **`fix-claim-gen-compat`** (`0aa637eac`, `692e7d5d8`): Implements the runner-side compatibility bridge (`capabilities.claimGeneration`, `claimGenerationAccepted` fence, immediate crash `done(failed)`, 45 s / 2 min dead-claim sweep, `"Needs a Cairn update"` badge in `machine-row.tsx`, and separate desktop `runner-home` so dual local+remote runners stop 401 crash loops). It also adds the `runnerProtocolVersion` floor (`426` before claiming, `runner-outdated` routing and queue reason). Remaining follow-up from this contract: idle self-update for standalone CLI/`launchd` runners.
- **`fix-ag-banner-skew`** (`bbf7d78bd`): Fixes Antigravity re-sign-in across local and remote mode (`antigravity:sign-in` IPC enabled in remote mode; `AntigravityReloginDialog` with no dead Save button). Remaining follow-up from this contract: when `isDesktopShell()` is true and `antigravityBridge()` is `null` (an older shell `< desktop-v0.1.729`), show **`Update Cairn`** instead of `"Open this page in the Cairn desktop app"`.
- **`fix-remote-update`**: Removes the `!allowLocalCredentials` block on `desktop-update:install` in `apps/desktop/src/main.ts` so remote-mode users can update their desktop shell instead of clicking a dead button.
- **`remote-version`** (`1a7ac932d`, design note `remote-server-version.md` on that branch): Implements `GET /api/server/version`, `POST /api/server/update`, `createRemoteVersionController`, server version display in About/Settings/update control, and idle-safe automatic update of older remote hosts. Remaining follow-up from this contract: enforce `minBridgeVersion` / `recommendedBridgeVersion` negotiation on the shell ↔ server boundary.
