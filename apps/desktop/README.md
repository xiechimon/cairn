# Cairn desktop (macOS)

An Electron shell for macOS. The main process starts the bundled Cairn server on Electron's own Node with `utilityProcess.fork`, bound to `127.0.0.1` on a free port with `CAIRN_HOME` under the app's `userData` directory, waits until it answers, and opens its web UI in a window. The server writes its owner token to `CAIRN_HOME/token`; the main process reads it and adds `Authorization: Bearer <token>` only to requests whose initiator is the app's own origin, so the window signs in as the owner on macOS, where the server's loopback owner check is Linux-only. `CAIRN_TOKEN` and `CAIRN_AUTH` are removed from the server's environment so the token file is always the one in use. Once the server answers, the main process enrolls this computer as the server's local Runner: it starts an enrollment and confirms it with the owner token (`/api/machine/enroll/start` and `/confirm`, the same pair the browser approval uses), writes the returned `machine.json` (mode 0600, in a 0700 directory) under `userData/runner`, and starts the bundled daemon with `cairn start --foreground --server <origin>`. The daemon runs on Electron's binary with `ELECTRON_RUN_AS_NODE=1`, so anything it starts through `process.execPath` is Node too; it is restarted up to five times if it exits, and the enrollment is repeated at every launch, which rotates the machine token. Links to other origins open in the default browser. A menu bar icon (`assets/trayTemplate*.png`, drawn from `apps/web/public/logo-mark.svg`) shows the server address and offers Open Cairn and Quit Cairn. Closing the window only hides it and the server keeps running; the Dock icon or Open Cairn brings it back. Quitting the app stops the Runner and then the server with SIGTERM and removes the icon.

Only the macOS package is maintained. The research behind the stack is `docs/research/desktop-app-stack-2026-11-08.md`.

## Build

```bash
pnpm --filter @cairn/web build
pnpm --filter @xiechimon/cairn build
pnpm --filter @xiechimon/cairn-cli build
node apps/server/scripts/stage-web.mjs
pnpm --filter @cairn/desktop stage-server
pnpm --filter @cairn/desktop stage-runner
pnpm --filter @cairn/desktop dist:mac
```

`stage-server` copies the server's `dist`, `web`, `drizzle` and the `better-sqlite3` runtime (its Node-API prebuilds load under Electron unchanged) into `apps/desktop/server`. `stage-runner` runs `pnpm deploy --prod --ignore-scripts` for `@xiechimon/cairn-cli` with a hoisted `node_modules` into `apps/desktop/runner`, then drops the Claude Agent SDK's bundled `claude` binaries: the daemon runs the `claude` it finds on `PATH` or in the usual install folders, and a Mac without one has no Claude Code runtime to offer anyway. `dist:mac` writes arm64 and x64 DMG and zip files to `apps/desktop/release`. Builds are ad-hoc signed (`identity: '-'`, no hardened runtime) until a Developer ID is set up, so Gatekeeper asks before the first launch; the DMG must be built on macOS.

`pnpm --filter @cairn/desktop smoke` launches `release/mac-arm64/Cairn.app` with Playwright, checks that the window is on the loopback server, that `/api/teams` answers 200 without a pairing step, that no pairing gate shows, and that a `local` machine comes online within 90 seconds, saves `release/smoke.png`, then checks that closing the window hides it while the server keeps answering and that quitting stops the server and the Runner. The `desktop-mac` workflow runs the same steps on a macOS runner for changes under `apps/desktop` and uploads `Cairn-<version>-arm64.dmg` and `smoke.png` as unzipped artifacts.

The `electron` package's install script is disabled in `pnpm-workspace.yaml`, so `pnpm install` does not download Electron. To run `pnpm --filter @cairn/desktop start` locally, run `node apps/desktop/node_modules/electron/install.js` once.

## Releases

`desktop-release` publishes `desktop-v0.1.<run number>` to GitHub Releases with arm64 and x64 DMG and zip files named `Cairn-<version>-<arch>.<ext>`. It runs every 3 hours (minute 17) and on demand from the Actions tab (`workflow_dispatch`). A scheduled run first checks on Linux whether anything the app ships changed since the last `desktop-v*` tag (`apps/web`, `apps/server`, `apps/daemon`, `apps/desktop`, `packages/shared` and the root package and lockfile files) and starts the macOS build only if so; an on-demand run always builds. The version is stamped into the packaged `package.json` with `-c.extraMetadata.version`, so `app.getVersion()` reports it; the arm64 build passes `pnpm smoke` before anything is published.

## Updates

Each release also carries `desktop-latest.json` (`scripts/release-manifest.mjs`): the version and, per arch, the zip's name, size and SHA-256. The packaged app reads `https://github.com/xiechimon/cairn/releases/latest/download/desktop-latest.json` 10 seconds after launch, every hour, and when a window gains focus at least 10 minutes after the last check; this is a release download, not the REST API, so the API's 60-requests-per-hour limit for unauthenticated callers does not apply, and a latest release without the file (HTTP 404) means no update. `desktopUpdateFrom` in `@cairn/shared` turns a newer manifest into the zip URL for the running arch. The sidebar's bottom-left button (desktop only, through the `cairnDesktop` preload bridge) shows the state; clicking "Update to …" downloads the zip next to the running bundle, checks its SHA-256, unpacks it with `ditto`, swaps the bundle and relaunches. Electron's `autoUpdater` and `electron-updater` are not used because Squirrel.Mac only installs a build signed with the same Developer ID, and these builds are ad-hoc signed. Updating needs Cairn in a writable folder such as `/Applications`; run from the DMG or a translocated path, the button says so instead.
