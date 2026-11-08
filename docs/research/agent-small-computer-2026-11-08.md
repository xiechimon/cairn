# The agent's own computer: how others build it, and what cairn's lacks

Status: research, 2026-11-08. No code changed and no process touched. Question (ian): cairn gives each agent a computer it can operate, but it feels incomplete. How do other products build theirs?

Evidence labels: `实测` = read or run first-hand in this session (page, source or host command), `推断` = follows from `实测` facts, `猜测` = everything else. cairn code was read at the deployed checkout, commit `a3f51c7c6` (2026-11-07). Host facts come from omarchy on 2026-11-08.

Earlier research this note builds on: `docs/research/coordinator-computer.md` (branch `docs/coordinator-computer`, D75 "copy Rakazo") and `docs/research/orb-container-runtime.md` (D69 item 3).

## 1. Comparison

| Product | Isolation | Desktop / GUI | Persistence | Start time | How the agent drives it | Secrets | Cost | Source |
|---|---|---|---|---|---|---|---|---|
| **Grok Bot** (xAI) | A dedicated Firecracker microVM per user, hosted by Cursor (`*.cursorvm.com`). All of one user's bots share it (`实测`) | Live desktop. The user can take over; the bot hands back control on CAPTCHA or 2FA (`实测`) | A durable disk keeps files and browser sessions. The VM hibernates when idle. Recreating it keeps the disk but loses user-installed packages (`实测`) | First boot and updates take "several minutes". The warm-start time is not stated (`实测`) | Browser, shell, computer use, apps and MCP. Coding can be delegated to Cursor Cloud Agents (`实测`) | Connector tokens stay in Cursor's backend. Vault and Secure Form values are filled into the page without the model seeing them (`实测`) | Draws on the subscription's weekly usage pool (`实测`) | [security-faq](https://docs.x.ai/grok-bot/security-faq), [computers](https://docs.x.ai/grok-bot/computers), [computer-and-apps](https://docs.x.ai/grok-bot/computer-and-apps), [troubleshooting](https://docs.x.ai/grok-bot/troubleshooting), [faq](https://docs.x.ai/grok-bot/faq) |
| **Rakazo** (open source, `elie222/rakazo`, Apache-2.0, created 2026-08-13) | A local **Docker container** by default. The supervisor holds the Docker socket and starts one sibling container per computer. The docs state "The computer container is the security boundary". Pluggable backends: E2B, Daytona, Novita, Railway, Boat, boxd, Incus, and Kubernetes with a kata or gVisor runtime class (`实测`) | Xvfb, fluxbox, x11vnc, noVNC and Chromium. Each bot gets its own X display and a persistent Chrome profile. Supports "Take control" and "Needs you" (`实测`) | The workspace (home) is checkpointed to `DATA_DIR` or S3 (AES-256-GCM) when a run ends, on stop and on idle. The computer hibernates when idle and wakes on use (`实测`) | Not stated. The screen-connect timeout is 15 s (`实测`) | Pi runs **outside** the computer, in the API or worker. Tools: `shell`, file tools, `computer_observe`/`computer_act`, `browser_navigate`/`browser_snapshot`/`browser_act` through agent-browser, and `attach_file` (`实测`) | `request_secret` stores the value encrypted in Postgres. An HTTP-header secret is injected by the backend, and the model never sees it. A "command variable" becomes a shell env var and is readable by the bot (`实测`) | Free to self-host. The hosted plans use Stripe (`实测`) | [repo](https://github.com/elie222/rakazo), [`docs/computer-runtime.md`](https://github.com/elie222/rakazo/blob/main/docs/computer-runtime.md), `docs/bot-secrets.md`, `infra/sandboxes/computer/Dockerfile` |
| Rakazo video `xk-aLMQRYfk` (2026-10-15) | yt-dlp was bot-blocked (`实测`). noembed gives the title "How I Built an Open Source Grok Bot in a Day" by Elie Steinbock (`实测`). **The computer is not an OrbStack or "orb" machine.** OrbStack appears only in a note about putting egress firewall rules in the Linux VM when Docker runs inside one, for example OrbStack on macOS (`实测`, `docs/self-host-docker-computers.md`) | | | | | | | [video](https://www.youtube.com/watch?v=xk-aLMQRYfk) |
| **dots** (OpenAI) | Runs on the ChatGPT Work cloud-computer infrastructure, in "VM-backed sandboxes" on shared, OpenAI-managed hosts. The hypervisor is not disclosed (`实测`; that it is a VM is `推断`) | The user can open the dot's computer, press Take over, and Return control (`实测`) | "Can keep its state between periods of use". The cloud browser's cookies are separate from the user's own (`实测`) | Not stated | Cloud browser, computer use, shell and code, and plugins. It can delegate to Work or Codex cloud, or connect to the user's own computer (one at a time) (`实测`) | A private login form sends the password straight to the cloud browser. Codex network secrets are placeholders swapped for the real value at allowed HTTPS hosts (`实测`) | Pro, Business Premium and Enterprise. Delegated tasks count toward those products' usage (`实测`) | [introducing-dots](https://openai.com/index/introducing-dots/), [dots docs](https://learn.chatgpt.com/docs/dots/computers-and-apps), [dots security](https://learn.chatgpt.com/docs/enterprise/dots-security) |
| **Claude Duet** (Anthropic) | **It exists publicly**: a research preview, US Pro/Max/Ultra, waitlist only (`实测`). The product article says it "has a virtual machine with its own browser". The VM type is not disclosed (`实测`) | "It can't yet show you its browser": no live view and no takeover (`实测`) | Not stated. It checks connected accounts every few hours (`实测`) | Not stated | Browser plus connectors. An auto-mode classifier approves actions, and it asks before sending, paying, signing or deleting (`实测`) | It "never directly sees your passwords or sign-in tokens", following the Managed Agents design (`实测`) | Shares the plan's usage (`实测`) | [product page](https://claude.com/product/claude-duet), [article](https://claude.com/resources/articles/claude-duet) |
| **Anthropic computer-use reference** | A Docker container on `ubuntu:22.04` (`实测`) | Xvfb, mutter, tint2, x11vnc and noVNC. Ports 5900 and 6080, display 1024x768 (`实测`) | None. It is a plain container (`推断`) | Not stated | A client-run computer toolset (`screenshot`, `left_click`, `type`, `zoom`, …) plus bash and text_editor (`实测`) | The docs suggest passing logins in the prompt, with an injection warning (`实测`) | Tokens only: about 4.5k extra input tokens per request and 1–1.8k per screenshot (`实测`) | [quickstart](https://github.com/anthropics/claude-quickstarts/tree/main/computer-use-demo), [docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool) |
| **OpenAI Codex cloud** | A container from the `codex-universal` image. The runtime underneath is not stated (`实测`) | None (`实测`) | The container is cached for up to 12 h. A maintenance script runs on resume (`实测`) | Not stated | Shell loop plus `AGENTS.md` (`实测`) | Secrets reach only the setup script and are removed before the agent phase. The agent's internet is off by default, and egress goes through a proxy with an allowlist (`实测`) | Part of the plan (`猜测`) | [environments](https://developers.openai.com/codex/cloud/environments), [internet access](https://developers.openai.com/codex/cloud/internet-access) |
| **OpenAI Operator / ChatGPT agent** | A remote browser on a "virtual computer". The type is not disclosed (`实测` / `推断`) | Visual browser with "Take over browser". No screenshots are taken during takeover (`实测`) | Cookies persist across sessions (`实测`) | Not stated | CUA model: screenshots plus mouse and keyboard (`实测`) | The user types secrets during takeover (`实测`) | Subscription (`实测`) | [Operator](https://openai.com/index/introducing-operator/), [help](https://help.openai.com/en/articles/11752874-chatgpt-agent). The agent launch page returned 500 (blocked) |
| **e2b** | Firecracker microVM, "not a container" (`实测`) | Desktop template: XFCE, x11vnc and noVNC. The SDK has click, type and screenshot plus an authenticated stream (`实测`) | `pause()` saves filesystem and memory, kept indefinitely. Pausing takes about 4 s per GiB; resuming takes about 1 s (`实测`) | No cold-start number on the pages read | SDK exec and files, SSH over WebSocket (`实测`) | `envs`, or a secret store whose egress proxy injects values into matching HTTPS requests. The value never enters the sandbox (`实测`) | 2 vCPU $0.000028/s + RAM $0.0000045/GiB-s; Pro $150/mo (`实测`) | [security](https://e2b.dev/docs), [persistence](https://e2b.dev/docs/sandbox/persistence), [pricing](https://e2b.dev/pricing) |
| **Daytona** | Linux containers by default, with optional KVM VMs (Linux or Windows) (`实测`) | `computer_use.start()` runs Xvfb, xfce, x11vnc and noVNC, with mouse, keyboard, screenshot and recording APIs (`实测`) | Stop keeps the disk but not memory. Archiving is free. VMs can pause (`实测`) | "Under 90ms" (`实测`, vendor claim) | SDK exec, computer-use API (`实测`) | Placeholder env value `dtn_secret_…`. The proxy swaps in the real value in HTTPS headers to allowlisted hosts (`实测`) | vCPU $0.0504/h, RAM $0.0162/GiB-h (`实测`) | [docs](https://www.daytona.io/docs/en/computer-use), [secrets](https://www.daytona.io/docs/en/secrets), [pricing](https://www.daytona.io/pricing) |
| **Modal Sandboxes** | gVisor or microVMs (`实测`) | None built in (`推断`) | Filesystem snapshots keep 30 days; memory snapshots keep 7 days and are alpha (`实测`) | Not stated | `sb.exec`, tunnels (`实测`) | `modal.Secret` as env vars (`实测`) | $0.00003942 per core-second (`实测`) | [sandbox guide](https://modal.com/docs/guide/sandbox), [pricing](https://modal.com/pricing) |
| **Fly Machines** | A Firecracker VM per Machine (`实测`) | None (`推断`) | Stop resets the rootfs; suspend keeps memory; volumes persist (`实测`) | Starting takes "well under a second"; resuming takes hundreds of ms (`实测`) | Machines API, exec, SSH (`推断`) | An encrypted vault, injected as env vars or files (`实测`) | shared-1x 256 MB $2.19/mo (`实测`) | [overview](https://fly.io/docs/machines/overview/), [suspend](https://fly.io/docs/reference/suspend-resume/), [pricing](https://fly.io/docs/about/pricing/) |
| **Firecracker** | KVM microVM with a jailer and seccomp (`实测`) | n/a | Full snapshots of memory and devices (`实测`) | Under 125 ms to guest init (`实测`) | n/a | n/a | n/a | [SPECIFICATION.md](https://github.com/firecracker-microvm/firecracker/blob/main/SPECIFICATION.md) |
| **OrbStack machines** (macOS) | All machines share one lightweight VM and its kernel ("not independent VMs"). Isolated machines are "not a substitute for a full VM" (`实测`) | Not by default; XQuartz or Xrdp (`实测`) | Persist like VMs (`推断`) | Creation takes under 1 min (`实测`) | `orb -m <name>`, SSH (`实测`) | Mac files and the SSH agent are shared by default (`实测`) | Free for personal use, $8/user/mo commercial (`实测`) | [architecture](https://docs.orbstack.dev/architecture), [machines](https://docs.orbstack.dev/machines/) |
| **cairn today** (§2) | A systemd-nspawn container with a user namespace, cloned from `cairn-orb-computer`. Egress goes only through the filtering relay (`实测`) | Xvfb `:1` 1280x800, fluxbox, two x11vnc servers on Unix sockets, a sealed noVNC gateway and a web panel with Take control (`实测`) | The `/home/agent` bind persists; the image is disposable. Idle stop after 10 min, takeover hold 30 min. No memory snapshot (`实测`) | The nspawn boot to desktop took about 2 s (`推断`, journal 03:19:43 → Chromium 03:19:45) | **The model has no tool that reaches it** (§2.2) | No path at all (`实测`) | Local hardware only | `apps/daemon/src/orb/computer.ts`, `apps/daemon/src/computer/*`, `scripts/ops/orb/build-computer-image.sh` |

Answer to question 1: Rakazo's computer is a **Docker container**, optionally swapped for a remote sandbox (E2B and others) or a kata/gVisor pod. It is not an OrbStack machine and not a VM of its own (`实测`). Grok Bot's computer is a **Firecracker microVM** on Cursor's cloud (`实测`). cairn's "Orb" name comes from Amp's orbs (`docs/research/orb-container-runtime.md`), not from OrbStack.

## 2. cairn's current implementation

### 2.1 What exists (`实测`, deployed checkout `a3f51c7c6`)

- **Image.** `scripts/ops/orb/build-computer-image.sh` snapshots `cairn-orb-base` into `cairn-orb-computer` and adds `xorg-server-xvfb x11vnc fluxbox xdotool chromium imagemagick`, a Chromium managed policy, `cairn-computer-desktop.service` and `cairn-computer-agent.service` (`scripts/ops/orb/README.md` §"Coordinator computer image (D75)").
- **Lifecycle.** `ComputerOrbs` (`apps/daemon/src/orb/computer.ts`) runs `machinectl clone`, `start`, `poweroff` and `terminate` directly. The scope is one computer per Coordinator: `scopeKey = chief:<chiefId>`, and the name is `cairn-orb-computer-<sha256(scope)[:40]>`. Idle stop is `COMPUTER_IDLE_STOP_MS = 10 min` and takeover hold is `30 min`. State lives in `<CAIRN_HOME>/orb-state/computers.json`, read only at construction.
- **Provider wiring.** `machine-loop.ts:208-223` builds `ComputerOrbs` and `OrbComputerProvider` only when the worker provider is `NspawnOrbProvider`. The Podman and E2B providers (`orb/select.ts:104-111`) have no computer.
- **Transport.** The guest agent dials `/run/cairn/computer.sock` with a token and release key (`computer/orb.ts`, `orb-protocol.ts`). Its methods are `execute`, `listFiles`, `readFile` and `writeFile`.
- **Server side.** `services/machine-computer.ts` implements `forwardComputerCall`, target selection, leases, deadlines, redacted output frames and the `computer` and `computer_call` tables. `routes-machine.ts:497` accepts relay bodies carrying `computer: true`. There are also a screen gateway (#2880), a panel (#2855, `apps/web/src/board/computer-screen.tsx` with noVNC) and takeover (`services/computer-control.ts`).
- **Merged PRs.** The D75 PRs #2687, #2699, #2701, #2702, #2707, #2708, #2764, #2797, #2855, #2877, #2880 and #2985 are merged (`实测`, `gh pr list`). #2743 (`user_computer_shell` on ian's own computer) is closed.

### 2.2 What is missing in the code (`实测`)

1. **The model is never given computer tools.**
   - The Coordinator's tool list is `CHIEF_REMOTE_TOOLS` and `CHIEF_ROUTER_TOOLS` (`packages/shared/src/protocol/chief-tools.ts:198`). Neither contains `shell`, `computer_*`, `browser_*` or `attach_file`.
   - `coordinatorTool` (`apps/server/src/coordinator/runtime/tools.ts`) relays `{name, params}` without `computer: true`.
   - The only producer of `computer: true` relay bodies is in tests (`apps/server/test/machine-computer-forward.test.ts`).
   - Planned P6 ("sidecar tools", `coordinator-computer.md` §5) targeted `apps/coordinator`, which now holds only `node_modules`. D114 (#3304) retired the sidecar before P6 landed (`推断`).
   - Result: the whole pipe from server to daemon to Orb to panel is built, but nothing calls it.
2. **The Orb route serves only shell and files.**
   - `ORB_TOOLS` in `apps/daemon/src/computer/dispatch.ts:48` is `shell, list_files, read_file, write_file`.
   - `computer_observe`, `computer_act`, `open_path`, `launch_app`, `attach_file` and `browser_navigate`/`browser_snapshot`/`browser_act` are in the shared enum but return `NO_COMPUTER_PROVIDER_MESSAGE` on the Orb.
   - Screen observe and act exist only for `user_computer_*` on the host screen.
   - The image already has `xdotool` and `import`, so screenshot and click are only missing an adapter (`推断`).
   - P9 (browser on agent-browser) has not landed.
3. **No secret path.**
   - Nothing hands a secret to the computer: no `request_secret`, no secure form and no proxy-side injection.
   - The guard tells the model to read "the saved command credential from os.environ" (`computer/guard.ts:593`), but no code fills that env for the Orb.
4. **The lifecycle has no supervisor of its own.** The computer lives and dies with one daemon process (§2.3).
5. **Single backend.**
   - The computer runs only on nspawn. `ComputerOrbs` shells out to `machinectl`.
   - The `OrbRuntime` rebuild (`orb-container-runtime.md` §9) has not reached the computer, so there is no Mac, Podman or E2B computer.
6. **Persistence is home-only.**
   - There is no memory or full-disk snapshot, and no checkpoint of the home off the host. Rakazo checkpoints to S3; e2b and Fly pause memory.
   - Packages installed outside `/home/agent` are lost on re-clone. Grok has the same limit.

### 2.3 The machine and the keep-alive loops on omarchy (`实测`, 2026-11-08)

- **The machine.** `machinectl list` shows one machine: `cairn-orb-computer-<hash>`. It has been up since **2026-11-05 03:19:43 PST**. `computers.json` maps it to one Coordinator scope (`chief:<chiefId>`). Its unit uses about 24 MB of RAM and has 507 CPU-seconds in total.
- **The two loops.**

| PID | Started (PST) | Every | What it does |
|---|---|---|---|
| 2003019 | 11-05 03:20:08 | 30 s | Rewrites the side daemon's `orb-state/computers.json` with `lastUsedAt=now` and `holdUntil=now+12h`, then `machinectl start` if the machine is gone |
| 2014954 | 11-05 03:24:03 | 20 s | `machinectl start` only, if the machine is gone |

- **Who started them.**
  - Both loops are `nohup bash -c …` with parent PID 1, the user's home as cwd, and no `TERM`.
  - They belong to two separate non-interactive SSH logins as `ian`: `session-268` (03:20:07) and `session-273`. `loginctl` gives a tailnet `RemoteHost` (`<tailnet-ip>`), which `tailscale status` resolves to the Mac.
  - So a process on ian's **Mac** ran `ssh omarchy 'nohup bash -c …'` twice (`推断`: both sessions show the same `SSH_CLIENT`).
- **Timing against the daemon.**
  - The daemon behind this computer runs with its own separate `CAIRN_HOME`. Its log shows restarts at 03:06:56, 03:06:59 and 03:19:41, then `Shutting down… (SIGTERM)` at **03:23:58**. It has not run since; no process uses that home.
  - Loop 2 started 5 s after that shutdown.
  - At 03:19:45–49 the guest journal shows `systemd-run` starting Chromium on a test page, then `xdotool type "CAIRN PANEL AMC"` and `import -window root`.
  - Taken together: the loops come from a session collecting D75 panel evidence. It worked around the 10-minute idle stop, then stopped the daemon and kept the computer up by hand (`推断`).
- **Which transcript issued them: not found (`实测`).**
  - Searched the Claude Code and Codex session transcript stores on omarchy (files changed since 11-05 03:00) and on the Mac, including archived sessions, the thread-history database and the Claude desktop app's data directory. The search strings were the loop text, the machine hash and `CAIRN PANEL AMC`.
  - Neither host has a Codex `sessions/2026/11/05` directory. The source is probably a Codex or cairn-lane session from 11-05 whose rollout is not on disk (`猜测`).
- **Effect now.**
  - Nothing idle-stops the machine, because its daemon is dead. Loop 1's `computers.json` edits only take effect at the next daemon start: that daemon would see a 12 h hold and not stop it.
  - The loops are leftover state, not product behavior. Left in place, they keep a desktop with Chromium running with no consumer and would restart it after any manual stop (`推断`).
  - Per the brief, nothing was stopped or changed.

## 3. Gaps compared with the others

| Gap | Who has it | cairn |
|---|---|---|
| Agent can actually call shell, screen and browser tools | Grok, Rakazo, dots, e2b and Daytona SDKs | No tool definitions in the Coordinator (§2.2-1) |
| Screenshot and act on its own desktop | Rakazo `computer_observe/act`, Anthropic toolset, e2b and Daytona computer-use APIs | Desktop exists but the Orb route refuses screen tools (§2.2-2) |
| Browser tools on page refs, not pixels | Rakazo `browser_*` via agent-browser, Operator CUA | Enum only |
| Secrets the model never sees | Grok Vault and Secure Form, dots private login, e2b and Daytona proxy injection, Codex secrets limited to setup | None |
| Lifecycle owned by a supervisor: hibernate when idle, wake on use, survives daemon restarts | Grok hibernate, Rakazo idle suspend and wake, Fly suspend | Tied to one daemon process; hand-run loops filled in (§2.3) |
| Checkpoint beyond the local disk | Rakazo S3 checkpoint, e2b pause, Modal snapshots | Local bind only |
| Swappable backend (local container, remote microVM) | Rakazo `SandboxProvider`, E2B/Daytona adapters | nspawn only for the computer |
| Measured start and wake time | Firecracker, Fly and Daytona publish numbers | Not measured |
| One computer per user, many bot screens | Grok per-user VM; Rakazo per-bot display on one computer | One per Coordinator. Build orbs have no desktop (by design, D75) |
| Live view and takeover | Grok, Rakazo, dots, Operator | **Present** (gateway, panel, control) |
| Network egress control | Codex proxy allowlist, Rakazo restricted egress, Daytona allowlist | **Present** (relay plus nft, 403 on private addresses) |

## 4. The pattern that fits cairn

Rakazo's split, which Grok and dots share: **the agent runtime stays outside the computer; the computer is one persistent per-user box behind a provider interface. It carries a disposable image, a durable home, a desktop with takeover, and secrets injected outside the box.** Why this pattern fits:

- cairn already chose it (D75, "copy Rakazo"), and most of the plumbing is merged (§2.1). The missing pieces are the edges: tools, screen and browser adapters, secrets and lifecycle. They are not new architecture (`推断`).
- The Coordinator now runs in the server (D114). That matches Rakazo, where Pi runs in the API process, more closely than the sidecar plan did. Tools can be registered next to `CHIEF_REMOTE_TOOLS` directly (`推断`).
- The isolation level matches the threat. Rakazo and the Anthropic reference treat the container as the boundary; cairn's nspawn with userns and relay-only egress is at least that strong (`推断`). A microVM (e2b, Fly) is the upgrade path if it has to run remote or multi-tenant. It should be a second provider, not a rewrite.
- For secrets, proxy-side injection (e2b, Daytona, Codex placeholders) fits cairn's existing egress relay better than env vars. Rakazo's command variables leak the value to the bot (`实测`), so they are the pattern to avoid.

## 5. Recommendation, in order

1. **Give the Coordinator the tools.** This is the main gap, and the rest is useless without it.
   - Add a `COMPUTER_REMOTE_TOOLS` list (Rakazo names and shapes from `coordinator-computer.md` §3.4) in `packages/shared/src/protocol/chief-tools.ts` or a sibling `computer-tools.ts`.
   - Register them in `apps/server/src/coordinator/runtime/tools.ts`. They should relay with `computer: true` through `machine-api.ts`, or call `forwardComputerCall` in-process now that the Coordinator lives in the server.
   - Replay comes from `COMPUTER_REPLAY_SAFE_TOOLS`.
   - Add a test that every `COMPUTER_TOOLS` entry is either offered or explicitly withheld, so an enum value can never again exist with no producer.
2. **Screen tools on the Orb.**
   - Implement `computer_observe` (`import -window root`, downscaled) and `computer_act` (`xdotool`) in the guest agent (`apps/daemon/src/computer/orb-agent.ts`, `orb-protocol.ts`).
   - Add them to `ORB_TOOLS` in `computer/dispatch.ts`, reusing the frame and image path the host screen already uses (`host-screen.ts`).
   - Then `attach_file`.
3. **Browser tools (P9).** Use agent-browser in the computer image (`scripts/ops/orb/build-computer-image.sh`, `apps/daemon/src/computer/browser*.ts`), as Rakazo does with `pageBrowser`. Ship it after the gates in `coordinator-computer.md` §3.6.
4. **Secrets outside the box.** Add placeholder-plus-proxy injection in `scripts/ops/orb/egress-relay.mjs`, with values from `apps/server/src/services/secrets.ts`, which is a protected path. Add a secure takeover login for websites, which already matches D75 decision ④. Remove the `os.environ` hint in `computer/guard.ts:593` until a real path exists.
5. **Lifecycle that does not need hand loops.**
   - The computer's daemon must run as a supervised unit (`docs/ops/` deploy units for omarchy), not an ad-hoc `CAIRN_HOME`.
   - `ComputerOrbs` should wake on use (it already does through `ensure`) and hibernate on idle.
   - Add a host check that flags stray `machinectl start` loops and computers whose owning daemon is down (`scripts/ops/orb/orb-host-check.mjs`).
   - Measure cold start and wake time in that check.
6. **Provider seam for the computer.**
   - Move `ComputerOrbs` off direct `machinectl` calls onto the `OrbRuntime` interface (`orb-container-runtime.md` §9; `apps/daemon/src/orb/container-provider.ts`, `podman.ts`).
   - Add an E2B desktop provider later (`orb/e2b-provider.ts`), since e2b ships the same Xvfb/x11vnc/noVNC stack and pause/resume.
   - Optional: checkpoint the home off-host the way Rakazo does.
7. **The leftover loops on omarchy.** ian killed PIDs 2003019 and 2014954 on 2026-11-08. They no longer exist (`实测`, `ps`), and he ruled that such band-aids must never exist again. The machine `cairn-orb-computer-<hash>` is still running with no owning daemon (`实测`). The root cause and the fix are in §6.3.

Steps 1, 2 and 4 touch protected paths (`routes-machine.ts`, `services/machine*.ts`, `services/secrets.ts`, `apps/daemon/src/backend/command-gate.ts` if the guard moves). They go on the owner route.

## 6. Follow-up (ian, 2026-11-08): nspawn or microVM, Amp's orbs, cost, and the keep-alive root cause

Host facts in this section were read on omarchy on 2026-11-08 with read-only commands. Nothing was stopped, started or changed.

### 6.1 Why nspawn and not a Firecracker microVM

**The decision trail (`实测`, quoted from the plan and issues).**

| When | Where | What it says |
|---|---|---|
| 2026-10-31 | The cairn plan document §8.3, epic `orb-lite` | One nspawn container per task on omarchy (`MemoryMax=4G`, `CPUQuota=400%`, two in parallel), "= Amp's orb". Roadmap row E2.5: phase 1 uses nspawn orb-lite. Paid cloud sandboxes were phase 2, later replaced by bring-your-own-key E2B/Daytona in D101 |
| 2026-10-31 | Issue #2273, "Provision omarchy for per-task nspawn containers" | Its only stated premise is the host: "omarchy has the nspawn tooling but no image, no privilege path for the `ian` user, and no container egress." Plan §10 lists omarchy as "docker / bwrap / nspawn" |
| 2026-10-31 | Issue #2274, PR #2309, `OrbProvider` seam | "The shape follows the Open-Inspect infra package … so a paid cloud provider can plug in later." The cap is `CAIRN_ORB_MAX` 2, from "about 12 GB available on omarchy, 4 GB per orb" |
| 2026-11-01 | D55 | The thesis is real per-task Orb isolation (nspawn) |
| 2026-11-02 | **D69 ③** (decided; ian approved on 11-02) | Redo the Orb with a dispatch contract and a swappable runtime (rootless Docker or Podman on omarchy, Apple `container` or OrbStack on the Mac). Isolation comes from the container boundary plus egress limits, and the pacstrap/sudo/polkit dependencies go |
| 2026-11-04 | `docs/research/orb-container-runtime.md` §1 | Rates "microVM (E2B Firecracker, Kata)" as "Own kernel per sandbox; strongest, but needs KVM and a new runtime stack", and "A microVM is the upgrade path if container escape becomes the threat model; the interface below does not preclude it." Keeping nspawn was rejected because it "needs pacstrap, root-owned units, polkit rule, host nft" |
| 2026-11-03 | D75, `coordinator-computer.md` | The Coordinator computer is "a persistent nspawn Orb", built on the existing `cairn-orb-base` image. Spike S1 proved Chromium keeps its own sandbox inside nspawn |

**Conclusion (`推断` from the rows above).**

- Nobody ever compared nspawn with a microVM on the merits and picked nspawn. It was picked because it was already on the host and phase 1 had to be cheap. The plan always deferred stronger isolation to a provider swap.
- The newest decision on runtime (D69 ③) already says to leave nspawn for rootless Podman. The Coordinator computer (D75) stayed on nspawn only because the Podman work (D69 PR 6) had not reached `ComputerOrbs`.
- `实测` supporting this: a Podman image `localhost/cairn-orb-computer` (2.52 GB) exists on omarchy (`podman images`). `ComputerOrbs` still calls `machinectl` only (`orb/computer.ts`).

**Comparison on this host.**

- The host is an Intel i5-14400 (10 cores / 16 threads, `lscpu`; that is a desktop part, though the brief calls it a laptop) with 31 GiB RAM, a 62 GiB swap file and btrfs root (`实测`).
- `/dev/kvm` exists, mode `crw-rw-rw-`, group `kvm` (`实测`). The CPU flags show `vmx` and `kvm_intel` is loaded with `nested=Y` (`实测`).
- So KVM works here, and so does nesting, for example Firecracker inside a VM (`实测`/`推断`).
- `firecracker 1.17.0`, `libkrun 1.19.6` and `qemu-base 11.1.2` are in Arch `extra` and not installed. `cloud-hypervisor`, `gvisor` and `kata-containers` are not in the official repos (`实测`, `pacman -Si`).
- `crun 1.30.1` is installed and built with `+LIBKRUN`, next to rootless `podman 6.1.4` (`实测`, `crun --version`, `podman info`).

| Axis | nspawn today (`PrivateUsers=pick`, relay-only egress) | Rootless Podman + crun (D69 ③) | Firecracker microVM |
|---|---|---|---|
| Isolation | Shared host kernel. The man page says a user namespace "massively enhances container security", and that `--uid` "is not a security feature" on its own (`实测`, `man systemd-nspawn`, systemd 262). A kernel bug means host escape (`推断`) | Shared kernel, plus seccomp, no capabilities and an unprivileged subuid root (`实测`, `docs/verify/d69-orb-containers/README.md`). Same kernel risk (`推断`, `orb-container-runtime.md` §5) | Own guest kernel behind KVM, a minimal device model, and a jailer with seccomp (`实测`, [SPECIFICATION](https://github.com/firecracker-microvm/firecracker/blob/main/SPECIFICATION.md)). The strongest of the three |
| Boot | **1.3 s** from `Starting Container` to `Started Cairn computer desktop` (`实测`, unit journal 03:19:43.355 → 03:19:44.658) | About the same or less: no systemd inside (`推断`, `orb-container-runtime.md` §3) | ≤125 ms to guest init on a minimal guest (`实测`, spec). A full Arch userspace with Xvfb and Chromium adds userspace start time; 1–2 s is plausible (`猜测`) |
| Memory per instance | Shares host page cache. The idle computer now is **20 MB resident + 407 MB swapped**, peak **1.68 GB** with Chromium, under `memory.max` 4 GiB (`实测`, cgroup files) | Same model as nspawn (`推断`) | VMM ≤5 MiB (`实测`, spec), but guest RAM is a reservation the guest kernel owns. Without the balloon device ([ballooning.md](https://github.com/firecracker-microvm/firecracker/blob/main/docs/ballooning.md), free-page reporting) the host cannot take it back (`推断`). A Chromium desktop needs about 1.5–2 GiB booked per VM (`推断` from the 1.68 GB peak) |
| Disk / CoW | btrfs subvolume clones (`machinectl clone`), instant and shared (`实测`, `machinectl list-images`: type `subvolume`). Home 154 MB (`实测`, `du`) | Overlay layers, `podman commit` snapshots (`实测` doc, `orb-container-runtime.md`) | Raw block images. CoW needs `cp --reflink` on btrfs or device-mapper (`推断`). Full memory+device snapshots supported; diff snapshots are a developer preview (`实测`, `docs/snapshotting/snapshot-support.md`) |
| GUI | Xvfb + x11vnc on a Unix socket bind work now (`实测`) | Same stack. Rakazo and the Anthropic reference run it in Docker (`实测`) | No display device (`实测`, README "excludes unnecessary devices"), but Xvfb is software, so it works inside the guest. VNC has to cross vsock or the tap network instead of a bind-mounted socket (`推断`) |
| Operational burden | pacstrap images, root-owned units, a polkit rule, host nft, `prepare-machine.sh` as root (`实测`, `scripts/ops/orb/`) | No host root at run time; one Dockerfile (`实测`, D69 ③ and the research doc) | A guest kernel and rootfs to build and patch, tap or netns setup with `CAP_NET_ADMIN`, jailer paths that must be root-owned (`实测`, [prod-host-setup.md](https://github.com/firecracker-microvm/firecracker/blob/main/docs/prod-host-setup.md)), plus vsock plumbing for relay, computer and screen sockets. A whole new runtime stack (`推断`) |
| Ways it can take the host down | Unbounded memory is capped by cgroup (4 GiB, 400% CPU, 4096 pids, `实测`). A container kernel exploit is host root (`推断`) | Same caps from the user slice (`实测`) | Firecracker docs warn that misconfiguration "can lead to unbound memory or storage usage on the host side" (`实测`). Booked guest RAM plus host swap is the main risk on a 31 GiB host that is already 29 GiB into swap (`推断`). A KVM bug is rarer than a namespace bug (`猜测`) |

**Middle options (`实测` from each project's primary docs).**

- **gVisor:** "an application kernel … written in a memory-safe language (Go) and runs in userspace", with "small fixed overheads and a dynamic resource footprint". Its network stack and some syscalls are "not as optimized" ([docs](https://gvisor.dev/docs/), [performance](https://gvisor.dev/docs/architecture_guide/performance/)). Not in Arch repos. Fit: a drop-in `--runtime runsc` for Podman. It keeps container memory behavior, and Chromium's own sandbox inside gVisor would need a spike (`猜测`).
- **Kata Containers:** "lightweight Virtual Machines (VMs) that feel and perform like containers", with QEMU, Cloud Hypervisor or Firecracker as the hypervisor ([README](https://github.com/kata-containers/kata-containers)). Heavier to install: not packaged in Arch.
- **libkrun (crun `--runtime krun`):** "a dynamic library that allows programs to easily acquire the ability to run processes in a partially isolated environment using KVM", used "by Podman via `--runtime=krun`" ([libkrun](https://github.com/containers/libkrun), [krun.1](https://github.com/containers/crun/blob/main/krun.1.md)). Its caution: "The VM boundary does not restrict host resources exposed through devices."
  - On this host it is the cheapest path to a VM boundary: crun already has `+LIBKRUN`, and `libkrun` is one `pacman` package away (`实测`). It reuses the same OCI image and Podman flags as D69 ③ (`推断`).
- **Cloud Hypervisor:** a Rust VMM on KVM with "minimal emulation", "low memory footprint", CPU/memory/PCI hotplug and migration ([README](https://github.com/cloud-hypervisor/cloud-hypervisor)). Useful through Kata, or for a later persistent desktop VM that needs memory hotplug. Not in Arch repos.

### 6.2 Amp: orb per thread, on e2b; cairn: per conversation, plus one persistent computer

**Amp (`实测`).**

- The manual says orbs are "Machines that Amp creates **per thread**" ([manual](https://ampcode.com/manual)). The orbs overview says "Every orb thread gets a fresh, isolated environment" ([orbs](https://ampcode.com/docs/orbs)).
- The self-hosted page says "The provider spawns an orb per thread". It also says that when a thread goes idle "Amp sends `pause`, and the next message sends `spawn` again to resume the same orb" ([self-hosted](https://ampcode.com/docs/orbs/self-hosted)).
- Hosted orbs pause after 5 min of no agent work or 20 min of no interaction, whichever is later. Sizes run from `a1.tiny` (1 CPU / 2 GB, $0.08/h) to `a1.3xlarge`, all with 60 GB disk ([sizes-and-costs](https://ampcode.com/docs/orbs/sizes-and-costs)).
- What hosted orbs run on: Amp's security page lists "e2b provides ephemeral compute instances for Amp orbs" ([security](https://ampcode.com/security)). e2b states "Every sandbox is a Firecracker microVM, not a container" (§1). So Amp-hosted orbs are **remote Firecracker microVMs on e2b** (`推断` from the two `实测` statements).
- Hosted orbs "save disk and memory" on pause. The self-hosted examples (Docker, Apple containers, Kubernetes, E2B, Modal, Vercel, Daytona) differ, and only E2B also keeps memory (`实测`, self-hosted page table).
- Thorsten Ball, of Amp: "Yes, they are VMs, or sandboxes, or whatever you want to call them" ([orbs-explained](https://ampcode.com/notes/orbs-explained)).

**cairn today (`实测`, deployed checkout `a3f51c7c6`).**

- **Build orbs: one per conversation.**
  - `OrbLifecycle.acquire` looks up `handles.find((orb) => orb.conversationId === input.conversationId)` (`apps/daemon/src/orb/lifecycle.ts:48`), so later steps of the same conversation reuse the orb.
  - It stops after `ORB_IDLE_STOP_MS = 20 min` and is removed after `ORB_IDLE_REMOVE_MS = 72 h` idle or when the conversation closes (`lifecycle.ts:3-4, 88-92`). Names come from `orbMachineName(conversationId)` (`orb/names.ts:5`).
  - This is Amp's per-thread model, without memory-preserving pause (`推断`).
- **The Coordinator computer: one persistent computer per user × team.**
  - `scopeKey = chief:<chiefId>` (`apps/server/src/services/machine-computer.ts:562`). One `ComputerOrbs` entry per scope, 10 min idle stop, home kept on `/var/lib/cairn-computer/<machine>` (`orb/computer.ts`, `scripts/ops/orb/README.md`).
  - This matches Grok Bot's one computer per user.
- **In production, neither is on.**
  - `cairn-daemon.service` has no `CAIRN_EXECUTOR` (`实测`, `systemctl --user cat cairn-daemon.service` and the main PID's environment).
  - `createOrbProvider` therefore returns `HostOrbProvider` (`orb/select.ts:104`): builds run on the host as `ian`, and no `ComputerOrbs` is built (`machine-loop.ts:208-214` requires `NspawnOrbProvider`).
  - The running computer came from a separate hand-started daemon (§6.3).

### 6.3 What the computer costs now, and why it needed keep-alive loops

**Cost now (`实测`, 2026-11-08 ~02:55 PST).**

| Measure | Value | Source |
|---|---|---|
| Tasks | 19 | `systemd-cgtop -b machine.slice` |
| CPU | 0.3% now; 507 CPU-s over 3 days | cgtop, `systemctl show … CPUUsageNSec` |
| RAM | 20.7 MB resident (anon 9.5 MB), 407 MB in swap, peak 1.68 GB | `memory.current`, `memory.swap.current`, `memory.peak` |
| Limits | `memory.max` 4 GiB, `cpu.max` 400000/100000, `pids.max` 4096 | cgroup files |
| Disk | Home 154 MB; image is a btrfs CoW clone of `cairn-orb-computer` (exclusive size not readable without root) | `du`, `machinectl image-status` |
| Boot to desktop | 1.3 s | unit journal |
| Processes | systemd, journald, logind, networkd, dbus, Xvfb, fluxbox, 2× x11vnc. `cairn-computer-agent` has been stuck in `while [ ! -S /run/cairn/computer.sock ]; do sleep 1; done` since its daemon died, so the computer is up but unusable | `machinectl status` |

**What actually loads the host (`实测`).**

- Memory: 28 GiB of 31 used, 2.9 GiB available, 29 GiB of swap used. `/proc/pressure/memory` shows `some avg300=8.91`, `full avg300=4.44`. The load average was 35 on 16 threads.
- The largest RSS groups are `node-MainThread` 6.5 GB, `chrome-headless` 6.4 GB, `MainThread` 4.6 GB and `chrome` 1.7 GB.
- More than ten `tsx … apps/server` dev servers from worktrees are alive. `cairn-daemon.service` alone accounts for 6.2 GB of `MemoryCurrent`, child agents included.
- The idle computer is about 0.1% of the problem.
- `推断`: the Xvfb/x11vnc stack is cheap when idle. Cost only appears while Chromium runs, about 1–1.7 GB. The pressure that makes omarchy slow comes from e2e browsers, dev servers and agent processes, not from the nspawn computer.

**Root cause of the keep-alive loops.** These causes stack.

1. **The idle stop counts only agent calls (`实测` code; `推断` effect).**
   - `ComputerOrbs.sweep()` runs every 60 s (`machine-loop.ts:553-560`). It stops a computer once `now - lastUsedAt >= 10 min` and `now >= holdUntil` (`orb/computer.ts` `idle()`).
   - `lastUsedAt` moves only on `ensure` and on `touch` from `OrbComputerProvider` during agent calls (`computer/orb.ts:561, 591, 623`).
   - An open screen viewer calls `ensureComputer` once at connect and never again (`computer/screen-provider.ts:154`).
   - `hold()`, the 30-minute takeover grace, is defined but never called anywhere (`grep` finds only its definition).
   - `isBusy` is not passed in `machine-loop.ts:210-213`, so it defaults to `false`.
   - Because the model has no computer tools (§2.2-1), nothing ever touches the computer. **Every computer is powered off 10 min after it is opened, even while ian is watching or controlling the screen.**
   - The evidence session at 03:19 needed the screen to stay up longer than that. Loop 1 wrote `holdUntil=now+12h` into `computers.json` for exactly this reason (`推断` from its code).
2. **The computer lives in an ad-hoc daemon, not the production one (`实测`).**
   - Production `cairn-daemon.service` runs without `CAIRN_EXECUTOR=orb`, so it has no computer at all (§6.2).
   - The computer was served by a second, hand-started daemon with its own separate `CAIRN_HOME`. Its log shows enrolment at 03:06:57, restarts at 03:06:59 and 03:19:41, and `SIGTERM` at 03:23:58. Nothing restarted it: there is no unit.
   - Once it was gone, the machine had no owner, so the second loop just re-ran `machinectl start` (`推断`).
3. **The state file is read only at construction (`实测`, `ComputerOrbs` constructor).** Editing `computers.json` from outside has no effect on a running daemon, and `save()` overwrites it. The loop's own comment admits this ("if daemon uses in-memory only").
4. **The computer is tied to the worker executor (`实测`, `machine-loop.ts:208-223`).** Enabling the computer means `CAIRN_EXECUTOR=orb`, which also moves every build into nspawn Orbs. That is a large switch to flip just to get a desktop, which is a plausible reason someone ran a side daemon instead (`猜测`).
5. An unexplained stop: the first boot at 03:07:37 was powered off at 03:11:09, only 3.5 min later. That is not the 10-minute sweep. The cause is unknown; a 60 s `waitForRuntime` failure or a manual stop are candidates (`猜测`).

**Proper fix: make the band-aid impossible, not discouraged.**

- **Leases, not timestamps.**
  - Replace `lastUsedAt`/`holdUntil` with live leases: in-flight agent call, open viewer, control lease, takeover grace. Stop only when no lease is live and the last one ended at least 10 min ago.
  - Viewer connections register a lease for their lifetime (`computer/screen-channel.ts`, `screen-provider.ts`). Takeover calls the lease API (`services/computer-control.ts` → daemon). Wire `isBusy` to in-flight calls.
  - Add a red-first test: "a computer with an open viewer is never stopped by the sweep".
- **One owner, supervised.**
  - The computer belongs to the production daemon under `cairn-daemon.service`, with a separate capability flag (for example `CAIRN_COMPUTER=orb`), independent of `CAIRN_EXECUTOR`.
  - `ComputerOrbs` construction moves out of the `orbProvider instanceof NspawnOrbProvider` branch in `machine-loop.ts`.
  - A second daemon on the same host must refuse to start a computer: `prepare-machine.sh` or the daemon checks the enrolled owner recorded with the machine.
- **Orphans are reported, never kept alive.**
  - `scripts/ops/orb/orb-host-check.mjs` gains two checks. One lists running `cairn-orb-computer-*` machines with no live owning daemon. The other lists any process outside the daemon's cgroup whose command line runs `machinectl start cairn-orb-*`. Both fail the check.
  - Wake-on-use already exists (`ensure` from the screen and from calls), so with a 1.3 s boot nothing ever needs to be kept up artificially.
- **No external state edits.** The state file stays private (0600, `实测`) and read once. Lease state is in memory plus `computers.json` and is written only by the daemon.

### 6.4 Recommendation

**Hybrid. Keep a container boundary for both kinds of machine on omarchy, finish the move to rootless Podman (D69 ③), and fix the lifecycle first. Add a VM boundary as an opt-in provider through libkrun (`crun --runtime krun`), with E2B (Firecracker) as the remote option. Do not make a local Firecracker stack the default.** Reasons:

- The real constraint on this host is memory pressure (§6.3), not isolation.
  - Containers give memory back when idle: 20 MB now. A microVM books its guest RAM unless ballooning is set up (`推断`).
  - On a host already 29 GiB into swap, booked guest RAM is the failure that takes the machine down (`推断`).
- A microVM's isolation advantage matters for untrusted web content.
  - The Coordinator computer is exactly where untrusted pages get opened (D75: work that reads untrusted content, such as browsing, goes in the Orb).
  - libkrun gives a KVM boundary with the same OCI image and Podman flags, and crun on this host already supports it (`实测`). It is a runtime flag on one provider, not a new stack (`推断`).
  - A local Firecracker stack would mean a guest kernel, tap networking, jailer and vsock plumbing for what D69 ③ already solved with sockets (`推断`).
- Per-task ephemeral sandboxes already exist as per-conversation build orbs (§6.2). Remote E2B (D101) is the burst option and costs the host nothing.

**Resource budget for omarchy (31 GiB, 16 threads).** These are proposals, `推断` from the measurements above.

| Item | Budget | Basis |
|---|---|---|
| Coordinator computer (one) | `MemoryHigh=1.5G`, `MemoryMax=2G`, `CPUQuota=200%`, `TasksMax=1024`. Idle cost about 20–50 MB | Peak 1.68 GB with Chromium; idle 20 MB (`实测`) |
| Build orbs | 2 × (`MemoryMax=4G`, `CPUQuota=400%`), as in the plan; queue beyond that (`CAIRN_ORB_MAX=2`) | Plan §10, #2274 (`实测` doc) |
| All cairn sandboxes together | A parent slice `cairn-orb.slice` with `MemoryMax=10G`, so sandboxes can never push the host into OOM | 31 GiB total minus the host's own about 15 GiB user slice (`实测` `user-1000.slice`) |
| libkrun VM computer (opt-in) | Guest `--memory 2048`, 2 vCPU; count the whole 2 GiB against the slice | Fixed guest booking (`推断`) |
| Remote (E2B) | No host budget; user pays about $0.17/h for 2 vCPU/4 GB (D101) | Plan D101 (`实测` doc) |

Separately: the swap and PSI numbers say omarchy needs a cap on dev servers and headless browsers (`e2e:affected` slots, stale `tsx` servers) more than it needs a different sandbox. That is an ops ticket, not part of this design (`推断`).

**Migration path behind `OrbRuntime`** (interface from `docs/research/orb-container-runtime.md` §2).

1. **Lifecycle fix (no runtime change).**
   - Leases, owner and orphan checks as in §6.3, in `apps/daemon/src/orb/computer.ts`, `computer/screen-*.ts`, `machine-loop.ts`, `services/computer-control.ts` and `scripts/ops/orb/orb-host-check.mjs`.
   - Decouple the computer from `CAIRN_EXECUTOR` and run it in `cairn-daemon.service`.
   - Add the model's computer tools (§5 step 1), so `touch` comes from real use.
2. **Computer on `OrbRuntime`.**
   - Rebuild `ComputerOrbs` on `OrbRuntime` (`orb/container-provider.ts`, `orb/podman.ts`), using the existing `localhost/cairn-orb-computer` image.
   - The home becomes a named volume, and the computer and screen sockets become directory binds as today.
   - nspawn stays as a provider until Podman passes the same canary (`scripts/ops/orb/canary.mjs`), then it is removed. That also removes pacstrap, polkit and root units (D69 ③).
3. **VM runtime as an option.**
   - Add `OrbRuntimeName = 'podman-krun'`: the same spec with `--runtime krun`, guest memory from `limits.memoryBytes`, egress through the relay socket (spike: does the Unix-socket bind cross libkrun's virtio-fs; `猜测` that it does).
   - Run the canary and the Chromium-sandbox spike S1 again under krun. Make it the default for the Coordinator computer only after both pass.
4. **Remote.** Add an E2B desktop provider (`orb/e2b-provider.ts`, D101) for users without KVM or with no spare RAM, with pause/resume keeping memory.
5. **Not planned.** Kata (unpackaged), gVisor (unpackaged; Chromium sandbox interaction unverified) and a self-built Firecracker or Cloud Hypervisor stack. Revisit one of them only if a libkrun spike fails.

Protected paths touched by steps 1–3: `apps/server/src/services/machine*.ts` (lease API) and `scripts/ops/orb/**` (owner route).
