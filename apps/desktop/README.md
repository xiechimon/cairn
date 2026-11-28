# Cairn desktop

An Electron shell for macOS, Windows x64, and Linux x64. The main process starts the bundled Cairn server on Electron's own Node with `utilityProcess.fork`, bound to `127.0.0.1` on a free port with `CAIRN_HOME` under the app's `userData` directory, waits until it answers, and opens its web UI in a window. The server writes its owner token to `CAIRN_HOME/token`; the main process reads it and adds `Authorization: Bearer <token>` only to requests whose initiator is the app's own origin, so the window signs in as the owner on macOS, where the server's loopback owner check is Linux-only. `CAIRN_TOKEN` and `CAIRN_AUTH` are removed from the server's environment so the token file is always the one in use. Once the server answers, the main process enrolls this computer as the server's local Runner: it starts an enrollment and confirms it with the owner token (`/api/machine/enroll/start` and `/confirm`, the same pair the browser approval uses), writes the returned `machine.json` (mode 0600, in a 0700 directory) under `userData/runner`, and starts the bundled daemon with `cairn start --foreground --server <origin>`. The daemon runs on Electron's binary with `ELECTRON_RUN_AS_NODE=1`, so anything it starts through `process.execPath` is Node too; it is restarted up to five times if it exits, and the enrollment is repeated at every launch, which rotates the machine token. Links to other origins open in the default browser. A menu bar icon (`assets/trayTemplate*.png`, drawn from `apps/web/public/logo-mark.svg`) shows the server address and offers Open Cairn, task-scoped keep-awake choices and Quit Cairn. The default keeps the computer awake only while a claimed step is in flight and lets the screen sleep; the menu can keep the screen on instead, or on AC-powered macOS request lid-closed running. Nothing is held while no task is in flight. Closing the window only hides it and the server keeps running; the Dock icon or Open Cairn brings it back. Quitting the app stops the Runner and then the server with SIGTERM and removes the icon.

## Telemetry

The server's stdout and stderr (the main process pipes them instead of inheriting them, since a Finder launch has no terminal) are written to `~/Library/Application Support/@cairn/desktop/logs/server.log`, and the main process's own `console` output to `logs/main.log`. Each file is mode `0600`, capped at 5 MB, and keeps one backup (`server.log.1`, `main.log.1`); the Runner keeps writing `runner/daemon.log` itself. Complete lines pass through a redactor that replaces the owner token and the `CAIRN_OTEL_HEADERS` values with `[redacted]` before they reach disk.

Export to an OTLP collector such as Langfuse is off unless `~/Library/Application Support/@cairn/desktop/otel.env` exists. It is dotenv text with `CAIRN_OTEL_ENDPOINT`, optional `CAIRN_OTEL_HEADERS` and optional `CAIRN_OTEL_ENVIRONMENT` (default `mac`), and must be mode `0600`; a file readable by others is ignored. The main process reads it once at launch and passes the file path to the server and the Runner as `CAIRN_OTEL_ENV_FILE`; the header secret never enters a child process environment (a same-UID session can read another process's environment block through `KERN_PROCARGS2`). Each side reads the file itself and takes only the three `CAIRN_OTEL_*` keys. Quit and reopen Cairn after editing it. Design: `docs/design/desktop-otel-export.md`; reaching the deployment's Langfuse from a Mac: `docs/ops/langfuse.md`.

macOS (arm64 and x64), Windows x64, and Linux x64 packages are released automatically. Linux x64 ships as a portable tar.gz archive; in-app automatic updates cover macOS and Windows. The research behind the stack is `docs/research/desktop-app-stack-2026-11-08.md`.

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

The real-click command `pnpm --filter @cairn/desktop smoke` requires an isolated macOS GUI session with `CAIRN_SMOKE_ISOLATED_SESSION=1` set explicitly: it launches `release/mac-arm64/Cairn.app` with Playwright, checks that the window is on the loopback server, that `/api/teams` answers 200 without a pairing step, that no pairing gate shows, and that a `local` machine comes online within 90 seconds, saves `release/smoke.png`, then checks that closing the window hides it while the server keeps answering and that quitting stops the server and the Runner. The `desktop-mac` workflow runs the same steps on a macOS runner for changes under `apps/desktop` and uploads `Cairn-<version>-mac-arm64.dmg` and `smoke.png` as unzipped artifacts.

The `electron` package's install script is disabled in `pnpm-workspace.yaml`, so `pnpm install` does not download Electron. To run `pnpm --filter @cairn/desktop start` locally, run `node apps/desktop/node_modules/electron/install.js` once.

### Linux x64 archive

Run the same web, server, Runner build and staging commands above, then replace `dist:mac` with:

```bash
pnpm --filter @cairn/desktop dist:linux
mkdir -p "$HOME/.local/opt/cairn"
tar -xzf apps/desktop/release/Cairn-0.0.0-linux-x64.tar.gz -C "$HOME/.local/opt/cairn" --strip-components=1
"$HOME/.local/opt/cairn/cairn"
```

The archive bundles Electron, the server and Runner, so running it does not require Node.js. It needs a graphical Linux session. It chooses a free loopback port and keeps its data under `$XDG_CONFIG_HOME/@cairn/desktop` (normally `~/.config/@cairn/desktop`). Use an independent `HOME` and `XDG_CONFIG_HOME` to test without importing existing model logins or app data. This command never publishes a release. Quit Cairn to stop its server and Runner.

The bundled Runner includes pi. In **Connect models → OpenAI Codex**, follow the browser device-login prompt; no separate Codex CLI or pi install is needed. With only Codex connected on fresh data, **Confirm settings** shows GPT-6.1 Sol for Coordinator and Tasks, with pi executing tasks. Confirm, then create a local Git project and ask for a small change. See [the first-result steps](../../README.md#connect-a-model-and-get-your-first-result). Claude Code is optional and needs its own installed CLI plus a subscription token connected in Model services. Devin is downloaded only for an enabled, unexpired Devin subscription.

Run `pnpm --filter @cairn/desktop smoke:linux /absolute/path/to/cairn-linux/cairn /absolute/path/to/smoke.png` to check an extracted archive. The single-process Playwright check creates a fresh HOME and app data directory, checks owner sign-in and that the Runner comes online, quits the app, checks that the server and Runner stopped, and removes its temporary data. It does not log in to a model or claim a first task result.

## Releases

`desktop-release` publishes signed macOS ARM64 and x64 DMG and update ZIP files, Windows x64 installer and ZIP files, Linux x64 archives, and the update manifests. A completed `main` CI run wakes it; a 15-minute schedule and manual dispatch to `main` are backstops. Eligible builds can overlap. Every package carries its reserved version, and failed releases may leave version gaps. Publication waits for all checks, including migration from the preceding stable release, then rechecks ancestry and exact-SHA CI before advancing the update channel. Use a fresh dispatch, not a rerun, to retry. See the [release contract](../../docs/design/tested-sha-landing.md#desktop-release) for operator details.

## Updates

Each release also carries `desktop-latest.json` (`scripts/release-manifest.mjs`): the version and, per arch, the zip's name, size and SHA-256. The packaged app reads `https://github.com/xiechimon/cairn/releases/latest/download/desktop-latest.json` 10 seconds after launch, every hour, and when a window gains focus at least 10 minutes after the last check; this is a release download, not the REST API, so the API's 60-requests-per-hour limit for unauthenticated callers does not apply, and a latest release without the file (HTTP 404) means no update. `desktopUpdateFrom` in `@cairn/shared` turns a newer manifest into the zip URL for the running arch. The sidebar's bottom-left button (desktop only, through the `cairnDesktop` preload bridge) shows the state; clicking "Update to …" downloads the zip next to the running bundle, checks its SHA-256, unpacks it with `ditto`, swaps the bundle only when the unpacked app is signed with the committed Cairn certificate, and relaunches. Electron's `autoUpdater` and `electron-updater` are not used because Squirrel.Mac only installs a build signed with the same Developer ID, and these builds carry no Apple certificate. Updating needs Cairn in a writable folder such as `/Applications`; run from the DMG or a translocated path, the button says so instead.
