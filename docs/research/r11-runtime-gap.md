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

1. **pacman 没有 runtime 这个对象。** server 侧只有 `machine` 一行 = 一台注册主机，
   runtime（一台电脑 × 一个 CLI 工具）在 pacman 里不存在行、不存在 id、不存在列表
   （`apps/server/src/db/schema.ts:398`）。**这不是遗漏，是形态差异**：pacman 的 daemon 自己就是 pi 运行时的宿主，
   「工具」不是被侦测出来的外部 CLI，而是 daemon 进程内嵌的引擎（`apps/daemon/src/machine-loop.ts:84`、
   `apps/daemon/src/backend/pi.ts:507`）。Multica 的 daemon 是「CLI 的调度器」，pacman 的 daemon 是「pi 的宿主」。
2. **第一条要改的不是能力，是「机器的能力」不被上报。** `presence` 只带 `cliVersion`
   （`packages/shared/src/protocol/machine-wire.ts:81`），而 claim 侧**完全不看机器能跑什么**
   （`apps/server/src/services/machines.ts:581`：只筛 `status='pending'` + team + pinnedMachine），
   于是任何机器都会领到任何步。多机一旦超过一台，这是第一个断点。
3. **在线判定比 Multica 脆一个量级。** pacman 的 `online` 只在机器 wake SSE 流 abort 时翻 false
   （`apps/server/src/routes-machine.ts:240`），**没有陈旧阈值、没有扫掠、没有心跳落库**
   （全仓穷举：`markOffline` 仅一处调用点；`step.lastHeartbeatAt` 写而不读）。于是活性完全等价于
   「这条 TCP 连接还在」：**没有 FIN 的断开**（网络分区、主机断电、拔网线）永久显示在线；
   而**有 FIN 的断开**（进程被 kill、daemon 自身重连）会立刻翻离线，且重连后要等下一拍 presence
   （最长 30s）才翻回来——同一个字段承载了两种语义，两头都不准。
4. **步与机器是硬绑定，且没有任何兜底。** claim 把 `step.status` 置 `claimed` + `machineId`
   （`apps/server/src/services/machines.ts:767`），此后只有该 machineId 能通过 `recover` 面看到它
   （`apps/server/src/services/machines.ts:553`），别的机器 claim 不到（`status='pending'` 已不成立），
   而 server 侧**没有任何超时把它放回去**。机器一去不回 = 这一步永久挂着。
   Multica 在这一点上有三层（150s 陈旧 + 3h 重连宽限 + 7 天回收，r10 §5.2–§5.4）。
5. **任务级凭据 pacman 有半边，缺的是「agent 拿什么回服务端说话」那一半。**
   `token/{stepId}` 发的是 provider 配置 + 团队密钥 env + git 凭证（`packages/shared/src/protocol/machine-wire.ts:339`），
   daemon 内存持有、步收尾清空（`apps/daemon/src/credentials.ts:22`）——形状与 Multica 的 per-run 下发同向。
   但 Multica 的 `mat_` 是**身份**（agent 用它调 Multica API，actor 记为 agent），pacman 没有对应物：
   agent 侧的工具全部经 `tool/{stepId}` relay 由 daemon 用机器 token 代发
   （`packages/shared/src/protocol/machine-wire.ts:314-334`）。
6. **下发的 `env` 槽在 daemon 侧无人消费。** `pushCredential` 收下 `provider/env/git` 三件
   （`apps/daemon/src/credentials.ts:22`），但全 daemon 只有 `creds.provider`（`apps/daemon/src/runner.ts:251`）与
   `creds.git`（`apps/daemon/src/runner.ts:286`、`:642`）有消费点，`creds.env` 仅被 `clearCredentials` 置空
   （`apps/daemon/src/credentials.ts:29`）。已有票 #508 在办，本票只登记它属 runtime 模型的哪一格。
7. **并发不是「比 Multica 低」，而是根本没有并发。** daemon 的 claim 循环 `await runStep(...)` 串行
   （`apps/daemon/src/machine-loop.ts:361`），server 侧 #503 已把上限概念整体摘除
   （`apps/server/src/services/machines.ts:744`）。Multica 是 daemon 20 / agent 6 的双层闸（r10 §5.4）。
   On the pacman side 02/A3 **deliberately** removed the cap (`docs/spec/02-architecture-parity.md:15`), but between the status quo and "deliberate" there is a missing step:
   what was removed is the **cap**, while the actual effect is **serial execution**.
8. **模型来源的读取机器，与执行机器不是同一台。** claude-code 段的模型清单由 **server 进程** fs 直读
   `~/.claude/settings.json`（`apps/server/src/services/providers.ts:141`；同文件 `:132` 与 `:179` 两处
   `hostname()` 取的都是 server 所在机器）。#519 一旦把控制面搬上常开主机、执行面留在另一台，这一页显示的就是**控制面主机的 Claude Code 配置**。
   Multica 的模型清单来自**对应 runtime**（r10 §4.2）。
9. **pacman 多出来的东西集中在「执行面本身」，不在「runtime 管理面」。** 每步 worktree + commit/push/merge
   （`apps/daemon/src/workspace.ts:66`）、per-step git 凭证、plan.md/transcript 产物上传、steer/stop/sync 三条
   拉取-确认指令（`packages/shared/src/protocol/machine-wire.ts:264`）、review 只读检出（`apps/daemon/src/runner.ts:593`）、
   supervisor 崩溃保活（`apps/daemon/src/supervisor.ts:58`）——这些 Multica 的 runtime 模型里没有对应物，
   most of these were **deliberately** locked per todos semantics by volumes 02/08 (`docs/spec/02-architecture-parity.md:18`, `:21`).
10. **`enabledRuntimes` 是形状先到、执行面没到。** machines 页的 per-runtime 开关存得下、读得出
    （`apps/server/src/db/schema.ts:416`、`apps/server/src/services/machines.ts:368`），但 claim 与执行两侧都不读它
    （穷举 grep：仓内消费点只有 schema 投影与测试）。Multica 对应的是 `agent_runtime.visibility`，
    它**是**绑定闸（`canUseRuntimeForAgent`，r10 §8.2）。

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
| **G12** | claim 候选只筛 `status='pending'` + team + `pinnedMachineId`（`apps/server/src/services/machines.ts:581-597`），**不看机器能不能跑这一步的模型** | runtime 与 agent 绑定，任务路由到匹配的 runtime（r10 §2.1/§8） | 缺 | 属·本图要定（= G5 的另一面；单机不阻塞，第二台机器一上就出问题） |
| **G13** | 步与机器硬绑定：claim 时写 `machineId`（`apps/server/src/services/machines.ts:767-772`），此后仅该机器经 `recover` 可见（`apps/server/src/services/machines.ts:553-561`），他机 claim 不到，**无重派、无超时释放**。失败后的唯一出路是人工重跑 = 新 build 新会话（`apps/server/src/services/builds.ts:7`） | `RecoverOrphanedTasksForRuntime` 绕开宽限 reclaim；`FailTasksForOfflineRuntimes` 按宽限判失败（r10 §5.3） | 缺 | **属·阻塞#519**（#519 要的是「真闭环」，机器半路掉线会把闭环永久卡死在这一步） |

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
| **G21** | 无自定义 runtime profile：无命令字段、无 `fixed_args`、无参数排序问题（全仓零命中） | `runtime_profile` + `fixed_args` 排在 Multica 参数**之前**，位置不可回退（r10 §7.3） | 缺 | 不属·本图 Out of scope（自用场景不接 wrapper CLI；若 G6 落地多 backend，此条须重判） |
| **G22** | 模型源读的是 **server 进程所在机器**：claude-code 段 fs 直读 `~/.claude/settings.json`（`apps/server/src/services/providers.ts:131-161`，`:132` 的 `hostname()` 取 server 主机名，`:141` 读文件）；pi 段 = 团队 custom provider 的 `models[]`（`:167-183`，`:179` 再用一次 `hostname()`） | 模型清单来自**对应 runtime**（部分工具暴露固定集，部分按本机配置/登录态算；r10 §4.2） | 形状不同 | **属·阻塞#519**（控制面与执行面分机后，这一页显示的是常开主机的 Claude Code 配置，不是执行机的） |
| **G23** | 版本门只有一个，且比的是 **daemon 自己的版本**：`meetsMcpVersionGate(latestCliVersion)` vs `MCP_MIN_CLI_VERSION`，未达则 claim 不携带 `mcpServers`（`apps/server/src/services/machines.ts:643-666`、`packages/shared/src/protocol/mcp.ts:164`） | 每族最低版本表 10 条（r10 §3.2/D7），低于则**不注册**该 runtime；另有 `capabilities`/`launched_by` 注册元数据（r10 §2.2） | 形状不同 | 属·本图要定（G6 的配套；单 backend 形态下现门够用） |
| **G24** | Transport = HTTP long-poll claim (server holds 75s, `packages/shared/src/protocol/machine-api.ts:30`, `apps/server/src/services/machines.ts:882-893`) + SSE wake (`apps/server/src/routes-machine.ts:227`). **The daemon side does not consume wake events** (`apps/daemon/src/machine-loop.ts:286-290` only dispatches shutdown/steer/stop/sync; `:227-234` comment records the #482 ruling: hold-expiry resend is the residual upper-bound backstop) | WebSocket `GET /api/daemon/ws` + 3-minute claim-poll backstop (r10 §5.2) | pacman deliberately different (implementation layer) | Not in scope · deliberate (`docs/spec/02-architecture-parity.md:13` A1 "real-time surface all SSE, no WS" is locked; the collaboration semantics (long poll + backstop) are identical on both sides) |
| **G25** | 发行 = 纯 JS npm 包（`docs/spec/01-stack-v2.md:123`）；supervisor 自建崩溃保活（`apps/daemon/src/supervisor.ts:28-92`，指数退避封顶 30s）；引擎 pin pi 0.86.0（`docs/spec/01-stack-v2.md:126`） | 6 平台二进制（275MB）；引擎 pi 0.84.3 构建（r10 §0 / `docs/spec/01-stack-v2.md:231-232`） | pacman 有意不同 | 不属·有意不同（`docs/spec/01-stack-v2.md:231-232` 差异表已登记；supervisor 是 pacman 独有增量，见 §9） |

---

## 9. What pacman has extra (reverse list)

The items below have **no counterparts** in Multica's runtime model (they never appear in r10) and are execution-plane increments on the pacman side.
Most are intentionally locked by volumes 02/08 per todos semantics; only facts and their nature are listed, without repeating the four columns.

| Item | pacman source | Nature |
|---|---|---|
| Per-step worktree contract: base clone + `worktree add -b` + reuse/recover/stale three steps + `projectLock` serialization + anti-fork guardrails | `apps/daemon/src/workspace.ts:66-114`, `docs/spec/02-architecture-parity.md:183-195` | Deliberate (todos semantics); Multica's daemon hands no git credentials down and does no worktree |
| 每步 commit + push + merge 落地（hosted / github / local 三形态） | `apps/daemon/src/runner.ts:606-660`、`apps/daemon/src/workspace.ts:137-140` | 有意；见上 |
| per-step git 凭证（hosted 一次性 key 现签现 revoke / github connection token），不进 argv、不落盘 | `apps/server/src/services/machines.ts:1208-1213`、`apps/daemon/src/credentials.ts:16-18` | 有意；wiki A3 已判定 secrets 面应对齐这条纪律 |
| 产物上传：`upload-urls/{stepId}` 预签名 + `PUT /api/machine/upload/{uploadId}` 自出（self-host 无对象存储）；plan.md 即文件版本 | `packages/shared/src/protocol/machine-wire.ts:356-391`、`apps/daemon/src/runner.ts:666-696` | 有意 |
| steer / stop（含 discard rewind）/ sync 三条 server→daemon 拉取-确认指令 | `packages/shared/src/protocol/machine-wire.ts:264-297`、`apps/daemon/src/machine-loop.ts:236-271` | 有意 |
| review 步只读检出：工具面不下发 edit/write + 收尾 rewind 回步起点两层 | `apps/daemon/src/backend/pi.ts:63-71`、`apps/daemon/src/runner.ts:593-604` | 有意（#511，本仓独有的硬闸语义） |
| chief 步：服务端 relay 工具 49 词表 + 绑定 Agent 的 pi 会话 | `packages/shared/src/protocol/machine-wire.ts:189-200`、`apps/server/src/services/machines.ts:668-730` | 有意（02/A7）；#515 明列「Chief 存废」为 Not yet specified |
| Hard-gate phase model (nine phases, two manual gates) | `packages/shared/src/phase.ts:5-15` (nine-value vocabulary), `apps/server/src/services/phase.ts:17` (migration edge set), `docs/spec/02-architecture-parity.md:17-18` | Deliberate; #515 names it pacman's sole differentiation |
| MCP slug 化：服务端只下发 slug 列表，端点由执行机读本机 `~/.claude.json` 解析，凭证从不跨 wire | `packages/shared/src/protocol/machine-wire.ts:207-213`、`apps/daemon/src/backend/mcp-config.ts:60` | 有意（spec 13 断约） |
| 机器 per-runtime 开关 `enabledRuntimes` | `apps/server/src/db/schema.ts:416` | **形状先到、执行面没到**（见 G7） |
| supervisor 崩溃保活（detach spawn + daemon.json + 指数退避重启） | `apps/daemon/src/supervisor.ts:28-92` | 有意（02/A1「detached + supervisor 跨崩溃保活」） |
| 代理探测（`EnvHttpProxyAgent` honor `HTTP_PROXY` 族，代理死持续重试不退出） | `apps/daemon/src/proxy.ts`、`docs/spec/01-stack-v2.md:129` | 有意 |

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
