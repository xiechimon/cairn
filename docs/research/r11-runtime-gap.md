# R11 · pacman ↔ Multica runtime-model capability gap inventory

> Purpose: ticket #518 — take the conclusions of the runtime research ticket (#517 / `docs/research/r10-multica-runtime.md`),
> compare them item by item against pacman's current state, and produce a capability-gap list: what is missing, what is extra, where the shapes differ.
> Comparison baseline: `docs/research/r10-multica-runtime.md` (467 lines, source-level measurement, containing 14 doc/source inconsistencies; Multica clone HEAD
> `43b0571f992567a919c7f1f699ff160922594b94`, 2026-09-29 23:27:27 -0700).
> pacman-side evidence: `origin/main` = `c95ee5f` (this ticket's independent worktree; the main checkout untouched).
> Map: #515. Upstream research: #517 (closed). Inventory date: 2026-09-30 (local Asia/Shanghai).

## 0. Reading conventions

- Two kinds of sources, marked per item:
  - **P** (pacman) = `path:line` read line by line on the `c95ee5f` working tree by this ticket;
  - **M** (Multica) = cited from r10's `path:line`. **This ticket did not re-clone the Multica source for re-verification**; the M-side precision rests on r10
    (r10 §0 already declares its sourcing discipline: docs-side marked D, source-side marked C, nothing written without a source).
- Four-column format (per the ticket): **current state (file:line) · how Multica does it · gap nature · whether it is in scope for this plan to fix**.
- "Gap nature" takes three values: `missing` / `different shape` / `intentionally different in pacman`.
- "In scope for this plan to fix" is judged by the boundary already ruled in map #515, taking values:
  - `in-scope · blocking #519` — #519 (control plane moved to an always-on host + a closed loop running) will hit it directly;
  - `in-scope · for this plan to decide` — items #515 marked `Not yet specified`, explicitly waiting for this plan's research to come back before ruling;
  - `out · intentionally different` — divergence already locked by volume 02 / volume 01, not reopened by this plan;
  - `out · out of scope for this plan` — explicitly excluded by #515.
- No emoji anywhere; commands, constants, and values copied verbatim.
- One naming trap pinned first (same as r10 §0): Multica's "permission" has three layers, and this ticket discusses only the **third layer**,
  `agent_runtime.visibility` (who can start an agent on whose machine). pacman has no corresponding layer (§G20).

---

## 1. Conclusions first

1. **pacman has no runtime object.** The server side has only a `machine` row = one registered host;
   runtime (one computer × one CLI tool) has no row, id, or list in pacman
   (`apps/server/src/db/schema.ts:398`). **This is shape, not omission**: pacman's daemon is the pi runtime host;
   the "tool" is not an external probed CLI but an engine embedded in the daemon process (`apps/daemon/src/machine-loop.ts:84`,
   `apps/daemon/src/backend/pi.ts:507`). Multica's daemon schedules CLIs; pacman's daemon hosts pi.
2. **The first fix is not capability but missing machine capability advertisement.** `presence` carries only `cliVersion`
   (`packages/shared/src/protocol/machine-wire.ts:81`), and claim **never checks what the machine can run**
   (`apps/server/src/services/machines.ts:581`: only `status='pending'` + team + pinnedMachine),
   so any machine can claim any step. With more than one machine, this is the first break.
3. **Online detection is an order of magnitude more brittle than Multica.** pacman `online` flips false only when the machine wake SSE stream aborts
   (`apps/server/src/routes-machine.ts:240`), **no staleness threshold, no sweep, no persisted heartbeat**
   (repo-wide: `markOffline` has one call site; `step.lastHeartbeatAt` written never read). Liveness equals
   "this TCP connection is up": **disconnect without FIN** (partition, power loss, unplugged cable) stays online forever;
   **disconnect with FIN** (kill, daemon reconnect) flips offline immediately, then up to 30s until the next presence beat —
   one field, two semantics, both wrong.
4. **Steps are hard-bound to machines with no safety net.** claim sets `step.status` `claimed` + `machineId`
   (`apps/server/src/services/machines.ts:767`); only that machineId sees it via `recover`
   (`apps/server/src/services/machines.ts:553`); others cannot claim (`status='pending'` no longer holds),
   and the server **never times out and releases**. Machine gone = step stuck forever.
   Multica has three layers (150s stale + 3h reconnect grace + 7-day reclaim, r10 §5.2–§5.4).
5. **Per-task credentials are half present; missing "what identity does the agent use back to the server".**
   `token/{stepId}` delivers provider config + team secret env + git credentials (`packages/shared/src/protocol/machine-wire.ts:339`),
   held in daemon memory, cleared at step end (`apps/daemon/src/credentials.ts:22`) — same direction as Multica per-run delivery.
   Multica's `mat_` is **identity** (agent calls Multica API, actor recorded as agent); pacman has no counterpart:
   agent tools all relay via `tool/{stepId}` with the daemon's machine token
   (`packages/shared/src/protocol/machine-wire.ts:314-334`).
6. **Delivered `env` slot is unused on the daemon.** `pushCredential` accepts `provider/env/git`
   (`apps/daemon/src/credentials.ts:22`), but only `creds.provider` (`apps/daemon/src/runner.ts:251`) and
   `creds.git` (`apps/daemon/src/runner.ts:286`, `:642`) are consumed; `creds.env` is only cleared
   (`apps/daemon/src/credentials.ts:29`). Ticket #508 is open; this ticket only maps which runtime-model cell it fills.
7. **Concurrency is not "lower than Multica" but absent.** The daemon claim loop `await runStep(...)` is serial
   (`apps/daemon/src/machine-loop.ts:361`); server #503 removed the cap concept entirely
   (`apps/server/src/services/machines.ts:744`). Multica uses daemon 20 / agent 6 double gate (r10 §5.4).
   On the pacman side 02/A3 **deliberately** removed the cap (`docs/spec/02-architecture-parity.md:15`), but between the status quo and "deliberate" there is a missing step:
   what was removed is the **cap**, while the actual effect is **serial execution**.
8. **Model source is read from the server host, not the execution host.** The claude-code model list is read by the **server process** from
   `~/.claude/settings.json` (`apps/server/src/services/providers.ts:141`; `:132` and `:179`
   `hostname()` are the server machine). After #519 splits control plane and execution, this page shows **the control-plane host's Claude Code config**.
   Multica's model list comes from **the matching runtime** (r10 §4.2).
9. **pacman extras sit on the execution plane, not runtime management.** Per-step worktree + commit/push/merge
   (`apps/daemon/src/workspace.ts:66`), per-step git credentials, plan.md/transcript upload, steer/stop/sync pull-ack commands
   (`packages/shared/src/protocol/machine-wire.ts:264`), review read-only checkout (`apps/daemon/src/runner.ts:593`),
   supervisor crash keep-alive (`apps/daemon/src/supervisor.ts:58`) — no Multica runtime-model counterparts;
   most of these were **deliberately** locked per todos semantics by volumes 02/08 (`docs/spec/02-architecture-parity.md:18`, `:21`).
10. **`enabledRuntimes` is shape-first, execution-second.** The machines page per-runtime switch stores and reads
    (`apps/server/src/db/schema.ts:416`, `apps/server/src/services/machines.ts:368`), but claim and execution never read it
    (grep: consumers are schema projection and tests only). Multica's `agent_runtime.visibility`
    **is** a binding gate (`canUseRuntimeForAgent`, r10 §8.2).

---

## 2. Surface A · runtime identity and registration (G1–G4)

| # | Current state (file:line) | How Multica does it | Gap nature | In scope for this plan to fix |
|---|---|---|---|---|
| **G1** | The machine table has only eight columns — `id/teamId/name/online/tokenHash/apiKeyId/latestCliVersion/kind/enabledRuntimes` — no provider / profile / owner / lastSeen columns (`apps/server/src/db/schema.ts:398-417`); `kind` only splits `local`/`remote` (`packages/shared/src/records/machine.ts:31`) | A runtime is a row of the `agent_runtime` table = (workspace, daemon, provider, profile) (r10 §2.2, `server/pkg/db/queries/runtime.sql:63`, `:95`) | missing | in-scope · for this plan to decide (#515 `Not yet specified` "which CLI to connect first for multi-backend: wait for the runtime research to produce the protocol-family and capability-difference matrix") |
| **G2** | No profile dimension: nothing named `runtimeProfile` / `runtime_profile` / `customProfile` anywhere in the repo (exhaustive grep, zero hits) | Two partial unique indexes elevate profile into a fourth dimension, with built-in and custom instances coexisting (r10 §2.2, D13, migrations 120/121) | missing | out · out of scope for this plan (no custom-wrapper demand in the single-machine self-use scenario; not requested by any section of #515) |
| **G3** | Registration idempotency = the application layer looks up `(apiKeyId, teamId)`, updates on hit, otherwise inserts a new row (`apps/server/src/services/machines.ts:437-442`, `:461-474`) | DB-level `ON CONFLICT ... DO UPDATE` with the two unique indexes as the conflict key; idempotent across restarts (r10 §2.2/D13) | different shape | in-scope · for this plan to decide (the side effect is concrete: "re-registering the same machine with a different apiKey" creates **an extra machine row** in pacman, while Multica does not; #519 will register another machine via the api-key path and can easily step on this) |
| **G4** | The daemon enrolls only when `machine.json` is absent (`apps/daemon/src/machine-loop.ts:114-135`); a restart neither re-registers nor refreshes `latestCliVersion` (only presence refreshes it, `:139`, `:310`) | Restart triggers re-registration and reclaims runs that did not end cleanly last time (r10 §5.1 consistency item) | different shape | out (more idempotent than Multica, and `presence` already carries version refresh; no gap) |

---

## 3. Surface B · probing, protocol families, and multi-backend (G5–G7)

| # | Current state (file:line) | How Multica does it | Gap nature | In scope for this plan to fix |
|---|---|---|---|---|
| **G5** | No CLI probing at all: the daemon starts with `Loading pi runtime…`, the backend is always `createPiBackend` (`apps/daemon/src/machine-loop.ts:84-101`); no `lookPath` / `which` / PATH scanning anywhere (exhaustive grep, zero hits). A machine reports only `cliVersion` (`packages/shared/src/protocol/machine-wire.ts:81-83`) | The daemon scans PATH at startup to probe 26 command names, with a login-shell fallback and a 30-minute cache (r10 §3.2) | missing | in-scope · for this plan to decide (this is exactly wiki ``[[pacman's own coordinates and borrowing list]]`` B1 "machine capability advertisement"; not blocking for #519's single-machine shape, but a prerequisite for multi-machine routing) |
| **G6** | Single embedded engine: pi is a dependency of this repo, the `AgentBackend` seam exists but has only the pi implementation (`packages/shared/src/agent-backend.ts:190`, `apps/daemon/src/backend/pi.ts:507`, `docs/spec/01-stack-v2.md:126`) | A 25-family protocol whitelist + one backend per family (r10 §4.2, `server/pkg/agent/agent.go:364-390`) | missing | in-scope · for this plan to decide (#515 explicitly lists "which CLI to connect first for multi-backend" for this plan) |
| **G7** | `enabledRuntimes` can be stored and read but has no execution surface: written at `apps/server/src/routes.ts:1203` (PATCH), schema projection at `apps/server/src/services/machines.ts:368`; neither the claim side (`apps/server/src/services/machines.ts:581-597`) nor the daemon execution (`apps/daemon/src/machine-loop.ts:361`) reads it | `agent_runtime.visibility` is a binding gate (`canUseRuntimeForAgent`, r10 §8.2) | different shape | in-scope · for this plan to decide (the switch already promises "run pi or Claude Code on this machine" in the UI, but it takes effect at neither position) |

---

## 4. Surface C · online decision and heartbeat (G8–G10)

| # | Current state (file:line) | How Multica does it | Gap nature | In scope for this plan to fix |
|---|---|---|---|---|
| **G8** | `online` flips to false only when the machine's wake SSE stream aborts (`apps/server/src/routes-machine.ts:240-246` → `markOffline`, `apps/server/src/services/machines.ts:543`, the only call site in the repo); `markPresence` unconditionally sets it true (`apps/server/src/services/machines.ts:521-541`). **No staleness threshold, no sweep, no `last_seen_at`**. Two reproducible consequences: ① a disconnect without FIN (network partition / power loss / unplugged cable) → online forever; ② the daemon's own reconnect (`apps/daemon/src/machine-loop.ts:278-306` — the reconnect loop **does not re-send presence**) → the old stream's abort flips offline first, and it takes up to 30s for the next presence beat to flip it back | A 150s staleness threshold + 30s sweep ≈ 180s to decide offline; a Redis TTL hot path + `last_seen_at` persisted at most once per 60s (r10 §5.2/D11) | missing | **in-scope · blocking #519** (what #519 demands is exactly "the laptop can power off while the control plane keeps working", and these two consequences judge live machines dead and dead machines live) |
| **G9** | `step.lastHeartbeatAt` is written by `heartbeat/{stepId}` (`apps/server/src/services/machines.ts:897-900`; the daemon beats every 30s, `apps/daemon/src/runner.ts:416-419`), but **there is no read point anywhere in the repo** (exhaustive grep: only the write and the schema definition) | Heartbeat age is the criterion for queue release and failure recovery (r10 §5.3: `ExpireStaleQueuedTasks` reads the heartbeat age directly) | missing | **in-scope · blocking #519** (the step-level liveness data is already online; what is missing is the decision and actions that consume it) |
| **G10** | Presence cadence 30s (`apps/daemon/src/machine-loop.ts:313`); no state machine and no persistence cadence on the server side | Heartbeat 15s (r10 §5.2) | different shape | out (a pure numeric difference; the real gap is G8) |

---

## 5. Surface D · claim, concurrency, and dispatch (G11–G13)

| # | Current state (file:line) | How Multica does it | Gap nature | In scope for this plan to fix |
|---|---|---|---|---|
| **G11** | Serial: the claim loop `await client.claim(...)` → `await runStep(...)` executes in order, one step per round (`apps/daemon/src/machine-loop.ts:342-362`, `running` always passed as 1, `:361`); no concurrency gate server-side (`apps/server/src/services/machines.ts:744-745`, #503 comment verbatim "machine claiming is not bound by the cap") | daemon 20 / agent 6 double gate; claims rejected when `running >= agent.MaxConcurrentTasks` (r10 §5.4) | pacman deliberately different | Not in scope · deliberate (`docs/spec/02-architecture-parity.md:15` A3 already ruled "the concurrency-cap concept is removed wholesale with #503"); but the status quo is **serial**, not "uncapped" — this layer of difference deserves its own row on the map, see §9 |
| **G12** | claim candidates filter only `status='pending'` + team + `pinnedMachineId` (`apps/server/src/services/machines.ts:581-597`), **not whether the machine can run the step's model** | runtime bound to agent; tasks route to matching runtime (r10 §2.1/§8) | missing | in-scope · for this plan to decide (= other face of G5; single machine OK, breaks with a second) |
| **G13** | step hard-bound to machine: claim writes `machineId` (`apps/server/src/services/machines.ts:767-772`); only that machine sees it via `recover` (`apps/server/src/services/machines.ts:553-561`); no redispatch, **no timeout release**. After failure the only path is manual rerun = new build/session (`apps/server/src/services/builds.ts:7`) | `RecoverOrphanedTasksForRuntime` reclaims outside grace; `FailTasksForOfflineRuntimes` fails per grace (r10 §5.3) | missing | **in-scope · blocking #519** (#519 needs a real closed loop; mid-flight offline machine jams the loop on this step) |

---

## 6. Surface E · grace, recovery, and orphans (G14–G16)

| # | Current state (file:line) | How Multica does it | Gap nature | In scope for this plan to fix |
|---|---|---|---|---|
| **G14** | No reconnect grace, no queue expiry: no corresponding constants and no corresponding sweep (exhaustive grep: `grace` / `stale` / `expire` have no machine-surface hits in `apps/server/src`) | Default 3h grace (clamped below by 150s); a queued run must satisfy both "the runtime cannot prove itself alive" and "it has been parked for a full grace window" (r10 §5.3/D3) | missing | **in-scope · blocking #519** (the action surface of G8+G13) |
| **G15** | No failure and automatic retry of in-progress tasks on offline runtimes | `FailTasksForOfflineRuntimes` in batches of 500; the retry-grace terminal path (r10 §5.3) | missing | in-scope · blocking #519 (same as G13; pacman's answer is "manual rerun", but a human cannot see it when the machine is offline — the step stays claimed forever) |
| **G16** | No GC of machine rows; the only time-based recovery is the **worktree** orphan TTL of 7×24h (`packages/shared/src/protocol/executor.ts:126`, `apps/daemon/src/workspace.ts:159-185`, one round at startup + one every 24h, `apps/daemon/src/machine-loop.ts:191-193`) | Runtime rows GC after 7 days with three criteria (offline + 7 days + no unarchived user agents + no non-terminal tasks), hourly (r10 §5.4/D4) | missing | out · out of scope for this plan (single-team self-use; machine rows will not pile up; the worktree TTL already covers the surface that actually grows) |

---

## 7. Surface F · per-task credentials and environment (G17–G19)

| # | Current state (file:line) | How Multica does it | Gap nature | In scope for this plan to fix |
|---|---|---|---|---|
| **G17** | `token/{stepId}` delivers `{provider, env, git}` (`packages/shared/src/protocol/machine-wire.ts:339-354`, assembled server-side at `apps/server/src/services/machines.ts:1183-1215`); the daemon holds them in memory and `clearCredentials` at step wrap-up (`apps/daemon/src/credentials.ts:22-31`). **There is no per-task API identity**: agent-side tools are all relayed through `tool/{stepId}` by the daemon holding the machine token (`packages/shared/src/protocol/machine-wire.ts:314-334`, `apps/daemon/src/machine-client.ts:254-300`, `apps/daemon/src/backend/pi.ts:566-594`) | The `mat_` token binds `(task, agent, workspace, runtime owner)`, hardcoded to 24h, injected into the agent process; forging `X-Agent-ID` cannot change the actor (r10 §6.2/D12) | missing | out · out of scope for this plan (pacman's agent does not call its own API directly, so there is no forgeable actor surface; not requested by #515) |
| **G18** | `creds.env` is delivered and then dropped: the only consumption points are `creds.provider` (`apps/daemon/src/runner.ts:251`) and `creds.git` (`apps/daemon/src/runner.ts:286`, `:642`); `creds.env` is only nulled (`apps/daemon/src/credentials.ts:29`). `SessionOpts` has no env field either (`packages/shared/src/agent-backend.ts:141-176`) | 13 `MULTICA_*` variables injected into the agent process, plus an `isBlockedEnvKey` prefix ban + an exact-name list (r10 §6.3) | missing | in-scope · for this plan to decide (ticket **#508** is already in progress and not reopened here; but if #519 hits a "the secret never arrived" UI message, the handling is already fixed by #508 as "align with git's per-step discipline" — direct plaintext env injection is not allowed) |
| **G19** | No environment-variable namespace or blocklist discipline (exhaustive grep: no `isBlockedEnvKey` equivalent, no `MULTICA_`-style prefix ban; the daemon sets only `PI_OFFLINE`/`PI_CODING_AGENT_DIR` itself, `apps/daemon/src/backend/pi.ts:514-515`) | The entire `MULTICA_` segment is banned + an exact list of `HOME/PATH/CODEX_HOME/...`, with the single exception `HERMES_HOME` (r10 §6.3) | missing | in-scope · for this plan to decide (same line as G18; the landing point is #508) |

---

## 8. Surface G · permissions, profiles, model sources, transport, and distribution (G20–G25)

| # | Current state (file:line) | How Multica does it | Gap nature | In scope for this plan to fix |
|---|---|---|---|---|
| **G20** | Machines have no owner, no visibility: the schema's eight columns have no `ownerId`/`visibility`; single-user seed + auto login (`docs/spec/02-architecture-parity.md:14` A2) | `agent_runtime.owner_id` + `visibility`; owner-exclusive sharing, no admin bypass; ownerless runtimes can never be bound (r10 §8.2) | pacman deliberately different | Not in scope · deliberate (local-first single user, locked in 02/A2) |
| **G21** | no custom runtime profile: no command field, no `fixed_args`, no argument ordering (zero hits repo-wide) | `runtime_profile` + `fixed_args` before Multica args, position non-reversible (r10 §7.3) | missing | out · out of scope for this plan (self-use, no wrapper CLI; revisit if G6 lands multi-backend) |
| **G22** | model source read from **server process host**: claude-code segment fs-reads `~/.claude/settings.json` (`apps/server/src/services/providers.ts:131-161`, `:132` `hostname()` is server, `:141` reads file); pi segment = team custom provider `models[]` (`:167-183`, `:179` `hostname()` again) | model list from **matching runtime** (r10 §4.2) | different shape | **in-scope · blocking #519** (after split, page shows always-on host Claude config, not executor) |
| **G23** | single version gate comparing **daemon's own version**: `meetsMcpVersionGate(latestCliVersion)` vs `MCP_MIN_CLI_VERSION`; below threshold claim omits `mcpServers` (`apps/server/src/services/machines.ts:643-666`, `packages/shared/src/protocol/mcp.ts:164`) | per-family minimum table 10 entries (r10 §3.2/D7); below → runtime not registered; plus `capabilities`/`launched_by` (r10 §2.2) | different shape | in-scope · for this plan to decide (G6 companion; single-backend gate enough today) |
| **G24** | Transport = HTTP long-poll claim (server holds 75s, `packages/shared/src/protocol/machine-api.ts:30`, `apps/server/src/services/machines.ts:882-893`) + SSE wake (`apps/server/src/routes-machine.ts:227`). **The daemon side does not consume wake events** (`apps/daemon/src/machine-loop.ts:286-290` only dispatches shutdown/steer/stop/sync; `:227-234` comment records the #482 ruling: hold-expiry resend is the residual upper-bound backstop) | WebSocket `GET /api/daemon/ws` + 3-minute claim-poll backstop (r10 §5.2) | pacman deliberately different (implementation layer) | Not in scope · deliberate (`docs/spec/02-architecture-parity.md:13` A1 "real-time surface all SSE, no WS" is locked; the collaboration semantics (long poll + backstop) are identical on both sides) |
| **G25** | distribution = pure JS npm package (`docs/spec/01-stack-v2.md:123`); supervisor self-built crash keep-alive (`apps/daemon/src/supervisor.ts:28-92`, exponential backoff cap 30s); engine pinned pi 0.86.0 (`docs/spec/01-stack-v2.md:126`) | six-platform binary (275MB); engine pi 0.84.3 build (r10 §0 / `docs/spec/01-stack-v2.md:231-232`) | intentionally different in pacman | out · intentionally different (`docs/spec/01-stack-v2.md:231-232` diff table; supervisor is pacman-only increment, §9) |

---

## 9. What pacman has extra (reverse list)

The items below have **no counterparts** in Multica's runtime model (they never appear in r10) and are execution-plane increments on the pacman side.
Most are intentionally locked by volumes 02/08 per todos semantics; only facts and their nature are listed, without repeating the four columns.

| Item | pacman source | Nature |
|---|---|---|
| Per-step worktree contract: base clone + `worktree add -b` + reuse/recover/stale three steps + `projectLock` serialization + anti-fork guardrails | `apps/daemon/src/workspace.ts:66-114`, `docs/spec/02-architecture-parity.md:183-195` | Deliberate (todos semantics); Multica's daemon hands no git credentials down and does no worktree |
| Per-step commit + push + merge (hosted / github / local) | `apps/daemon/src/runner.ts:606-660`, `apps/daemon/src/workspace.ts:137-140` | Deliberate; see above |
| per-step git credentials (hosted one-shot key sign/revoke / github connection token), not in argv or on disk | `apps/server/src/services/machines.ts:1208-1213`, `apps/daemon/src/credentials.ts:16-18` | Deliberate; wiki A3 aligned secrets face to this discipline |
| artifact upload: `upload-urls/{stepId}` presign + self-hosted `PUT /api/machine/upload/{uploadId}`; plan.md as file version | `packages/shared/src/protocol/machine-wire.ts:356-391`, `apps/daemon/src/runner.ts:666-696` | Deliberate |
| steer / stop (incl. discard rewind) / sync three server→daemon pull-ack commands | `packages/shared/src/protocol/machine-wire.ts:264-297`, `apps/daemon/src/machine-loop.ts:236-271` | Deliberate |
| review step read-only checkout: no edit/write tools + rewind to step start on wrap-up | `apps/daemon/src/backend/pi.ts:63-71`, `apps/daemon/src/runner.ts:593-604` | Deliberate (#511, hard-gate semantics unique here) |
| chief step: server relay tool 49-word vocabulary + bound Agent pi session | `packages/shared/src/protocol/machine-wire.ts:189-200`, `apps/server/src/services/machines.ts:668-730` | Deliberate (02/A7); #515 lists Chief keep/remove as Not yet specified |
| Hard-gate phase model (nine phases, two manual gates) | `packages/shared/src/phase.ts:5-15` (nine-value vocabulary), `apps/server/src/services/phase.ts:17` (migration edge set), `docs/spec/02-architecture-parity.md:17-18` | Deliberate; #515 names it pacman's sole differentiation |
| MCP slug-only: server sends slug list; executor resolves endpoints from local `~/.claude.json`; credentials never cross wire | `packages/shared/src/protocol/machine-wire.ts:207-213`, `apps/daemon/src/backend/mcp-config.ts:60` | Deliberate (spec 13 contract break) |
| machine per-runtime switch `enabledRuntimes` | `apps/server/src/db/schema.ts:416` | **shape first, execution missing** (see G7) |
| supervisor crash keep-alive (detach spawn + daemon.json + exponential backoff restart) | `apps/daemon/src/supervisor.ts:28-92` | Deliberate (02/A1 detached + supervisor across crashes) |
| proxy probe (`EnvHttpProxyAgent` honors `HTTP_PROXY` family; dead proxy retries, no exit) | `apps/daemon/src/proxy.ts`, `docs/spec/01-stack-v2.md:129` | Deliberate |

---

## 10. In-scope-for-this-plan summary of the rulings

The 25 gaps grouped by their four-value ruling (criteria in §0); the full four columns for each are in §2–§8.

**in-scope · blocking #519 (the control plane moving to an always-on host + a running closed loop will hit these directly) — six items**

- **G8 / G9 / G14 / G15**: the entire chain of machine and step liveness decisions is missing. "Online" is defined by SSE connection state,
  there is no criterion for "a step is stuck" (`lastHeartbeatAt` written but never read), and there is no grace and no recovery.
  #519's scenario is exactly "the laptop powers off mid-way while the control plane stays up"; this chain is its first load-bearing wall.
- **G13**: steps are hard-bound to machines with no redispatch. A machine dropping offline = the step stays `claimed` forever, and the loop is jammed.
- **G22**: the model source is read from the server host rather than the execution host. After the split, the providers page points at the wrong machine.

**in-scope · for this plan to decide (#515 `Not yet specified` explicitly says to wait for this plan's research before ruling) — nine items**

- **G1**: a runtime is not an object; only a machine row exists.
- **G3**: the registration idempotency key lives in the application layer; re-registering with a different key creates an extra machine.
- **G5 / G12**: machine capability is not advertised + claim does not check capability. This is the complete form of wiki B1 "machine capability advertisement",
  and the prerequisite for #515's "which CLI to connect first for multi-backend".
- **G6**: a single embedded engine, with only the `AgentBackend` seam.
- **G7**: the `enabledRuntimes` switch has no execution surface.
- **G18 / G19**: env injection and namespace discipline — **ticket #508 already exists**; this plan does not reopen it, only registers the landing point.
- **G23**: only one version gate, and it compares the daemon's version.

**out · intentionally different (locked by volumes 02/01) — five items**

- G11 (concurrency cap removal, `docs/spec/02-architecture-parity.md:15` A3), G20 (single user, no owner/visibility, A2),
  G24 (all SSE, no WS, A1), G25 (pure-JS npm distribution + pi 0.86.0, volume 01 §8), G4 (no re-registration on restart, better than Multica).

**out · out of scope for this plan — four items**

- G2 (custom profiles), G16 (runtime 7-day GC), G17 (per-task `mat_` identity), G21 (custom runtime profile).

**Listed separately: one numeric difference, two "the nature judgment itself needs the map to rule"**

- **G10** (presence 30s vs 15s): a pure numeric difference, and pacman's 30s is a self-set replication-era value rather than an upstream observation
  (the comment at `apps/daemon/src/machine-loop.ts:46-47` admits "r3 did not capture a specific value [design]") — not counted as a difference, no action.
- **A supplement to G11**: what 02/A3 removed was the "concurrency **cap**"; the current state is **serial execution** on the execution side
  (`apps/daemon/src/machine-loop.ts:361`, one step per round). The reason for removing the cap was "self-use does not need throttling",
  but serial means **multiple machines do not run in parallel, and a single machine runs only one step at a time**. Under self-use this may be an acceptable trade-off,
  or it may be exactly the "slow closed loop" that #519 will hit — this ticket makes no ruling and hands it to the map.
- **G5 and G7 are two faces of one thing**: machines do not advertise capabilities (G5) and the switch does not take effect (G7); together they mean
  the "run pi or Claude Code on this machine" setting already promised in the UI **has no execution surface at all**.

---

## 11. Not found / not dug deep

Per the ticket's discipline, this section contains only what was **not verified**, without imagination filling the gaps:

1. **Multica-side line numbers were not re-verified by this ticket** — all cited from r10. r10's own sourcing discipline (§0) is "write nothing without a source",
   but it is the previous ticket's product; this ticket did not re-clone and compare. [cited]
2. **Whether Multica's daemon has a worktree/git contract** — r10 only mentions the existence of the `MULTICA_TASK_WORKSPACES_ROOT` variable
   (§6.3) without expanding the daemon-side workspace implementation. The §9 judgment "the per-step worktree is unique to pacman" rests on
   **absence from r10**, not on "confirmed Multica has none". [not found]
3. **Whether Multica has a counterpart for steer/stop/sync** — r10's seven surfaces do not cover this topic; not found.
   Recording it as a pacman increment in §9 is likewise on the "absent from r10" caliber. [not found]
4. **The final shape of pacman's `creds.env`** — #508 is opened but not landed; this ticket registers only the current state (delivered and then dropped),
   without predicting #508's ruling details. [statement of fact]
5. **Whether `machine.enabledRuntimes` ever had an execution surface** — this ticket read only the `c95ee5f` current state;
   git history was not traced item by item for whether it ever participated in claims. [not dug deep]
6. **The observation source of the 30s presence** — the code comment itself says "r3 did not capture a specific value [design]" (`apps/daemon/src/machine-loop.ts:46-47`),
   i.e. it is itself a replication-era self-set value rather than an upstream observation. Against Multica's 15s this constitutes not a "difference" but two self-set values.
   [statement of fact]
7. **A caliber conflict on the wiki side**: the wiki page ``[[pacman's own coordinates and borrowing list]]`` section B1 says
   "`presence` already carries `maxConcurrent` + `cliVersion`", but #503 removed `maxConcurrent` along with the concept
   (`apps/server/src/services/machines.ts:744-745`, `packages/shared/src/protocol/machine-wire.ts:96-98` "empty since #503").
   **That wiki page is outdated on this point**: `presence` now carries only `cliVersion`
   (`packages/shared/src/protocol/machine-wire.ts:81-83`). [verified conflict]

---

## Attached: one-sentence version (for the map)

pacman's runtime model is missing an entire layer compared with Multica's: **no runtime object** (only a machine row), **no machine capability advertisement**
(presence reports only cliVersion; claim does not check capability), **no liveness decision** (online is defined by SSE connection state; a step's `lastHeartbeatAt`
is written but never read; no grace and no recovery), **no per-task identity** (`token/{stepId}` carries only provider/env/git; the agent speaks through the daemon relay);
what it has extra is the execution plane itself (the worktree contract, per-step git credentials, artifact upload, steer/stop/sync, review read-only checkout, the chief,
supervisor keep-alive), most of which are intentionally locked by volumes 02/08 per todos semantics. The four items a machine split (#519) will hit directly:
machines online forever (G8/G9), steps hanging forever (G13), no grace and no recovery (G14/G15), and the model source read from the control-plane host rather than the execution host (G22).
