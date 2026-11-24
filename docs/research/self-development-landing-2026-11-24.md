# Self-Development Landing: Full-Access Direct Execution and Removal Plan

Date: 2026-11-24
Scope: Research and removal plan only (no product code changes, no changes to the `cairn` repository's `queue/main` landing flow, no new landing feature, and no opt-in tightening toggles).
Baseline commit: `232d8e82d` (`origin/main`).

---

## 0. Product Direction and Newcomer First

**Direction: tasks run directly on the user's own computer with the user's full permissions, like a full-access Claude Code session — macOS on the Mac, Windows on Windows, Linux (including Arch) on Linux. Delete task sandbox confinement, host-shell confinement, the command gate, git/gh credential env stripping, and the built-in Linux VM runner with every consumer, setting, UI string, and test that only exists for them. Keep remote machines (e.g., controlling a Mac mini) as they are. Security hardening is out of scope for now.**

### Newcomer First

- **Where the newcomer meets it:** The moment they install Cairn on macOS, Windows, or Linux (including Arch) and start their first task. There is no "Linux VM (1.5 GB)" download switch in first-run setup, no "task sandbox not ready" blocker on the Machines page, and no Cairn-owned PR/branch harness overriding their repository's `AGENTS.md` or `CLAUDE.md`.
- **What they must already know:** Only how they already push code from their terminal (`git`, `gh`, SSH, or whatever CLI their repo uses).
- **Accounts, payments, and keys asked of them:** Only their model provider key/subscription. Connecting Cairn's GitHub App stays optional (for server-side webhook/issue intake), never required for an agent to push or land code.
- **Where data is stored:** Cairn never copies or proxies personal SSH keys, macOS Keychain items, or `~/.config/gh` tokens. Agents use the host's native credential stores directly; Cairn stores only observed task results (commit SHA, PR link if one was opened, landed commit SHA) in SQLite.
- **Where they get stuck / what they see on failure:** If `git` or `gh` is not logged in on that computer, the agent gets the native `git`/`gh` error verbatim in the transcript instead of an opaque Seatbelt `EPERM` or a synthetic `"Not delivered: no-pr"` prompt.

### Measured Problem Baseline (`xiechimon/cairn` Self-Development)

Measured in the owner's Cairn database across **54 builds** on `xiechimon/cairn`, only **4 reached `done`**:

- **(a) Confinement + forced PR delivery vs. `queue/main`:** `xiechimon/cairn` rejects direct pushes to `main` via `green-main` and lands commits only through `node scripts/ops/preflight.mjs --wait` and `node scripts/ops/push-queue.mjs --wait` (`AGENTS.md`, `docs/design/tested-sha-landing.md`). Cairn simultaneously stripped/replaced host `gh`/git credentials, blocked Keychain and `.git/rebase-merge` in Seatbelt (breaking `git rebase` and `push-queue.mjs` with `EPERM`), and injected a PR-only system prompt + `'no-pr'` completion gate, so tasks opened PRs that died on `PR Auto-fix needs you: Conflict round cap (2) reached`.
- **(b) Stale retry non-fast-forward push (out of scope):** A retry re-pushed a stale copy and failed non-fast-forward three times. A separate lane owns this defect; not touched here.
- **(c) Quick-lane refusal:** Four tasks failed at claim time with `"quick lane refused: the task has no checkable owner request"`. Root cause and two live siblings are in Section 2.

---

## 1. Reference Architecture and Prior Art

All external claims are verified from primary vendor docs and tagged `Measured` or `Inferred`.

| Tool | Execution & auth model | How agent work lands | Forced PR or direct observation? | Primary sources |
| --- | --- | --- | --- | --- |
| **t3code** *(reference)* | **Full access** default for new threads ("Allows commands and edits without approval prompts") (`Measured`). Uses the machine's native git + CLI auth (`GH_TOKEN`, `gh auth login`, `glab`, `fj`/`tea`, `az`, `cafe`) (`Measured`). | Agent follows repo instructions; commits, pushes, or opens PRs directly using host auth (`Measured`). Turn diff isolates only the turn's edits (`Measured`). | **Observe only.** Never forces a PR; passively links a PR if opened on the branch; PR watching is explicit (`Linked items`) (`Measured`). | [t3code Permission Modes](https://github.com/pingdotgg/t3code/blob/main/docs/user/permission-modes.md), [t3code Source Control](https://github.com/pingdotgg/t3code/blob/main/docs/user/source-control.md) |
| **Devin** | Cloud Linux VM per session with managed GitHub/GitLab integration (`Measured`). | Reads `AGENTS.md`/`CLAUDE.md`; supports PR templates, Stacked PRs, Lifecycle Hooks (`Measured`). | PR-centric cloud SDLC (`Measured`). | [Devin AGENTS.md](https://docs.devin.ai/work-with-devin/agents-md), [Devin Stacked PRs](https://docs.devin.ai/work-with-devin/stacked-prs), [Devin Lifecycle Hooks](https://docs.devin.ai/work-with-devin/lifecycle-hooks) |
| **OpenAI Codex (Local / Cloud)** | Local runs directly on the user's machine; Cloud runs in isolated containers with internet off after setup (`Measured`). | Reads `AGENTS.md` hierarchy; Local executes repo commands directly, Cloud hands off PR/diff (`Measured`). | Local is open to machine git/CLI; Cloud is PR/diff handoff (`Measured`). | [Codex Local Environments](https://developers.openai.com/codex/app/local-environments), [Codex Cloud Environments](https://developers.openai.com/codex/cloud/environments), [Codex AGENTS.md](https://developers.openai.com/codex/guides/agents-md) |
| **GitHub Copilot coding agent** | Ephemeral GitHub Actions container on `copilot/*` branch (`Measured`). | Reads `.github/copilot-instructions.md` and `AGENTS.md`; setup via `copilot-setup-steps.yml` (`Measured`). | Strictly PR-only; never pushes directly to `main` (`Measured`). | [Copilot Coding Agent](https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent), [Customize Agent Environment](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/customize-the-agent-environment) |
| **Google Jules** | Cloud VM with GitHub App OAuth token (`Measured`). | Reads `AGENTS.md`; REST `automationMode` supports only `AUTOMATION_MODE_UNSPECIFIED` or `AUTO_CREATE_PR` (`Measured`). | PR-only automated output (`Measured`). | [Jules Environment](https://jules.google/docs/environment/), [Jules Sessions API](https://developers.google.com/jules/api/reference/rest/v1alpha/sessions) |
| **Graphite & GitHub Merge Queues** | Repo-side merge queues validating temporary merge branches (`Measured`). | CLI/MCP (`gt submit`, `gt merge`) or GitHub queue rules (`Measured`). | Agents participate only if not blocked from host auth or trapped in a PR-only loop (`Inferred`). | [Graphite Merge Queue](https://graphite.com/docs/merge-queue), [Graphite MCP](https://graphite.com/docs/gt-mcp), [GitHub Merge Queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue) |

---

## 2. Root Cause of (c): `"quick lane refused: the task has no checkable owner request"`

1. **Creation (`apps/server/src/services/todos.ts:602-605, 629-640`):** On GitHub-connected projects, `planSelfIssue` causes `createAutonomousTodo` to store `sourceKind = 'github-issue-self'` (line 632) and `sourceRef = null` / `owner/repo#<n>` instead of `sourceKind = 'orchestration'` + `orchestrationSourceRef(threadId)`.
2. **Claim-time refusal (at `9575eeb74~1`, `coordinator-request.ts:353-364` called by `machine-claim.ts:509-513`):** `quickLaneRefusal` parsed the coordinator thread ID only when `row.sourceKind === 'orchestration'`, so on every GitHub project `threadId` was `undefined` and line 363 unconditionally returned `"quick lane refused: the task has no checkable owner request"`.
3. **Status:** Removed in `9575eeb74` (`desktop-v0.1.449`, 2026-11-19; `docs/design/quick-lane.md:3`; regression test `apps/server/test/coordinator-legacy-quick-card.test.ts:12-39`).
4. **Bug class & 2 live siblings still on `main` (`232d8e82d`):** Overloading `sourceKind`/`sourceRef` erases Coordinator provenance on GitHub projects. Two live callers still check `sourceKind === 'orchestration'` and break on `'github-issue-self'`:
   - `apps/server/src/services/chief.ts:1206-1223` (`rewatchCreatingThread`, invoked at `apps/server/src/services/build-restart.ts:112`): drops project-channel routing after build retries.
   - `apps/server/src/services/mcp-threads.ts:455-458`: misses `'github-issue-self'` tasks once transient thread watches clear.

---

## 3. Complete Removal Inventory (with `file:line`)

### R1. Task Sandbox Confinement (Seatbelt on macOS, `bwrap` on Linux, `pi-host` confined worker, server/wire/UI gates)

**Why it blocks self-development and cross-OS direct execution:**
- `apps/daemon/src/backend/confine-seatbelt.ts:421-423, 432` and `apps/daemon/src/backend/confine.ts:302-306` write-deny `.git/rebase-merge`, `.git/rebase-apply`, and `.git/sequencer`, breaking `git rebase origin/main` and `scripts/ops/push-queue.mjs` (`git rebase --onto` at `:214`, `git rebase --exec` at `:254`) with `EPERM`.
- `confine-seatbelt.ts:18-33, 194-196, 227-254, 485` and `confine-session.ts:309-314, 445-462` deny `~/.config/gh`, `~/.ssh`, `~/.git-credentials`, `~/.cairn` (breaking `scripts/lib/github-create-gate.mjs`), `~/Library/Keychains`, `ssh-*` sockets, and Mach services `com.apple.securityd`/`SecurityServer`/`secd`/`trustd` (breaking `gh auth login` and `git-credential-osxkeychain`).
- `packages/shared/src/records/machine-capabilities.ts:89-99` (`confinementEnforced`) and `apps/daemon/src/doctor.ts:153-161, 194-244` fail-close macOS and Linux runners unless `sandbox-exec` or `bwrap` + `systemd` PID 1 + userns sysctls are ready, blocking Arch/minimal Linux setups outright.

**What R1 deletes:**

| Category | Exact paths & lines | What is deleted / simplified |
| --- | --- | --- |
| **Core confinement modules (delete whole files)** | `apps/daemon/src/backend/confine.ts`, `apps/daemon/src/backend/confine-seatbelt.ts`, `apps/daemon/src/backend/confine-session.ts`, `apps/daemon/src/backend/confinement-availability.ts` | Delete Seatbelt SBPL generator, Linux `bwrap` args/gate/cgroup/owner confinement, session confiner, and startup probe loop. Inline the 3-line pure `contains()` path helper in `apps/daemon/src/backend/devin-managed.ts:21` and `apps/daemon/src/backend/gemini-managed.ts:21`. |
| **Confined Pi worker (delete whole files)** | `apps/daemon/src/backend/pi-host.ts`, `apps/daemon/src/backend/pi-host-client.ts`, `apps/daemon/src/backend/pi-host-protocol.ts` | Delete the JSONL out-of-process worker that exists solely to run confined Pi sessions (`apps/daemon/src/cli.ts:19, 376-377`). `PiBackend.open` (`apps/daemon/src/backend/pi.ts:74, 953-960, 1042-1053`) already runs `openInProcess` when `confine === undefined`. |
| **Daemon & desktop consumers** | `apps/daemon/src/machine-loop.ts:35-36, 141-145, 201-211, 228-230, 240-241, 411-414, 574-575, 590`, `apps/daemon/src/backend/claude-code.ts:55, 1400-1411, 1519-1521, 1540`, `apps/daemon/src/backend/acp.ts:57, 660-663`, `apps/daemon/src/workspace.ts:36, 108, 117, 122, 348, 478`, `apps/daemon/src/workspace-hooks.ts:5, 35, 66`, `apps/daemon/src/doctor.ts:153-161, 194-244`, `apps/desktop/src/runner.ts:115`, `apps/desktop/scripts/smoke-linux.mjs` | Remove `createSessionConfiner`, `ConfinementAvailability`, `confine` spawn wrappers, `CAIRN_CONFINE_DENIED_ROOTS`, and Seatbelt/`bwrap`/userns/hardlinks/systemd-PID1 doctor gates. |
| **Shared protocol & server dispatch gates** | `packages/shared/src/brand.ts:71` (`confinementPlatform`), `packages/shared/src/records/machine-capabilities.ts:52-99, 252-253, 276-277, 302-303, 357`, `packages/shared/src/protocol/machine-wire.ts:9, 139`, `apps/server/src/services/machines.ts:21, 267-290, 432-438, 561, 613`, `apps/server/src/services/machine-claim.ts:9-10, 879-887`, `apps/server/src/services/dispatch-eligibility.ts:4, 257, 292`, `apps/server/src/services/step-queue.ts:3, 55-56, 289-290`, `apps/server/src/services/unplaceable-steps.ts:19, 61-62, 71` | Delete `confinementReportSchema`, `confinementCauseSchema`, `confinementEnforced`, `confinementDispatchReady`, `'sandbox-unavailable'` queue-block kind, stale-confinement 409 check, and confinement claim fence. Keep optional unknown-field tolerance in `parseReportedCapabilities` so older daemons still connect during rolling upgrades. |
| **Web UI strings & fixtures** | `apps/web/src/api/mappers.ts:126, 148`, `apps/web/src/i18n/en.ts:1118-1119, 1132-1133`, `apps/web/src/fixtures/records.ts:317-318` | Delete `'sandbox-unavailable'` queue labels and `confinement`/`confinementCause` fixture fields. |
| **Workflows & tests (delete whole files)** | `.github/workflows/mac-confinement.yml`, `apps/daemon/test/confine.test.ts`, `apps/daemon/test/confine-seatbelt.test.ts`, `apps/daemon/test/confine-session.test.ts`, `apps/daemon/test/confine-owner.test.ts`, `apps/daemon/test/confine-ownership.test.ts`, `apps/daemon/test/confine-batch-parity.test.ts`, `apps/daemon/test/confinement-availability.test.ts`, `apps/daemon/test/pi-host-confinement.test.ts`, `apps/daemon/test/pi-host-protocol.test.ts`, `apps/server/test/confinement-availability.test.ts`, `apps/server/test/confinement-wire.test.ts` | Delete 1 workflow and 11 confinement-only test files; remove confinement assertions from `apps/daemon/test/{doctor,machine-boot,machine-fixtures,workspace-hooks}.test.ts`, `apps/daemon/test/machine-loop-harness.ts`, `apps/server/test/{capability-pending-reason,machine-fixtures,machine-pin,machine-pool-claim,unplaceable-steps}.test.ts`, and `packages/shared/test/{machine-capabilities,machine-fixtures,vocabulary}.test.ts` + snapshot. |

---

### R2. Host-Shell Confinement (keeping Remote Machines and Direct Host Control intact)

**Why it is removed:** `HostComputerProvider` (`apps/daemon/src/computer/host.ts`) runs Coordinator shell/file commands on the user's own computer or a remote machine (such as a Mac mini). Wrapping it in `host-shell-confinement.ts` denies `~/.ssh`, `~/.config/gh`, Keychain, and host config writes even when the user explicitly controls their own machine.

**What R2 deletes:**

| Category | Exact paths & lines | What is deleted / kept |
| --- | --- | --- |
| **Core file & test (delete)** | `apps/daemon/src/backend/host-shell-confinement.ts`, `apps/daemon/test/host-shell-confinement.test.ts` | Delete entire file and unit test. |
| **Consumers cleaned** | `apps/daemon/src/machine-loop.ts:40, 288-292`, `apps/daemon/src/computer/host.ts:17, 45-47, 56, 68-70, 193-195, 264` | Instantiate `new HostComputerProvider()` without `confinement`; remove `options.confinement?.denied()` check, `options.confinement?.wrap()`, and `HOST_STRIPPED_ENV` (`SSH_AUTH_SOCK`, `SSH_AGENT_PID`, `DBUS_SESSION_BUS_ADDRESS`). **Keep** `HostComputerProvider`, `HostScreen`, `contained-spawn.ts` (process-tree subreaper cleanup), and `CAIRN_OWN_COMPUTER=1` intact so local Mac and remote Mac mini control continue working directly. |
| **Security-surface gate lists** | `packages/shared/merge-gate-paths.json:59, 98`, `AGENTS.md`, `apps/server/test/merge-gate-paths.test.ts`, `apps/server/test/merge-gate-paths-json.test.ts` | Remove `apps/daemon/src/backend/host-shell-confinement.ts` from the security-surface list and update its matching tests. |

---

### R3. Command Gate and Permission Rules

**Why it is removed:** With full-access host execution and no opt-in tightening, Cairn should not interpose a regex/shell-parser permission gate between the model and host tools across Pi, ACP adapters, or computer dispatch.

**What R3 deletes:**

| Category | Exact paths & lines | What is deleted / simplified |
| --- | --- | --- |
| **Core files & tests (delete)** | `apps/daemon/src/backend/command-gate.ts`, `packages/shared/src/records/permission-rules.ts`, `apps/daemon/test/command-gate.test.ts`, `packages/shared/test/permission-rules.test.ts` | Delete `DEFAULT_BASH_PATTERNS`, shell-command classifier, `gateToolCallHandler`, `phoneControlRefusal`, `PermissionRule` schema/matcher, and their test suites. |
| **Consumers cleaned** | `packages/shared/src/records/index.ts:48`, `apps/daemon/src/backend/pi.ts:64, 1160-1171`, `apps/daemon/src/backend/acp.ts:56, 695-729`, `apps/daemon/src/backend/acp-permission-gate.ts:3, 9-12, 171-229`, `apps/daemon/src/computer/dispatch.ts:16`, `apps/daemon/test/acp-permission-gate.test.ts` | Remove `cairn-command-gate` inline Pi extension and `PermissionRule` export; simplify `acp-permission-gate.ts` so normal-turn ACP permission requests auto-select `allow_once` without calling `command-gate` (keeping only structural `read-only` / `relay-only` filtering if non-code turns still require it); remove `phoneControlRefusal` from `computer/dispatch.ts`. |
| **Metadata / gates** | `packages/shared/merge-gate-paths.json`, `AGENTS.md`, `scripts/comment-discipline-allowlist.json` | Remove `apps/daemon/src/backend/command-gate.ts` from security-surface lists and comment-discipline allowlist. |

---

### R4. Env Stripping and Git/GH Credential Replacement

**Why it blocks self-development:** Even without Seatbelt, Cairn currently strips `GH_TOKEN`/`GITHUB_TOKEN` in the desktop spawner, drops them again in `childEnv()`, clears `SSH_AUTH_SOCK` in `runtimeChildEnv()`, wipes git's `credential.helper` via `gitCredentialEnv()`, overwrites `GH_CONFIG_DIR` with a `cairnwright[bot]` GitHub App token (`StepAppCredential`), enables `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1`, overrides `HOME` for Devin/Antigravity, and injects `commitEnv(stepIdentity)` overriding host `git config user.name/email`.

**What R4 deletes / simplifies:**

| Category | Exact paths & lines | What changes |
| --- | --- | --- |
| **Desktop env scrub** | `apps/desktop/src/otel-config.ts:38-62`, `apps/desktop/src/main.ts:319`, `apps/desktop/src/runner.ts:108-129`, `apps/desktop/scripts/otel-config.test.mjs` | Delete `SECRET_SHAPED_ENV` (`/(?:_TOKEN\|_SECRET\|_PASSWORD\|_KEY\|_CREDENTIALS?)$/`); strip only Cairn's own internal keys (`CAIRN_OTEL_*`, `OTEL_*`, `CAIRN_TOKEN`, `CAIRN_AUTH`, `CAIRN_API_KEY`, `CAIRN_GITHUB_OAUTH_CLIENT_ID`, `CAIRN_ALERT_SMTP_URL`) so host `GH_TOKEN`/`GITHUB_TOKEN` survive into the local runner. |
| **Daemon child env & SSH/GH stripping** | `apps/daemon/src/child-env.ts:1-79`, `apps/daemon/src/backend/otel.ts:88-123`, `apps/daemon/src/workspace-hooks.ts:60-65`, `apps/daemon/src/computer/host.ts:59-72` | Replace `CHILD_ENV_BASE` allowlist with host `process.env` pass-through minus Cairn internal daemon/OTel/server tokens; stop blanking `SSH_AUTH_SOCK`/`SSH_AGENT_PID` and stop deleting `GH_TOKEN`/`GITHUB_TOKEN`. |
| **Per-step App git credential override & `HOME` / author overrides** | `apps/daemon/src/step-app-credential.ts` (delete file), `apps/daemon/src/step-env.ts:43-115`, `apps/daemon/src/git.ts:138-170`, `apps/daemon/src/runner.ts:402-418`, `apps/daemon/src/step-tooling.ts:74-75`, `apps/daemon/src/backend/claude-code.ts:50, 1443, 1465-1472`, `apps/daemon/src/backend/acp.ts:46` | Delete `StepAppCredential` (`GH_CONFIG_DIR` App-token override). In `assembleStepEnv`: stop injecting `gitCredentialEnv` (`credential.helper=''`), stop setting `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1`, stop overriding `HOME` in `isolatedConfigEnv` (keep only harness-specific config vars where needed without hiding `~/.gitconfig`, `~/.config/gh`, or `~/.ssh`), and stop injecting `commitEnv(stepIdentity)` on normal GitHub/local repos so commits carry the host's configured git author. Keep `gitCredentialEnv` solely if `repo.kind === 'hosted'` still needs Cairn-hosted push auth. In `claude-code.ts`, remove the `scrubbed` `permissionMode: 'default'` branch so normal steps run `bypassPermissions`. |
| **Tests (delete / update)** | Delete `apps/daemon/test/step-app-credential.test.ts`, `apps/daemon/test/claude-scrub-permissions.test.ts`, `apps/daemon/test/pi-child-env.test.ts`; update `apps/daemon/test/child-env.test.ts`, `apps/daemon/test/step-env.test.ts`, `apps/desktop/scripts/otel-config.test.mjs` | Assert that host `GH_TOKEN`, `GITHUB_TOKEN`, `SSH_AUTH_SOCK`, `HOME`, and git `credential.helper` pass through while Cairn's own `CAIRN_TOKEN` / `CAIRN_OTEL_*` remain stripped. |

---

### R5. Built-In Linux VM Runner (Apple `container` Mac VM, Download UI, Package Install, Info-Card VM Gate)

**Why it is removed:** On macOS 26+ Apple silicon, Cairn ships a separate built-in Debian VM runner (`VmDesktops` / `VmRuntime` / `apps/daemon/computer-image/`) that downloads ~1.48 GB (~2.09 GB unpacked), spawns a per-scope Linux VM with Xvfb/Chromium/nftables, exposes VM-only tools (`install_packages`, `computer_manage`), and blocks info cards on every machine that is not an Apple silicon Mac on macOS 26+ with the Linux VM turned on (`apps/server/src/services/info-card.ts:23-36`). With direct host execution on Mac, Windows, and Linux, this entire subsystem is dead weight.

**What R5 deletes:**

| Category | Exact paths & lines | What is deleted / changed |
| --- | --- | --- |
| **Daemon VM runner & guest image (delete whole files/dirs)** | `apps/daemon/src/computer/vm-desktop.ts`, `apps/daemon/src/computer/vm-runtime.ts`, `apps/daemon/computer-image/` (all 14 files: `Dockerfile`, `entry.sh`, `desktop.sh`, `guard.nft`, `image.json`, `browser.sh`, `agent-browser.sh`, `agent-desktop.sh`, `agent-env.sh`, `cloak.mjs`, `wait-display.sh`, `cairn-browser.desktop`, `cairn-chromium.desktop`, `chromium-accessibility.conf`), `scripts/vm-download-sizes.mjs`, `.github/workflows/computer-image.yml` | Delete the Apple `container` runtime downloader/verifier, VM lifecycle manager, Debian guest image, nftables guard, download-size checker, and image-build workflow. |
| **Daemon consumers** | `apps/daemon/src/machine-loop.ts:63-64, 310, 321-329, 407, 445-446, 671-673`, `apps/daemon/src/doctor.ts:162-174`, `apps/daemon/src/computer/dispatch.ts:56-57, 141, 234, 575-653, 718-725`, `apps/daemon/src/computer/provider.ts:47` | Remove `VmDesktops`/`VmRuntime` instantiation on `darwin`, `vmDownload` reporting, `terminalCommand` VM hook, `doctor.ts` Apple `container` check, and `install_packages`/`computer_manage`/`browserLicense` handlers in `dispatch.ts`. |
| **Shared wire & protocol** | `packages/shared/src/records/machine-capabilities.ts:173-195, 245-246, 286, 310, 320-321`, `packages/shared/src/protocol/computer.ts:3, 22-23, 141, 252`, `packages/shared/src/protocol/computer-tools.ts:170`, `packages/shared/src/protocol/rest.ts:17` | Delete `VM_DOWNLOAD_PARTS`, `VM_DOWNLOAD_BYTES`, `vmDownloadSchema`, `vmDownload`, `computerKind: 'vm'`, `install_packages`, `computer_manage`, `browserLicense`, and `ComputerRecord.download`. |
| **Server VM services & routes** | `apps/server/src/services/vm-computer.ts` (delete file), `apps/server/src/routes-computers.ts:1, 8, 18-36`, `apps/server/src/services/machine-computer.ts:1043, 1086-1255, 1466, 1505, 1569-1571, 1740`, `apps/server/src/services/computer-feed.ts:57-59`, `apps/server/src/services/computer-handoff.ts:124`, `apps/server/src/services/coordinator-tool-defs.ts:58-59`, `apps/server/src/coordinator/index.ts:46, 290, 587`, `apps/server/src/coordinator/runtime/server-runtime.ts:51, 134`, `apps/server/src/coordinator/runtime/tools.ts:436`, `apps/server/src/services/machine-claim.ts:114` | Delete `teamHasVmComputer`, `POST /api/computers/package-install`, `POST /api/computers/:id/actions`, `manageComputer`, `decidePackageInstall`, `install_packages` orchestration, and VM-only `browserLicense` injection. |
| **Info-card unblocking** | `apps/server/src/services/info-card.ts:23-36` | Change `infoComputerHosts` so info cards do **not** require `computerKind === 'vm'`; dispatch them directly to any online host machine (local Mac, Windows, Linux, or remote machine). |
| **Web UI, settings & strings** | `apps/web/src/board/machines-panel.tsx:1, 165-230, 380-395, 426-461`, `apps/web/src/board/first-run-setup.tsx:303, 311-316, 358-359, 406-433`, `apps/web/src/board/computer-actions-menu.tsx:23-84, 90, 95, 99, 144-201`, `apps/web/src/chief/package-install-card.tsx` (delete file), `apps/web/src/api/hooks.ts:1713-1725`, `apps/web/src/api/mappers.ts:144, 1832-1845, 2111`, `apps/web/src/chief/chief-message-rows.tsx:44, 465, 682`, `apps/web/src/chief/chief-row-kinds.ts:18`, `apps/web/src/fixtures/records.ts:621`, `apps/web/src/i18n/en.ts:315-330, 333-334, 341-358, 2985-2986` | Delete `VmDownloadRow`, first-run Linux VM toggle switch, VM lifecycle dropdown actions (`Stop VM`/`Update VM`/`Recover VM`/`Reset VM` + reset dialog), `PackageInstallCard`, `decidePackageInstall`/`manageComputer` hooks, and all ~25 Linux VM i18n strings (keeping Rename and Runner Settings in `MachineMenu`). Regenerate `.claude/skills/verify-cairn/feature-map.json` via `node scripts/generate-feature-map.mjs`. |
| **Tests & scripts (delete / update)** | Delete `apps/daemon/test/computer-vm-desktop.test.ts`, `apps/daemon/test/computer-vm-runtime.test.ts`, `apps/daemon/test/computer-image-readiness.test.ts`, `apps/server/test/computer-packages.test.ts`, `apps/web/test/chief-package-install-card.test.ts`, `apps/web/e2e/chief-package-install-card.spec.ts`; update `apps/web/e2e/first-run-setup.spec.ts:214-235`, `apps/web/e2e/machines-computer-actions.spec.ts:112-136`, `apps/server/test/{chief-claim-computer-tools,computer-routes,coordinator-computer-tool-offers,info-card-computer,machine-computer-forward,outbound-untrusted-turn,research-thread}.test.ts`, `packages/shared/test/{machine-capabilities,computer-protocol}.test.ts` + `packages/shared/test/__snapshots__/snapshot.test.ts.snap`, `scripts/test-changed.test.mjs:11, 29-30` | Delete 6 VM-only test/e2e files and prune VM-specific cases from shared/server/web tests and snapshots. |

---

### R6. Forced PR Delivery, Undelivered `'no-pr'` Gate, PR Auto-Fix Downgrade, Watchdog & `(c)` Siblings

Even after R1-R5 remove every sandbox/VM/env blocker, Cairn's delivery layer still forces a PR-only flow and parks non-PR landings:

| Gate | Exact `file:line` | Removal / observe-only change |
| --- | --- | --- |
| **Forced PR prompt & branch lock** | `packages/shared/src/records/prompts.ts:447-483`, `apps/daemon/src/step-prompt.ts:199-212` | Delete the mandatory PR/branch-lock text (`WORK_BRANCH_NOTE_TAIL` / `gh pr create` mandate) on normal git/GitHub repos; emit only a short neutral context line naming the starting worktree/branch and telling the agent to follow the repo's `AGENTS.md` / `CLAUDE.md`. Keep `CAIRN_PUSHES_NOTE` only for `repo.kind === 'hosted'`. |
| **Work-branch drift fail & daemon auto-commit/auto-push** | `apps/daemon/src/step-closing-git.ts:45-122`, `apps/server/src/services/build-step-complete.ts:102-108, 205-223`, `apps/daemon/src/git.ts:1001-1053` | On normal git/GitHub repos, stop auto-committing (`<kind>: <title>`), stop auto-pushing `cairn/conv-*`, and remove `workBranchDrift` hard failure from `stepArtifactGate` and `GATE_REJECTION` (`apps/server/src/services/retry-parking.ts:29`). Instead, **observe** the repo state at step close (`git fetch origin <baseBranch>`, check whether step commits since `headAtStart` are ancestors of `origin/<baseBranch>` -> `'landed'`, or have an open/merged PR via `probeStepPr` -> `'pr'`, or were pushed to a remote ref -> `'pushed'`, or exist locally -> `'local'`, else `'none'`). |
| **Undelivered `'no-pr'` blocking prompt** | `apps/server/src/services/build-undelivered.ts:15-27, 62-96`, `apps/server/src/services/build-step-complete.ts:195-197, 309-318`, `apps/daemon/src/step-deliver.ts:64-90`, `apps/daemon/src/step-pr-probe.ts:18-57`, `apps/server/src/services/machine-finish-step.ts:319-357` | Delete the `'no-pr'` check from `undeliveredEnd` (`build-undelivered.ts:25-26`). Complete the build as `done` for `landed`, `pr`, `pushed`, or `local`; keep `'no-commits'` (`needs_input`) strictly for `'none'` (zero commits created and zero remote effect). |
| **PR Auto-fix conflict cap downgrade** | `apps/server/src/services/pr-watch.ts:111-407`, `apps/server/src/services/pr-wakes.ts:242-281, 322-338, 612-638`, `apps/server/src/services/ci-pr-rounds.ts:26`, `apps/server/src/services/ci-fix-prompts.ts:20-33` | Attach PR links passively only when the agent opened a PR; stop downgrading `done -> failed` when a PR conflict cap trips; remove the `no-rebase` ban from `buildMergeConflictPrompt`. |
| **60-minute watchdog killing long CLI waits** | `apps/daemon/src/stream-watchdog.ts:27, 105-107, 140-161`, `apps/daemon/src/step-pass-controls.ts:38-47`, `scripts/ops/push-queue.mjs:97` | Pause or extend the `duration` timer while `runningToolCalls.size > 0` (matching `idle`/`body` at lines 143 and 151) so `node scripts/ops/push-queue.mjs --wait` (default 120 min) is never killed mid-wait. |
| **Live `(c)` `sourceKind` siblings** | `apps/server/src/services/chief.ts:1206-1223`, `apps/server/src/services/mcp-threads.ts:455-458` | Resolve Coordinator origin for both `'orchestration'` and `'github-issue-self'` tasks. |

---

## 4. What Explicitly Stays (Remote Machines and Direct Host Control)

Nothing in the removal plan touches remote machine support or direct host control:

| Capability | Files kept intact | Why it stays |
| --- | --- | --- |
| **Remote machines (e.g., Mac mini)** | `apps/daemon/src/machine-loop.ts` (enrollment, presence, long-poll claim), `apps/server/src/services/machines.ts`, `machine-claim.ts`, `dispatch-eligibility.ts` (runtime/model/local-path/pin checks), `apps/web/src/resources/machine-row.tsx` | Adding and routing tasks or computer control to another computer (Mac mini, Linux workstation, Windows PC) works identically — and now without sandbox availability failures. |
| **Direct host computer control (`ownComputer`)** | `apps/daemon/src/computer/host.ts` (minus confinement), `host-screen.ts`, `host-screen-png.ts`, `host-screen-self.ts`, `contained-spawn.ts` (Linux process-tree cleanup), `apps/web/src/resources/own-computer-panel.tsx`, `apps/desktop/src/preload.ts:71` | Coordinator can still view/control the local Mac or a remote Mac mini screen and run host shell commands directly, now with full user permissions. |
| **Phone control** | `apps/daemon/src/computer/phones.ts`, `phone-android.ts`, `phone-probe.ts`, `apps/web/src/resources/phones-panel.tsx` | Unrelated to task sandboxing or the Linux VM. |
| **GitHub App (server-side)** | `apps/server/src/services/github-webhook.ts`, `github-connection*.ts`, issue sync, passive PR probe | Still useful for webhook/issue triggers and reading PR status; no longer overrides agent git/gh credentials on the host. |

---

## 5. Order of Landings (Small, Self-Contained Slices)

Each slice is independently deployable, passes CI on its own, and leaves `main` green:

| Order | Slice | Scope & exact deletions/edits | Verification gate |
| --- | --- | --- | --- |
| **1** | **Stop git/gh env stripping & App credential overrides** | Edit `apps/desktop/src/otel-config.ts`, `apps/daemon/src/child-env.ts`, `backend/otel.ts`, `step-env.ts`, `runner.ts`, `step-tooling.ts`, `claude-code.ts`, `acp.ts`, `workspace-hooks.ts`; delete `apps/daemon/src/step-app-credential.ts` + `step-app-credential.test.ts` + `claude-scrub-permissions.test.ts` + `pi-child-env.test.ts`. | Unit tests confirm `GH_TOKEN`, `GITHUB_TOKEN`, `SSH_AUTH_SOCK`, `HOME`, and host git `credential.helper` / `user.name` pass through while `CAIRN_TOKEN` and `CAIRN_OTEL_*` remain stripped. |
| **2** | **Delete task sandbox confinement (`Seatbelt` / `bwrap` / `pi-host`)** | Delete `confine.ts`, `confine-seatbelt.ts`, `confine-session.ts`, `confinement-availability.ts`, `pi-host*.ts`, `.github/workflows/mac-confinement.yml`, and 11 confinement/pi-host test files; inline `contains()` in `devin-managed.ts` & `gemini-managed.ts`; clean `machine-loop.ts`, `claude-code.ts`, `acp.ts`, `pi.ts`, `cli.ts`, `workspace.ts`, `workspace-hooks.ts`, `doctor.ts`, `apps/desktop/src/runner.ts`, `packages/shared` (`machine-capabilities.ts`, `machine-wire.ts`, `brand.ts`), `apps/server` (`machines.ts`, `machine-claim.ts`, `dispatch-eligibility.ts`, `step-queue.ts`, `unplaceable-steps.ts`), and `apps/web` (`mappers.ts`, `en.ts`, `records.ts`). | Daemon spawns Claude Code, Pi (in-process), and ACP directly on macOS/Windows/Linux (including Arch without `bwrap`); `git rebase` and host `gh auth login` work inside a task step; CI + snapshots green. |
| **3** | **Delete host-shell confinement & command gate** | Delete `host-shell-confinement.ts`, `command-gate.ts`, `packages/shared/src/records/permission-rules.ts`, and their 3 test files; clean `computer/host.ts`, `machine-loop.ts`, `backend/pi.ts`, `backend/acp.ts`, `backend/acp-permission-gate.ts`, `computer/dispatch.ts`, `packages/shared/merge-gate-paths.json`, `AGENTS.md`, `apps/server/test/merge-gate-paths.test.ts`, `apps/server/test/merge-gate-paths-json.test.ts`, and `scripts/comment-discipline-allowlist.json`. | `HostComputerProvider` executes directly on local Mac and remote Mac mini; Pi and ACP execute tools without `cairn-command-gate`; `merge-gate-paths` tests green. |
| **4** | **Replace forced-PR delivery with observe-only + fix watchdog & `(c)` siblings** | Edit `prompts.ts`, `step-prompt.ts`, `step-closing-git.ts`, `step-deliver.ts`, `step-done-body.ts`, `build-undelivered.ts`, `build-step-complete.ts`, `machine-finish-step.ts`, `pr-wakes.ts`, `ci-fix-prompts.ts`, `retry-parking.ts`, `stream-watchdog.ts`, `chief.ts`, `mcp-threads.ts`. | **Self-development milestone:** Coordinator task on `xiechimon/cairn` runs `preflight.mjs --wait` and `push-queue.mjs --wait`, lands on `origin/main`, and finishes `done` with landed commit SHA and zero `'no-pr'` prompts. Normal PR repos still attach PR links passively. |
| **5** | **Unblock info cards from `computerKind === 'vm'`** | Edit `apps/server/src/services/info-card.ts:23-36` (allow any online host machine), `apps/web/src/api/mappers.ts:144`, `apps/web/src/i18n/en.ts:2985-2986`, and `apps/server/test/info-card-computer.test.ts`. | Info cards execute on Mac, Windows, or Linux without requiring a VM capability flag. |
| **6** | **Delete built-in Linux VM runner in daemon & CI** | Delete `vm-desktop.ts`, `vm-runtime.ts`, `apps/daemon/computer-image/*`, `scripts/vm-download-sizes.mjs`, `.github/workflows/computer-image.yml`, and 3 daemon VM tests; clean `machine-loop.ts`, `doctor.ts`, `computer/dispatch.ts`, `computer/provider.ts`, `scripts/test-changed.test.mjs`. | Daemon compiles and boots cleanly on macOS/Windows/Linux with zero VM runtime code or image manifests. |
| **7** | **Delete Linux VM server services, routes & shared wire schemas** | Delete `apps/server/src/services/vm-computer.ts` and `apps/server/test/computer-packages.test.ts`; clean `routes-computers.ts`, `machine-computer.ts`, `computer-feed.ts`, `computer-handoff.ts`, `coordinator-tool-defs.ts`, `coordinator/index.ts`, `coordinator/runtime/{server-runtime,tools}.ts`, `machine-claim.ts`, `packages/shared/src/{records/machine-capabilities,protocol/computer,protocol/computer-tools,protocol/rest}.ts`, snapshots, and affected server tests. | Server & shared suites pass with zero VM-only endpoints (`package-install`, `computers/:id/actions`) or `vmDownload` fields. |
| **8** | **Delete Linux VM Web UI, first-run switch, package-install card & i18n strings** | Clean `machines-panel.tsx`, `first-run-setup.tsx`, `computer-actions-menu.tsx`, `api/hooks.ts`, `api/mappers.ts`, `chief-message-rows.tsx`, `chief-row-kinds.ts`, `fixtures/records.ts`, `i18n/en.ts`; delete `package-install-card.tsx`, `chief-package-install-card.{test,spec}.ts`; update `first-run-setup.spec.ts` and `machines-computer-actions.spec.ts`; run `node scripts/generate-feature-map.mjs` and clean `scripts/vitest-shard-weights.json` & `scripts/doc-refs-baseline.json`. | Web typecheck, unit tests, `i18n-scan`, `feature-map`, and e2e specs pass with zero Linux VM UI artifacts. |

---

## 6. What a User Sees Before vs. After

| Scenario | Before (today on `232d8e82d`) | After (Slices 1-8 landed) |
| --- | --- | --- |
| **Owner asks Coordinator to fix a bug on `cairn` and land it** | Quick lane refused 4 tasks (`sourceKind` bug, fixed in `9575eeb74`); remaining builds hit Seatbelt `EPERM` on Keychain/`gh`/`.git/rebase-merge`, got forced into opening PRs by `[cairn system rule]`, rotted on `queue/main` conflicts, hit `PR Auto-fix needs you: Conflict round cap (2) reached`, or parked on `Not delivered: no-pr` (4/54 done). | Agent runs directly on the Mac with host `git`/`gh` auth, fixes the bug, runs `git rebase origin/main`, `node scripts/ops/preflight.mjs --wait`, and `node scripts/ops/push-queue.mjs --wait` exactly like a Claude Code session. Cairn observes the commit landed on `origin/main` and marks the task **`done`** with the landed commit SHA. Zero human clicks. |
| **Newcomer installs Cairn on macOS** | First-run setup asks whether to download a **1.5 GB Linux VM** (`first-run-vm`); Machines panel shows a VM download bar and Stop/Update/Recover/Reset VM menus; tasks fail with Seatbelt `EPERM` when touching user CLI tools or Keychain. | First-run setup picks a model and starts chatting immediately — zero VM prompt, zero 1.5 GB download. Tasks run natively on macOS with the user's installed tools and credentials. |
| **Newcomer installs Cairn on Linux (including Arch)** | `cairn doctor` and startup probe refuse dispatch (`sandbox-unavailable`) if `bwrap`, `systemd` PID 1, `unprivileged_userns_clone`, or `fs.protected_hardlinks` fails; tasks sit stuck in queue. | Runner comes online immediately on Arch, Ubuntu, Fedora, or minimal Linux without `bwrap` or sysctl tweaks; tasks run directly as the user. |
| **Newcomer installs Cairn on Windows** | Confinement path is Mac/Linux-only while env/credential overrides and forced PR rules still interfere with native Windows `git`/`gh` credential manager. | Runner executes natively on Windows with Windows Git Credential Manager and `gh` CLI; no sandbox wrappers or forced PR prompts. |
| **Owner controls a remote machine (e.g., Mac mini)** | Works via remote daemon + `ownComputer`, except `host-shell-confinement` blocks host shell access to `~/.ssh`, `~/.config/gh`, Keychain, and shell config on the Mac mini. | Remote Mac mini stays enrolled and controllable identically in Machines panel and Coordinator tools, and host shell commands run directly with the Mac mini user's full permissions. |
| **Owner runs an info card / research task** | Stuck in queue with `"needs an Apple silicon Mac on macOS 26 or later with the Linux VM turned on"` on Intel Macs, macOS < 26, Windows, Linux, or Macs without the 1.5 GB VM. | Runs directly on any online Mac, Windows, or Linux machine without any VM prerequisite. |
| **Newcomer repo using standard GitHub PRs** | Works on simple repos, but fails if repo instructions differ or if PR conflicts exceed 2 rounds (`done -> failed`). | Agent follows the repo's `AGENTS.md` (or opens a PR with the user's `gh` login), Cairn passively attaches the PR link and marks the task **`done`** without downgrading it on PR-watch caps. |
| **Failure: red preflight CI / busy `queue/main` / rebase conflict / missing `gh` auth** | Watchdog kills waits >60 min; `no-rebase` prompt blocks rebase; Seatbelt hides real auth errors behind `EPERM`. | Agent inspects `gh run view --log-failed`, fixes CI, resolves rebase conflicts in place, waits through `push-queue.mjs --wait` without 60-min watchdog kills, or surfaces the exact native `gh auth login` error. Zero-change runs still pause at `needs_input` (`no-commits`). |

---

## 7. Open Decisions for the Owner (Edge Scope Confirmations)

1. **Linux Orb container executor (`apps/daemon/src/orb/*`, `apps/daemon/orb-image/*`, `scripts/ops/orb/*`, `packages/shared/src/orb-services.ts` — ~90 files + CI canary jobs):**
   - *Context:* Separate from the built-in macOS Linux VM (`vm-desktop.ts`), Cairn also carries the `CAIRN_EXECUTOR=orb` Linux `systemd-nspawn` / Podman / E2B container sandbox runner.
   - *Recommendation:* Delete `orb` as well in a follow-up Slice 9 if you are not using containerized Linux orbs on any fleet host; otherwise leave it untouched during Slices 1-8.
2. **Coordinator computer shell parser guard (`apps/daemon/src/computer/guard*.ts` — 7 files + 4 test files):**
   - *Context:* Distinct from `command-gate.ts` and `host-shell-confinement.ts`, `computer/dispatch.ts:29-33` runs regex/shell-parser guards (`guard.ts`, `guard-cairn.ts`, `guard-executable.ts`, `guard-heredoc.ts`, `guard-quoted.ts`, `guard-words.ts`, `guard-shell-parse.ts`) over Coordinator shell calls.
   - *Recommendation:* Delete `computer/guard*.ts` in Slice 3 alongside `command-gate.ts` and `host-shell-confinement.ts` so Coordinator shell calls on your Mac and Mac mini have the same direct full-access behavior as task sessions.
3. **Linux Xvfb virtual desktop (`apps/daemon/src/computer/host-desktop.ts`):**
   - *Context:* `machine-loop.ts:314-320` instantiates `HostDesktops` on Linux hosts that have `Xvfb`/`openbox`/`x11vnc` installed (separate from macOS `VmDesktops`).
   - *Recommendation:* Keep `HostDesktops` only if you run a headless Linux machine that needs a virtual X11 browser display; otherwise remove it in Slice 6 alongside `VmDesktops` so Linux machines use the same direct host path as macOS and Windows.
4. **Cairn-hosted repo push auth (`repo.kind === 'hosted'`):**
   - *Context:* Projects whose git repository is hosted inside Cairn itself (no external GitHub remote) have no host `gh`/SSH auth and rely on daemon-side push credentials.
   - *Recommendation:* Keep `gitCredentialEnv` and daemon auto-push strictly scoped to `repo.kind === 'hosted'`, and delete all GitHub/local credential overrides (`StepAppCredential`, `commitEnv`, `WORK_BRANCH_NOTE_TAIL`) in Slices 1 and 4.
