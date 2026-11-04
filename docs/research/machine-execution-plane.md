# The machine execution plane: how "the same code runs on any machine" is implemented

> Purpose: answer the user's question of 2026-10-02 — "this project can run on any machine. I want to know how this feature is actually implemented".
> Sources: herdr thread t-0047 read-only research (data collected 2026-10-02: link-by-link source reading in the repo + first-hand crabbox / Multica fetches for cross-checking + local process/port measurements on this machine and mea).
> Baseline: all `path:line` references were re-anchored to `origin/main = 37edab2a` (2026-10-03) at commit time and spot-checked one by one; line numbers drift with the code — the baseline SHA is authoritative.
> Freshness: the crabbox / Multica side is a 2026-10-02 snapshot (crabbox HEAD pushedAt 2026-10-02T10:39Z, 1440 stars; multica HEAD pushedAt 2026-10-02T14:25Z, 51848 stars; README / architecture docs / source sampled directly via the `gh` CLI). Multica mechanism details are cited from in-repo r10 / r13 (fresh-clone, line-by-line source) and r3 (worktree contract measured); this document does not re-crawl its source. The Multica deployment on mea was decommissioned on 2026-10-02, which does not affect its value as a comparison sample.
> Citation convention: an unmarked `path:line` = first-hand evidence from this repo; `[推断]` = an inference without a direct source; no sourceless assertions.
> Related: engineering ticket #682 (machine dispatch closed loop) cites this document; r10 / r11 / r13 are the canonical research on the Multica runtime model.

## 0. Conclusions first

1. **The "any machine" execution plane already exists in full**: the enroll / claim / worktree / report-back chain is all in place; the same code running a server + daemon each on this machine (macOS) and mea (WSL2 Linux) is living proof (§3).
2. **The mechanism in four sentences**: code never travels with the task — git is the single source; the execution machine is a daemon that reaches out and claims tasks, so the server never needs inbound connectivity to machines; authentication and per-step git credentials are all issued by the server and short-lived per step; the control plane rides HTTP/SSE and the data plane rides git (§1).
3. **What "not closed-loop" is missing is not the execution plane but the wiring from entry points to dispatch**: the pinned-machine column (`build.pinnedMachineId`) is in the database and the claim filter is in the service, but none of the three task entry points (new-task UI / REST body / chief orchestration chain) can write it — the only writer today is the scheduler. There are also five governance gaps (§4, all collected into #682).
4. **The lineage of the dispatch model**: pacman ≈ Multica's dispatch skeleton (daemon dials out + claim long-polling + per-conversation worktree + per-task credentials), but decouples Multica's "agent bound to runtime" into "assignment picks the agent, the machine is pinned separately"; crabbox represents the other extreme — machine choice is just an explicit flag at call time, with no queue and no binding (§5).

## 1. The four pillars of the mechanism

**Pillar one: git is the single source of code; code never travels with the task.**
Before executing a task, the execution machine clones the base repository on the spot from the `cloneUrl` in the claim payload and opens a per-conversation worktree (`apps/daemon/src/workspace.ts:66-114`). The three forms of `cloneUrl` are derived at a single point on the server side, `projectRepoRef` (`apps/server/src/services/git.ts:115-130`):

- hosted = `<origin>/git/<teamId>/<repoName>` (a bare repo on the server + `git http-backend` CGI, `git.ts:100-102`);
- github = `https://github.com/<repo>.git` (`git.ts:132-135`);
- local = the user's absolute repository path (`git.ts:125-127`).

So "any machine" needs no pre-installed project — only daemon + git + network reachability.

**Pillar two: the execution machine = a daemon that dials out; no public inbound needed.**
The machine runs the same npm package (`@xiechimon/pacman-cli`), and `pacman start --server <url>` points at any server (`apps/daemon/src/cli.ts:101`; config precedence = explicit argument > env > default, `apps/daemon/src/config.ts:1-3`). All work goes over daemon → server HTTP long-polling + SSE outbound connections; the server never connects back to machines.

**Pillar three: authentication and credentials are all issued by the server and short-lived per step.**
Machine registration trades for a 64-hex token; the server stores only the hash (`packages/shared/src/protocol/machine-wire.ts:41-45`); before each step the daemon calls `GET /api/machine/token/{stepId}` to fetch a **per-step** git credential (hosted repo key / GitHub x-access-token), held in memory and never written to disk (`apps/daemon/src/runner.ts:267-268`, `apps/server/src/routes-machine.ts:313-315`). There are no long-lived credentials on the machine.

**Pillar four: the control plane is HTTP/SSE, the data plane is git.**
Instructions, heartbeats, and events go over the server; code output returns to the git remote via `commitAll + push` of the conv branch at the end of each step (`runner.ts:803-838`). Any machine can recover the code context from origin — this is the underlying reason "any machine can pick up where another left off" (the exception for conversation context is §4-7).

## 2. The full chain, link by link (new task → remote machine execution → report-back)

### Link 0 · machine online (enroll, three paths)

- The web "add machine" dialog hands over CLI commands: `npm install -g @xiechimon/pacman-cli@latest` + `pacman start` (browser authorization) or `pacman start --api-key <key> --team <teamId>` (headless path), `apps/web/src/resources/create-machine-dialog.tsx:35-37`.
- On the target machine the daemon starts: with no `machine.json` it registers — POST `/api/machine/enroll` (Bearer apiKey, `apps/daemon/src/machine-client.ts:178-190`, `apps/daemon/src/machine-loop.ts:141-173`); the browser authorization flow = enroll/start + poll + authorization-page confirmation (`machine-client.ts:192-214`, `apps/server/src/routes-machine.ts:136-204`).
- The server writes the `machine` row: `enrollMachine` upsert, token stored as hash (`apps/server/src/services/machines.ts:449-490`); local/remote decided by hostname (local-machine rule seed, `machines.ts:400-405`); on server startup a local row with kind='local' is seeded (`machines.ts:422-447`, `apps/server/src/index.ts:39`).
- The daemon then enters its three resident loops: presence heartbeat 30s (`machine-loop.ts:347-351`) → wake SSE subscription (reconnects persistently, `machine-loop.ts:265-345`, `routes-machine.ts:235-256`; a dropped stream marks it offline, `machines.ts:571-577`) → claim long-polling main loop (`machine-loop.ts:380-401`).

### Link 1 · new task (web)

- The new-task dialog submits only **body + project id** (`apps/web/src/overlay/new-task-dialog.tsx:273`) — no machine, no agent, no title.
- "Save" = `POST /api/projects/:id/todos` (`apps/web/src/overlay/use-new-task-surface.ts:112-136` → `apps/server/src/routes.ts:1079-1092`); "save and start" = after creation, **directly sends a chief orchestration turn** `POST /api/todos/:id/orchestrate` (`use-new-task-surface.ts:139-172` → `routes.ts:586-603` → `sendChiefMessage`; after the #640 ruling this is the only default path). The manual start surface is on the task detail page: `POST /api/projects/:id/builds` (`apps/web/src/routes/todo-detail-page.tsx:486-497` → `routes.ts:1094-1110`).

### Link 2 · enqueue (todo → build → step)

- `startBuilds` (`apps/server/src/services/builds.ts:342-394`): one `build` row per todo (buildId ≡ conversationId, UUIDv7) + the first step enqueued (plan or build), todo phase → queued. **The build row carries a `pinnedMachineId` column** (`apps/server/src/db/schema.ts:132`, `packages/shared/src/records/build.ts:21-22` with the original comment "pin machine; null = auto"), and the service-layer parameter is already supported (`builds.ts:351`, `373`) — but the only writer today is the scheduler (`apps/server/src/services/scheduler.ts:60-66`, passing through `schedule.machineId`; the schedule-side write surface = chief's `schedule_todo` tool, `packages/shared/src/protocol/chief-tools.ts:450-465`).
- The orchestrate path: chief thread + chief step enqueued (session key `chief-<threadId>`, `routes.ts:599`), no build, no machine semantics.

### Link 3 · claim (the core of multi-machine dispatch)

- The daemon main loop long-polls `POST /api/machine/tasks/claim` (server holds ~75s + wake for instant wakeup; `machine-loop.ts:380-401` → `machine-client.ts:239-250` → `routes-machine.ts:227-232`).
- The server `claimStep / tryClaim` (`machines.ts:949`, `793-830`) selects a step:
  - **worker-step candidates** (`claimCandidates`, `machines.ts:609-625`): `step.status='pending'` AND **`build.pinnedMachineId IS NULL OR = this machine`** (`machines.ts:619`) — the pin filter is already implemented; unpinned steps can be grabbed by any online machine in the team, FIFO by createdAt.
  - **chief-step candidates** (`claimChiefCandidates`, `machines.ts:629-637`): no build/todo row, **no machine filter at all**.
  - Atomic claim: `UPDATE step SET status='claimed', machineId, ... WHERE status='pending'` (`machines.ts:826-830`); worker steps additionally require the todo to have an assigned agent with a model (`machines.ts:822`), chief steps require the chief to have an agent with a model bound (`machines.ts:730-738`).
- Claim payload assembly: the worker side (`machines.ts:860-944`) carries conversationId, the new/continue session decision (continue reads the server-side prior sessionId, `machines.ts:835-855`), todo (title/spec), **project + repo (cloneUrl derived by `projectRepoRef`)**, agent (model/memory/skill allowlist/permission switches), remoteTools, localTools (dual-gate decision `machines.ts:696-718`), mcpServers (CLI version gate `machines.ts:669-690`); the chief-side assembly is at `machines.ts:750-790`.

### Link 4 · execution (on the claiming machine)

`runStep` (from `apps/daemon/src/runner.ts:217`):

1. Per-step credential: `client.token(stepId)` → `pushCredential` (in memory, `runner.ts:267-268`). Runtime steps (claude-code) get zero credential injection — authentication relies on the execution machine's local login / `ANTHROPIC_API_KEY` (comment at `runner.ts:258-277`).
2. Worktree: `workspace.prepare({projectId, conversationId, cloneUrl, credentials})` (`runner.ts:334-340`) → base clone/fetch to `<workspacesRoot>/<projectId>/repo`, task worktree `<workspacesRoot>/<conversationId>`, branch `pacman/conv-<conversationId>`, base chosen between origin/conv or origin/default (`workspace.ts:66-114`); projectLock serializes operations on the same project (`workspace.ts:50-64`).
3. Backend resolution: `backendFor(agent.provider)` — pi by default, claude-code constructed lazily (spec 17 A3, `machine-loop.ts:109-130`); the MCP slug resolves endpoints against the local `~/.claude.json` on the execution machine, credentials never cross the wire (`runner.ts:376-384`).
4. Session: `backend.createSession` (`runner.ts:586-591`), systemPrompt = chief-synthesized / worker role + memory (`runner.ts:361-368`). While running: heartbeat and tool-line/streaming report-back (`routes-machine.ts:278-309`), steer/stop via wake SSE fetch-and-ack (`machine-loop.ts:274-309`).
5. Crash recovery: the daemon-side StepJournal (`apps/daemon/src/journal.ts:32-107`) + `client.recover()` reconciliation on restart to resume (`machine-loop.ts:234-263`).

### Link 5 · report-back and closed loop

- Wrap-up: `commitAll` (`runner.ts:803`) → (merge step) merge `origin/<default>` → `push` the conv branch (with the per-step credential, `runner.ts:838`) → transcript/plan upload (`runner.ts:860-895`) → `done` (status/sessionId/usage/hasChanges/checkpoint commit, `runner.ts:900-910`) → server `finishStep` advances the todo phase. For the local form, the merge lands by pushing the conv branch back to the user's repository (#1211: the branch of the user's main checkout is never advanced).
- Stop/discard = rewind to the step-start checkpoint; review steps check out read-only + force-rewind at wrap-up — both paths share the same rewind guardrail (`runner.ts:743-765`).

## 3. Measured evidence for "any machine"

Evidence collected 2026-10-02 (ps / lsof / systemctl measured):

- This machine (macOS): server listening on :8787 + daemon running, completing all links.
- mea (WSL2): `pacman-dev-server.service` (active, node running `/home/measure/pacman/apps/server/src/index.ts`) and `pacman-daemon.service` (active, enrolled to local server :8787).

The same code completing the full server + daemon chain in two deployments on macOS and Linux (WSL2) respectively — "deploy on any machine" itself has no gap; "not closed-loop" refers specifically to **machine targeting of tasks** (§4).

## 4. Gap list (named link by link against §2)

The execution plane (links 0/3/4/5) is fully present; the gaps concentrate in **entry points and governance**. Items 1–6 and 9 are collected into engineering ticket #682; 7 and 8 are known boundaries once multiple machines exist.

| # | Gap | Evidence of current state | Classification |
|---|---|---|---|
| 1 | New task has no machine entry | the dialog submits only spec+projectId (`new-task-dialog.tsx:273`); `use-new-task-surface.ts:112-172` has no machine parameter | entry-link |
| 2 | REST surface has no machine parameter | `startBuildsBodySchema` only has todoIds/assignment/withPlan (`records/build.ts:38-43`); the orchestrate route has no body surface (`routes.ts:586-603`) | entry-link |
| 3 | The chief orchestration chain has no machine semantics | chief-step claim has no pin filter (`machines.ts:629-637`); chief's `machines` tool is read-only; the `run_builds` tool has no machineId parameter (`protocol/chief-tools.ts:472-493`, handler `services/chief-tools.ts:671-700` calls startBuilds without passing a pin) | orchestration-link |
| 4 | The pin exists but is an island | the column (`schema.ts:132`) + claim filter (`machines.ts:619`) + service parameter (`builds.ts:351,373`) are all there; the only writer = the scheduler (`scheduler.ts:66`); even the web creation surface for schedules exposes no machineId (only branch-dialog has a machine picker anywhere in the web tree, `apps/web/src/detail/branch-dialog.tsx:200-206`) | wiring-link |
| 5 | The per-runtime switch is written but never read | `enabledRuntimes` has only a PATCH write (`routes.ts:1272-1284`) and a web mapping; nothing in claim/dispatch consumes it (whole-tree grep confirmed) — the A8 promise on the machines page "decide whether this machine runs pi or Claude Code tasks" is unfulfilled | governance-link |
| 6 | A pinned machine offline = the step waits forever | `claimCandidates` filters only ownership, with no liveness condition; pending steps have no timeout and no sweeper (the concurrency gate was removed, `machines.ts:802-803`, #503) — compared against Multica's reconnect-grace / queued-expiry system this is a hole (§5) | governance-link |
| 7 | Multi-machine rotation loses the session | conv session files live on the execution machine's local disk (pi sessionDir; the continue decision reads the server-side prior sessionId, `machines.ts:835-855`); a different machine claiming the next step of the same build degrades to SessionNotResumable → new session. The worktree is fine via git; **what is lost is the conversation context** — machine affinity is a correctness item, not an optimization | execution-link constraint |
| 8 | The local form of project pins the machine | `projectRepoRef` local = a server-side absolute path (`git.ts:125-127`) — only a machine that can reach that path can execute; a remote machine failing prepare fails the step | execution-link constraint |
| 9 | claude-code runtime credentials do not cross machines | runtime steps get zero credential injection (`runner.ts:258-277`); remote machines each need their own claude login / `ANTHROPIC_API_KEY`, and no preflight surfaces this gap | credential-link |
| 10 | Concurrency/load surface | machines have no claim cap (#503 removed it, `machines.ts:802-803`); no capability matching (except the MCP version gate and the shell dual-gate) | dispatch-link (only appears with multiple machines) |

## 5. Three-way comparison: crabbox / Multica / pacman

### crabbox (github.com/openclaw/crabbox, Go, MIT)

Model = "warm a box, sync the diff, run the suite" — a pure remote command executor:

- The full lifecycle of one command (README + docs/how-it-works.md): `crabbox run --provider docker -- <cmd>` = rent a box (lease, `cbx_` + 12hex, one-off per-lease SSH key) → **rsync-sync the dirty worktree** (git seed + fingerprint-skip when unchanged; no commit required first) → execute the command over SSH with streamed output → take the exit code → release.
- **Machine choice = a flag at call time**: `--provider <docker|ssh|aws|hetzner|...>`, reuse a warm box with `--id <box>` / `--slug`. A 16+ provider matrix. No queue, no claim loop, no task concept — every call is stateless (warm leases aside).
- Four execution modes (docs/architecture.md, `internal/cli/provider_backend.go:1959` `loadBackend`): brokered (coordinator manages leases) / direct SSH / registered direct / delegated (the sandbox service self-manages execution).
- **The coordinator (optional) manages only the control plane**: it holds provider credentials, lease state, usage, and spend caps; **the data plane = CLI ↔ runner direct SSH+rsync, files and command output never traverse the coordinator** (how-it-works.md, verbatim: "your files, commands, and output never traverse it"). Without a coordinator, local containers / your own hosts work with full functionality.
- No agent/orchestration concept: who picks the machine and what commands run is entirely the caller's business (human or agent skill).

### Multica (github.com/multica-ai/multica, Go; mechanism details cited from r10 / r13; the 2026-10-02 spot-check against HEAD still holds: `server/internal/daemon/wsrpc.go:346-349` tasks.claim RPC and `daemon.go` runtimeIndex both present)

Model = queued execution with agents bound to runtimes:

- **runtime = one computer + one AI tool** (r10 citing concepts.txt:33 "The agent is the identity; the runtime is the computer that executes it"). The daemon on the machine dials out (WS `GET /api/daemon/ws`) to register: upsert into the `agent_runtime` table, unique key `(workspace_id, daemon_id, provider)`, idempotent re-registration via `ON CONFLICT DO UPDATE` (r10 citing runtime.sql:63-116). The daemon probes and auto-discovers 26 CLIs on the machine with `exec.LookPath` (r10, agents_probe.go).
- **Machine choice happens at agent creation/binding time**: the agent table carries a `runtime_id` foreign key (r10 citing agents-create.txt:7). A task trigger produces a run, the run is enqueued, and **the runtime bound to the agent claims it**; copying an agent can migrate machines with `--runtime-id`.
- Dispatch (r13 hop-by-hop evidence): `pollLoop` → batched `tasks.claim` WS-RPC `{daemon_id, runtime_ids, max_tasks}` → `handleTask` looks up `runtimeIndex[task.RuntimeID]` → `agent.ResolveBackend` spawns the process → event stream report-back. Session continuity is explicit design: conversation "routes subsequent runs to a runtime that can access that session" (r10 citing chat.txt:41-43).
- Companion machine governance (all numbers evidenced in r10 §5): heartbeat 15s → Redis TTL key + 60s DB write, 150s stale + 30s sweep ≈ 3 minutes to mark offline; reconnect grace 3h; `dispatched` 5-minute timeout; concurrency = daemon 20 ∩ agent 6; GC only after 7 days offline + no unarchived agents + no non-terminal tasks.
- Credentials: daemon token `mdt_`; **task-level token `mat_`** (minted at claim time, bound to (task, agent, workspace, owner), 24h, injected into the agent process in place of a PAT — r10 §6). Code surface: per-conversation worktree + `tds/conv-*` branches + push at each step's wrap-up (r3 §1.4 measured; pacman's worktree contract was replicated from this).

### Comparison conclusions

- **pacman ≈ Multica's dispatch skeleton** (daemon dials out + claim long-polling + per-conv worktree + per-step credentials), but decouples the "agent↔runtime binding" into "assignment picks the agent, the machine is pinned separately" — the machine record comment states plainly "one machine can carry steps of multiple Agents; it is not an attribute of an Agent" (`packages/shared/src/records/machine.ts:5`). The pin surface was only built at the data layer (build column), not the entry layer (§4-1~4).
- **One tier thinner on governance**: Multica has a full liveness/grace/timeout/GC system (numbers above); pacman's pending steps have no timeout and no sweeper (§4-6) — invisible on a single machine, the first risk once multiple machines exist.
- **crabbox's lesson points the other way**: machine choice can simply be an explicit parameter at call time, with no binding relationship — this is exactly the shape of "pick a machine directly in the new-task dialog", and it is the granularity #682 adopts (task-level pin, no agent binding).
- **The same design philosophy**: crabbox's "coordinator manages only the control plane, the data plane is CLI↔runner direct, files/commands/output never traverse it" and pacman's "control plane HTTP/SSE, data plane git" are the same design judgment — the central service keeps only the ledger and the credentials; byte streams travel point-to-point.

## 6. Engineering implications (collected into #682)

t-0047's feasibility verdict on "pick a machine directly in the new-task dialog": **high** — the execution semantics of pinning are already all in the codebase (column + claim filter + service parameter + restart already handles "do not inherit pin", `builds.ts:437`); machine data is already loaded on the new-task surface on the web side (used by the mention picker, `use-new-task-surface.ts:90`); the UI has an existing precedent (project chip popover, `branch-dialog.tsx:200-206` machine dropdown). Key points of the plan (the canonical copy is on the #682 ticket): `todo.machineId` as single source → startBuilds inherits by default → chief thread gains machine affinity → `enabledRuntimes` becomes a real gate → pin offline = marked waiting, **no automatic fallback** (the semantics of a pin is determinism).

Rejected alternatives (judgment on the record, to prevent re-litigation):

- **Multica-style agent-to-machine binding**: contradicts pacman's orthogonal design (comment at `records/machine.ts:5`), and combining it with the assignment double-slot causes combinatorial explosion.
- **Pure chief prompt instruction (no data-plane change)**: fragile — the LLM may not follow the injected instruction, and there is no read-back verification surface; a pin only counts when it lands in the database and goes through the claim filter.
- **Fully automatic scheduling at claim time (label/load matching)**: the user wants deterministic choice, not a scheduler; automatic matching is left to the `enabledRuntimes` gate and later work.

## Appendix · evidence collection method and field experience

Collection method (reusable for similar mechanism research):

- In-repo side: link-by-link source reading; all file:line references are current code in the baseline workspace; processes/ports measured on this machine and mea.
- Comparison side: crabbox / Multica fetched same-day via the `gh` CLI for READMEs, architecture docs, and source sampling, cross-checked against the in-repo first-hand research r3 / r10 / r13, with no copying of secondhand documents. For Multica evidence the preferred ground is r10 / r13 (fresh-clone, line-by-line source) and r3 (worktree contract measured); no need to re-crawl the source.

Three field lessons from reconnaissance on mea (WSL2):

- **Probing the Windows host from WSL2 requires full paths**: when calling Windows binaries (e.g. `powershell.exe`) from inside WSL2 to inspect the host environment, invoke them by full path (`/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe`) — in non-interactive ssh sessions the WSL interop PATH append is not necessarily present, and a bare command name will not be found.
- **scp with multiple sources silently swallows files**: an scp command with several remote source paths silently drops files; transfer key evidence one by one and count the received files on the receiving end to verify.
- **For shim-type services the traffic record lives in `/tmp`, not the journal**: forwarding shims (e.g. pi-relay-shim) often override logging hooks, leaving only a one-line startup record in the journal; the real traffic log is in the shim's own `/tmp/*.log` (one line per request). When reconnoitering such services, find its file logs first — do not conclude "no traffic" from the journal.
