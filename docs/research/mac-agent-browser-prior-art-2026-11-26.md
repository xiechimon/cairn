# Prior art: giving each agent a browser on a Mac (2026-11-26)

Question: how does dusk bot give every bot its own browser on a Mac with the least setup for a brand-new user, and what should Cairn copy?

Evidence labels: **measured** = read in the source or primary docs during this session (path + line or URL), **inferred** = derived from measured facts, **guess** = everything else.

Sources read:

- dusk bot: official site `https://dusk.bot` (repo `homepageUrl`), source `https://github.com/DuskBotAI/duskbot`, shallow clone at `34aa5b9a0c8f` (2026-11-25). The two directory listings in the brief (completeaitraining, skillsllm) were not used; the source answers everything.
- vercel-labs/agent-browser: README and `docs/content/docs/engines/chrome.mdx` on `main`, release `v0.45.0` (2026-11-25) assets, npm `agent-browser@0.45.0`.
- Electron: `docs/api/debugger.md`, `docs/api/session.md`, `docs/tutorial/offscreen-rendering.md` in `electron/electron`.
- Blocked: Google's 2019 developer blog post on blocking sign-in from embedded frameworks (`developers.googleblog.com/en/better-protection-against-man-in-the-middle-phishing-attacks/`) returned an empty body to curl. Every claim below about Google sign-in in embedded browsers is therefore a **guess**.

## dusk bot, question by question

### 1. Which engine runs the bot's browser

- **measured**: every bot browser is a **vercel-labs/agent-browser** daemon driving a Chrome-family binary over CDP. The server spawns `agent-browser mcp --tools core --no-webmcp` per bot session with a curated env (`server/browser-engine.ts` L604-650, return statement at L650). The pinned engine is agent-browser 0.37.0, 12,429,360 bytes for darwin-arm64 (`server/browser-engine-release.ts` L3, L20-21).
- **measured**: the desktop installer bundles that engine **plus Chromium Headless Shell 153.0.8010.47**, 98,668,949 bytes zipped for mac-arm64, into `Resources/browser-engine` (`docs/browser-packaging.md` "Package layout and lookup"; `server/browser-bundle-release.ts` L10-19).
- **measured**: at run time a Chrome is chosen once per machine (`server/browser/chrome/resolve.ts` L1-3, `installedGoogleChrome` L58-80; `docs/browser-packaging.md` "Which Chrome the bots' browser runs"):
  1. the user's installed **Google Chrome**, unless an organization manages it (`/Library/Managed Preferences/com.google.Chrome.plist`); the bot gets its own profile and the user's Chrome profile is never touched;
  2. otherwise **Chrome for Testing** (the full browser, not the headless shell) downloaded once into `tools/chrome/` in the data directory, pinned by size and SHA-256 (`server/browser/chrome/install.ts` L1, L23: 190,878,359 bytes for darwin-arm64);
  3. otherwise the bundled headless shell.
  The reason given: the headless shell "cannot pass for Chrome: its TLS handshake differs and it has no `window.chrome`" (`resolve.ts` L54-57).
- **measured**: an opt-in second engine, `browserEngine.engine: "chrome"` (default stays `agent-browser`, `server/browser/config.ts` L19, L38-39), is dusk bot's own CDP driver (`server/browser/cdp/*`). It launches Chrome on `--remote-debugging-pipe` (fd 3/4) so "nothing else can reach this Chrome's DevTools" (`server/browser/chrome/launch.ts` L34, L98-123).
- **measured**: a third option, **My Chrome**, attaches to the user's running Chrome 144+ after they switch on remote debugging at `chrome://inspect/#remote-debugging`. It uses agent-browser's `AGENT_BROWSER_AUTO_CONNECT` and never saves cookies across (`browser-engine.ts` L598-623; `docs/browser-packaging.md` "Signed-in sites and My Chrome"). It exists for sites that refuse the automated browser, Google sign-in named explicitly.
- **measured**: the bot browser is **not** an Electron webContents. `WebContentsView` in `electron/main.mjs` (L4, L1569, L2093, L3099) is used only for the app's own place rail and a paint cover; `webviewTag: false` (L2302).
- **measured**: "a full desktop" (Linux VM in Docker, cloud desktop, or the user's own macOS screen) is a separate computer-use feature, not the browser (`README.md` L92).

### 2. A Mac with no Chrome installed

- **measured**: the browser works on first launch with nothing to download, because the installer already carries agent-browser and the headless shell (`docs/browser-packaging.md`: "A fresh installation needs no separate browser download").
- **measured**: in the background, at first launch, Apple-silicon Macs without Google Chrome download Chrome for Testing (190.9 MB zip). A browser call made during the download waits up to 45 s, then says how far the download got. Platforms without a pin, and Linux desktops without Chrome, keep the headless shell (`docs/browser-packaging.md` "Which Chrome…", item 2-3).
- **inferred**: installer cost is about 111 MB compressed (12.4 + 98.7) on top of the app. On top of that, a Mac without Chrome takes a 191 MB download once.

### 3. Does the window show or steal focus; watch live and take control

- **measured**: the bots' browser always runs **headless**. `BrowserService` opens with `mode: "headless"` (`server/browser/service.ts` L255), the agent-browser env sets `AGENT_BROWSER_HEADLESS=1` unless told otherwise (`browser-engine.ts` L629-632), and headless adds `--headless=new` (`server/browser/chrome/flags.ts` L94). No Chrome window appears on the user's screen, so the user's focus is never taken (**inferred**).
- **measured**: to make headless Chrome look like headed Chrome, dusk bot reads the real user agent and client hints from the binary, adds `--disable-blink-features=AutomationControlled` and passes the real screen size and language. On macOS it adds `--use-mock-keychain`, so no keychain prompt appears (`docs/browser-packaging.md` "Identity"; `agent-browser.json` at repo root).
- **measured**: the live view is a **CDP screencast** streamed to the app's Computer/Browser panel over a WebSocket: JPEG frames, or H.264 when the user has an `ffmpeg` with libx264 installed. Each frame is acknowledged, so a slow viewer slows the screencast instead of queueing frames. The code is adapted from t3code's `ServerBrowserStream.ts` (`server/browser/viewers/stream-v2.ts` L1-10). Each viewer gets its own CDP session and its own screencast, and the panel's mouse and keys are dispatched into the page over CDP (`server/browser/viewers/core.ts` L1-9).
- **measured**: **Take control** is per tab. A person holds the tabs they took. A bot call on a held tab waits for the hand-back (bounded, cancellable) and then does not run. While the person answers a sign-in request, every bot call is refused. A takeover drains running work and revokes element refs (`server/browser/control.ts` L1-5). Only a person can take or release control (`README.md` L94).

### 4. Logins: persistence and "sign in without the AI seeing the password"

- **measured**: each bot has a persistent Chrome profile at `<data>/browser profiles/<sha256(session)[0..32]>`, passed as `AGENT_BROWSER_PROFILE` (`browser-engine.ts` L45-48, L628). agent-browser's saved state is also kept (`AGENT_BROWSER_RESTORE`, `AGENT_BROWSER_RESTORE_SAVE=auto`) and encrypted with `AGENT_BROWSER_ENCRYPTION_KEY` (L607-627). The own-driver engine keeps profiles under `<data dir>/browser`, keyed by a random per-workspace id so that a copied workspace never shares a cookie jar (`server/browser/chrome/profile.ts` L5-8, L33-48). Settings lists signed-in sites per profile, with Sign out per site.
- **measured**: the model calls **`fill_login`**. dusk bot types the username, password and TOTP itself, submits each step, and reports where the page went. "You never see the password." A login fills only on its own site (`server/drivers/agents-catalog.ts` L551-560). Secrets are read only at fill time. In-page scripts carry no secret and answer only booleans. Values go in as real typing over agent-browser's loopback relay, never on a command line (`server/login-fill.ts` L1-2, L10-16). For 60 s after a fill, page scripts (`agent_browser_eval`) are refused while a filled password may still be on the page (`login-fill.ts` L55; `server/browser/tools.ts` L166).
- **measured**: logins come from `"card" | "settings" | "1password"` (`shared/logins.ts` L14). The user enters them on a secure card in the app or a paired phone, never in chat (`agents-catalog.ts` L498). On the desktop they sit in an Electron `safeStorage`-encrypted `credentials.bin` (`electron/secure-credentials.mjs` L55-62).

### 5. How the model drives it

- **measured**: the model works from the accessibility tree with element refs. `agent_browser_open` "answer[s] with its snapshot: the page's accessibility tree with element refs (e12)". The snapshot is capped near 20 KB, and screenshots are a fallback "when the tree is not enough" (`server/browser/tools.ts` L150-154).
- **measured**: the tools the model sees are `agent_browser_status, open, navigate, snapshot, read, screenshot, click, fill, type, press, select, check, hover, drag, scroll, upload, wait, eval, dialog, tabs, close` (`tools.ts` L28-134, descriptions L149-169), plus `fill_login`. Aliases map older agent-browser names onto these (L196-212). Underneath, the calls go over MCP stdio to agent-browser, which speaks CDP to Chrome.

### 6. Headless server and unattended Mac

- **measured**: the same engine runs on a VPS, in Docker and on dusk cloud, headless. A displayless Linux host is forced headless (`browser-engine.ts` L617-618). Containers need `init: true` and `shm_size: 512m` (`docs/browser-packaging.md` "Containers").
- **measured**: on a Mac, "a sleeping computer runs nothing". While plugged in, the desktop app keeps the Mac awake for the hour before a due routine, and a missed run may start up to 12 h late (`README.md` L122).
- **inferred**: a locked but awake Mac still runs the bots' browser, because it is headless and needs no window, focus or screen.

## Contrast

**vercel-labs/agent-browser** (measured, README L13-26 and `docs/content/docs/engines/chrome.mdx`): a native Rust CLI. The npm package is a 349 KB shim, and the darwin native binary in v0.45.0 is 20,087,232 bytes (arm64) or 22,157,960 bytes (x64). It does **not** require system Chrome, but it needs some Chromium. With no `--executable-path`, it first checks the Chrome it downloaded with `agent-browser install`, then `/Applications/Google Chrome.app`, Chrome Canary, Chromium, Brave (and the same apps in `~/Applications`), then the Puppeteer and Playwright caches. When none is found, `agent-browser install` downloads Chrome for Testing. It can also attach to a running Chrome with `--cdp` / `--auto-connect`, or use Lightpanda, the iOS Simulator or cloud providers. **inferred**: the "~121 MB" figure in Cairn's earlier plan is not agent-browser itself (20 MB). It matches the Linux Chrome headless-shell zips (119.7 MB linux-x64, 120.2 MB linux-arm64 in dusk bot's pins); on a Mac the headless shell is 98.7 MB and the full Chrome for Testing is 190.9 MB.

**Electron's own webContents as the agent browser** (measured from Electron docs): a `WebContentsView` or offscreen `BrowserWindow` can host a page per agent, with `session.fromPartition('persist:<agent>')` giving each one a persistent cookie jar (`docs/api/session.md`). `webContents.debugger.attach()` is "an alternate transport for Chrome's remote debugging protocol" inside the main process, so CDP is available with no port and no extra binary (`docs/api/debugger.md`). Offscreen rendering yields frames without a visible window (`docs/tutorial/offscreen-rendering.md`). It downloads nothing. **inferred**: the costs are that it lives inside the Electron main process, not the daemon, so it stops when the app quits and cannot run on a headless Linux host; the bridge, tool layer and take-control would all have to be built against Electron's API instead of reusing agent-browser; its user agent and fingerprint are Electron's. **guess**: Google and some banks refuse sign-in from embedded frameworks (primary source blocked, see above). dusk bot, which ships an Electron app, still chose not to use webContents for bots (measured, section 1).

## Comparison

| Source | How it does it | Setup for a new Mac user | Trade-offs | Link |
|---|---|---|---|---|
| dusk bot (default) | agent-browser 0.37 daemon per bot over MCP stdio; headless Chrome; per-bot profile dir; CDP screencast live view with per-tab take control | None: engine + headless shell (~111 MB compressed) ship inside the installer; uses installed Google Chrome if present; else 191 MB Chrome for Testing downloaded once at first launch, in the background | Bigger installer; pins to review per Chrome security release; Windows needs a patched engine build; ffmpeg not bundled (JPEG live view without it) | https://github.com/DuskBotAI/duskbot/blob/main/docs/browser-packaging.md |
| dusk bot "My Chrome" | Attach to the user's running Chrome 144+ via auto-connect | User toggles remote debugging in `chrome://inspect` | Only desktop; bot acts only in tabs it opened; for sites that refuse automated browsers | same doc, "Signed-in sites and My Chrome" |
| dusk bot `engine: "chrome"` | Own CDP driver, Chrome on `--remote-debugging-pipe` | Same as default | Opt-in; a full driver to maintain | `server/browser/chrome/launch.ts` |
| vercel-labs/agent-browser | Rust CLI + daemon; finds system Chrome/Brave/Chromium/Playwright cache; else `agent-browser install` (Chrome for Testing) | 20 MB binary; no browser download if any Chromium exists | A browser must exist or be downloaded; headless by default | https://github.com/vercel-labs/agent-browser |
| Electron webContents | `WebContentsView` + `persist:` partition + `webContents.debugger` CDP | Zero download | Tied to the app process, not the daemon; no server or headless host; Electron fingerprint; separate tool stack | https://github.com/electron/electron/blob/main/docs/api/debugger.md |

## Pattern that fits Cairn

Cairn today: the daemon already drives `agent-browser` (`apps/daemon/src/computer/browser.ts` L16-17) and has an owner-Chrome path over MCP (`apps/daemon/src/computer/owner-chrome.ts`). `browser_*` is offered only on Linux hosts (from the brief; not re-checked here). The plan on the table, rejected by the owner as too heavy, was: the daemon downloads agent-browser plus a ~121 MB browser, and drives system Chrome or downloads Chrome for Testing.

What dusk bot shows (inferred from the measured facts above):

1. The heavy part is the Chrome binary, not agent-browser (12-20 MB). Most of the weight goes away by using an installed Google Chrome with a separate `--user-data-dir` per agent.
2. The browser that "just works" is headless Chrome plus a CDP screencast panel in the app. Nothing appears on the user's screen, nothing takes focus, it keeps running on a locked Mac and on a server, and take control is a panel interaction, not a window. This also matches t3code's preview stream, which dusk bot adapted.
3. The download is moved out of the user's way: ship the engine inside the installer and download Chrome only when it is missing, in the background, with the tool waiting a bounded time and reporting progress.
4. Electron webContents was available to dusk bot and it did not use it for bots.

## Recommendation for Cairn

Make the Mac path the same shape as the Linux path, and cut the weight:

1. **Ship the agent-browser binary inside the Mac app** (darwin-arm64 ~20 MB at v0.45; Cairn's existing pin may differ), signed with the app, so the daemon never downloads it. Pin size and SHA-256, as dusk bot does.
2. **Use the installed Google Chrome first** (LaunchServices lookup for `com.google.Chrome`, then `/Applications`, `~/Applications`), skipping it when `/Library/Managed Preferences/com.google.Chrome.plist` exists. Run it **headless** with a Cairn-owned profile dir per agent (or per task, if that is the unit), `--use-mock-keychain`, and the real user agent. Nothing to download for the common user.
3. **Only when no usable Chrome exists**, fetch the Chrome for Testing **headless shell** (98.7 MB for mac-arm64) **lazily on the first browser call, not at install**. The call waits a bounded time and says how far the download got, and the result is cached in Cairn's data dir. Do not bundle it in the DMG: unlike dusk bot, Cairn then pays the 99 MB only on Macs without Chrome. If the owner prefers the full-Chrome fingerprint for fallback Macs, the full Chrome for Testing costs 191 MB instead; ship that as a later step only if sign-in failures show up.
4. **Live view and take control in Cairn's UI** via a CDP screencast stream (t3code pattern, already proven by dusk bot), not a visible Chrome window. Keep the existing owner-Chrome attach as the fallback for sites that refuse automated browsers (Google sign-in), and the existing secret-fill path for passwords.
5. **Do not build the agent browser on Electron webContents**: it would split the browser between the app and the daemon, would not exist on Linux or remote runners, and would duplicate the agent-browser tool layer Cairn already has.

Net setup for a new Mac user who has Chrome: zero downloads, and about 20 MB added to the app. Without Chrome: one ~99 MB background download the first time an agent opens a page.
