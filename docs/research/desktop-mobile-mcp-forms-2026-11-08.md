# Desktop app, mobile and MCP management: what form each takes (2026-11-08)

Publication note: restored historical research, with private details redacted. Evidence labels describe the original research session; recommendations are not implementation approval or current policy.

> **Question.** This research considers three product surfaces: a desktop client, an Android web/PWA client (native iOS deferred), and an MCP view that shows which servers each machine has (a marketplace maybe later). For each: what form, what it can do, how to build it, and what to leave out. The product stays lean: the smallest form that supports daily use.
>
> **Marks.** **measured**: read or run first-hand in this session (doc page, source at a pinned ref, live API response, command output, page operated in Chrome). **inferred**: derived from measured and checkable. **unverified**: everything else.
>
> **Refs.** cairn `origin/main` `28ff79ae9`. t3code `main` `ade4730` (2026-11-08). Claude Code 2.1.319 and codex-cli 0.167.0 run locally. Docs fetched 2026-11-08.
>
> **Builds on.** `docs/research/desktop-app-stack-2026-11-08.md` (Electron chosen for the shell; not reopened here). Spec 30 (`docs/spec/30-harness-profile-opt-in.md`) for MCP definitions across machines.
>
> **Blocked sources.** claude.ai connector directory page (`claude.ai/directory`): Cloudflare "verify you are human" checkbox in the research browser; agents do not solve CAPTCHAs. Covered instead by the Claude Code docs and by the connector registry the Claude session itself queries (measured, section 3.1). The Claude desktop app, Codex app, Cursor app and Linear app were not operated (no desktop-control session was available); their rows rest on first-party docs and, for the desktop shells, on the bundle analysis in the stack note. Smithery's connection product shut down on 2026-10-31, so only its shutdown notice is read.

## 0. What cairn has today (measured)

| Surface | State on `origin/main` | Source |
|---|---|---|
| Desktop app | `planned`. Feature map: "a web shell that bundles the server, daemon, Coordinator and tsnet, so installing it makes the machine an executor"; gaps: no design for tray, window, install, packaging, updates, data location | `.claude/skills/verify-cairn/feature-map.json` id `desktop-app`; stack note |
| Mobile web / PWA | `shipped`. `manifest.webmanifest` (standalone, `launch_handler: navigate-existing`, maskable icons, screenshots). `sw.js` has **no fetch handler** by design, handles `push` (title/body/tag, posts a delivery receipt to `/api/teams/:id/push/receipts`) and `notificationclick` (persists the href to CacheStorage, then focuses or opens a window). `push-device.ts` does VAPID subscribe/unsubscribe per device. Server side: `services/push.ts`, `push-alerts.ts` (delivery rows plus an SMTP fallback when push is not confirmed), `thread-push.ts`, and `pwa/thread-presence.ts` (a visible tab heartbeats presence, so the thread being viewed is not pushed) | `apps/web/public/sw.js`, `apps/web/src/pwa/*`, `apps/server/src/services/push*.ts` |
| iOS app | `planned`, deferred in the roadmap | feature map id `ios-app` |
| MCP servers page | `shipped`, read-only. Reads **the server machine's** `~/.claude.json` top-level `mcpServers` only (`parseClaudeMcpEntries` ignores `projects[path].mcpServers`, `.mcp.json`, plugins, Codex `config.toml` and pi). Rows: name, transport, command or URL, env/header **key names** only. Write verbs 404 | `apps/server/src/services/mcp-servers.ts`, `packages/shared/src/protocol/mcp.ts:89`, `.claude/skills/verify-cairn/features/mcp-servers.md` |
| Per-machine MCP facts | The daemon **already reports** each machine's MCP slugs and skill names in `capabilities` (`apps/daemon/src/machine-capabilities.ts`, mtime-cached). The server uses them for dispatch eligibility (`services/dispatch-eligibility.ts:38-80`). The machine detail pane shows only a count, `MCP {n} · 本机技能 {m}` (`apps/web/src/resources/machine-detail-pane.tsx:310`) | as cited |
| Coordinator over MCP | `shipped`: `/api/mcp` lets outside harnesses talk to the Coordinator with an API key | feature map id `coordinator-mcp` |
| Spec 30 | T0 landed: secret-free `harness_profile` table, default `independent`; T1 is "presence carries a harness fingerprint; server computes drift; settings shows a read-only matrix" | spec 30 |

So the MCP surface has a data gap (one file, one machine) and a display gap (per-machine facts exist but are shown as a number). Mobile already has the hard parts of web push. Desktop has nothing.

---

## 1. Desktop app

### 1.1 What comparable desktop apps do beyond a web wrapper

| Source | What the desktop app adds | Mark / link |
|---|---|---|
| **Claude desktop, Code tab** | OS notification when a session finishes and you are not viewing it. **Remote Control** switch per session, and "connect new sessions automatically", so local sessions appear on claude.ai and the phone. **SSH sessions**: Claude Code runs on the remote under a background helper, so the task survives sleep or quit of Desktop; MCP servers come from the **remote's** `~/.claude.json` / `.mcp.json`. **Deep link** `claude://code/new?ssh_host=&ssh_folder=&q=` opens a prefilled new session after a confirm step. PR card with CI status, **Auto-fix** and **Merge when ready**; needs `gh` on the machine. Connectors and plugins installed from a `+` menu; Customize page lists them. Dispatch (Cowork) can spawn Code sessions and push to the phone | measured [desktop](https://code.claude.com/docs/en/desktop), [remote-control](https://code.claude.com/docs/en/remote-control) |
| **Codex / ChatGPT desktop app** | Now ships for macOS, Windows and **Linux (preview: deb, rpm, Arch script)**. Notification settings: turn completion never / only in background / always, plus separate toggles for permission and question prompts; an **Activity** view (bell) lists unread, running and waiting chats; a floating "pet" shows Running / Needs input / Ready / Blocked. **Settings > Connections > Control this Mac or PC** turns the desktop into a host reachable from the phone through a relay, with a **keep this computer awake** setting; **SSH hosts** read from `~/.ssh/config`; **handoff** moves a chat plus its Git state to another host's worktree. **Settings > MCP servers** lists servers, shows which need OAuth, with an **Authenticate** button; config shared with CLI and IDE | measured [notifications](https://learn.chatgpt.com/codex/notifications), [remote-connections](https://learn.chatgpt.com/codex/remote-connections), [linux-app](https://learn.chatgpt.com/codex/linux/linux-app), [mcp](https://learn.chatgpt.com/codex/extend/mcp) |
| **Cursor** | Desktop "Agents Window" with **Remote Control** (Settings > Agents, `/remote-control`) so the phone drives a local agent; computer must stay awake with the workspace open. Cloud runs can pick **My Machines** as a worker | measured [help: mobile app](https://cursor.com/help/ai-features/mobile-app), [cloud-agent/mobile](https://cursor.com/docs/cloud-agent/mobile) |
| **Amp** | Native Mac app (Sparkle self-update) whose distinctive feature is **"Use This Mac as a Runner"**: the app runs the user's installed `amp` CLI as `amp --no-tui --no-serve-cwd --runner-id <name>` with a **folder allowlist** (one project, a parent folder scanned two levels deep, or home), restarts it on exit, stops it on quit, and diagnoses the CLI as Missing / Not signed in / Too old with one-click fixes. **Keep This Mac Awake** while plugged in (menu-bar icon shows a cup). Terminal access and display sharing are separate opt-in switches. Notifications only when a thread is ready for your next message, never for the thread on screen. Thread links (`ampcode.com/threads/...`) open in the app once chosen | measured [apps/mac](https://ampcode.com/docs/apps/mac), [apps/mac/runner](https://ampcode.com/docs/apps/mac/runner) |
| **t3code** (Electron) | Dock/taskbar **notification badge** with a thread count, zeroed when the window is focused (`apps/desktop/src/ipc/methods/notificationBadge.ts`). Custom protocol registration (`ElectronApp.setAsDefaultProtocolClient`), a Linux URL handler, electron-updater with channels. **Prompt links** `app.t3.codes/new?prompt=&repo=&pr=` open a *draft* that never auto-runs and cannot change permission mode or branch. The always-on host is a **user service** (`t3 service install`, `t3 update`, `t3 up` for remote access), separate from the desktop app | measured source at `ade4730`: `docs/user/background-service.md`, `docs/user/prompt-links.md`, `apps/desktop/src/{electron,app,updates}` |
| **Conductor** (Tauri, Mac) | Workspace-per-task with Diff Viewer comments sent back to the agent, Checks tab (CI, deployments, comments, todos), create PR, merge, archive. **Bundles its own Claude Code and Codex** in the app and tells users not to update them | measured [workflow](https://www.conductor.build/docs/concepts/workflow), [faq](https://www.conductor.build/docs/faq); bundle facts in the stack note |
| **Orca** (Electron, MIT) | Closest shape to cairn: "run a fleet of coding agents with your own subscription", a **coordinator agent** that splits work to workers in worktrees. **Run anywhere**: Local, SSH target, **Remote Orca Server** (`orca serve`, paired over Tailscale with a link), per-workspace cloud VM. The desktop app can "Advertise this app as a server" | measured [README](https://github.com/stablyai/orca), [ways-to-run](https://www.onorca.dev/docs/ways-to-run) |
| **Linear desktop** | OS-integrated notifications and dock badge; "always on"; web can route links into the app (`linear://` prefix, and a browser preference "Open in desktop app" that probes localhost ports). Offline: changes stored locally and retried. Linear **dropped browser push**: real-time desktop alerts need the desktop app | measured [get-the-app](https://linear.app/docs/get-the-app), [notifications](https://linear.app/docs/notifications) |

### 1.2 Pattern

Every product puts the same four things in the desktop shell, and none of them needs a second UI (inferred from 1.1):

1. **Attention**: OS notifications only for "needs you" or "done", suppressed for the thread on screen; a badge or menu-bar count (Codex Activity, Amp, t3code, Linear).
2. **Links into the app**: a custom scheme or a captured https link that opens a *draft*, never an auto-run (Claude `claude://code/new`, t3code prompt links, Amp thread links, Linear).
3. **This computer as a worker**: a switch that runs the *already installed* CLI as a supervised worker with a folder allowlist and keep-awake (Amp runner, Codex "Control this Mac or PC", Orca "advertise as server"). The always-on host is a service, not the desktop app (t3code `t3 service`, Orca `orca serve`).
4. **Self-update** (Sparkle, electron-updater).

Offline is not a feature anyone builds for an agent product beyond queued writes (Linear); work happens on the host.

### 1.3 Recommendation for cairn

For an existing self-hosted deployment, the desktop app can be a **client of a configured server** that optionally makes the current computer another worker. This is a generic deployment scenario, not a description of a personal installation. Bundling a server belongs to the new-installation flow (D100/D105) and is deferred in this historical proposal.

Should do (3-5), one measured example each:

| # | Capability | Example measured | cairn form |
|---|---|---|---|
| D1 | Window on a configured server origin, remembered per install; single instance | Orca pairs a client to a Remote Orca Server with a link (measured) | Electron `BrowserWindow.loadURL(<server origin over tailnet>)`, the same SPA; first run asks for the server URL or a pairing link |
| D2 | Tray / menu-bar with "needs you" count, and OS notifications only for needs-input / failed / PR ready, suppressed for the visible thread | Codex: completion alerts "only in background" plus separate permission toggles; Amp: never for the thread on screen (measured) | Reuse the existing push events and the `thread-presence` heartbeat; the desktop subscribes like a device and shows `Notification` + `Tray` badge; zero the badge on focus as t3code does |
| D3 | `cairn://` deep links that open a prefilled draft in the Coordinator or a thread, never auto-run | `claude://code/new?...&q=` asks to confirm; t3code prompt links never run anything (measured) | Register the scheme; map `cairn://thread/<id>` and `cairn://new?q=` onto existing web routes |
| D4 | "Use this computer as a worker" switch | Amp runner: uses the installed CLI, folder allowlist, restart on exit, stop on quit, keep-awake while plugged in, explicit Missing / Not signed in / Too old states (measured) | Spawn the existing `apps/daemon` with this machine's registration, an explicit allowed-folders list, `powerSaveBlocker` while on AC; diagnose `claude` / `codex` / `pi` presence and sign-in, never bundle them |
| D5 | Self-update | electron-updater (t3code, OpenCode), Sparkle (Amp, Codex) (measured) | electron-builder + electron-updater; AppImage/deb for Linux, DMG for Mac |

Leave out:

- A second UI or native panes: the SPA is the UI (D45).
- Bundling Claude Code / Codex binaries (Conductor does it and must then pin them; Amp and Claude-SSH use what is installed) (measured).
- Bundling the server, Coordinator and tsnet in the existing-deployment slice. Keep D100's bundled mode for the new-installation phase.
- Offline mode, an in-app terminal, an in-app browser, computer use, SSH session management (the daemon already runs where the code is).
- Windows build until someone needs it.

**First slice.** `apps/desktop`: Electron window on a configured server origin + tray with the needs-you count + OS notifications from the existing push stream with presence suppression + `cairn://` drafts + electron-updater, AppImage and unsigned DMG. Acceptance: on supported desktop platforms, a task that asks a question raises one notification, clicking it lands in the thread, the badge clears, nothing fires for the thread on screen. D4 (worker switch) is slice two, because it touches daemon registration (`apps/daemon/src/credentials.ts`, `apps/server/src/routes-machine.ts`, both owner-routed security surfaces).

---

## 2. Mobile (Android PWA; iOS native paused)

### 2.1 What mobile clients let you do for agent work

| Source | Start | Steer / approve | Review | Notify | Voice / share | Form | Mark / link |
|---|---|---|---|---|---|---|---|
| **Claude app (Code tab)** | cloud sessions on a repo+branch; Remote Control into a local session; Dispatch task | send messages, answer prompts; permission modes Manual / Accept edits / Plan / Auto, never Bypass from the phone; terminal-only commands (`/plugin`, `/resume`) do not work | session transcript and changes | **two toggles**: "Push when Claude decides" and "Push when actions required"; skipped while you are focused on the terminal, or while a presence file exists (`CLAUDE_CLIENT_PRESENCE_FILE`); Android battery optimisation can delay | photos saved to `~/.claude/uploads/`, other files passed as `@` refs | native iOS + Android; "a client for Claude Code sessions rather than a place where code runs" | measured [mobile](https://code.claude.com/docs/en/mobile), [remote-control](https://code.claude.com/docs/en/remote-control) |
| **ChatGPT / Codex mobile** | pick Cloud or a connected computer + project, describe the task | follow progress, send instructions, **Approve / Always approve / Deny** a requested command | "inspect responses, changed files, diffs, and test results" | when done or needs attention | (dictation in app) | native; pair host by QR from the desktop app; relay, no inbound ports | measured [mobile](https://learn.chatgpt.com/codex/mobile), [remote-connections](https://learn.chatgpt.com/codex/remote-connections) |
| **Cursor for iOS** | repo + branch, pick worker: Cloud, Team Pool or **My Machines** | follow-ups to running agent; subagent transcripts | full diffs, commits, checks, comments; **merge** (squash, ready, update branch, auto-merge) | push when an agent finishes a turn; Live Activities for up to 8 agents | dictation, realtime voice chat, Design Mode (draw on screenshots) | native **iOS only, Android planned**; earlier form was the cursor.com/agents PWA; "not an IDE, not an admin console"; secrets and environments set on the web; cache-first | measured [cloud-agent/mobile](https://cursor.com/docs/cloud-agent/mobile), [help](https://cursor.com/help/ai-features/mobile-app) |
| **Amp** | threads in orbs or on your runners | as web | as web | app notifies when a thread is ready for you | **Android**: Share to Puck from any app's share menu, long-press icon shortcuts (Dictate, Call, New thread), Quick Settings tile; dictation | native Android APK (Android 10+), iOS TestFlight, self-updating | measured [apps](https://ampcode.com/docs/apps), [apps/android](https://ampcode.com/docs/apps/android) |
| **t3code mobile** | connect to a server on another machine | as desktop | as desktop | notifications on finish, fail, **needs approval**, asks input; tap opens thread; quiet while app in foreground; **background push requires their relay (T3 Connect); a direct or Tailscale connection alone does not push**; Android Live Updates / ongoing notification | | Expo native, App Store + Google Play | measured `docs/user/install.md`, `docs/user/mobile-notifications.md` at `ade4730` |
| **Orca mobile** | create a workspace (asks which host), start an agent | reply `continue` / `yes` / text, attach photo, dictate | source control: changed files, stage, commit | push when an agent finishes | | iOS + Android APK; "intentionally not a full editor — a remote control for the desktop you already have" | measured [docs/mobile](https://www.onorca.dev/docs/mobile) |
| **GitHub Mobile** | assign issues to Copilot | | **read, review, and collaborate on PRs; edit files in PRs**; triage notifications | mentions, notifications inbox | | native iOS + Android | measured [docs](https://docs.github.com/en/get-started/using-github/github-mobile) |
| **Linear mobile** | create issues; delegated coding sessions under My Issues | iterate with Linear Agent by tapping a diff line to add it to the message | **Reviews tab**: Guided Reviews, preview links, merge approved changes (2026-11-04) | inbox synced across clients, snooze, reply | camera attachments | native iOS + Android, **plus a PWA** | measured [get-the-app](https://linear.app/docs/get-the-app), [mobile diffs](https://linear.app/changelog/2026-11-04-mobile-diffs), [coding sessions](https://linear.app/changelog/2026-07-30-coding-sessions-on-mobile) |

### 2.2 What an Android PWA can and cannot do

| Capability | Chrome Android | iOS Safari | Mark / link |
|---|---|---|---|
| Install as a real app (launcher, Android app settings, URL intent filters for its scope) | yes: Chrome mints a **WebAPK** from the manifest; links inside scope open the installed app | Add to Home Screen | measured [web.dev WebAPKs](https://web.dev/articles/webapks) |
| Web Push via service worker | Chrome 42 | 16.4 | measured MDN BCD `api/PushManager.json` |
| Notification **action buttons** | Chrome 53 | no | measured BCD `api/Notification.json` `actions` |
| App icon badge (`setAppBadge`) | **no** | 16.4 | measured BCD `api/Navigator.json` |
| Receive shares from other apps (`share_target`) | Chrome 76 | no | measured BCD `manifests/webapp/share_target.json` |
| Long-press shortcuts (`shortcuts`) | Chrome 84 | no | measured BCD `manifests/webapp/shortcuts.json` |
| `launch_handler` | Chrome 110 | no | measured BCD |
| Speech recognition in the page | Chrome 139 | 14.1 | measured BCD `api/SpeechRecognition.json` |
| Background Sync / Periodic Background Sync | Chrome 49 / 80 | no | measured BCD |
| Custom protocol handlers | no | no | measured BCD `protocol_handlers` |
| Push delivery path | the browser vendor's push service queues messages while the device is offline | | measured [web.dev push overview](https://web.dev/articles/push-notifications-overview) |
| Long-running background work, Live Activities / ongoing notifications | no (only short service-worker events) | no | inferred from the API list above; t3code and Cursor need native code for these (measured) |

The structural difference from t3code: cairn's server already holds VAPID keys and sends Web Push itself (measured section 0), so a PWA on a tailnet-only server still gets background push through Google's push service, which t3code says its Tailscale path cannot do without their relay (measured). Whether Chrome can mint a WebAPK for an origin only reachable on a tailnet is unverified (unverified): check on the phone.

### 2.3 Pattern

Every mobile client is a **remote control, not a workstation**: start, answer, approve, read the result, merge; no editor, no terminal for the general case (Cursor, Orca, Claude all say so, measured). Notifications have exactly two classes, "needs you" and "done", with suppression when you are already looking (Claude presence file, t3code foreground, Amp on-screen thread). Review on the phone means reading a diff and the checks, and at most merging (Cursor, Linear, GitHub).

### 2.4 Recommendation for cairn

Should do:

| # | Capability | Example measured | cairn form |
|---|---|---|---|
| M1 | Two notification classes with separate on/off: "needs you" (question, approval, failed) and "done / PR ready" | Claude: "Push when Claude decides" vs "Push when actions required" (measured) | Per-device toggle on the push subscription row; server tags each push with its class; keep the presence suppression already in `thread-presence.ts` |
| M2 | Answer from the notification when it is safe: action buttons **Open** and, for plain questions with fixed choices, the choices themselves | Codex mobile: Approve / Always approve / Deny on a requested command (measured); Chrome Android supports `actions` since 53 (measured) | `showNotification({actions})` in `sw.js`, `notificationclick` posts the chosen action to an authenticated endpoint. Approvals of commands stay in-app (one more tap) because a lock-screen tap is weaker auth (inferred) |
| M3 | Share into the Coordinator from any Android app (link, screenshot, text) | Amp "Share to Puck" (measured); `share_target` Chrome 76 (measured) | `share_target` in the manifest posting to a route that prefills the Coordinator composer as a draft |
| M4 | Long-press shortcuts: New task, Needs me | Amp icon shortcuts (measured); `shortcuts` Chrome 84 (measured) | `shortcuts` in the manifest pointing at existing routes |
| M5 | Phone-sized review of the delivered PR: evidence, checks, diff summary, merge or send back | Cursor and Linear review and merge on the phone (measured) | The existing thread/PR detail at narrow width; deep line-by-line review stays in GitHub Mobile, linked out |

Leave out: native iOS and Android apps, Live Activities / ongoing notifications (need native, measured above), a terminal or file editor on the phone, in-page voice dictation (Gboard voice typing already works in any text field, inferred), offline write queue, approving commands straight from the lock screen.

**First slice.** M1 + M4 + M3: notification classes with per-device toggles, manifest `shortcuts`, `share_target` into a Coordinator draft. All are manifest and service-worker changes plus one server tag. Acceptance on an Android test device: install from Chrome, long-press shows two shortcuts, sharing a URL from another app opens a Coordinator draft, a question push arrives with the screen locked and opens the thread, a done push can be muted without muting questions.

---

## 3. MCP management (per machine now, marketplace later)

### 3.1 How products list, check, install and scope MCP servers

| Source | Listing and health | Install / enable | Scope | Trust | Mark / link |
|---|---|---|---|---|---|
| **Claude Code `/mcp`** | `claude mcp list` health-checks each server: `✔ Connected`, `! Needs authentication`, `✘ Failed to connect`, `⏸ Pending approval` for unapproved `.mcp.json` servers; after five failed reconnects marks failed and notifies; `/mcp reconnect all` | `claude mcp add`; plugins bundle servers and are toggled, not removed, in `/mcp` | **local** (per project, in `~/.claude.json` under the project path), **project** (`.mcp.json`, shared via git, needs approval), **user** (`~/.claude.json`); then plugin servers, then claude.ai connectors; highest wins, no field merge, duplicates matched by name or endpoint | project servers need approval in a trusted folder; OAuth flagged on 401/403 | measured [docs/mcp](https://code.claude.com/docs/en/mcp); CLI 2.1.319 `claude mcp list --help` |
| **claude.ai connectors directory** | "Connectors are MCP servers with a graphical setup flow"; Customize > Connectors lists and disconnects | browse directory from `+` menu, OAuth | per account; reaches local and SSH sessions | curated directory | measured [desktop docs](https://code.claude.com/docs/en/desktop); registry entries as seen by Claude carry name, description, tool names, URL, `directoryUuid`, `connected`, `enabledInChat` (measured via the session's connector registry tool). Directory page **blocked** (Cloudflare check) |
| **Claude desktop extensions (.mcpb)** | | one-click install of a zip with `manifest.json`; "automatic updates, easy configuration ... and a curated directory" | per app | `user_config` fields can be `sensitive: true`; `compatibility.platforms` (`darwin`, `win32`, `linux`); server `type` node / python / binary | measured [mcpb README](https://github.com/modelcontextprotocol/mcpb), MANIFEST.md |
| **Codex** | app: Settings > MCP servers shows enabled and needs-OAuth with **Authenticate**; `codex mcp list --json` returns `name`, `enabled`, `disabled_reason`, `transport{type,command|url,...}`, `auth_status` (`unsupported` / `unknown` / ...) | `codex mcp add`, `codex mcp login` | `~/.codex/config.toml`, project `.codex/config.toml` (trusted projects); plugin-provided servers toggled per plugin; per-tool `enabled_tools` / `disabled_tools` / `approval_mode` | | measured [codex mcp](https://learn.chatgpt.com/codex/extend/mcp); local run with fake servers. **Note: the JSON includes `env` values verbatim** (measured), so a daemon that relays it must drop values |
| **Cursor** | Customize page | **Cursor Marketplace** one-click "Add to Cursor"; community list at cursor.directory; team marketplace distributes servers | user and workspace `mcp.json`; team-distributed | official plugins vs community | measured [cursor mcp](https://cursor.com/docs/context/mcp) |
| **VS Code** | Customizations > MCP Servers, per-server Disable / Uninstall, server output log | Customization Marketplace (preview), or add by URL/command with a confirmation showing package, version, publisher | **User** vs **Workspace** groups; global `~/.copilot/mcp-config.json`, workspace `.mcp.json`, older `.vscode/mcp.json` deprecated | "Review the publisher, command or endpoint, and requested access before installing" | measured [vscode mcp](https://code.visualstudio.com/docs/copilot/customization/mcp-servers) |
| **Official MCP Registry** | metadata only | `server.json`: name (reverse-DNS namespace), version, `packages[]` (`registryType` npm / pypi / oci ..., `transport`) or `remotes[]` (`streamable-http` URL), env var inputs with `isSecret` / `isRequired` | | namespace proven by GitHub login (`io.github.<user>/*`) or DNS; npm ownership by `mcpName` in `package.json`; **moderation "quite permissive"**: removes only illegal, malware, spam, non-functioning; consumers "should assume minimal-to-no moderation". Unauthenticated REST: `GET /v0.1/servers?search=&version=latest&cursor=`, `/versions/{v}`; aggregators expected to scrape ~hourly; **"not intended to be directly consumed by host applications"** | measured live API [`/v0.1/servers`](https://registry.modelcontextprotocol.io/v0.1/servers?limit=2), docs [about](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/about.mdx), [aggregators](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/registry-aggregators.mdx), [moderation](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/moderation-policy.mdx), schema `2025-12-11` |
| **Smithery** | | | | **shut down its MCP proxy, managed identity, API, CLI and SDKs on 2026-10-31**; remains a public non-proxied registry listing vendors' direct URLs | measured [smithery.ai/docs](https://smithery.ai/docs) |
| **Docker MCP Catalog / Toolkit** | Toolkit in Docker Desktop (beta) | pick servers from catalog into **profiles**; a gateway exposes one profile per client; "Dynamic MCP" lets the agent search and add servers | profiles per project or environment; custom catalogs restrict to approved servers | images under `mcp/` built and **signed by Docker with SBOM**; local servers run as isolated containers; remote servers via OAuth. Hub shows publisher, category, stars, pulls | measured [toolkit](https://docs.docker.com/ai/mcp-catalog-and-toolkit/toolkit/), [catalog](https://docs.docker.com/ai/mcp-catalog-and-toolkit/catalog/), [hub.docker.com/mcp](https://hub.docker.com/mcp) operated in Chrome |
| **Tailscale Aperture** | gateway aggregates remote MCP servers behind one `/v1/mcp`; tools prefixed by server id (`docs_search`); servers register and unregister at runtime | `connectors.servers` config with url, description, context | **deny by default**; grants by Tailscale identity/group with globs `connectorID/category/resource` (`tools`, `resources`, `templates`, `proxy`) | identity-based; MCP proxying in alpha | measured [mcp-server](https://tailscale.com/docs/aperture/mcp-server), [grant-mcp-tool-access](https://tailscale.com/docs/aperture/how-to/grant-mcp-tool-access) |
| **Glama** | directory with per-server **license / quality / maintenance** grades, Inspector, "Claim" for owners, Deploy Server | | | grades are directory heuristics; a page showed license `F`, quality `D` for an unclaimed repo | measured [glama.ai/mcp/servers](https://glama.ai/mcp/servers) operated in Chrome |
| **t3code** | no MCP manager: configure in each harness, then "Restart agent"; exposes itself as an MCP server for outside agents | | | | measured `docs/user/composer.md`, `outside-agents.md` at `ade4730` |

### 3.2 Pattern

- **List** = name + source/scope + transport + status from a real connect attempt (Claude `mcp list`, Codex app, VS Code). Status vocabulary converges on **connected / needs auth / failed / disabled / pending approval** (measured).
- **Scope** is always user vs project, with the project file in the repo and needing trust (Claude, Codex, VS Code, Cursor) (measured).
- **Secrets stay where the server runs**: env values and OAuth tokens live in the harness's own store on that machine; listings show key names (Claude `/mcp`, cairn today). Codex's JSON leaks values, so a relayer must strip them (measured).
- **Marketplaces** sit on top of the official registry as aggregators that add curation (Docker signing, Glama grades, Cursor/Claude curated lists). The registry itself is permissive and says hosts should not consume it directly (measured). One marketplace (Smithery) has already folded its hosted layer (measured).
- **Install from a marketplace** writes a harness config entry (or a bundle); OAuth is done in the client where the server runs.

### 3.3 Recommendation for cairn

Should do:

| # | Capability | Example measured | cairn form |
|---|---|---|---|
| P1 | A **machine × server matrix**: rows are server names, columns are machines, cell shows harness and scope | Docker profiles per environment, Codex settings list per host (measured) | Replace the single-file read in `mcp-servers.ts` with the per-machine facts the daemon already reports; extend `capabilities.mcpServers` from slugs to `{name, harness: claude-code|codex|pi, scope: user|local|project, transport}` (no values) |
| P2 | Read every source a harness actually loads, not just one key | Claude scopes local / project / user / plugin / connector (measured); Codex `config.toml` (measured) | Daemon reads `~/.claude.json` top level **and** `projects[*].mcpServers`, `codex mcp list --json` (dropping `env`, headers values), and pi's `mcp.json`; same parser shape as spec 30's `mcpDefinitions` so T1 drift reuses it |
| P3 | Status per cell from a real check, on demand | `claude mcp list` statuses; Codex `auth_status` (measured) | A "check" action that runs the harness's own list command on that machine and stores `connected / needs auth / failed / pending approval` with a timestamp; never on a timer (spec 30 A9 spirit) |
| P4 | Fix by going to the machine's own flow, not by moving credentials | Claude `/mcp` and `claude mcp login`; Codex Authenticate (measured) | For `needs auth`, show the exact command to run on that machine (`claude mcp login <name>` / `codex mcp login <name>`); cairn never stores the token (spec 30 A6) |
| P5 | Later, catalog = read-only view of the official registry, install = write a definition through spec 30 | Registry `/v0.1/servers?search=&version=latest` (measured); Docker custom catalogs restrict to an approved set (measured) | When spec 30 T2 lands: a search box over the registry API (server-side, cached), showing `remotes` and `packages`, publisher namespace and status; "add" writes a profile `mcpDefinitions` entry, rendered per machine by spec 30 renderers |

Leave out: a hosted MCP proxy or gateway (Smithery folded theirs; Aperture already does this on a tailnet, measured), container isolation (Docker), cairn's own ratings or security grades, OAuth inside cairn, per-tool approval policy UI (each harness owns it), a timer-driven health probe, storing any env or header value, installing `.mcpb` bundles.

**First slice.** P1 + P2 for Claude Code and Codex: the daemon reports `{name, harness, scope, transport}` per machine; the MCP page becomes the matrix; the machine detail pane lists names instead of a count. Acceptance: with a fixture `~/.claude.json` holding one user-scope and one local-scope server and a Codex `-c` override on a second daemon, the page shows both machines' columns with the right scope and no secret values in API JSON (assert absence of the fixture secret strings). P3 status checks follow; P5 waits for spec 30 T2.

**Code areas.** `apps/daemon/src/machine-capabilities.ts`, `packages/shared/src/protocol/mcp.ts` and `packages/shared/src/records/machine-capabilities.ts` (record shape), `apps/server/src/services/mcp-servers.ts`, `apps/server/src/services/dispatch-eligibility.ts` (consumes slugs; keep it on `name`), `apps/web/src/resources/mcp-servers-page.tsx`, `apps/web/src/resources/machine-detail-pane.tsx`. Machine capability reporting crosses `apps/server/src/services/machine*.ts`, an owner-routed security surface.

## 4. Open items

- Operate the claude.ai connector directory once an authorized tester clears the Cloudflare check in the research browser.
- On an Android test device: confirm WebAPK minting for the tailnet-only origin and that Web Push arrives with Chrome closed.
- The Claude desktop, Codex and Cursor desktop apps were read through docs only; a hands-on pass on a supported desktop platform would confirm notification and badge behavior screen by screen.

## Addendum: claude.ai Directory, operated 2026-11-08 (measured, signed-in research browser)

- `https://claude.ai/directory` loaded with no challenge on this pass. The page has one search box ("Search plugins & connectors"), a Filter menu, "Add custom" and "Submissions".
- The Filter menu offers categories (Topic, Department, Industry, Everyday life) and types with counts: Trending 9, New 10,306, Verified 1,512, Community 8,794, Custom 1, In-chat UI 752, Desktop extensions 132.
- An entry page (notion) has a header with icon, verified mark, kind (Plugin) and source repo, plus one "Add to Claude" button. Its tabs are Overview / Contents / Skills / Commands / Connectors. The right rail shows Permissions ("Can send data to mcp.notion.com"), Categories, Source (GitHub link), Version with date, and License.
- inferred for cairn's later catalog: the unit people browse is a bundle (connector + skills + commands), not a bare MCP server. Trust is shown as a verified mark, the declared data destination, the source repo and the license. Verified entries are a minority (1,512 of ~10k).
