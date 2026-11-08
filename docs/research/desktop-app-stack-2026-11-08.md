# Desktop app stack for cairn (2026-11-08)

> **Question.** cairn needs a desktop app now (D45, D100, D103, D105: a stranger installs it and gets a first PR in 10 minutes; the app bundles server, daemon, Coordinator and tsnet). Electron or something else, and how should the stack be chosen?
>
> **Marks.** **`实测`**: read or run first-hand in this session (shipped bundle unpacked, source at a pinned ref, official doc page, command output). **`推断`**: derived from `实测` and checkable. **`猜测`**: everything else.
>
> **Refs.** cairn `origin/main` `a2e2ebb51`. t3code `main` `8e6a73230` (2026-11-08). Bundles were downloaded from each vendor's official URL (the Homebrew cask URL where one exists) on 2026-11-08 and listed with 7-Zip 26.06; nothing downloaded was executed. Local runs used omarchy (Hyprland, Wayland, NVIDIA RTX 3060).
>
> **Not reopened.** D45 already says "wrap the existing web UI, do not rewrite". This note picks the wrapper and corrects one D45 premise (section 1.1).

## 1. What shipped apps actually use

### 1.1 Amp, the D45 reference

| Fact | Mark | Source |
|---|---|---|
| The macOS DMG is **14.9 MB** (`content-length: 14939759`); unpacked it is **27.6 MB**. The plan's "21 MB" is between the two, so the order of magnitude holds. | `实测` | `https://static.ampcode.com/mac/latest.dmg`, `7zz l` |
| It is a **native Swift app**: `MacOS/Amp` links `SwiftUI`, `AppKit`, `WebKit` and `_WebKit_SwiftUI`; the binary is 9.6 MB. Updates use **Sparkle** (`SUFeedURL https://static.ampcode.com/mac/appcast.xml`, EdDSA key). No Chromium, no Node runtime. Requires macOS 26 and Apple silicon. | `实测` | `Contents/Info.plist`, `strings Contents/MacOS/Amp`; [docs/apps/mac](https://ampcode.com/docs/apps/mac) |
| The Windows app is a different native shell: the portable zip is 612 KB, `Amp.exe` (1.4 MB) plus `WebView2Loader.dll`. It is labelled experimental. There is **no Linux desktop app**. | `实测` | `https://static.ampcode.com/windows/Amp-windows-x64.zip`; [docs/apps](https://ampcode.com/docs/apps) |
| **Amp's app does not bundle a daemon.** "Use This Mac as a Runner" runs `amp --no-tui --no-serve-cwd --runner-id <name>` using the Amp CLI the user already installed, found through the login shell `PATH`; if missing, the app sends the user to the install page. | `实测` | [docs/apps/mac/runner](https://ampcode.com/docs/apps/mac/runner) |
| So Amp gets 15 MB because it ships no backend at all. cairn must ship a Node server, a Node daemon and a Go sidecar, so Amp's size is not reachable for cairn on any framework. | `推断` | the two rows above; D100 |

### 1.2 Comparison of shipped apps

| Product | Shell | How the backend ships | SQLite | Updater | Platforms | Download | Mark / source |
|---|---|---|---|---|---|---|---|
| Amp | Swift + WKWebView (Mac), native exe + WebView2 (Win) | none in the app; uses the user's `amp` CLI | n/a | Sparkle; Windows App Installer | Mac, Win (exp.) | 14.9 MB DMG | `实测`, 1.1 |
| Claude desktop 4.23118 | **Electron 44.9.3** (Chrome 152) | `app.asar` with native `node-pty` and `@ant/claude-native`; Claude Code binary downloaded per version into `~/.config/Claude/claude-code/<ver>/` | n/a | (Omarchy package on Linux) | Mac, Win, Linux | Mac zip 391 MB; Linux install 624 MB | `实测`: `/usr/lib/claude-desktop`, `strings`, asar `package.json`; [Homebrew cask](https://formulae.brew.sh/api/cask/claude.json); running process args |
| Codex app 26.623 | **Electron 42.1.0**, framework renamed `Codex Framework` | `app.asar` (165 MB) plus a bundled `codex` Rust binary (249 MB) in `Resources` | **`better-sqlite3`** plus `node-pty`, unpacked by `@electron-forge/plugin-auto-unpack-natives` | **Sparkle** (`codexSparkleFeedUrl`), not Squirrel | Mac; makers for deb, rpm, MSIX present | 535 MB zip | `实测`: asar `package.json`, `7zz l`; [cask](https://formulae.brew.sh/api/cask/codex-app.json) |
| ChatGPT desktop 26.1103 | **Electron**: the current Homebrew `chatgpt` cask downloads `ChatGPT-darwin-arm64-*.zip` from `codex-app-prod`, bundle id `com.openai.codex`, asar name `openai-codex-electron`, Chromium 157 | same as Codex plus `CodexCLI.app` | as Codex | Sparkle | Mac | 815 MB zip | `实测` (cask and bundle). That the earlier native-Swift ChatGPT app is retired is `猜测` |
| Cursor 3.29.9 | **Electron** (VS Code fork; Arch package runs system `electron42`) | extensions host an `agent-host-daemon` started with `ELECTRON_RUN_AS_NODE` | `@vscode/sqlite3` and **`better-sqlite3`** (in `cursor-agent-exec`) | (pacman on Arch) | Mac, Win, Linux | 544 MB installed | `实测`: `/usr/share/cursor/resources/app`, `find -name '*.node'`, `grep ELECTRON_RUN_AS_NODE` |
| VS Code 1.145.1 | **Electron 43.8.3** | extension host is Electron's Node | `@vscode/sqlite3` | Squirrel / own | Mac, Win, Linux | 1.1 GB installed | `实测`: `strings /usr/share/code/code` |
| Linear 1.32.8 | **Electron 44.9.1** | none (cloud product) | n/a | **Squirrel.Mac** (`Squirrel.framework`) | Mac, Win | 234 MB universal DMG | `实测`: framework `Info.plist`, `7zz l`; [cask](https://formulae.brew.sh/api/cask/linear.json) |
| **t3code** 0.1.7 | **Electron 44.10.1**, electron-builder 26, `electron-updater` | server `apps/server/dist/bin.mjs` spawned with `process.execPath` and **`ELECTRON_RUN_AS_NODE=1`**, bootstrap over fd 3; Rust helpers in `native/` as sidecars | **`node:sqlite`** (13 imports), no native SQLite module | electron-updater (`latest-*.yml`); Windows signed with Azure Trusted Signing (`AZURE_TRUSTED_SIGNING_*`) | Mac, Win, Linux (AppImage, deb) | DMG 188 MB, AppImage 191 MB | `实测`: `apps/desktop/package.json`, `apps/desktop/src/backend/DesktopBackendConfiguration.ts:523-537`, [release v0.1.7](https://github.com/pingdotgg/t3code/releases/tag/v0.1.7) |
| t3code remote access | calls the system `tailscale` CLI (`tailscale status`, `serve --https`), not tsnet | | | | | | `实测`: `packages/tailscale/src/tailscale.ts:13-21,156` |
| **OpenCode desktop** 2.2.5 | **Electron 44.9.1**, electron-builder, electron-updater. **Moved off Tauri**: PR #25822 (merged 2026-05-05) deleted `src-tauri/` and "replac[ed] the Tauri-based implementation" | `opencode-cli` single binary in `extraResources` as a sidecar | sqlite via the CLI | electron-updater, generic provider | Mac, Win, Linux (AppImage, deb, rpm) | DMG 152 MB, AppImage 160 MB | `实测`: [package.json](https://github.com/anomalyco/opencode/blob/dev/packages/desktop/package.json), `electron-builder.config.ts:104-109`, [#25822](https://github.com/anomalyco/opencode/pull/25822), [#15663](https://github.com/anomalyco/opencode/pull/15663). The PR gives only "consistency/maintenance" as the reason; one closed bug, [#43299](https://github.com/anomalyco/opencode/issues/43299), is "missing scrollbars in the Tauri WebView on Linux" |
| **Conductor** 0.93.0 | **Tauri 2.11.1** (wry 0.55.1) with plugins updater, deep-link, sql, shell, notification | `bin/.internal/conductor-runtime` is a **Bun 1.4.4 compiled** binary (104 MB), plus bundled `gh` (40 MB) | `tauri-plugin-sql` and `bun:sqlite` | `tauri-plugin-updater` (CrabNebula CDN) | **Mac only** | 100 MB tar.gz | `实测`: `strings Contents/MacOS/conductor`, `strings conductor-runtime`; [cask](https://formulae.brew.sh/api/cask/conductor.json) |
| Raycast 2.11.1 | **Native Swift + WKWebView** with a web `frontend/` bundle, plus a Rust `libraycast_host.dylib` | backend `index.mjs` on a **bundled Node** (`node-v26.12.1-darwin-arm64.tar.gz`, 44 MB) with native `.node` modules | (native modules) | own `Updater` | Mac (this build) | 158 MB DMG | `实测`: `7zz l`, `strings` on both binaries |
| Zed 1.27.0 | **Native Rust GPUI**, own GPU renderer; Linux has `wayland.rs` and `x11.rs` backends | Rust | Rust | own | Mac, Win, Linux | DMG 88 MB | `实测`: [crates/gpui_linux/src/linux](https://github.com/zed-industries/zed/tree/main/crates/gpui_linux/src/linux), [release v1.27.0](https://github.com/zed-industries/zed/releases/tag/v1.27.0) |
| Warp | **Native Rust**, own `warpui` framework (repo AGPL-3.0/MIT) | Rust | Rust | own | Mac, Win, Linux | AppImage 150 MB | `实测`: [warpdotdev/warp/crates](https://github.com/warpdotdev/warp/tree/main/crates); download `size_download` |

**Pattern (`推断` from the table).** Every product that ships a JavaScript backend inside a cross-platform app with Linux support (t3code, OpenCode, Codex, Cursor, VS Code, Claude) uses Electron and runs the backend either on Electron's own Node (`ELECTRON_RUN_AS_NODE`) or as a compiled sidecar binary. The two lean shells are Amp (no backend, no Linux) and Conductor (Tauri, Mac only, so it never meets WebKitGTK). OpenCode is the one product found that shipped Tauri on all three OSes and then replaced it with Electron. Native-UI products (Zed, Warp) rewrote the UI, which D45 rules out.

## 2. Frameworks against cairn's requirements

cairn's shape (`实测`): `apps/server` is Hono + **`better-sqlite3` 13.0.3** (`apps/server/src/db/client.ts:4`, drizzle) with `engines.node >=22.19.0`; `apps/daemon` is pure JS deps (pi packages, `@anthropic-ai/claude-agent-sdk`, MCP SDK); `apps/tsnet-sidecar` is already a Go binary that the server spawns and talks to over stdin/stdout JSON with Unix-socket upstreams (`apps/tsnet-sidecar/README.md`, `apps/server/src/lib/tsnet-sidecar.ts:162`); `apps/web` is a React SPA the server already serves.

### 2.1 Local measurements on omarchy

| Measurement | Result | Mark |
|---|---|---|
| `better-sqlite3` 13.0.3 ships `prebuilds/{darwin,linux,linuxmusl,win32}-{x64,arm64}.node`. The same `linux-x64.node` loads and runs `select sqlite_version()` (3.53.4) under Node 24.14.0 (ABI 137) **and** under Electron 43.8.3's Node 24.22.0 (ABI 148). No `@electron/rebuild` needed. | works on both | `实测` (`node -e`, `ELECTRON_RUN_AS_NODE=1 electron43 -e`) |
| Electron 43 also has `node:sqlite` built in (SQLite 3.53.4). | works | `实测` |
| Electron 43, `--ozone-platform=wayland`, hidden 1280x800 window loading cairn's own UI from `127.0.0.1:8787`: 6 processes, **338 MB PSS**. | loads | `实测`. Hidden window, so painting may be throttled |
| WebKitGTK 2.54.1 (the engine Tauri, Wails, Neutralino and Electrobun-without-CEF use on Linux): both a PyGObject WebView and the stock `MiniBrowser` **crashed at start** with `Error 71 (Protocol error) dispatching to Wayland display`. With `WEBKIT_DISABLE_DMABUF_RENDERER=1` MiniBrowser loaded the same page: 7 processes, **484 MB PSS**. | crash by default on ian's own desktop; no memory win | `实测`. Visible window, so not a like-for-like memory number; the crash is the finding |
| Bundle floor: Electron 43.8.3 release zips are 124 MB (darwin-arm64), 127 MB (linux-x64), 151 MB (win32-x64). | | `实测`: [release v43.8.3](https://github.com/electron/electron/releases/tag/v43.8.3) |
| The daemon's `@anthropic-ai/claude-agent-sdk-linux-x64` platform package is **224 MB** on disk (the bundled Claude Code binary). The daemon passes `pathToClaudeCodeExecutable` only when configured (`apps/daemon/src/backend/claude-code.ts:994-996`). If the app bundles it, it outweighs the whole Electron runtime. | | `实测` (`du`, source) |

### 2.2 Framework table

| Criterion | **Electron** | **Tauri 2** (v2.12.5; v3 alpha.6) | **Electrobun** v2.0.6 | **Wails** v3.1.0 | **Neutralino** v6.10 | **Swift shell + webview** | **Flutter desktop** |
|---|---|---|---|---|---|---|---|
| Renderer on Linux | bundled Chromium | WebKitGTK; CEF runtime only in v3 alpha with open Linux bugs (e.g. [#16249](https://github.com/tauri-apps/tauri/issues/16249)) | system WebKitGTK, or `bundleCEF` | WebKitGTK (GTK3/GTK4) | WebKitGTK | none (Mac only) | own Skia/Impeller; no web reuse |
| Bundle floor | ~124-151 MB zip (`实测`) | single-digit MB shell (Conductor 69 MB binary incl. app code, `实测`) | small with system webview; +Chromium with CEF (README, `实测`) | small (`猜测`, not measured) | small (`猜测`) | Amp 27.6 MB unpacked (`实测`) | ~20-40 MB (`猜测`) |
| Memory | 338 MB for cairn UI (`实测`, hidden) | WebKitGTK 484 MB for the same page (`实测`, visible), so no clear win on Linux | as Tauri or Electron | as Tauri | as Tauri | WKWebView, lower (`猜测`) | n/a |
| Running cairn's Node server and daemon | **Electron's own Node**: `utilityProcess` ("child process with Node.js and Message ports", [docs](https://www.electronjs.org/docs/latest/api/utility-process)) or `ELECTRON_RUN_AS_NODE` (t3code, Cursor, `实测`). One runtime, no extra binary | sidecar via `bundle.externalBin` with `-<target-triple>` names; docs suggest `@yao-pkg/pkg` or embedding Node ([sidecar](https://v2.tauri.app/develop/sidecar/), [Node sidecar](https://v2.tauri.app/learn/sidecar-nodejs/), `实测`) | main process **is Bun**; server would run on Bun | Go main; Node as sidecar | "extensions" are child processes; Node shipped separately | bundled Node tarball (Raycast, `实测`) | sidecar |
| `better-sqlite3` | prebuild loads as is (`实测` 2.1) | inside the sidecar: Node SEA cannot `dlopen` from its VFS and must copy the `.node` to disk first ([SEA docs](https://nodejs.org/api/single-executable-applications.html#native-addon-limitations), `实测`) | Bun issues on better-sqlite3 open/closed ([#8895](https://github.com/oven-sh/bun/issues/8895), [#24956](https://github.com/oven-sh/bun/issues/24956)); would mean porting to `bun:sqlite` (`推断`) | as Tauri | as Tauri | bundled Node, works (`推断`) | as Tauri |
| Go tsnet sidecar | `extraResources`, spawned by server as today | `externalBin` | resource | **could run in-process** (Go) | extension | resource | resource |
| Auto-update | Squirrel.Mac and Squirrel.Windows built in; **"no built-in support for auto-updater on Linux"** ([docs](https://www.electronjs.org/docs/latest/api/auto-updater), `实测`); `electron-updater` adds Linux AppImage, rpm, deb ([README](https://github.com/electron-userland/electron-builder/blob/master/packages/electron-updater/README.md), `实测`); Codex uses Sparkle instead | `tauri-plugin-updater`; on Linux it updates the **AppImage** only ([docs](https://v2.tauri.app/plugin/updater/), `实测`) | bsdiff patch updates on Mac, Win, Linux (docs, `实测`) | `v3/pkg/updater` exists (`实测`, untested) | `Neutralino.updater` (resource-level, `实测`) | Sparkle | none built in |
| Signing / notarization | `@electron/notarize`, Forge or builder; Windows via Azure Trusted Signing (t3code, OpenCode) | built-in `tauri build` signing ([distribute/sign](https://v2.tauri.app/distribute/)) | Hutch handles signing (docs) | manual (`猜测`) | manual (`猜测`) | Xcode | Xcode / signtool |
| Wayland | native Ozone Wayland works here (Electron 43 and Claude 44 run with `--ozone-platform=wayland`, `实测`) | WebKitGTK crashed here without an env var (`实测`) | as Tauri unless CEF | as Tauri | as Tauri | n/a | supported (`猜测`) |
| Tray, deep links, global shortcuts | `Tray`; protocol links via `second-instance` on Win/Linux ([docs](https://www.electronjs.org/docs/latest/tutorial/launch-app-from-url-in-another-app), `实测`); `globalShortcut` uses the **xdg GlobalShortcuts portal on Wayland**, on by default, needs `desktopName` ([docs](https://www.electronjs.org/docs/latest/api/global-shortcut), `实测`) | plugins for all three ([global-shortcut](https://v2.tauri.app/plugin/global-shortcut/), deep-link) | trays and menus on 3 OSes (docs) | tray, single-instance, Linux portal and X11 shortcuts (`v3/pkg/application/global_shortcut_linux_portal.go`, `实测`) | tray yes (`猜测`) | full | plugins |
| Maturity for this shape | 6 of 6 JS-backend peers above (`实测`) | Conductor (Mac only); OpenCode left it (`实测`) | v2, one-person-led, 13k stars (`实测`) | v3.0.0 stable 2026-10-26 (`实测`), few shipped agent apps found | niche | Amp, Raycast (Mac only) | no web reuse |
| `apps/web` reuse | 100%: load the server's own origin | 100% if WebKitGTK renders it right | 100% / CEF | 100% / WebKitGTK | 100% / WebKitGTK | Mac only; needs Win + Linux shells too | 0% |

**Webview consistency.** cairn's UI is tuned against claude.ai in Chrome. `apps/web/src` uses `field-sizing` (3 files), `@container` (2), `color-mix` (6), `backdrop-filter` (3), `popover` (33), plus Tailwind v4 (`oklch`, `@property`) (`实测`, `grep`). Whether WebKitGTK 2.54 renders all of these the same as Chromium is unknown (`猜测`), and it would be a second engine to screenshot-test on every UI PR. With Electron every OS runs the engine cairn already tests in Playwright Chromium (`推断`).

## 3. Choice criteria (reusable)

Apply in order. A later criterion only breaks ties left by an earlier one.

1. **Hard constraints first.** List the target OSes and the runtimes you must ship. Drop any option that cannot meet them. For cairn: Mac, Windows and Linux (ian runs omarchy), plus a Node backend with a native SQLite module and a Go binary. This drops the Swift shell (Mac only) and Flutter (no web reuse).
2. **Fidelity on the worst platform.** Test the real UI on the weakest target, not the best. For cairn that is Linux Wayland, where WebKitGTK crashed on ian's own desktop (2.1).
3. **Reuse.** Prefer the option that runs today's code unchanged: same runtime, same native modules, same UI engine as CI tests.
4. **Peer proof.** Find products that ship the same shape (backend type × platforms) and read their bundles, not their blog posts. Count switches away from an option as strong evidence.
5. **Pipeline maturity.** Update, sign, notarize, installer formats and crash reporting must already exist for every target OS.
6. **Cost metrics last.** Bundle size and memory break ties only, and only when the gap is real for this payload. Here the payload (Node backend, possibly a 224 MB Claude binary) dominates any shell difference.
7. **Reversibility.** Prefer the option whose UI and backend stay portable, so a later switch only replaces the shell.

## 4. Recommendation for cairn

**Electron**, with the server, daemon and Coordinator running on Electron's own Node, the existing Go tsnet sidecar shipped as a resource, and the window loading the bundled server's own origin.

| Decision | Choice | Why | Mark |
|---|---|---|---|
| Shell | Electron (current stable major) | the only option that passes criteria 1-5; t3code, OpenCode and Codex ship this shape | `推断` from 1.2, 2.2 |
| Backend process | `utilityProcess.fork` for the server (Node with MessagePort; keeps the RunAsNode fuse off). Fall back to t3code's `ELECTRON_RUN_AS_NODE` spawn if a `utilityProcess` limit appears in the spike | one runtime; the `better-sqlite3` prebuild already loads under Electron's Node | `实测` (load), `推断` (choice) |
| SQLite | keep `better-sqlite3` 13 now; `node:sqlite` (release candidate since Node v25.7.0, [docs](https://nodejs.org/api/sqlite.html), `实测`) is the later exit that removes the native module, as t3code did | no migration needed to start | `实测` |
| tsnet | ship `tsnet-sidecar-<os>-<arch>` in `extraResources`; the server keeps spawning it as today; Windows needs the AF_UNIX upstream checked | already built this way | `推断` |
| Window content | `BrowserWindow.loadURL('http://127.0.0.1:<port>')` of the bundled server, same SPA as the browser and phone | 100% `apps/web` reuse, one origin for auth | `推断` |
| Packaging and update | electron-builder + electron-updater (DMG/zip, NSIS, AppImage/deb/rpm), as t3code and OpenCode; Arch users can also get a PKGBUILD later | Linux auto-update is covered only for AppImage, deb, rpm | `实测` (docs) |
| Signing | Apple Developer ID + notarization; Windows Azure Trusted Signing | both cost money: **ian's call** (payment) | `实测` (peers use them) |
| Claude Code binary | do not bundle the 224 MB SDK platform package; use the user's installed `claude` through `pathToClaudeCodeExecutable`, as Amp uses the user's `amp` CLI | halves the download | `推断` |
| Tray / menu bar | Electron `Tray` showing server, daemon and tsnet status; quitting the window keeps the backend running | D45 tray requirement | `推断` |

**Code areas touched.** A new `apps/desktop` (main, preload, builder config); a server entry that accepts a port, data dir and parent-pipe readiness signal (`apps/server/src/index.ts` or equivalent, plus `apps/server/src/db/client.ts` for the data path); the daemon started in-process or as a second `utilityProcess` with the machine registration token handed over locally (`apps/daemon/src/credentials.ts` and `apps/server/src/routes-machine.ts` are **owner-routed security surfaces**); `apps/server/src/lib/tsnet-sidecar.ts` binary-path resolution; CI release workflows for three OSes. The CLAUDE.md seam rule ("GitOps, MCP and LLM provider access behind `apps/daemon/src/backend/`") does not change.

### Risks

| Risk | Mitigation | Mark |
|---|---|---|
| Size: about 130 MB Electron plus backend `node_modules`, so a 150-250 MB download, ten times Amp | accepted; peers are 150-800 MB. Drop the bundled Claude binary; prune `node_modules` with the bundler | `推断` |
| Memory: Electron plus server plus daemon resident on an always-on machine | measure in the spike; server and daemon are already resident today, so the net add is the renderer (about 340 MB with a window open, 0 when the window is closed and only the tray remains) | `实测` (338 MB), rest `猜测` |
| Electron's Node major differs from the server's tested Node (24.22 vs fnm 24.14) | pin Electron to a major whose Node matches `engines`; run the server test suite under `ELECTRON_RUN_AS_NODE` in CI | `实测` (versions) |
| Linux tray on Wayland depends on StatusNotifierItem support in the bar (waybar on omarchy) | verify in the spike | `猜测` |
| Windows: Unix-socket upstreams for tsnet, path handling, Defender on unsigned builds | spike step 6; signing decision | `猜测` |
| Two backends talking to one SQLite file if a user also runs the CLI server | single-instance lock plus server-ownership check (t3code has `serverOwnership.ts`) | `推断` |

## 5. One-day spike

Goal: prove the Electron shape end to end on omarchy and the Mac, with numbers. Work on a branch in a new worktree, no merge.

1. `apps/desktop` with Electron (latest stable), electron-builder, main process only. (1 h)
2. Start the built server with `utilityProcess.fork(serverEntry, ['--port', '0', '--data-dir', userData])`; wait for a ready message; `loadURL` its origin. Pass: the first screen renders and `/api` calls succeed. (2 h)
3. Confirm `better-sqlite3` loads from `app.asar.unpacked` in the packaged build (not just dev) and migrations run into `userData`. (1 h)
4. Spawn the daemon the same way and register it as this machine; run one real task to a PR on a scratch repo. Pass: the D105 path works without a terminal. (2 h)
5. Ship `tsnet-sidecar` in `extraResources`; server spawns it; `authUrl` opens in the default browser. (1 h)
6. Package AppImage (omarchy) and an unsigned DMG (Mac). Record download size, installed size, cold start to first paint, PSS with window open and with only the tray, and Wayland tray behavior. (1 h)
7. Same page in a Tauri 2 window on omarchy for 30 minutes: screenshot the five main screens against Electron. Pass for Electron is confirmed if WebKitGTK shows any visible difference or needs `WEBKIT_DISABLE_DMABUF_RENDERER` to start. (30 min, optional)

Exit: if steps 2-4 fail on `utilityProcess`, retry with `ELECTRON_RUN_AS_NODE` (t3code's proven path) before considering any other framework.

## 6. Open items

- Apple Developer Program and Windows signing accounts are payments; ian decides.
- Claude desktop's macOS build was not unpacked; that it is the same Electron build as the Linux package is `推断` from the shared `@ant/desktop` version.
- Wails, Neutralino and Flutter sizes and memory were not measured (`猜测` above).
