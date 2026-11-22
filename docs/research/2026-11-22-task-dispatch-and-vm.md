# Task dispatch, task permissions, and the VM — outcome for #5369

Date: 2026-11-22. Status: outcome record for issue #5369 (the 2026-11-18 Coordinator briefing's four questions: how dispatch should work, what permissions a task gets, whether tasks belong in a VM, what the VM is for). Facts measured on `origin/main` at `84727fa28`.

Marks: **observed** = read in the code or a landed doc this session; **derived** = follows from observed facts; **guess** = unverified, stated as such.

## Newcomer

Someone who installed the Cairn Mac app today on one Mac. They sign in, add a model subscription or provider key, and create a task — a "fix this bug" card — or ask the Coordinator to create one. The app bundles a Runner (the daemon) on that same Mac, enrolled as their `local` machine (`machines.ts` `seedLocalMachine`, observed). A **code** task runs on their Mac under an OS sandbox they never configured; it can read and write the project worktree and not much else that is theirs. Separately, on macOS 26+ Apple silicon, the Machines page offers a "Linux VM" download (~1.5 GB, off until the owner asks — `vm-download-consent.md`): a desktop computer the Coordinator can browse, click and run shells in. It is not where a code task's agent process runs — but it *is* where an **info card** (a research/summary/report task, `output` ∈ info/report/dataset/link) executes: inside the VM through computer tools, per `info-cards-in-agent-computer.md`.

What they must already know: nothing about any of this. Accounts/keys: a model subscription or API key; a GitHub connection only if the project is GitHub-backed. What it stores: per-step scoped credentials, resolved on the server and handed to the step for its lifetime (details in Q2). Where they get stuck: a machine that cannot sandbox shows `confinement: unavailable` and tasks stay pending rather than running unsandboxed.

## The four questions and where each stands

| # | Question | Verdict |
|---|---|---|
| 1 | How should task dispatch work? | Answered by landed code + docs since 11-18. Recorded below; nothing left to decide. |
| 2 | What permissions should a task get? | Answered by the shipped confinement + today's design doc. Detail decisions already routed to the owner inside that doc. |
| 3 | Should tasks run in a VM, or where? | **Mostly answered by landed design** — code tasks stay host-side under the OS sandbox; info cards already execute inside the VM (`info-cards-in-agent-computer.md`). **Decided here** with prior art: do not move the code-task agent process into a VM; the orb container path already serves users who want machine-level isolation; worker code steps keep no computer grant. |
| 4 | What is the Coordinator VM for? | Answered by `mac-vm-computer.md` + `vm-download-consent.md` + `per-thread-browser-profiles.md`: it is a desktop *computer for tools*, not an execution environment. |

## Q1 — How should task dispatch work?

The model that shipped (all observed on `origin/main` today):

1. **Machines pull; the server never pushes.** Each Runner daemon long-polls `POST /api/machine/tasks/claim`; the server's `tryClaim` atomically flips a `pending` step to `claimed` (`machine-claim.ts`). A task (todo) compiles to builds → steps; each step kind (plan/build/review/…) carries a routing decision — provider + model, an optional machine pin, and optional required capabilities (`step-route.ts`, `routing-rule.ts`, `agent.ts`).
2. **A step can be claimed when the machine fits it**, checked in `machineEligibility` (`dispatch-eligibility.ts:268-293`): the step's runtime exists there (claude-code/pi/devin/antigravity), the model is configured there, required capabilities are reported (mcpServers, models, `executor: orb`, os), a local-path project's pin matches, no Claude rate-limit block, the subscription exists, and — last — `confinementDispatchReady`: on enforced platforms the machine must currently report `confinement: ready`. A task with no fitting machine shows `waitingOn: machine`; a quota hold shows `waitingOn: quota` (`todo.ts:130`). Those are the only two wait reasons left.
3. **No concurrency cap, no strain hold, no lanes.** Since 11-19 a computer runs every task ready for it (`no-machine-concurrency-cap.md`, commit `c490c7587`); the only caps left are the per-project `maxConcurrent` (off by default) and an orb Runner's own sandbox cap (`maxWorkers`, `machine-loop.ts:1330`). Strain is *displayed* (memory pressure ≥90%, CPU util ≥90%, free disk <5 GB — never the load average) but never holds a task (`runner-strain-and-progress.md` §"No claim gate", commit `05c294c94`). The quick lane is revoked — there is one kind of task again (`quick-lane.md` header, commit `9575eeb74`).
4. **One live card per request.** The Coordinator's create path resolves request twins by segment coverage: a verbatim repeat create is refused; a covered dead card is superseded, donates its GitHub issue, and is skipped by retry and ownership sweeps (commit `843303b97`, #5386/#5387 — the duplicate-dispatch and silent-continuation defects from the briefing).
5. **Failures are bounded and told.** Automatic retry: 3 attempts at +1/+2/+4 min, then `Task parked` with a thread message, a Coordinator notice and a Needs You entry (`automatic-retry.md`). Needs-human errors never retry. A rerun by the owner always works and resets the budget.
6. **An issue opens only when a leg delivers code** (commit `4020b3777`) — the briefing's "every card auto-opens a GitHub issue" no longer holds.

The briefing's "unknown chief tool" for `user_computer_*` calls is also fixed: mistyped calls get the valid tool names back (commit `f5f30e7fa`, #5353).

Nothing here needs an owner decision: the dispatch shape is pull-claim + eligibility + no caps, and every relaxation the briefing complained about (strain holds, two lanes, silent duplicates, unbounded retries) was removed or bounded between 11-19 and 11-22.

## Q2 — What permissions should a task get?

Answered by the shipped macOS session confinement (landed 2026-11-17) plus today's design doc `docs/design/2026-11-22-task-confinement-and-credentials.md` (#5006/#5393). In newcomer's terms: a task gets **its own workspace and its own short-lived credentials, and nothing of yours**.

Observed on `main`:

- Every task agent session (Claude Code, pi, ACP adapters) launches inside a Cairn-owned Seatbelt profile on macOS (`confine-session.ts` → `confine-seatbelt.ts`); dispatch refuses a machine whose confinement is not `ready` — fail closed, no unconfined fallback (`dispatch-eligibility.ts:292`, `machine-capabilities.ts:89-97`).
- The profile today: file deny on the credential stores (`~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.kube`, container runtimes, `~/.claude`, `~/.codex`, `~/.pi`, `~/.gemini`, `~/.netrc`, `~/.git-credentials`, Chrome/Chromium config, daemon and server homes — `confine.ts:24-51`, `confine-seatbelt.ts`); `(deny file-write*)` outside the workspace/task-temp/state/caches; `.git` metadata write-deny; mach denies for LaunchServices/AppleEvents, WindowServer and pasteboard; network deny on the server's loopback port; unix-socket denies covering the launchd/SSH-agent socket classes (`observed` — `ssh-add -l` inside fails, per the design doc's probe table).
- Credentials are per-step and scoped, resolved **outside** the sandbox and delivered on private channels: provider key / subscription token by env or pi's `initialize` frame; git via a `git-step-<id>` key or a GitHub-App `StepAppCredential` file + `GH_CONFIG_DIR`; MCP connector headers and secret-grant values resolved daemon-side; the machine token and owner token never enter the session (design doc §"Which credentials each path gets, and how").
- Every task-reachable child env is now an allowlist, so daemon credentials (`GH_TOKEN`, `ANTHROPIC_API_KEY`, …) no longer leak into sessions (commit `ccec4f37d`, today).
- Owner decisions — payments-like actions, approvals — are gated on the in-memory desktop channel (commits `049f476d9`, `a8fbbac09`); a task cannot self-approve.

Hardening in flight (design doc, not yet landed): deny-list expansion to `~/.config`, package-manager credential files, shell rc files and the system keychain; same-sandbox-only `signal`/`process-info`; `.agents/*` workspace hooks through the same confiner (they run unconfined today — observed); the step-credential-dir placement fix; the `KERN_PROCARGS2` env-read residual closed by the "no credentials in any reachable env" rule rather than by Seatbelt (measured: SBPL cannot deny it). Detail calls on these are already enumerated as the doc's ten open questions for the owner — they change the boundary's edges, not its shape.

## Q3 — Should tasks run in a VM, or where?

**Short answer: the landed split already decides the "or where" — code on the host under the OS sandbox, info cards inside the VM — and the remaining question, "should the code-task agent process itself move into a VM", is no.**

What already shipped/decided (observed): an info card never spawns its harness inside the guest. `infoCardPlan` (`info-card.ts:38-73`) routes it either to the in-server pi runtime driving the VM through computer tools — the Rakazo pattern the owner chose in `info-cards-in-agent-computer.md` — or to a Runner on the VM's host with `remoteToolsOnly`/`relayOnly` (harness confined on the host, only tool calls cross into the guest). A VM-capable host is a hard requirement (`computerKind === 'vm' && computer && browser`); without one the card waits `no-computer`. The design doc's reason for keeping the harness out of the guest is exactly the credential argument of Q2: inside the VM the agent uid could read any injected model key, so credentials stay server/daemon-side and only tool calls cross.

So the open part of Q3 narrows to: should a **code** task's agent process run inside a VM (or container) instead of the host Seatbelt/bwrap profile?

### Prior art — where the industry puts the agent workload

Existing in-repo coverage (read this session, cited not redone): `2026-11-22-task-confinement-prior-art.md` (Codex CLI Seatbelt/bwrap+seccomp, Anthropic sandbox-runtime, Gemini CLI profiles, credential-broker pattern), `amp-native-sandbox-orb.md` (Amp local vs e2b orbs), `agent-small-computer-2026-11-08.md` (e2b/Firecracker, Fly, Modal, Daytona, Grok-on-Cursor), `orb-container-runtime.md` (OpenHands container default, Daytona egress).

| Product | Local or cloud | Boundary per task | Task can reach | Source |
|---|---|---|---|---|
| Devin | Cloud | Dedicated Linux VM per session ("kernel-level session isolation"); Customer-Dedicated = single-tenant VPC | Egress allowlist + Security Profiles; secrets kept out of the prompt | docs.devin.ai/onboard-devin/environment, /product-guides/security-profiles, /enterprise/deployment/overview |
| Devin CLI (`devin acp`) | Local | No vendor sandbox — the host's own confiner (here: Cairn's Seatbelt) is the boundary | Whatever the local confiner grants | repo docs/design/devin-subscription-source.md (observed) |
| OpenAI Codex cloud | Cloud | Container per task ("Codex creates a container"), `codex-universal` image, cached ≤12 h | Secrets injected into setup phase only; agent internet off by default, optional domain allowlist | learn.chatgpt.com/docs/environments/cloud-environment.md, /cloud/internet-access |
| Codex CLI | Local | `sandbox-exec` deny-default SBPL / bwrap+seccomp helper — no VM | Full-disk read by default; Keychain readable (SecurityServer granted); credential broker via MITM | repo prior-art doc rows 1–2 (observed, source-level) |
| Cursor background agents | Cloud | Dedicated VM per run (Ubuntu; hibernate/delete on idle; likely Firecracker-family — `*.cursorvm.com` hosts Grok Bot on Firecracker, per `agent-small-computer-2026-11-08.md`) | Repo access via Git App; env secrets + redaction; network policies; full desktop for computer use | cursor.com/docs/cloud-agent/security + /capabilities (hypervisor derived) |
| Claude Code | Local | sandbox-runtime: `sandbox-exec` / bwrap+seccomp | Sentinel-masked creds + host proxy injecting real values only to allowlisted hosts | repo prior-art doc rows 4–5 (observed) |
| OpenHands | Local | **Docker container per conversation** (default; "Process" mode documented as unsafe) | Workspace mount rw; per-conversation credential boundary | docs.openhands.dev/openhands/usage/sandboxes/{overview,docker} |
| OpenHands Cloud | Cloud | Same docker runtime, hosted | same | runtime.all-hands.dev |
| Amp | Local + cloud | Local: no OS sandbox at all. Orbs: one e2b **Firecracker microVM** per thread | Orbs prefer OIDC workload identity over stored secrets | repo amp-native-sandbox-orb.md (observed) |
| GitHub Actions | Cloud | Fresh VM per job | Per-job OIDC JWT endpoint instead of stored secrets | docs.github.com/actions |
| Gitpod → Ona | Cloud | Container (k8s pod + workspacekit userns rings) per workspace — deliberately userns over Kata/Firecracker | Root-like inside, unprivileged on node | ona.com/stories/we-are-leaving-kubernetes |
| E2B / Vercel Sandbox / Fly | Cloud infra | Firecracker microVM per sandbox | Secret store + egress proxy injects values into allowlisted requests; value never enters the sandbox | repo agent-small-computer doc + vercel.com/docs/sandbox/concepts (observed) |

Rows whose claims rest on in-repo docs are marked observed in-line. The external-doc rows (Devin, Codex cloud, Cursor, OpenHands, Actions, Gitpod) cite first-party pages read through search excerpts this session — observed at excerpt strength, not full-fetch strength; hypervisor details vendors do not disclose are marked derived.

Two clean camps, **observed** across the table:

- **Local-first products never use a hypervisor for the agent process.** The spectrum is: OS sandbox (Codex, Claude Code, Gemini — all deny-default allowlists, same family as our Seatbelt/bwrap), a local container when a whole environment is needed (OpenHands), or nothing (Amp local, Devin CLI) with "isolated environment" as the documented escape hatch. A Linux VM appears only incidentally — Docker Desktop's — never as the security boundary.
- **Cloud products always isolate per task**, split between dedicated VMs/microVMs (Devin, Cursor, Amp orbs, GitHub Actions, E2B/Vercel/Fly) and containers (Codex cloud, OpenHands, Gitpod, Daytona). The microVM is becoming the default for *untrusted* third-party workloads — which is not our threat: on the owner's own Mac the task is the owner's, the secrets are the owner's, and the adversary is a prompt-injected agent, not a tenant.

And independently of the boundary, every product converges on the same credential shape Cairn already ships: the workload holds scoped or placeholder values; real secrets stay outside and are injected per-destination or per-step (Q2).

### Recommendation

1. **Tasks stay host-side under the OS sandbox.** The confinement contract (fail-closed `ready` gate, per-step scoped credentials, env allowlist) already delivers the property a VM would be bought for — the task cannot reach the owner's credentials — at none of the cost: no ~1.5 GB image, no 2–8 GiB of reserved RAM, no multi-second cold start per step, no second kernel to maintain on the user's Mac (derived from `vm-download-consent.md`'s measured sizes and `mac-vm-computer.md`'s memory sizing).
2. **Do not reuse the computer VM to run tasks.** Its profile is a desktop (X11, browsers, broad internet reach for web work); the session profile is the opposite (no GUI mach services, server port denied, credential denies). Mixing them weakens both — and the VM's guard proves its own point: it exists to isolate a *display+input* surface, not compute (derived).
3. **The orb executor is the upgrade path, and it is already built.** `CAIRN_EXECUTOR=orb` runs each step in a disposable container (nspawn today; rootless Podman designed; e2b/Firecracker the documented next `OrbRuntime` — `orb-container-runtime.md` §7, `select.ts`). That matches the container camp (OpenHands/Gitpod/Codex cloud). Moving the *default* Mac runner onto orbs is a threat-model decision (kernel-shared container escape), not an industry-conformance gap — recommend: not now; revisit when the first real escape-class incident or a multi-user server makes the same-kernel boundary load-bearing.
4. **Code tasks keep no computer grant — no new setting.** Today a step reaches the computer channel only when `computerThreadOf` resolves a thread for it: chief steps, and steps of `output`-is-info todos (which run *through* the VM rather than in it) (`computer-thread.ts:32-51`, `machine-computer.ts:1457-1460`). A code task cannot drive the VM desktop or the owner's Mac. The briefing's "tasks can't use the VM or its logins" is true for code tasks by design — and for browsing needs the product already answers with the info-card kind, which gets the VM's signed-in browser. Granting *code* steps a desktop scope would be a new trust surface (shared screen, stored logins) for a need no code task has shown — recommend keeping it out; if one appears, extend the same relay/lease path the info card uses, not a toggle.

Product rule check: this adds zero settings — it declines one (a "run tasks in the VM" switch) and keeps one existing capability boundary as designed.

## Q4 — What is the Coordinator VM for?

Answered by `mac-vm-computer.md`, `vm-download-consent.md`, `per-thread-browser-profiles.md` (all observed):

- It is a **computer, not an executor** — a per-scope Debian desktop (Xvfb + openbox + Chromium + CloakBrowser + shell + file tools) that agent *tools* drive. On a Mac Runner it runs under Apple's `container` on macOS 26+ arm64 (`vm-desktop.ts`), one VM per computer scope. The Coordinator runs in the server process (`coordinator/runtime/server-runtime.ts`, `coordinatorRunsOnPi()`) and reaches a scope's desktop through computer calls relayed to a machine (`machine-computer.ts` `forwardComputerCall`).
- Its purpose is a **trust boundary for acting on the world**, not for running code the task produces: inside, the agent uid reaches the internet but not the Mac, the LAN, or another VM (`guard.nft`, measured on the trial VM per the design doc). Browsers hold the sessions and logins the agent needs; the owner can watch the screen and take over (`computer-login-handoff.md`).
- Scoping today: one computer scope per chief (`computer` row keyed `chief:<id>`), reachable by chief steps and by info-card steps, which borrow the owner's chief scope (`computer-access.ts`, `computer-thread.ts`); per-thread browser profiles inside it (`per-thread-browser-profiles.md`); per-task desktops are explicitly out of scope there.
- It is opt-in and self-describing: nothing downloads until the owner asks (the first-run switch or the Computers panel), a pre-download tool call is refused with a pointer to the panel, and unsupported hosts report no computer (`vm-download-consent.md`).
- The `user_computer_*` family is the other end of the same idea — the Coordinator driving the owner's *own* Mac screen/shell through the confined host shell (`own-mac-computer.md`, `host-shell-confinement.ts`), for things that must happen on the real Mac.

So "what is the VM for" in one sentence: it gives the agent a sandboxed computer to *use* — see, click, browse, run shells, hold logins — behind a network guard; and it is the execution seat for info cards, whose whole job is using that computer. A code task's agent process stays confined on the host either way.

## Scenario table

| Situation the user meets | What they see | What the system does | Wait/cost |
|---|---|---|---|
| Newcomer runs a task on one Mac | Task starts on the next claim poll; never "computer is full" | Pull-claim + eligibility; session spawns under Seatbelt; per-step creds delivered | seconds |
| Five tasks at once on a small Mac | All start; tray shows strain (amber, memory/CPU/disk) | No cap, no hold; owner stops tasks if needed | none |
| Task fails on something transient | Card stays failed ~1 min, retry shows in thread; at 3 failures, `Task parked` + Needs You | Bounded retry sweep; Coordinator notified once | ≤ ~7 min to parked |
| Coordinator asked the same thing twice | One card; the repeat create is refused with the covering card ids | Segment-coverage dedup; dead twin superseded, donates its issue | none |
| Task tries `cat ~/.ssh/id_rsa` | Tool error `Operation not permitted` in transcript | Seatbelt file deny | none |
| Task needs to push to GitHub | `git push` works in-session | Per-step scoped credential via env or credential dir | none |
| Owner turns on the Linux VM | ~1.5 GB downloads once in the Computers panel | Apple `container` + pinned image; then Coordinator calls get a desktop | one-time, owner-triggered |
| Coordinator asked to browse a site | Opens Chromium inside the VM; owner can watch/take over | `computer_*` tools → scope's desktop; nft guard keeps it off the Mac | 2–3 s cold start |
| A task is a research/report card (`output: info`) | Runs inside the VM as a pi thread or a relay-only runner step; uses the VM's signed-in browser; writes `report.md` and calls `submit_report` | `infoCardPlan` + the chief-scope computer channel; waits `no-computer` until a VM host exists | VM download first if never asked |
| A code task asks to browse | Not possible today — no computer grant for code steps | `computerThreadOf` resolves no thread; recommendation: keep it that way | n/a |
| `sandbox-exec` removed by a macOS update | Machine `confinement: unavailable`, tasks pending with a repair reason | Fail closed — never unsandboxed dispatch | until repaired |

## Decisions routed to the owner

Only two, both with recommendations above; everything else in this doc is description of landed behavior:

1. **Confirm: the code-task agent process never runs inside a VM** — host OS-sandbox is the boundary; orb (container today, e2b/microVM the designed upgrade) is the answer when stronger isolation is genuinely needed; info cards already show the "task in the VM" shape is a *tools* channel, not a harness inside the guest. Recommended: yes, confirm; it ratifies the direction the confinement workstream already shipped.
2. **Confirm: code tasks stay without a computer grant** (chief + info-card scopes only, as coded). Recommended: yes; if a code task later needs a browser, extend the existing scope/lease path rather than adding a setting.

The confinement design doc's own ten open questions (`2026-11-22-task-confinement-and-credentials.md` §"Open questions for the owner") remain the detailed boundary decisions — Linux migration sequencing, `~/.config` wholesale deny, the Antigravity keychain carve-out, OTel env removal, owner-shell env residual, hook confinement, Group Containers, `sandbox-exec` deprecation posture, the batch launcher, and the `confine()` signature — each already carrying a recommendation there.
