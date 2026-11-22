# Cairn desktop

An Electron shell for macOS and local Linux x64 builds. The main process starts the bundled Cairn server on Electron's own Node with `utilityProcess.fork`, bound to `127.0.0.1` on a free port with `CAIRN_HOME` under the app's `userData` directory, waits until it answers, and opens its web UI in a window. The server writes its owner token to `CAIRN_HOME/token`; the main process reads it and adds `Authorization: Bearer <token>` only to requests whose initiator is the app's own origin, so the window signs in as the owner on macOS, where the server's loopback owner check is Linux-only. `CAIRN_TOKEN` and `CAIRN_AUTH` are removed from the server's environment so the token file is always the one in use. Once the server answers, the main process enrolls this computer as the server's local Runner: it starts an enrollment and confirms it with the owner token (`/api/machine/enroll/start` and `/confirm`, the same pair the browser approval uses), writes the returned `machine.json` (mode 0600, in a 0700 directory) under `userData/runner`, and starts the bundled daemon with `cairn start --foreground --server <origin>`. The daemon runs on Electron's binary with `ELECTRON_RUN_AS_NODE=1`, so anything it starts through `process.execPath` is Node too; it is restarted up to five times if it exits, and the enrollment is repeated at every launch, which rotates the machine token. Links to other origins open in the default browser. The menu-bar icon opens the operating system's native menu. It shows the server address, workspace and Runner status, and offers navigation, the local Runner and screen-awake switches, Settings and Quit Cairn. While Keep the Screen On holds the display awake, or a scheduled run is about to start, the icon switches to `assets/trayAwakeTemplate*.png`, the same spiral with a cup in its lower right corner. Closing the window only hides it; the server keeps running and the Dock icon or a menu navigation item brings the window back. Quitting the app stops the Runner and then the server with SIGTERM and removes the icon.

## Tray status

The desktop process reads the first workspace's tasks, computers, usage and account through the local server. It preloads the snapshot, refreshes every 30 seconds and when the menu opens, and applies results after the menu closes so that rows do not jump during keyboard navigation. A failed read shows status unavailable; navigation and local controls still work. Runner and screen-awake changes do not wait for the workspace refresh. The screen-awake choice is saved in the desktop app's user data; the Runner switch affects the current app session.

## Telemetry

The server's stdout and stderr (the main process pipes them instead of inheriting them, since a Finder launch has no terminal) are written to `~/Library/Application Support/@cairn/desktop/logs/server.log`, and the main process's own `console` output to `logs/main.log`. Each file is mode `0600`, capped at 5 MB, and keeps one backup (`server.log.1`, `main.log.1`); the Runner keeps writing `runner/daemon.log` itself. Complete lines pass through a redactor that replaces the owner token and the `CAIRN_OTEL_HEADERS` values with `[redacted]` before they reach disk.

Export to an OTLP collector such as Langfuse is off unless `~/Library/Application Support/@cairn/desktop/otel.env` exists. It is dotenv text with `CAIRN_OTEL_ENDPOINT`, optional `CAIRN_OTEL_HEADERS` and optional `CAIRN_OTEL_ENVIRONMENT` (default `mac`), and must be mode `0600`; a file readable by others is ignored. The main process reads it once at launch and passes the file path to the server and the Runner as `CAIRN_OTEL_ENV_FILE`; the header secret never enters a child process environment (a same-UID session can read another process's environment block through `KERN_PROCARGS2`). Each side reads the file itself and takes only the three `CAIRN_OTEL_*` keys. Quit and reopen Cairn after editing it. Design: `docs/design/desktop-otel-export.md`; reaching the deployment's Langfuse from a Mac: `docs/ops/langfuse.md`.

The macOS package is released automatically. Linux x64 can be packaged locally as a portable archive; Linux releases and automatic updates are not provided. The research behind the stack is `docs/research/desktop-app-stack-2026-11-08.md`.

## Build

Start in a checkout with Node.js 22.19+ (22 or 24 LTS), Git and pnpm installed:

```bash
git clone https://github.com/xiechimon/cairn
cd cairn
pnpm install --frozen-lockfile --ignore-scripts
```

```bash
pnpm --filter @cairn/web build
pnpm --filter @xiechimon/cairn build
pnpm --filter @xiechimon/cairn-cli build
node apps/server/scripts/stage-web.mjs
pnpm --filter @cairn/desktop stage-server
pnpm --filter @cairn/desktop stage-runner
pnpm --filter @cairn/desktop dist:mac
```

`stage-server` copies the server's `dist`, `web`, `drizzle` and the `better-sqlite3` runtime (its Node-API prebuilds load under Electron unchanged) into `apps/desktop/server`. `stage-runner` runs `pnpm deploy --prod --ignore-scripts` for `@xiechimon/cairn-cli` with a hoisted `node_modules` into `apps/desktop/runner`, installing the platform-specific optional packages for the target `ARCH` (default: the host's), so an x64 build staged on an arm64 Mac carries x64 binaries. The daemon runs the `claude` it finds on `PATH` or in the usual install folders; when it finds none, the Claude Agent SDK falls back to its bundled `claude`, so `stage-runner` fails unless `@anthropic-ai/claude-agent-sdk-<platform>-<arch>/claude` resolves from the SDK, and the release checks the same in the packaged app with `scripts/check-runner-claude.mjs`. `dist:mac` writes arm64 and x64 DMG and zip files to `apps/desktop/release`. Without signing variables the build is ad-hoc signed (`identity: '-'`). Releases are signed by `scripts/sign-mac.cjs` with Cairn's own self-signed certificate (`signing/cairn-mac-self-signed.crt`) when `CAIRN_MAC_SIGN_IDENTITY` and `CAIRN_MAC_SIGN_KEYCHAIN` are set, with no hardened runtime and no notarization, so Gatekeeper still asks before the first launch. A fixed certificate keeps the app's designated requirement the same across releases, so macOS keeps its Accessibility and Screen Recording grants after an update; an ad-hoc requirement is the build's cdhash and loses them. `scripts/check-signature.mjs` fails a build that is not signed by the given certificate. Where the certificate and key live, and how to rotate them, is in `docs/ops/desktop-signing.md`. The DMG must be built on macOS.

`pnpm --filter @cairn/desktop smoke` launches `release/mac-arm64/Cairn.app` with Playwright, checks that the window is on the loopback server, that `/api/teams` answers 200 without a pairing step, that no pairing gate shows, and that a `local` machine comes online within 90 seconds, saves `release/smoke.png`, then checks that closing the window hides it while the server keeps answering and that quitting stops the server and the Runner. The `desktop-mac` workflow runs the same steps on a macOS runner for changes under `apps/desktop` and uploads `Cairn-<version>-arm64.dmg` and `smoke.png` as unzipped artifacts.

The `electron` package's install script is disabled in `pnpm-workspace.yaml`, so `pnpm install` does not download Electron. To run `pnpm --filter @cairn/desktop start` locally, run `node apps/desktop/node_modules/electron/install.js` once.

### Linux x64 archive

Run the same web, server, Runner build and staging commands above, then replace `dist:mac` with:

```bash
pnpm --filter @cairn/desktop dist:linux
mkdir -p "$HOME/.local/opt/cairn"
tar -xzf apps/desktop/release/Cairn-0.0.0-linux-x64.tar.gz -C "$HOME/.local/opt/cairn" --strip-components=1
"$HOME/.local/opt/cairn/cairn"
```

The archive bundles Electron, the server and Runner, so running it does not require Node.js. It needs a graphical Linux session, bubblewrap 0.11 or newer and a working systemd user session for task confinement, as described in `docs/getting-started.md`. It chooses a free loopback port and keeps its data under `$XDG_CONFIG_HOME/@cairn/desktop` (normally `~/.config/@cairn/desktop`). Use an independent `HOME` and `XDG_CONFIG_HOME` to test without importing existing model logins or app data. This command never publishes a release. Quit Cairn to stop its server and Runner.

Extract the app outside `/tmp`, which the task sandbox deliberately hides. A source checkout and build output may still live in `/tmp`.

The bundled Runner includes pi. In **Connect models → OpenAI Codex**, follow the browser device-login prompt; no separate Codex CLI or pi install is needed. With only Codex connected on fresh data, **Confirm settings** shows GPT-6.1 Sol for Coordinator and Tasks, with pi executing tasks. Confirm, then create a local Git project and ask for a small change. See [the first-result steps](../../README.md#connect-a-model-and-get-your-first-result). Claude Code is optional and needs its own installed CLI plus a subscription token connected in Model services. Devin is downloaded only for an enabled, unexpired Devin subscription.

On Linux the app runs the Runner in its own transient systemd user service and stops that service when the Runner is turned off or the app quits. It does not fall back to an unsandboxed Runner. See `docs/design/desktop-linux-runner.md` for ownership and failure behavior.

Run `pnpm --filter @cairn/desktop smoke:linux /absolute/path/to/cairn-linux/cairn /absolute/path/to/smoke.png` to check an extracted archive. The single-process Playwright check creates a fresh HOME and app data directory, checks owner sign-in and the pi Runner's actual sandbox readiness, quits the app, checks that the server and Runner stopped, and removes its temporary data. It does not log in to a model or claim a first task result.

## Releases

`desktop-release` publishes `desktop-v0.1.<run number>` to GitHub Releases with arm64 and x64 DMG and zip files named `Cairn-<version>-<arch>.<ext>`. It runs every 3 hours (minute 17) and on demand from the Actions tab (`workflow_dispatch`). A scheduled run first checks on Linux whether anything the app ships changed since the last `desktop-v*` tag (`apps/web`, `apps/server`, `apps/daemon`, `apps/desktop`, `packages/shared` and the root package and lockfile files, not counting tests, e2e specs and Markdown) and starts the macOS build only if so; an on-demand run always builds. The version is stamped into the packaged `package.json` with `-c.extraMetadata.version`, so `app.getVersion()` reports it; the arm64 build passes `pnpm smoke` before anything is published.

## Updates

Each release also carries `desktop-latest.json` (`scripts/release-manifest.mjs`): the version and, per arch, the zip's name, size and SHA-256. The packaged app reads `https://github.com/xiechimon/cairn/releases/latest/download/desktop-latest.json` 10 seconds after launch, every hour, and when a window gains focus at least 10 minutes after the last check; this is a release download, not the REST API, so the API's 60-requests-per-hour limit for unauthenticated callers does not apply, and a latest release without the file (HTTP 404) means no update. `desktopUpdateFrom` in `@cairn/shared` turns a newer manifest into the zip URL for the running arch. The sidebar's bottom-left button (desktop only, through the `cairnDesktop` preload bridge) shows the state; clicking "Update to …" downloads the zip next to the running bundle, checks its SHA-256, unpacks it with `ditto`, swaps the bundle and relaunches. Electron's `autoUpdater` and `electron-updater` are not used because Squirrel.Mac only installs a build signed with the same Developer ID, and these builds carry no Apple certificate. Updating needs Cairn in a writable folder such as `/Applications`; run from the DMG or a translocated path, the button says so instead.
