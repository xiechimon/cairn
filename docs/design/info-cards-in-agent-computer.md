# Info cards run in the agent's computer

Date: 2026-11-17. Status: design for ian's review; no code changed. Owner decision (ian, 2026-11-17): non-code tasks (todo `output: 'info'`: research, summaries, reports such as `汇总 BOSS 上 10 个 AI 应用开发岗位的要求`) leave the owner's Mac and run in the agent's own computer, the Debian VM from [mac-vm-computer](mac-vm-computer.md). Code tasks stay on the Mac under [mac-session-confinement](mac-session-confinement.md). Research: [agent-computer-cross-platform-2026-11-17](../research/agent-computer-cross-platform-2026-11-17.md).

## Why

- On 2026-11-17 one info card failed delivery three times: the Seatbelt profile denies `runner/` and blocked the task `TMPDIR`, while the info report handoff writes `runner/reports/<convId>/report.md` (`reportFile` in `apps/daemon/src/step-prompt.ts`, read after exit by `readInfoReport` in `step-outputs.ts`, sent by `deliverStepOutcome` in `step-deliver.ts`; the server then fails the step with `信息卡未产出报告` in `build-step-complete.ts`). The error surfaces only after the harness has exited, so the agent cannot fix it.
- Research cards want the VM's signed-in browser (`.cairn/browser-profile`), which a host harness cannot reach.

## Prior art

Rakazo (`elie222/rakazo` at `ebed57a`) runs its agent loop (Pi) in the API/worker process and sends every shell, file, browser and screen call into the bot's computer: "Pi runs in the Rakazo API/worker process. It is not installed in, or executed by, E2B" and "The computer container is the security boundary" ([computer-runtime.md](https://github.com/elie222/rakazo/blob/main/docs/computer-runtime.md)). Results leave the computer as files the bot sends into the chat ([computer.md](https://github.com/elie222/rakazo/blob/main/docs/computer.md)); one bot drives its computer for one run at a time and the user's takeover is an exclusive control lease ([run-execution.md](https://github.com/elie222/rakazo/blob/main/docs/run-execution.md), computer-runtime.md "Take control"). "Use this Mac" exists only as an explicit opt-in ([desktop-app.md](https://github.com/elie222/rakazo/blob/main/docs/desktop-app.md)). Claude Cowork moved its agent loop out of the VM for the same reason (research note §2).

Cairn already has the Rakazo shape for one agent: the in-server Coordinator runtime (`apps/server/src/coordinator/runtime/`, Pi via `@earendil-works/pi-durable`) relays `computer_observe/act` and `browser_*` through `relayComputer` → `forwardComputerCall` (`apps/server/src/services/machine-computer.ts`) → the Runner → `VmDesktops` (`apps/daemon/src/computer/vm-desktop.ts`), which already implements `execute`, `listFiles`, `readFile` and `writeFile` inside the guest as uid 1000, confined to `/home/agent`.

## Options

| | A. Loop on host, tools in VM (Rakazo) | B. Harness inside the VM | C. Host harness, VM path mounted for the report |
|---|---|---|---|
| Where the model runs | In-server runtime (same as the Coordinator) | Claude Code / Codex / pi inside the guest | Host harness under Seatbelt |
| Credentials in the VM | None (model keys stay in the server; browser secrets and the Cloak license already go through the existing redacted call fields) | The model credential: an Anthropic key or Claude OAuth token, Codex `auth.json`, or a provider key, readable by any prompt-injected command in the guest; plus a channel back to the server for asks and heartbeats (a machine-like token in the guest) | None |
| Report out | `submit_report` tool reads the file through the tool channel; errors return to the model in the same turn | Needs a new guest→host channel (a shared volume or a second exec protocol); same post-exit failure as today | Host reads a VM path, which needs a virtiofs share the VM design does not have; a `--volume` bind of a host dir is a second host write path the session confinement must also allow |
| Signed-in browser | Yes, the existing browser tools | Yes, but a second driver of the same profile beside the Coordinator | No: the host harness's own tools still run on the Mac; only the report moves |
| Fixes today's failure | Yes, there is no host path at all | Yes | Only moves it: the host session still runs under Seatbelt with `TMPDIR` and caches, and gains a mount it must be allowed to read |
| New mechanism | Generalize the chief-only relay to info steps; one tool | Guest images carry three harness CLIs and their updates; guest ask/steer/heartbeat protocol; credential injection and rotation | Mount plumbing in `container run`, path mapping, cleanup |
| Harness choice | Pi with the team's Coordinator providers; Claude Code subscription cannot drive Pi | Any harness | Any harness |

**Recommendation: A.** It is the only option that removes the host path, keeps every credential out of the guest, and makes a missing or oversized report a tool error the model fixes before the step ends. B turns the VM into a credential holder and duplicates the Runner protocol inside it; C keeps the failing host session and adds a mount.

## Design under A

**Executor.** An info build step (`isBuildStepKind(kind) && todo.output === 'info'`) is claimed by the in-server runtime, never by a daemon. It runs as a durable thread like a Coordinator thread (same store, compaction, steer, `ask_user`, heartbeat, stop). The step row records the computer's machine as its target so routing, the Runner page and offline handling see it.

**Computer.** The info card uses the owner's Coordinator computer scope (`chief:<chiefId>`), so it shares the VM and its signed-in browser profile. No second VM is created: on a 16 GB Mac the VM is 4 GiB (`vmMemoryFlag`), and a second VM would double that.

**Tools.** `shell`, `list_files`, `read_file`, `write_file`, `browser_navigate/snapshot/act`, `request_takeover`, `submit_report`, and the existing reply/ask tools. `computer_observe/act` are withheld from info cards in v1: the screen is shared with the Coordinator and the owner, and page tools cover research. Work happens in `/home/agent/tasks/<convId>/`.

**Report.** The agent writes `report.md` (and `deliverables/pages|slides/` when the card has deliverables) under its task dir and calls `submit_report({ path })`. The server reads the file through `read_file` on the computer channel, enforces `INFO_REPORT_MAX_BYTES` (512 KiB) and the deliverable manifest, then calls `completeStep` with `report` and `deliverables`; `storeInfoReport` and `publishDeliverables` are unchanged. A missing, empty or too-large file returns an error to the model. Ending the turn without an accepted `submit_report` fails the step with the existing `信息卡未产出报告`.

**States of an info step.**

| From | To | Trigger |
|---|---|---|
| queued | claimed | In-server runtime claims; a target Runner with an online computer exists |
| queued | queued (`waitingOn: machine`) | No eligible computer; the existing `no_machine` notice after 10 min, text names the reason |
| claimed | running | Thread opened, first tool call or model turn |
| running | needs_input | `ask_user` / worker question (existing `pendingWorkerQuestions` path) |
| running | waiting_owner | `request_takeover` (existing card and push) |
| needs_input, waiting_owner | running | Answer arrives / owner gives control back |
| running | reported | `submit_report` accepted; report held in the step outcome |
| reported | done (todo `review`) | Turn ends; `completeStep` stores the report |
| running | failed | Turn ends without a report; computer refusal persists past the Runner offline grace; stop |
| any | stopped | Owner stops the step; the thread's in-flight computer call is cancelled (`signal`) |

**Who reads or writes what.** Model: writes files in the guest through `write_file`/`shell`; calls `submit_report`. Server runtime: reads the report and deliverables through `forwardComputerCall` (`read_file`, `list_files`), writes `step` status, heartbeat and outcome, `storeInfoReport` writes the attachment, `publishDeliverables` the manifest, `setTodoPhase` the todo. Runner: executes calls in the guest, writes nothing on the host. Nothing else reads the guest task dir; the server never mounts it.

**Concurrency.** Shell and file calls from the Coordinator and any info card run in parallel (separate `container exec`). Browser: one Chromium session per scope; each step gets its own tab, and the server serializes browser calls per scope (the lock is held for one call, which first selects the caller's tab). Owner priority is unchanged: while the owner holds the control lease (`ComputerInputFence`, `hold(scope,'control')`), browser calls are refused with a fixed `主人正在使用电脑` result and the agent continues with shell/files or waits; a `handoff` screen still swaps browsers per [computer-login-handoff](computer-login-handoff.md). Idle stop counts any running info step as activity.

**Browser tabs (one per scope).** The browser session is per computer (`chief:<id>`), so every caller shares one profile and its logins, and a plain `open` navigates whatever tab is active; two workers alternating would overwrite each other's page. A scope is the Coordinator or one info card build. The server stamps each browser call with `tabScope` (`coordinator` or `card-<buildId>`); the daemon turns it into the agent-browser tab label `cairn-<scope>` and, as the first command of every browser call, lists the session's tabs (`tab list --json`, which reports `label` and `active`) and selects the scope's tab (`tab <label>`) or opens it (`tab new --label <label>`, which switches to it). Everything after that, including the existing active-tab guard (`refuseOffBoundTab`), runs against that tab. Checked against agent-browser 0.41.2: `tab new/close/<label>`, labels unique per session, the closed tab's neighbor becomes active.

| State | Who | Transition |
|---|---|---|
| none | daemon, first browser call of a scope | `tab new --label`; the scope's tab exists and is active |
| open | daemon, each later call | `tab <label>` before the call; no other scope's tab is touched |
| open | server, `finishStep` of an info card step that is not re-queued (done, failed, stopped, or the runtime's failure path) | pushes `browser_close_tab` with the scope; the daemon runs `tab close <label>`, then re-selects the Coordinator tab if the closed tab was the active one |
| open, card | daemon | a `cairn-card-*` tab unused for 30 minutes is closed by the next browser call of any scope; a tab not seen since a daemon restart is stamped on first sight and ages from then |

The Coordinator tab is one per computer and is never closed (the computer has one Coordinator at a time, and the owner's login handoff happens in it). The close call is not issued if the Runner is offline or the card never made a browser call in this daemon process (it must not start the VM or the stealth browser); the idle sweep is the backstop.

What the owner sees: the machine card's screen shows whichever tab was selected last, so while a card runs it follows that card's page and flips back to the Coordinator's when it makes the next call; when a card ends its tab disappears and the Coordinator's tab comes back. On a step crash nothing special runs in the browser: the runtime's failure path ends the step through `finishStep` (tab closed); if the server or Runner died instead, the tab stays until the idle sweep. Stealth (`-stealth`) sessions follow the same rules inside their own browser.

**Failure and fallback.**

| Host / condition | Behavior |
|---|---|
| Mac, macOS 26+, Apple silicon, VM not installed or not running | First call provisions or starts it (lazy, as for the Coordinator); the card shows `正在准备电脑`; a provisioning failure is a tool refusal and the step retries on the next call |
| Mac with macOS < 26 or Intel | No computer capability; the card routes to another team Runner with a computer (for example the Linux default Runner); none → waits with the reason |
| Linux Runner | Same loop; tools run on its host desktop (`HostDesktops`, `contained-spawn`) until the Linux image move (mac-vm-computer decision 4) |
| Windows Runner | No computer; same as macOS < 26 |
| Owner turned the computer off | Not eligible; waits with the reason |
| Runner goes offline mid-step | Calls refuse; the thread pauses; after the Runner offline grace the step fails |
| Server restarts | The durable thread resumes from its store, as Coordinator threads do |

**What the user sees.** The card looks the same; its activity lists the tool calls, and the machine card's screen shows the browser tab the card is using. A takeover request uses the existing card and push. A waiting card names why (`需要一台有电脑的 Runner`).

## Migration (one path)

Deleted in the same change: the daemon's info-build branch (`isInfoBuild`, `readonlyWorkspace` for info, `appendInfoNotes`, `appendReportLocationNote`, `appendDeliverablesLocationNote`, the report dir setup in `runner.ts`, `infoReportFile`, `readInfoReport`, the deliverable snapshot from the reports dir in `step-deliver.ts`, `reportsDir` in `state.ts`), and the daemon claim of info steps. The Seatbelt allowance for `runner/reports` becomes unnecessary; the confinement lane owns `confine-*` and is told, not edited here. At upgrade, a queued info step is picked up by the runtime; one already claimed by a daemon finishes or fails on that daemon, and a retry goes to the runtime. Tests: one per state row above, plus a guard that a daemon claim never returns an info step.

## Decisions (ian, 2026-11-17)

1. **Model for info cards.** The info card uses whatever the team's `session` routing rule (the new-task rule) names; the owner's choice is not overridden. For a provider/API model (for example `workbuddy` / `deepseek-v4.1-flash`) the agent loop runs in the in-server runtime (Pi) and its shell, file and browser tools are forwarded into the VM through `forwardComputerCall`. For the Claude subscription (`claude-code`) the card runs the way a `claude-code` Coordinator turn runs ([coordinator-on-claude-code](coordinator-on-claude-code.md)): Claude Code on the owner's Runner, built-in tools off (`lockedDown`), only Cairn relay tools, which forward into the VM. Pi never uses the subscription. The subscription token never enters the VM, and no model credential enters the VM on either route. Devin (2026-11-17, checked against Devin CLI 3000.13.4 and its permissions docs): the CLI has no flag or setting that removes built-in tools, only permission deny rules that reject calls to a fixed list (`read`, `edit`, `grep`, `glob`, `exec`, `Fetch`) while the tool set stays visible, and the daemon runs it in bypass mode, so it cannot be locked down the way `claude-code` is. An info card on a `devin` route therefore waits with the visible reason `info-card-runtime` (the queue tells the owner to pick another model for the new-task rule) instead of falling back to another model. The same applies to `gemini`. This supersedes the "Coordinator's providers only" recommendation above.
2. **Info cards in a code project.** When the card's project has a repo, a read-only snapshot of the default branch (`git archive`) is copied into the VM task dir at start. There is no second host path.
3. **No computer anywhere in the team** (macOS < 26, Intel Mac, Windows, VM not installed or not running). The card waits and the UI says why. There is no fallback to a host harness.
4. **Shared VM.** Info cards share the one VM and its signed-in browser with the Coordinator: one tab per card, the existing input fence, owner priority. No second VM.

## Repository snapshot for a local-repo project (decision 2, local case)

A project with `repoKind: 'local'` keeps its code on one Runner's disk (`localPath`); the server cannot read it. The snapshot still reaches the VM task dir through the one seeding path in `seedRepoSnapshot` (`apps/server/src/services/info-card-tools.ts`): `infoRepoSnapshot` returns `{ tarGz }` or `{ reason }`, and the same chunked `write_file` plus `tar xz` unpack runs. Only the source of the bytes differs by repo kind: hosted reads the bare repo, GitHub fetches the tarball, local asks the Runner.

**Flow.**

1. `infoRepoOffered` is true for a local project with a `localPath`. The Runner that holds the code is the project route's `machineId` (`profileForStep`), the same machine the dispatcher pins local-project steps to. No pinned machine, or one that is offline, writes `repo-snapshot-failed.txt` with the reason; the card still runs.
2. The server rejects a `baseBranch` that starts with `-`, then registers a pending request keyed by the info step id and pushes a `repo.archive` event (`stepId`, `directory = localPath`, `ref = baseBranch ?? 'HEAD'`, `maxBytes = INFO_SNAPSHOT_MAX_BYTES`) on that Runner's stream, next to `sync` and `computer`.
3. The Runner (`apps/daemon/src/repo-archive.ts`) re-checks the ref (no leading `-`), runs `git rev-parse --verify --end-of-options <ref>^{commit}` and `git archive --format=tar.gz` into a temp file with the same timeout, and rejects an archive over `maxBytes`.
4. The Runner returns the bytes over the existing step upload channel: `POST /api/machine/upload-urls/:stepId` then `PUT /api/machine/upload/:uploadId`, as the plan and session files do. The upload body is the base64 of the archive under the file name `repo-archive.b64`; a failure is a text body under `repo-archive-failed.txt`. The upload-urls call accepts these two names for an info step (which no Runner owns) only while a pending request names that Runner and step; any other name still needs `ownedStep`.
5. The PUT settles the pending request: the server decodes the archive, enforces `INFO_SNAPSHOT_MAX_BYTES` again, and `seedRepoSnapshot` writes it into the VM task dir. A Runner that answers nothing within 90 s, or a stopped step, settles the request with a reason.

**Failure behavior.** Offline Runner, missing path, not a git repo, unknown ref, oversized archive, timeout: each becomes a reason in `repo-snapshot-failed.txt`; none fails the card. The snapshot is the committed tree of the ref, so uncommitted edits in the owner's checkout are not included. With no `baseBranch` the ref is `HEAD` of the checkout.

**Who reads or writes what.** Runner: reads the repo, writes a temp archive it deletes, uploads once. Server: holds the bytes in memory for the seeding call, writes nothing to disk. VM: receives the files read-only under `repo/`, as for the other repo kinds. A second request for the same step while one is pending is refused.
