# Linux harness confinement

Date: 2026-11-09
Status: approved by ian on 2026-11-09; startup-availability addition and review correction below; implementation follows in ordered PRs

## Decision and boundary

| Decision | Owner and basis |
| --- | --- |
| Linux only; one mandatory bwrap launcher for dispatched harnesses on omarchy | ian and orchestrator, 2026-11-09; supersedes the platform scope in [research §4.2](../research/user-computer-model-2026-11-08.md#42-mode-b-one-cairn-owned-sandbox-around-every-harness) |
| No Seatbelt implementation | Known gap: its proposed file policy cannot meet daemon-PID isolation; non-Linux task launches must refuse, never run unconfined |
| Computer-driver tasks #140/#141 paused; neither driver qualified | ian, 2026-11-09; no driver choice, orb/noVNC deletion, dependency or lockfile change here |
| Startup isolation failure is machine unavailability, not repeated task failure | [ian's approval and addition](https://github.com/xiechimon/cairn/pull/3656#issuecomment-6742184723), 2026-11-09; machines-page reason and one notification per outage |

Reuse the research's whole-process precedent, not Bash-only or in-process isolation. Launch observations were inspected at `b46a16893`; proposals are not measured guarantees. Scope: daemon-dispatched harnesses and descendants, including retained orb workers, not the in-server pi-durable Coordinator or external MCP services.

## One policy, inside the backend seam

Only `apps/daemon/src/backend/confine.ts` launches harnesses: bwrap with `--die-with-parent --new-session --unshare-pid --ro-bind / / --dev-bind /dev /dev --proc /proc --tmpfs /tmp`. Networking stays shared; no `TMPDIR` override, resource caps, shell prefix or unconfined fallback. Custom code bridges policy/SDKs, not bwrap's namespace/mount machinery.

- **Writes:** worktree, git common directory, private task temp, own state, and shared caches (`~/.cache`, resolved pnpm store, `~/.npm`, Go modules, Cargo registry). Everything else is read-only; protect git hooks/config inside writable metadata.
- **Denied reads:** SSH, GPG, AWS, gh, netrc, Docker, Kubernetes and password-store credentials; Chrome/Chromium profiles; daemon home; other harness state. Mask directories with empty read-only mounts and files with `/dev/null`. Resolve canonical paths, classify absent targets without creating host secret files, and reject unsafe overlaps/symlinks before spawning.
- **Precedence:** read-only root, denied-parent masks, narrowly re-exposed task/state paths, then protected-file masks. Worktrees and pi state beneath daemon home must work without exposing its machine credentials, session index or unrelated transcripts. No writable cache may alias a denied root. Never rebind the whole daemon home.
- **Only profile difference:** own-state paths: Claude's configured directory plus `.claude.json`, Codex's directory, pi's `agentDir` plus private session directory/exact legacy resume file, Gemini's directory. Never expose shared transcripts/index; parent retains indexing. Preflight uses empty private task scratch, without git writes.
- **Limits:** shared networking, all devices, readable non-denied host files and writable caches/state are explicit trust exceptions, not protection against every host service. Pass only required environment/credential values and FDs; never inherit daemon credentials wholesale or log secrets.

## Launch inventory and failure behavior

Paths are relative to `apps/daemon/src/`; write failing launch tests per row, including create/resume. Invalid task input or model/adapter configuration remains session-local; isolation infrastructure failure follows the machine-unavailable transition below at every entry.

| Existing entry | Replacement and failure behavior |
| --- | --- |
| `backend/claude-code.ts`: `query`, SDK default spawn and conditional OAuth-FD spawner | Always install confine, with/without token FD; preserve stdio/abort/credentials, disable inner sandbox. bwrap/FD/SDK failure closes pipes and rejects before prompting. |
| `backend/acp.ts`: configured Claude/Codex adapters and default Gemini executable, including injected spawners | Injection records confined argv, never bypasses policy. Require Codex `full-access` after new/resume/load; disable other inner sandboxes. Unsupported adapters/modes or initialization failure close host tools/processes before prompting. |
| `backend/pi.ts`: `createAgentSession`, built-in file tools, Bash and local MCP children | Move the existing session into confined `cairn-daemon pi-host`, registered in `cli.ts`, in the same change. No in-process fallback; startup failure returns no handle. Descendants inherit confinement. |
| `claude-code-bin.ts` version and `claude-code-auth.ts` auth-status probes | Replace direct `execFile` with confine/preflight policy. Failure reports unavailable/unknown with scrubbed reason, never retries unconfined. |
| `machine-loop.ts` backend selection; `orb/worker.ts` backend factories; probe scripts and `backend/smoke-command.mjs` | Converge on these seams; remove smoke helper's direct spawn and `inOrb` exemptions. Missing bwrap/namespaces fails even inside retained containers. |

Git/workspace management, daemon supervisors and computer-driver helpers are not harness launches. Structural coverage must nevertheless reject new direct harness launches outside the inventoried seams, including SDK defaults; no backend file except `confine.ts` may import `node:child_process`.

## Startup ownership and machine availability

[Primary-source research](../research/confine-process-ownership-2026-11-09.md) identifies the parent-already-dead race in bwrap's `--die-with-parent`; retain the flag only as cleanup assistance. One systemd-owned transient task service/cgroup, established before bwrap starts, uses `BindsTo=` plus `After=` on the owning daemon unit, `Restart=no`, `KillMode=control-group` and final SIGKILL. bwrap remains the single sandbox. No cgroup delegation, writable cgroup controls or manager-control sockets/FDs reach the child. Missing manager/owner-unit/cgroup support fails preflight; no alternative launch mode.

A trusted confine init gate inside bwrap starts no harness until it validates an explicit current-invocation acknowledgement after manager ownership and sandbox readiness. EOF, cancellation or stale/malformed acknowledgement aborts; bwrap's `--block-fd` alone is insufficient because EOF releases it. Parent loss stops the bound task unit even before acknowledgement. Cancel/start races reconcile the unique launch unit; release paths only after terminal manager confirmation (inactive/dead with Result, or a completed D-Bus stop job / successful `systemd-run --wait`) **and** either `cgroup.events populated=0`, path `ENOENT`, or held-FD `ENODEV`, never a PID exit or an asynchronous stop request. Accept removal only after terminal confirmation because [cgroup-v2 removal requires no live processes](https://docs.kernel.org/admin-guide/cgroup-v2.html#organizing-processes-and-threads) and rejects populated cgroups with `EBUSY`, so systemd removal proves emptiness. An active unit with a missing cgroup, other errors, timeout, or remaining `populated=1` fails closed. Unverifiable cleanup reserves paths and marks the machine unavailable.

| Availability reader/writer | Transition, failure behavior and required test |
| --- | --- |
| Daemon startup/preflight and recovery | `checking → ready/unavailable`; run the same policy, startup gate and cleanup checks before any claim or harness probe. Missing bwrap, denied namespaces/mounts or failed ownership/cleanup makes all task runtimes unavailable. No raw fallback or automatic recheck loop; explicit recheck after repair must pass before readiness. |
| Enrollment/presence; shared capability parser; server machine service | Carry validated confinement state, scrubbed reason code and fenced daemon-invocation identity. Persist the current state; missing/invalid/stale readiness cannot enable dispatch. Keep presence online to expose the fault, without overwriting the owner's enabled-runtime settings. Test restart and reordered reports. |
| Scheduler/routing, server claim eligibility and daemon launch gate | Require current acknowledged readiness at every entry; otherwise leave tasks pending without failed builds. If infrastructure fails after claim but before launch, release the unstarted claim as machine-blocked and stop further claims; test concurrent claims and zero repeated task failures. |
| Machines page; notification writer | Show unavailable with the repair reason. Server persists one outage identity until confirmed recovery; deduplicate notification by machine/outage across heartbeats and restarts. Test one notification for repeated failure, visible reason, recovery and one new notice for a later outage. |

Implementation touches `machine-loop.ts`, shared machine capabilities, server presence/eligibility/routing/claim/notification paths and the existing machines surface together; do not ship readiness reporting without enforcement or UI visibility.

### Ownership segment contract

`launchConfined` is the backend launch seam; harness adapters migrate in the later integration segment. The caller reserves paths until `completed` or `stop()` succeeds; rejection means unavailable and reserved. `completed` proves cleanup, while the returned process carries the harness exit status. Resume paused stdout after attaching the consumer. Only three standard streams cross systemd; extra credential FDs are not yet supported. The manager establishes ownership before bwrap; the trusted shell init reads exactly one nonce line without buffering harness input. Clear the environment inside bwrap and pass only the caller's explicit allowlist.

| Reader / writer | Expected behavior and test |
| --- | --- |
| Owner check / acknowledgement | Require this process's active owner cgroup and invocation, recheck before releasing the nonce; EOF, malformed or stale nonce starts nothing. |
| Start / cancel | Unique task unit; cancelled or failed starts reconcile via a synchronous manager stop; unprovable cleanup rejects. |
| Completion / stop | Successful terminal wait or synchronous stop job, then independent emptiness/removal proof; active, unexpected errors, timeout and populated leftovers reject. |
| Escaped process / manager | `ExitType=cgroup` keeps the unit alive for survivors; `KillMode=control-group` kills even session-changing or externally joined processes. |

## Pi protocol and state ownership

One child per live session; no persisted protocol state or daemon-wide environment mutation. Existing SDK plus versioned, Zod-validated JSONL on private pipes: bounded frames/queues, correlation IDs, backpressure; scrubbed stderr diagnostics. This thin bridge preserves Cairn's custom tools/gates, unlike stock pi RPC.

| State reader/writer or transition | Required behavior and failure-first test |
| --- | --- |
| Parent create/continue → starting; child initialize → ready | Parent resolves the resume file; child validates model, settings and policy. Missing transcript, unsupported protocol or startup exit rejects open; ready includes session identity before any prompt. |
| Parent prompt; child ready → running; child events/usage | Stream ordered StepEvents, final usage and durable transcript updates; parent owns indexing and validates session paths. EOF, invalid/oversized frames or persistence failure fail pending work, never synthesize success. |
| Parent steer/image input; child live session | Preserve ordering, image checks, gates, skills, telemetry and compaction behavior. Reject steering after stopping and unsupported input without another child. |
| Child tool request; parent registered callback; child reply | Bridge only declared local/remote tools and approval callbacks with correlated IDs; reject unknown methods/IDs. Built-in file/Bash tools stay in the child. Do not expose a generic parent filesystem/command executor. External services retain their own authorization. |
| Parent stop/abort; completion, child error/exit, or parent loss → stopping → closed/failed | Settle requests once, cancel callbacks and close pipes; stop the manager-owned task cgroup and verify emptiness before releasing paths. Test owner death/cancel before startup acknowledgement, immediately after it, and with double-fork/session-changing descendants. Uncertain cleanup marks the machine unavailable; no respawn or blind retry. |

## Acceptance before implementation is called complete

Red-first: argv snapshots; launch/state tests per table row; structural tests; per-profile Linux probes for worktree writes, denied home writes/secret reads, hidden daemon PID, HTTP and GPU. Cover nested daemon-home paths, protected git metadata, absent targets, startup/cancel/parent-death races, independently verified cgroup cleanup and machine-unavailable behavior for namespace/mount failure, including the visible reason and exactly one outage notification. Real Claude/Codex/pi fake-model E2Es request sentinel reads/home writes and prove denial; record omarchy install (`pnpm install --ignore-scripts`) and tests inside confine. Use targeted Vitest `--maxWorkers=4`, lint, typecheck, spec:parse and prepush. No fresh runtime pass or macOS evidence is claimed. Design approval is recorded above; implementation starts only after this docs PR merges, in ordered red-first PRs.
