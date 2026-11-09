# The user's own computer: drive it directly, in the background, and confine every harness the same way

Status: research, 2026-11-08, revision 2. No code changed. This replaces the direction of `docs/research/agent-small-computer-2026-11-08.md` §6.4, which ian rejected. Revision 2 follows ian's review of revision 1:

- The agent must not pause when the user touches the machine. Both work at the same time, so the agent runs in the **background**.
- Each harness sandbox was verified against the installed versions. The result is one cairn-owned wrapper.
- There are **no optional modes**. One path per mode. The nspawn/orb computer and the container provider are deleted in the same change that lands the host path.

Question (ian): a cairn user connects their own spare computer and wants all of its power used. cairn uses that machine in two ways:

- **A.** The Coordinator operates the computer itself: screen, apps, browser.
- **B.** The Coordinator dispatches coding tasks to a local harness (Claude Code, Codex CLI, pi) in git worktrees.

Evidence labels: `实测` = read or run first-hand this session (page, source, installed binary, host command). `推断` = follows from `实测` facts. `猜测` = everything else. Web pages were fetched on 2026-11-08 through agent-reach (Jina Reader; raw HTML or `gh api` where Jina failed). cairn code was read at `ae86f0cb2`. Host facts come from omarchy: Hyprland 0.56.2 on Wayland, RTX 3060, 31 GiB RAM, 16 threads (`实测`: `hyprctl version`, `lspci`, `free`, `nproc`).

## 0. Answers

1. **Mode A: the user's own desktop, operated in the background.** The agent never moves the user's pointer and never takes keyboard focus. When an action can only be done in the foreground, the agent refuses it and reports why. It does not take over the screen.
   - **macOS: full background works.** Use Accessibility actions, events posted to the target process, per-window capture, and CDP on the user's Chrome profile.
   - **omarchy (Hyprland): partial background.** Background works for the browser (CDP) and for native apps that expose AT-SPI actions. Raw pointer and keyboard input to an unfocused window is impossible on standard Wayland. A Hyprland headless output still shares the user's single seat (§1.3).
2. **Mode B: run each harness directly on the host, inside one cairn-owned OS sandbox.**
   - Linux uses bubblewrap. macOS uses Seatbelt (`sandbox-exec`).
   - The same policy applies to every harness process. The harnesses' own sandboxes are switched off, so there is exactly one boundary.
   - Reason: pi has no sandbox, Claude Code's covers only Bash, and cairn never sets Codex's mode (§2.3).
3. **Delete the orb.** Remove the nspawn computer, the container provider, the orb step transport, the noVNC screen path and `scripts/ops/orb` in the same change that lands the host path: about 129 files and 35,000 lines (§4.3).

## 1. Mode A: where the agent's screen lives, and how it stays out of the user's way

### 1.1 Products (carried over from revision 1, re-checked)

| Product | Where it acts | Background? | Source |
|---|---|---|---|
| **Claude computer use** (Cowork, Code tab) | The user's real desktop. "Computer use has no sandbox between Claude and your applications" (`实测`) | macOS 15+: "Claude works in background windows… doesn't take over your pointer or keyboard". It asks before using the full screen (`实测`). Windows: not stated | [support 14128542](https://support.claude.com/en/articles/14128542-let-claude-use-your-computer-in-cowork), [desktop docs](https://code.claude.com/docs/en/desktop#let-claude-use-your-computer) |
| **Claude in Chrome** | The user's own Chrome, through the extension `debugger` permission, in a separate tab group (`实测`) | Yes: "keeps working even when you switch tabs" (`实测`) | [support 12012173](https://support.claude.com/en/articles/12012173-get-started-with-claude-in-chrome) |
| **ChatGPT / Codex Computer Use** | The user's real desktop (`实测`) | macOS: "running a scoped task in the background while you keep working elsewhere" (`实测`, **verified**). Windows: "can't operate in the background… expect ChatGPT to move the pointer"; OpenAI suggests a Windows VM for that case (`实测`) | [computer-use](https://learn.chatgpt.com/docs/computer-use) |
| **Cua Driver** (`trycua/cua`, MIT; ian's "CUCUA") | The user's real desktop, on macOS, Windows and Linux (`实测`) | Built for it: "drives native macOS apps without stealing focus". Background delivery "does not raise the window, move the real pointer, or switch the frontmost app" (`实测`). Its demo runs "on an Omarchy desktop while a terminal stays in the foreground" (`实测`) | [README](https://github.com/trycua/cua), [driver README](https://github.com/trycua/cua/blob/main/libs/cua-driver/README.md), [how it works](https://cua.ai/docs/cua-driver/concepts/how-cua-driver-works), [platform support](https://cua.ai/docs/cua-driver/concepts/platform-support) |
| **Vercel Labs agent-desktop** (most likely ian's "Wasail's Agent": "Vercel's" heard as "Wasail's", `猜测`) | The user's real desktop, through the accessibility tree (`实测`, locally installed agent-desktop 1.1.0) | On Linux, ref actions "are semantic AT-SPI calls that never move the pointer or change the active window" (`实测`, `agent-desktop skills get platform`). cairn already uses it (`apps/daemon/src/computer/host-screen.ts`, `实测`) | the binary's own platform guide |
| **"Youzi"** (`柚子`) | **Not identified.** Searches found only `柚子远程控制` (Youzi Remote Control), a remote-assistance app and not an agent ([App Store](https://apps.apple.com/nr/app/%E6%9F%9A%E5%AD%90%E8%BF%9C%E7%A8%8B%E6%8E%A7%E5%88%B6/id1616796757)). The closest Chinese-vendor background product is Qoder (Alibaba): it runs in the background on macOS, while on Windows "operations happen in the foreground" (`实测`, [Qoder docs](https://docs.qoder.com/user-guide/chat/computer-use-agent)). ian needs to give the vendor or URL | — | blocked: name unknown |
| **Manus My Computer** | The user's own computer, through CLI commands; pitched as "Unlock Your Idle Compute" (`实测`) | CLI only, no screen driving (`实测`) | [blog](https://www.manus.im/blog/manus-my-computer-desktop) |
| **Cursor My Machines** (`agent worker --computer-use`) | macOS: "drives the signed-in desktop session". Linux: `:0`, an inherited `DISPLAY`, or a worker-started TigerVNC + Xfce desktop (`实测`) | Not claimed; desktop sharing uses "a worker-created, isolated agent desktop" (`实测`) | [computer-use](https://cursor.com/docs/cloud-agent/self-hosted/computer-use) |
| **Microsoft agent workspace** | Same PC, separate Windows session and separate standard account; "more efficient than a full virtual machine" (`实测`) | Yes, by being a second session; the user's own logins are not shared (`推断` from the separate account) | [support](https://support.microsoft.com/en-us/windows/ai/ai-features/experimental-agentic-features), [blog](https://blogs.windows.com/windowsexperience/2025/10/16/securing-ai-agents-on-windows/) |
| **Apple** (Siri, App Intents) | Structured app actions and onscreen awareness that the app declares (`实测`) | No input at all, so nothing to steal (`推断`) | [WWDC26 240](https://developer.apple.com/videos/play/wwdc2026/240/) |
| Cloud computers (Duet, Operator/ChatGPT agent, dots, Grok Bot, Rakazo) | Their own VM or container; each adds a bridge back to the user's machine or identity: dots "connect your computer", Grok "Route traffic through this computer" (`实测`) | n/a | revision 1 links: [dots](https://learn.chatgpt.com/docs/dots/computers-and-apps), [Grok](https://docs.x.ai/grok-bot/faq.md), [Duet](https://claude.com/resources/articles/claude-duet), [ChatGPT agent](https://help.openai.com/en/articles/11752874-chatgpt-agent) |
| UI-TARS desktop, Agent S, Open Interpreter | The user's real desktop (UI-TARS, Agent S) or terminal only (Open Interpreter today) (`实测`) | Not claimed | [UI-TARS](https://github.com/bytedance/UI-TARS-desktop), [Agent S](https://github.com/simular-ai/Agent-S), [OI](https://www.openinterpreter.com/docs/terminal) |

### 1.2 Pattern

The products that run on the user's machine and claim background operation (Claude on macOS, Codex on macOS, Cua Driver, agent-desktop) all do it the same way (`实测`, §1.1, §1.3):

- Act on accessibility elements rather than screen coordinates.
- Post input to the target process, not to the global input stream.
- Capture single windows.
- Reach the browser through CDP or an extension on the user's own profile.

Where the OS gives no background route (Windows input for Codex and Qoder, raw input on Wayland), they either take the foreground or refuse. Cua makes refusal a contract: "the driver refuses rather than risk typing into the wrong app. A structured `background_unavailable` is part of the contract" (`实测`). ian's rule (never block the user) selects the refusal branch.

### 1.3 Techniques, and which ones give true background

| Technique | What it does | Background? | Evidence |
|---|---|---|---|
| macOS `AXUIElement` actions (`AXPress`, set value) | Acts on an element through Accessibility | **Yes.** Cua's rung 1: "`AXPerformAction` on macOS… the only rung the driver can verify itself" (`实测`) | [Cua how-it-works](https://cua.ai/docs/cua-driver/concepts/how-cua-driver-works) |
| macOS `CGEventPost` (global HID) | Synthesizes a click at screen coordinates | **No.** It "drops the event into the HID event stream… updates the pointer" (`实测`) | [Cua macOS internals](https://cua.ai/blog/inside-macos-window-internals) |
| macOS `CGEvent.postToPid` | Delivers to one process | **Yes, except Chromium web content**, which "filters synthesized events at the renderer IPC boundary". Keyboard to a pid "is enough" (`实测`) | same |
| macOS SkyLight `SLEventPostToPid` and focus-without-raise | Private SPI that Chromium accepts; flips AppKit-active state without raising the window | **Yes**, but it is a private framework found by "grepping SkyLight's symbol exports" (`实测`). It can break on an OS update (`推断`) | same |
| macOS ScreenCaptureKit per window | Captures one window, even occluded | **Yes** (`实测`, Cua platform table) | [platform support](https://cua.ai/docs/cua-driver/concepts/platform-support) |
| Windows UI Automation Invoke; window messages to the HWND | Element actions; input addressed to one window | **Yes for most apps**; elevated windows refuse; must run in the interactive session (`实测`, Cua). Codex and Qoder ship foreground-only on Windows (`实测`) | Cua docs; [Codex](https://learn.chatgpt.com/docs/computer-use); [Qoder](https://docs.qoder.com/user-guide/chat/computer-use-agent) |
| Windows second session (agent workspace) | A separate desktop for an agent account | **Yes**, at the cost of the user's logins (`实测`/`推断`) | Microsoft support page |
| Linux AT-SPI actions | Semantic actions over the accessibility bus | **Yes, where the app exposes the action.** Cua: "AT-SPI actions still work in the background" (`实测`). agent-desktop: "never move the pointer" (`实测`). On omarchy the bus answers: `agent-desktop status` → `accessibility: granted`, surfaces `window, sheet, alert, menu` (`实测`) | Cua; agent-desktop guide; host command |
| Wayland raw input to another window | Synthetic pointer/keys to an unfocused window | **No.** "An ordinary client cannot send raw input to an unfocused, occluded window" (`实测`, Cua). agent-desktop: on Wayland pointer gestures refuse with `ACTION_NOT_SUPPORTED` (`实测`) | same |
| Hyprland `hyprctl output create headless` | Adds a headless monitor "If you're running a VNC/RDP/Sunshine server" (`实测`, wiki) | **No.** It adds an output, not a seat. Hyprland's single seat still routes keyboard focus and pointer, so an agent working there contests focus with the user (`推断`: Cua needed a plugin to add seats, below) | [hyprland-wiki using-hyprctl.md](https://github.com/hyprwm/hyprland-wiki/blob/main/content/configuring/core/advanced-configuration/using-hyprctl.md) |
| wlroots virtual pointer (`zwlr_virtual_pointer_v1`) | A client-created pointer device; "the optional seat is a suggestion to the compositor" (`实测`) | **No** on Hyprland: Hyprland implements it (`src/protocols/VirtualPointer.cpp`, `实测`), but with one seat it drives the user's pointer (`推断`) | [protocol XML](https://gitlab.freedesktop.org/wlroots/wlr-protocols/-/raw/master/unstable/wlr-virtual-pointer-unstable-v1.xml) |
| Cua's Hyprland plugin (two agent seats) | Separate seats for agents | **Partly**: GTK and Qt 6 native Wayland apps only; "Chromium and Electron bind only the user's seat"; Qt drops background keys; "Experimental"; the plugin ABI must match the compositor (`实测`) | Cua platform support §Hyprland and Omarchy |
| Hyprland capture protocols | `Screencopy` and `ToplevelExport` exist in Hyprland's source (`实测`, `gh api …/src/protocols`) | Per-window capture without raising is plausible (`推断`). agent-desktop currently takes the portal route ("Wayland: portal consent", `实测`) | Hyprland source tree |
| CDP on the user's Chrome profile | DOM actions over DevTools | **Yes** on every display server: Cua acts "on the DOM over CDP without focus" (`实测`). `--remote-debugging-port` "does not reach that profile"; the supported route is the browser's own remote-debugging switch or, on Chrome 144+, the running profile's auto-connect endpoint, which "never restarts, copies, or edits the profile" (`实测`). omarchy has `google-chrome 157` (`实测`) | [Cua browsers](https://cua.ai/docs/cua-driver/guides/browsers) |

**Result per platform**:

| | Browser | Native apps with accessibility actions | Canvas, games, pixel-only apps | Raw keys to other windows |
|---|---|---|---|---|
| **macOS** | Background (CDP) | Background (AX) | Background pixel events via per-pid posting; Chromium content needs SkyLight (`实测`) | Background (`postToPid`, `实测`) |
| **omarchy / Hyprland** | Background (CDP, `推断` from Cua's display-independent DOM route) | Background (AT-SPI, `实测` bus up) | **Not possible in the background** | **Not possible** (`实测` Cua, agent-desktop) |

On omarchy, an action that would need the foreground is refused and reported. It is not done by stealing focus.

## 2. Mode B: harness isolation

### 2.1 Products (from revision 1)

| Product | Where the harness runs | Isolation | Source |
|---|---|---|---|
| Amp | Remote orb per thread, or self-hosted Docker/E2B…; CLI on the user's machine (`实测`) | Orb boundary; Docker orbs lose processes on pause; GPU work is moved out with `amp sync` (`实测`) | [orbs](https://ampcode.com/docs/orbs), [self-hosted](https://ampcode.com/docs/orbs/self-hosted) |
| Claude Code | Host | Sandboxed Bash (Seatbelt / bubblewrap), off by default; `srt` wraps a whole process (`实测`) | [sandboxing](https://code.claude.com/docs/en/sandboxing), [environments](https://code.claude.com/docs/en/sandbox-environments) |
| Codex CLI | Host | Seatbelt on macOS; bubblewrap on Linux, with Landlock only as the legacy path (`实测`, `codex-rs/core/README.md`) | [sandboxing](https://learn.chatgpt.com/docs/sandboxing), [core README](https://github.com/openai/codex/blob/main/codex-rs/core/README.md) |
| Cursor | Local terminal sandbox; cloud VMs; or My Machines, where "the machine keeps its own tools, credentials, and network" (`实测`) | per surface | [my-machines](https://cursor.com/docs/cloud-agent/self-hosted/my-machines) |
| Conductor, Crystal, t3code, OpenCode | Host, in worktrees (`实测`). Conductor: "Workspace isolation is development isolation, not a security boundary" (`实测`) | Harness-provided or none | [Conductor](https://www.conductor.build/docs/concepts/workspaces-and-branches), [Crystal](https://github.com/stravu/crystal), [t3code](https://github.com/pingdotgg/t3code), [OpenCode](https://opencode.ai/docs/permissions/) |
| Sculptor | A Docker container per agent; startup took minutes until images were prebuilt (`实测`) | Container | [blog](https://imbue.com/blog/containers) |
| Devin | Remote VM booted from a snapshot (`实测`) | VM | [environment](https://docs.devin.ai/onboard-devin/environment) |

### 2.2 What this user needs, and what an orb costs

These are unchanged from revision 1, summarized:

- **Needs.** Worktrees cover concurrency. An OS sandbox around the harness covers writes outside the task and secret reads. Neither needs a container (`实测` per harness docs).
- **Costs of an orb.**
  - Capped RAM and CPU.
  - No GPU: nothing in `scripts/ops/orb` passes a device in (`实测` grep). Inside bubblewrap, by contrast, `nvidia-smi -L` lists the RTX 3060 (`实测`, §2.4).
  - A duplicated toolchain image.
  - The nspawn ops burden behind the keep-alive incident.
  - About 35,000 lines that production does not run: `cairn-daemon.service` has no `CAIRN_EXECUTOR`, so `createOrbProvider` returns `HostOrbProvider` (`实测`).

### 2.3 Built-in harness sandboxes, verified

| Harness (installed) | Built-in sandbox | Coverage | How cairn runs it today | Uniform enable possible? |
|---|---|---|---|---|
| **Claude Code** 2.1.319, Agent SDK 0.3.278 (`实测` `claude --version`, `apps/daemon/package.json`) | Yes. `Options.sandbox?: SandboxSettings` with `enabled`, `failIfUnavailable`, `allowUnsandboxedCommands`, `filesystem.{allowWrite,denyRead,…}`, `credentials.files/envVars` deny or mask (`实测`, `sdk.d.ts:2098`, `3263-3298`) | **Bash, PowerShell and Monitor only.** "Built-in file tools, MCP servers, and hooks still run directly on your host"; a `denyRead` "doesn't stop the Read tool" (`实测`) | Never sets `sandbox` (`实测` grep). With a subscription token, the runner sets `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` (`runner.ts:865`), so steps run in `permissionMode: 'default'` with `canUseTool` approving everything not disallowed (`claude-code.ts:881-886, 946-950`). Otherwise `bypassPermissions` (`实测`). *Revision 1 said "bypassPermissions" for all host runs; that was incomplete.* | No: Read, Edit, MCP and hooks stay outside |
| **Codex CLI** 0.167.0, over ACP (`实测` `codex --version`) | Yes. The `codex-acp` adapter maps session modes `read-only` → `:read-only`, `auto` → `:workspace`, `full-access` → `:danger-no-sandbox` (`实测`, [`codex-acp/src/thread.rs`](https://github.com/zed-industries/codex-acp/blob/main/src/thread.rs), commit `296069e84`) | Spawned commands and built-in file operations (`实测`, Codex docs) | Through `CAIRN_ACP_AGENTS` with any `command` (`acp.ts:568-602`). cairn never calls `session/set_mode` (`实测` grep). `codex-acp` is not installed on omarchy, and the service sets no `CAIRN_ACP_AGENTS` (`实测`), so Codex is not dispatched in production today (`推断`) | Only by trusting the adapter's mode mapping and each user's `~/.codex/config.toml` defaults |
| **pi** (`@earendil-works/pi-coding-agent` 1.4.0) | **None.** "Project trust controls which project resources Pi loads, but it does not sandbox tool calls"; pi recommends running "entirely inside a container, virtual machine, or sandbox" (`实测`, package `docs/index.md`, `docs/security.md`) | n/a | **In-process in the daemon**: `createAgentSession` and `createBashToolDefinition` are imported into `apps/daemon/src/backend/pi.ts` (`实测`). Its Read/Write/Edit tools run with the daemon's own permissions (`推断`) | No |

Conclusion: one harness has no sandbox, and one covers only a subset of tools. The third depends on an adapter mode that cairn does not set. Uniform enablement cannot be guaranteed through the harnesses, so cairn owns the boundary (`推断`).

### 2.4 Host facts for the wrapper (`实测`, omarchy)

- `bwrap` 0.13.1 at `/usr/bin/bwrap`.
- **Nested bubblewrap works**: `bwrap … bwrap … true` exited 0.
- Inside `bwrap --ro-bind / / --dev-bind /dev /dev --bind /tmp/ucm /tmp/ucm`:
  - `/dev/nvidia0` and `/dev/dri/renderD128` are visible, and `nvidia-smi -L` lists the RTX 3060.
  - A write to the bound directory succeeds.
  - `touch ~/.bwrap-probe` fails with "Read-only file system".

## 3. The pattern that fits cairn

The user's machine is the computer, and cairn adds rails, not walls. That means:

- Mode A follows Codex/Claude on macOS and Cua's background ladder, with the refusal contract where the OS gives no background route.
- Mode B follows Cursor My Machines and Manus for placement, plus **one** OS boundary that cairn owns. The harness vendors already confine their own processes with the same tools (bubblewrap, Seatbelt), but none of them confines the others, and pi confines nothing (`实测`, §2.3).

## 4. Recommendation

### 4.1 Mode A: the user's desktop, in the background

1. **Tool order**: connectors/MCP → shell → browser over CDP on the user's running Chrome profile → accessibility actions → per-window pixel events where the OS allows them in the background.
2. **The agent never takes focus or the pointer.** An action whose only route is the foreground is refused, with the reason surfaced in the step (Cua's `background_unavailable` contract, `实测`). There is no foreground fallback and no pausing on user input. The user and the agent work at the same time.
3. **One driver: Cua Driver**, replacing agent-desktop behind the existing `HostScreen` interface (`apps/daemon/src/computer/host-screen*.ts`).
   - One MIT binary covers the background ladder on macOS (AX, per-pid events, SkyLight for Chromium, ScreenCaptureKit), Windows (UIA, HWND messages) and Linux (AT-SPI).
   - It also covers logged-in-profile CDP attach. It reports `effect`/`escalation`/`refused` per action and is tested on an Omarchy desktop (`实测`).
   - agent-desktop covers native apps only and points browsers to a second tool (`推断` from its guide and the Vercel description).
   - Cua's Hyprland seat plugin is not installed: it is experimental and does not bind Chromium (`实测`).
   - The decision rests on one spike (§4.4-1). The spike chooses the driver; it does not add a mode.
4. **What the user sees and controls**:
   - The step trail shows each action with its screenshot. Frames already flow through `frame-poster.ts` (`实测`).
   - Approvals: per-app first use and a denied-apps list (Claude's model, `实测`), and confirmation for send, pay and delete.
   - The user stops a step from cairn. No remote VNC takeover: it is the user's own screen.
5. **Real files, logins, GPU**: reached directly, because the agent runs as the user in the user's session.
6. **Rails that do not cap performance**: denied apps, action review of screen content for prompt injection (Claude's classifiers, `实测`), credentials filled by a password manager rather than typed by the model (Claude in Chrome + 1Password, `实测`), and an action audit log.

### 4.2 Mode B: one cairn-owned sandbox around every harness

**Design: `confine`**, a single module in `apps/daemon/src/backend/confine.ts` (inside the backend seam). It turns one policy into a launcher prefix:

- **Linux: `bwrap`** (one mechanism; Codex itself routes split policies through bwrap, `实测`).
  - Flags: `--die-with-parent --new-session --unshare-pid --ro-bind / / --dev-bind /dev /dev --proc /proc --tmpfs /tmp`.
  - A `--bind` for every writable path. Denied directories are covered with an empty `--tmpfs`; denied files with `--ro-bind /dev/null`.
  - Network is shared (no `--unshare-net`).
- **macOS: `sandbox-exec -p <SBPL>`**, generated from the same policy: `(allow default)`, `(deny file-write*)` outside the writable subpaths, and `(deny file-read*)` on the denied paths.

**The policy is the same for every harness**, except for one parameter: that harness's own state directory.

- **Writable**:
  - The step worktree.
  - The repository's git common dir. `.git/hooks` and `.git/config` stay read-only, as `srt` does (`实测`).
  - A per-step temp dir.
  - That harness's state dir: `~/.claude`/`~/.claude.json`, `~/.codex`, or pi's `agentDir`.
  - The shared build caches: `~/.cache`, the pnpm store, `~/.npm`, Go mod cache, Cargo registry.
- **Readable**: the rest of the filesystem.
- **Denied read**:
  - `~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.config/gh`, `~/.netrc` (mode 644 on omarchy, `实测` mise warning), `~/.docker`, `~/.kube`, `~/.password-store`.
  - Browser profile dirs (`~/.config/google-chrome`, `~/.config/chromium`, `~/Library/Application Support/Google/Chrome`).
  - The cairn daemon home (machine token).
  - The other harnesses' state dirs.
- **Devices**: all of `/dev`, so the GPU works (`实测`).
- **Fail closed**: if the sandbox cannot start (no `bwrap`, user namespaces blocked), the step does not start. This is Claude's `failIfUnavailable` behavior, applied by cairn.

**Where it is applied** (three spawn seams, the same prefix at each):

| Harness | Seam | Inner sandbox |
|---|---|---|
| Claude Code | SDK `spawnClaudeCodeProcess` (already used for the token FD, `claude-code.ts:985`, `实测`) | Leave `sandbox` unset (off by default, `实测`), so there is one policy |
| Codex | `AcpBackend` `spawnProcess` (`acp.ts:387`, `实测`) | Call `session/set_mode` `full-access` after `session/new`, so the codex-acp inner sandbox is off and cairn's is the boundary |
| pi | Move the session out of the daemon process into a child `cairn-daemon pi-host` (stdio JSONL), launched through `confine`; the existing `pi.ts` session code runs in the child. pi's docs name a child process as the isolation route (`--mode rpc`, "process isolation", `实测`) | None exists |

The inner sandboxes are switched off on both platforms. On Linux nesting works (`实测`), but two policies would drift apart. On macOS a sandboxed process applying a second Seatbelt profile is expected to fail (`猜测`; checked in spike §4.4-3).

**Tests that prove each harness is confined** (written first):

1. `confine-policy.test.ts`: golden `bwrap` argv and SBPL text for each harness profile. The deny and write sets are identical across `claude-code`, `codex` and `pi` except for the own-state-dir entry.
2. `confine-seam.test.ts`: construct each backend with a recording spawner. The recorded argv starts with `bwrap` on Linux and `sandbox-exec` on macOS, for all three harnesses.
3. `confine-structure.test.ts`: no file under `apps/daemon/src/backend/` other than `confine.ts` imports `node:child_process`. An unconfined spawn cannot be added without failing this test.
4. `confine-probe.test.ts` (Linux CI with bubblewrap; a macOS CI job): run a probe under each harness profile and assert:
   - A worktree write succeeds; a `$HOME/escape` write is denied.
   - Reading `~/.ssh/cairn-sentinel`, the daemon-home token and another harness's state dir fails.
   - `/dev/dri` is visible when the host has it.
   - An HTTP request to a local test server succeeds.
   - The daemon's PID is not visible.
5. `confine-harness.e2e` (omarchy and the Mac, real binaries): each harness is pointed at a local fake model endpoint that scripts one shell tool call, `cat ~/.ssh/cairn-sentinel; touch ~/escape`.
   - Claude Code: `ANTHROPIC_BASE_URL`. Codex: a custom provider base URL. pi: a custom provider (`docs/custom-provider.md` in the package).
   - Assert the sentinel text is absent from the tool result and `~/escape` does not exist.
   - Fake endpoints for all three are `推断` from their provider settings; proving them is spike §4.4-2.

### 4.3 What is deleted, what stays, what changes

All of this lands **in the same change as `confine` and the Cua host driver**. There is no freeze period and no compatibility layer.

**Deleted (129 files, about 35,200 lines, `实测` `wc -l`):**

| Area | Files | Lines |
|---|---|---|
| `apps/daemon/src/orb/` (whole directory: `computer`, `container-provider`, `delivery`, `dist`, `lifecycle`, `names`, `podman`, `probe`, `protocol`, `provider`, `relay`, `runtime`, `runtime-fs`, `seed`, `select`, `services-ensure`, `services-runtime`, `services-yaml`, `step`, `worker`) | 20 | 4,518 |
| `apps/daemon/src/computer/` orb and screen-gateway parts: `orb.ts`, `orb-agent.ts`, `orb-protocol.ts`, `input-fence.ts`, `screen-provider.ts`, `screen-channel.ts`, `control-pty.ts`, `view-input.ts` | 8 | (in the 7,154 below) |
| `apps/daemon/scripts/orb-probe.ts` | 1 | |
| Server screen gateway: `apps/server/src/routes-computer-screen.ts`, `apps/server/src/services/computer-screen.ts` | 2 | |
| Shared: `packages/shared/src/orb-services.ts`, `packages/shared/src/protocol/computer-screen.ts` | 2 | |
| Web noVNC panel: `apps/web/src/api/computer-screen.ts`, `apps/web/src/board/computer-screen.tsx`, `apps/web/src/novnc.d.ts` | 3 | |
| Subtotal, source files above | 36 | 7,154 |
| Daemon tests: `computer-input-fence`, `computer-orb-{command-budget,dispatch,input-fence,release}`, `computer-orb`, `computer-screen-provider`, `computer-view-input`, `container-provider`, `orb-{claude-bin,computer,delivery,dist,dist-fixture,fake,hardening,ids,probe,provider,relay,release,release-fixture,runner,runtime,seed,services-ensure,step,transport,watchdog,worker-process,workspace}`, `podman-fake`, `podman-runtime` | 33 | 10,674 |
| Server tests: `computer-screen{,-adapter,-routes,-stream}.test.ts`, `machine-orbs.test.ts` | 5 | 1,389 |
| `scripts/ops/orb/` (whole directory: image builds, `cairn-orb.nspawn`, `50-cairn-orb.rules`, `firewall.nft`, egress relay, canaries, host checks, cleanup, README) | 54 | 16,011 |
| `.github/workflows/orb-trial-report.yml` | 1 | |

**Changed** (the orb branch is removed; nothing is retargeted through a shim):

- `apps/daemon/src/machine-loop.ts`: no `createOrbProvider`, `OrbLifecycle`, `ComputerOrbs`, `OutboundComputerScreens` or orb sweeps; steps call `runStep` directly; the computer provider is the host one.
- `apps/daemon/src/cli.ts`: remove the `orb-step`, `orb-computer` and `orb` subcommands; add `pi-host`.
- `apps/daemon/src/runner.ts`: remove the `CAIRN_ORB` branches.
- `apps/daemon/src/backend/claude-code.ts`: remove `inOrb`; add the `confine` spawner.
- `apps/daemon/src/backend/acp.ts`: add the `confine` spawner and `set_mode full-access`.
- `apps/daemon/src/backend/pi.ts`: move the session into `pi-host`.
- `apps/daemon/src/computer/host-screen*.ts`: switch to Cua Driver.
- Daemon test helpers: `apps/daemon/test/machine-loop-harness.ts`, `apps/daemon/test/computer-presence.test.ts`.
- Shared records: `packages/shared/src/records/machine-capabilities.ts` (drop the `'orb'` executor), `packages/shared/src/protocol/machine-wire.ts` (drop `/api/machine/orbs/closed`), `packages/shared/src/protocol/index.ts`.
- Server: `apps/server/src/services/dispatch-eligibility.ts`, `apps/server/src/services/routing-rules.ts` (drop orb routing), `apps/server/src/routes.ts`, `apps/server/src/index.ts`, `apps/server/src/services/machine-wake-hub.ts` (screen push), `apps/server/src/services/computer-control.ts`.
- `apps/server/src/db/schema.ts`: `computer.kind` `'orb'` → `'host'`, with a migration.
- Web: `apps/web/src/board/machines-panel.tsx` (remove the screen surface); `apps/web/package.json` (drop `@novnc/novnc` and `@types/novnc__novnc`; **the lockfile change needs ian's confirmation**, `CAIRN_ALLOW_LOCKFILE_CHANGE=1`).
- `.github/workflows/ci.yml`: remove the two `scripts/ops/orb` steps.

**Owner-routed (protected) paths in this change:**

- `apps/server/src/routes-machine.ts`: the `/api/machine/orbs/closed` handler goes, and `computer: true` relay bodies now target the host.
- `apps/server/src/services/machine-computer.ts`: the orb machine naming and target selection go.
- `apps/daemon/src/backend/command-gate.ts`: not touched.

**Stays as is**:

- `apps/daemon/src/workspace.ts` and the worktree flow.
- `apps/daemon/src/computer/host.ts`, `dispatch.ts`, `frame-poster.ts`, `presence.ts`, `contained-spawn.ts`, `process-tree.ts`, `guard*.ts`, `provider.ts`.
- The `user_computer_*` tools in `packages/shared/src/protocol/computer.ts`.
- The rest of `apps/server/src/services/machine-computer.ts` (call leases, frames, the `computer`/`computer_call` tables).

### 4.4 Spikes before the change (feasibility)

1. **Host driver comparison, measured 2026-11-09: blocked; no driver selected.** The provisional Cua choice in §4.1 is not an implementation approval. Neither candidate completed the required script. See [method, primary sources, evidence and limits](host-computer-driver-spike-2026-11-09.md). These observations come from the interactive desktop session, not the daemon's environment.

   | Check | agent-desktop 1.1.0 | Cua Driver 0.38.0 |
   | --- | --- | --- |
   | GTK 3 semantic clicks | 3/3 counter increments; batch 1,522 ms | 3/3 counter increments; batch 3,420 ms |
   | Qt Widgets 6.12.0 semantic clicks | 3/3 counter increments; batch 1,583 ms | 0/3 requested; zero dispatched; first read 489 ms; `accessibility_window_identity_unproven` withheld action handles |
   | GTK single-window capture | Refused: `PLATFORM_NOT_SUPPORTED`, 64 ms | Correct 420 × 200 PNG, 25 ms |
   | Qt single-window capture | Refused: `PLATFORM_NOT_SUPPORTED`, 55 ms | Correct 420 × 200 PNG, 42 ms |
   | Background raw `F24`, same unfocused fixtures | 2/2 refused: `STALE_REF`, exact focus unproven; no key sent | 2/2 refused: `background_unavailable`; no foreground retry |
   | Existing-profile Chrome CDP | No CDP command advertised; not verified | Read-only classification returned `browser_consent_required`; setup not invoked; not verified |
   | Mac desktop checks | 0 executed, 0 passes | 0 executed, 0 passes |

   Shared observation interval: **10,993 ms, 967 samples, zero focus events, zero changed focus/pointer samples, zero observer errors**. Maximum sampling gap: **21.65 ms**. No movement was observed; pointer excursions between samples cannot be excluded. Continuous user typing was not instrumented. No complete acceptance pass is claimed. Times are single-run observations, not performance percentiles; click batches include snapshots, counter readback and settling.

   Mac SSH initially worked; Cua 0.38.0 was installed, but its daemon was not running and permissions were unknown. agent-desktop was absent from the checked locations. A later five-second SSH probe timed out. Mac availability is not a background-operation pass.

   No foreground fallback, desktop capture, Chrome setup UI, profile edit, driver dependency, or experimental Hyprland seat plugin was used. Segment 3 is blocked pending a qualifying measured choice. Segment 2's PR must also wait for segment 1's first program PR, which did not exist at measurement time; the unchanged original remains available through research-only PR #3449 and the untouched authoritative local source.
2. **Fake model endpoints** for Claude Code, Codex and pi that script one shell tool call (for test 5).
3. **macOS Seatbelt**:
   - Claude Code and `codex-acp` run inside `sandbox-exec` with their inner sandboxes off.
   - Confirm or refute that a nested Seatbelt profile fails.
4. **pi-host**: the current `pi.ts` session (gated read, env bash, command gate) runs unchanged in a child process.

## 5. Sources not reached

- `learn.microsoft.com/en-us/windows/ai/agent-workspace` returns 404 (`实测`); the Microsoft support page and Windows blog were used.
- "Youzi" (`柚子`) is not identified (§1.1).
- Windows UIA was read through Cua's documentation, not Microsoft's UIA reference.
