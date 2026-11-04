# 21 · Single-Machine Orchestration Defaults (issue #865)

> **Retirement note (2026-10-13)**: this doc's mechanism surface (primary-machine affinity + the `chief_thread.pinnedMachineId` / `todo.machineId` / `run_builds` machineId pinning family + T3's offline grace failure) has been wholly voided by ADR 0019 — owner-machine binding (`agent.machineId`) replaces pinning, the chief degrades to an ordinary agent; from #1257 a pending lost-contact uniformly suspends waiting for the machine (not ruled dead), and T3's explicit-failure path is dismantled with it. The text below is kept as a historical record, the code-location references (`failAbandonedChiefSteps`, `CHIEF_PIN_OFFLINE_HINT` etc.) all no longer exist.

> Scope: AMP alignment T4 (ticket-graph source of truth #861). **This ticket's phase 1 = this document, zero code**; the construction tickets execute per this doc's "blast radius" and "acceptance caliber". Answers the ticket's three questions: which machine is the primary, who decides; how the machines page expresses orchestration state; and the relationship with `chief_thread.pinnedMachineId` (#687 already wired).
> Baseline (the merged commits this spec builds on): #687 pin three-surface wiring (`todo.machineId` / `chief_thread.pinnedMachineId` / `run_builds` machineId + claim filter + offline-wait display), T1 `e760c06e` (abandoned-claim step release enables cross-machine continuation), T2 `b16e6e2c` (worker-step session affinity), T3 `5751a111` (offline pinning explicit failure after a 10-minute grace), T6 `5869b576` (claude-code step credential precheck reports the machine name).
> Basis: R14 (reuse chief, no separate per-machine orchestrator — a separate one = a second orchestrator, dual-tracked state); the machine dispatch model source of truth `docs/research/machine-execution-plane.md` (§4-7 session locality = a correctness item); the chief behavior source of truth `docs/research/r5-chief-behavior.md`.

## Problem

**The user request (#861 verbatim, 2026-10-05)**: "I also want to add an orchestration capability: one machine has one agent, used to orchestrate all agents. If I use this machine, it is the same. Set up an A on this machine, and it orchestrates all the Agents below." The accompanying request: "when my computer is off, it can continue, the opposite machine can keep running."

R14 already translated this request into pacman semantics: **reuse chief, realize it as machine affinity** — no new per-machine orchestrator, but pin the chief turns to a primary machine. #687 wired all the explicit pinning plumbing; what is missing is **the default strategy when there is no explicit pinning**. Four current gaps (code locations per main = `b16e6e2c`):

1. **An unpinned chief thread has no strategy.** The drawer new topic (`POST /api/teams/:id/chief/threads`, `apps/server/src/routes.ts:828`) carries no machine semantics, `sendChiefMessage` lands `pinnedMachineId: body.pinnedMachineId ?? null` (`apps/server/src/services/chief.ts:360`); the claim side `or(isNull(chiefThread.pinnedMachineId), …)` (`apps/server/src/services/machines.ts:656`) — unpinned = any online machine FIFO-preempts. The chief session file (pi sessionDir) is an execution-machine-local asset (machine-execution-plane §4-7), **every machine-change claim = one session degradation** (T1's `RESUME_FRESH_SESSION_NOTE` marks it explicitly, but the conversation context is actually lost). Under a multi-machine deployment "auto"'s real semantics is "each round may change machine", a correctness gap fully same-sourced with the worker step — and the worker surface was fixed by T2's session affinity gate (`machines.ts:921-930`), the chief surface has no counterpart. **The same correctness problem, two step families, one fixed and one not.**
2. **"Primary machine" has no single source.** pin's data layer (`build.pinnedMachineId` / `todo.machineId` / `chief_thread.pinnedMachineId`), claim filter, and service parameters are all in place, but "which machine to pin by default" has no answer: no user settings surface, no fallback rule. Outside the scheduler the only path writing a thread pin is the orchestrate entry's passthrough of `todo.machineId` (`routes.ts:621`).
3. **The machines page has zero orchestration info.** A machine row only has the online dot, shell gate, and runtime brand mark (`apps/web/src/resources/machines-page.tsx:110-169`). Which machine hosts the chief, whether a chief turn is running on some machine, whether a turn is waiting for some machine to come online, who the default primary is — all invisible. The user's "before shutting down, confirm the orchestration has landed on an always-on machine" has no observation surface.
4. **Existing threads' migration semantics undetermined.** `chief.ts:355-359`'s comment pins "existing threads are not back-written: which machine the session resumes on is decided at thread-creation time, a mid-stream machine change loses context". After the primary-machine concept lands, "do existing threads follow when the primary changes" must have an explicit answer, otherwise unexplained behavior appears on day one.

## Three-Question Quick Answers

- **Which machine is the primary?** The one the user pinned in chief settings (`chief.machineId`, new in this spec). No pin = no primary machine — only session affinity (see A4) backstops correctness.
- **Who decides?** The user. The system does not guess: the cost of guessing a wrong primary is **every chief turn a 10-minute timeout failure** (the T3 gate), while the pinning ruling's established wording is "the constraint is set by the human, lifted by the human" (T3 conclusion verbatim: The user lifts the constraint; the system never does). Setup entry once, cost one click (see A6), the system deciding for the user has no symmetric benefit.
- **How does the machines page express orchestration state?** Three-state read annotation: the `总管主机` badge (who is the default), `总管回合进行中` (this machine is currently executing a chief step), `总管等待机器` (a pinned pending chief step exists and this machine is currently not executable). Data goes through the GET /chief envelope's new `orchestration` block (see A5).
- **Relationship with `chief_thread.pinnedMachineId`?** pin's default-source chain lengthens: `todo.machineId` (orchestrate entry, current) → `chief.machineId` (new) → null. Existing threads not back-written (current semantics kept); unpinned threads get T2's same session-affinity gate, fixing "auto" from "each round may change machine" to "sticks to the session machine, only changes when that machine disappears".

## Solution

| ID | Decision | Landing shape |
|---|---|---|
| **A1** | primary machine = the chief-level setting `chief.machineId` | the `chief` table adds a column (migration ordered by main's tail at merge time, no hardcoded number in the ticket); one per "user×team", granularity same as the chief record itself (`ensureChief`, `chief.ts:96`) |
| **A2** | default = null = "auto", the system does not prefill | existing rows not backfilled; under single-machine deployment "auto" and pinning are identical (only one machine) |
| **A3** | new-thread pin default chain: `todo.machineId` → `chief.machineId` → null | single-point resolution into `sendChiefMessage` (`chief.ts:360` changes `body.pinnedMachineId ?? chiefRow.machineId ?? null`) — orchestrate / drawer new topic / future entries share the chain |
| **A4** | unpinned-thread's chief steps add the session-affinity gate (T2 same, filling the symmetry) | `tryClaim` chief candidate loop (`machines.ts:869-878`) adds candidate-level judgment, SQL unchanged (see the mechanism diagram) |
| **A5** | the GET /chief envelope adds the `orchestration` block | `chiefGetResponseSchema` (`packages/shared/src/records/chief.ts:138`) adds `defaultMachineId` + per-machine activity (running/waiting counts) |
| **A6** | setup entry = the chief settings Agent tab's new `机器` slot | a machine dropdown + an `自动` row (shape along the new-task machine chip's listbox family, `apps/web/src/overlay/new-task-dialog.tsx:771`); live write = PATCH /chief |
| **A7** | PATCH /chief adds the `machineId` slot, validation same rule as todo | flat `machineId: recordId.nullish()` (undefined = unchanged / null = clear back to auto); out-of-team machine 400 (aligned with `todos.ts:213-215`'s `machine X not in team`); the refine "at least one slot" adds this slot |
| **A8** | the machines-page orchestration state = three-state read annotation | badge + in-progress/waiting annotation; **no inline control** (the XMON-113 discipline of the only live control = the shell gate is kept); data = useChief envelope joined with useMachines |
| **A9** | effect boundary: the primary machine only governs chief-thread pinning | worker dispatch defaults (unpinned FIFO + T2 affinity), `run_builds` machineId semantics, the charter channel all untouched |

### Mechanism diagram

```text
sendChiefMessage 建线程（chief.ts）
  thread.pinnedMachineId = body.pinnedMachineId（orchestrate 的 todo 钉选，现状）
                        ?? chiefRow.machineId（主力机，新）
                        ?? null
  既有线程：不回写（现状语义保持，chief.ts:355-359 注释不动）

tryClaim 的 chief 候选循环（machines.ts，A4）
  thread 钉了机器（pinnedMachineId 非空）
    → SQL 过滤：唯钉选机可见（现状，不动；亲和不参与——T2 同律）
  thread 未钉 + 会话已开（thread.sessionId !== ''）
    → 会话亲和闸（新，与 worker T2 同型）：
        会话机（该线程链尾 session 步的 machineId，查询与 T2 的
          prior 查询同源，machines.ts:891-894 同型）在线且 runtime 闸开
          → 本机跳过该候选，步留 pending 等会话机领
        会话机离线 / 机器行被删 / runtime 闸关 / machineId 空
          → 本机领；换机 = daemon SessionNotResumable 回退新会话 +
            RESUME_FRESH_SESSION_NOTE（T1 显式降级，#862 契约不预判）
  thread 未钉 + 会话未开（首轮）
    → 现状 FIFO（先到先得；单机部署 = 唯一机器，与钉选无差异）

GET /chief 封套（A5，orchestration 块）
  defaultMachineId = chief.machineId
  activity[] = per 机 { machineId, running, waiting }
    running  = 该机上 status='claimed' 的 chief 步数（回合进行中）
    waiting  = 被钉到该机且 status='pending' 的 chief 步数 × 该机当前
               不可执行（离线或 runtime 闸关）——T3 已知缝隙（在线但
               闸关 = 无界等待）借此获得可见性

machines 页（A8，全部读态）
  「总管主机」徽标      → defaultMachineId 命中行
  「总管回合进行中」    → activity[].running > 0 行
  「总管等待机器」      → activity[].waiting > 0 行
```

The affinity gate's three details keep T2's same rule: a pinned thread is not affinitized (the sole visible candidate under a pinned SQL filter must not be dead-blocked; pinning = the user's explicit choice, overriding a soft preference); skipping only acts on the current candidate, does not block the same machine from claiming other threads' steps (per-machine visibility semantics, no head-of-line blocking); the affinity judgment's runtime gate uses the chief bound Agent's provider (same source as the gate inside `buildChiefClaim`, `machines.ts:777`).

### Relationship with T3 (the wait upper bound does not worsen)

Affinity releases **immediately when the session machine disappears** (offline/deleted/gate-off any one holds), no grace wait — so an unpinned thread does not produce new unbounded waits from affinity. T3's 10-minute grace + explicit failure only acts on the **pinned** path (`chief.ts:847-858`), and the primary-machine default chain exactly inherits "explicit pinning"'s semantics verbatim: setting a primary = every new thread pins it = when the primary is offline the turn fails after the 10-minute grace and names the machine (`dispatch-timeouts.ts:41`). This failure path changes from "reachable only via todo pinning" to "reachable by default once a primary is set", so A7 simultaneously widens `CHIEF_PIN_OFFLINE_HINT` (`dispatch-timeouts.ts:49`)'s exit copy from "change the task's machine to another online machine" to "change the chief setting's primary machine, or clear back to auto" — the failure message must point at a real existing exit (T6 rule: report the machine + report the remedy).

## Rejected Alternatives

| Option | Why rejected |
|---|---|
| **N1 a separate per-machine orchestrator A** | R14 already rejected: overlaps chief's duty, dual-tracked state (the drift failure class). The user's "one machine one orchestrator" is carried by machine affinity, no new orchestration entity. |
| **N2 the system guesses the primary (default prefill the `kind='local'` row, or first machine self-select)** | four independent reasons: ① it decides pinning for the user — directly conflicts with "constraints set by the human"; ② the guess-wrong failure surface = every turn a 10-minute timeout (T3), not degradation but shutdown; ③ under the server-host-has-no-daemon deployment shape (server on VPS, daemons on laptops) the local row is always offline, the chief dies entirely; ④ the conditional default "pin only if local online" = the same thread created at different times gets different semantics, breaking determinism. In the user's self-use topology mea is exactly the server host — **setting once is fully equivalent**, the prefill benefit is only saving one click, the cost is guessing once for all deployments. |
| **N3 the primary follows the user's own machine** | the web client carries no machine identity to the server (browser → server, no host concept); user ≠ machine (the phone opening the panel has no host to point to). No reliable signal, rejected. |
| **N4 affinity back-writes pin (write the session machine into `thread.pinnedMachineId` to fix it)** | forks from T2's claim-time soft semantics (worker has no back-write); after the back-write a machine disappearance goes through T3's hard failure rather than release-and-switch — affinity's correctness benefit halved; and pin gains a third writer source (the claim loop), the "who wrote this pin" troubleshooting surface blurs. |
| **N5 default-pin worker steps to the primary too (the literal reading of "chief turn and worker step pin the same machine")** | concentrating all work to one machine = multi-machine utilization to zero, contradicts the dispatch skeleton's design (unpinned = FIFO + T2 affinity); worker's shutdown-continuation does not depend on pinning — T1's release closed loop already exists (claim holder loses contact → step back to pending → another machine resumes). When the chief needs concentrated work it goes through the **charter** (standing instructions, r5 §2) and `run_builds` machineId (existing parameter), that is the semantically correct channel. |
| **N6 machines-page inline "set as primary" action** | the machines-page inline live-control discipline (from XMON-113 the only one = shell gate, `machines-page.tsx:12-15` comment); the primary machine is the chief's execution config, the decision surface lives in chief settings on the same layer as the bound Agent / model / thinking level. The badge is a read state, no discipline break. |
| **N7 re-pin existing threads to the new machine on primary change** | a mid-stream machine change loses the chief session context (creation-time semantics, `chief.ts:355-359`); unpinned existing threads already stick to the current session machine by A4 affinity, re-pinning is pure loss. Keep the re-open condition (see below). |
| **N8 the orchestration aggregate goes through the machines list response (machine record adds fields)** | the machine record is a shared schema + snapshot-pinned surface, and per-machine chief state is chief-domain data; living in the GET /chief envelope (the chief domain's own response) is semantically correct and the schema surface minimal, the machines page joins on the client. |
| **N9 chief-step cross-machine release (T1 symmetric extension to chief)** | the chief turn's side effects are non-idempotent: `create_todo` / `run_builds` dispatch mid-turn has no transaction-rollback surface, release-and-rerun = duplicate-dispatch risk. The worker's release loop eats the git checkpoint rollback (rewind to the step start), the chief has no counterpart. In-flight turn death keeps "explicit failure + resend" (`failAbandonedChiefSteps` claimed branch), primary-machine pinning already pushes this path's trigger probability down to "the machine really died". |

## Blast Radius (construction-ticket scope; this PR zero code change)

- **DB migration** (drizzle; number ordered by main's tail at merge time): the `chief` table adds a `machineId text` nullable column, the comment mirrors the `todo.machineId` rule (`schema.ts:94-97`). Existing rows not backfilled.
- **packages/shared** (`records/chief.ts`): `chiefRecordSchema` adds `machineId: recordId.nullable().optional()` (additive contract, an old web ignoring it degrades to current); `patchChiefBodySchema` (`:190`) adds the `machineId` slot + refine update; `chiefGetResponseSchema` (`:138`) adds the `orchestration` block. → **`packages/shared/test/snapshot.test.ts` must go red**: locally `vitest run test/snapshot.test.ts -u` update then per-block diff review before pushing (the established discipline of touching a shared schema slot).
- **apps/server**:
  - `services/chief.ts`: `sendChiefMessage` default chain (`:360`); `patchChief` machine-slot validation (out-of-team 400, aligned with `todos.ts:213-215`); `getChiefEnvelope` (`:188`) assembles `orchestration` (defaultMachineId + per-machine claimed / pending-pinned-not-executable counts).
  - `services/machines.ts`: `tryClaim` chief candidate loop (`:869-878`) adds the affinity judgment; the session-machine query same type as T2's prior query (`:891-894`). `claimChiefCandidates` SQL unchanged.
  - `services/dispatch-timeouts.ts`: `CHIEF_PIN_OFFLINE_HINT` (`:49`) copy update. The constant and sweep logic (`failAbandonedChiefSteps`) unchanged.
- **apps/web**:
  - `chief/chief-settings.tsx`: the Agent tab's new `机器` slot (listbox: machine rows + an `自动` row).
  - `resources/machines-page.tsx`: three-state read annotation (badge / in-progress / waiting); row-control discipline kept (no action button added).
  - i18n: new copy zh + **en sync** (i18n-coverage pins the en dictionary; append, do not land outside the `};`).
- **CONTEXT.md**: the glossary adds a line — Primary machine = `chief.machineId`, the chief's default execution machine; pinning semantics same as `todo.machineId` (deterministic, no auto fallback, lifting belongs to the user).
- **Tests**: server `machine-pin.test.ts` extends the default-chain four cases + the new chief affinity-gate tests (online skip / offline release / gate-off release / pinned not affinitized / first-round FIFO) + PATCH validation + envelope projection; web e2e machines-page / chief-settings each add read-surface and slot-surface cases.
- **Untouched list**: worker dispatch defaults, `run_builds` machineId semantics, `prompts.ts` machine-constraint row's trigger condition (keeps todo-pinning trigger, `packages/shared/src/records/prompts.ts:115-128` — that row says "the user specified **this task** runs on that machine, keep the pin at dispatch", a primary-source pin is a session-continuity constraint not a dispatch constraint, mixing triggers would mislead the chief into treating a global session constraint as a dispatch order), the machines-page row-control discipline, existing thread pins.

## Acceptance Caliber (construction tickets accept per this)

1. **Failure modes first** (the TDD rule): enumerate and land tests before implementation — the default-chain four states (todo pinned / todo unpinned + primary set / both unset / existing thread untouched), the affinity gate five states (listed above), PATCH three states (out-of-team 400 / null clear / undefined unchanged), envelope projection, failure-copy routing.
2. **Regression red line**: with no primary set the behavior is semantically equivalent to main — the default chain only changes behavior when `chief.machineId` is non-empty; pinning semantics (T3 grace + no auto fallback) untouched.
3. **Gates**: `pnpm lint` + `pnpm -r typecheck` + affected-surface e2e (`pnpm --filter @pacman/web e2e:affected`).
4. **Mechanism takes effect on real artifacts** (verify-pacman discipline, `docs/verify/865/` + the PR body's raw permanent links): one live-stack chain — PATCH sets the primary (read-back confirm) → drawer new topic → SQLite `chief_thread.pinnedMachineId` lands the primary (row-level evidence) → the machines-page `总管主机` badge (screenshot) → the primary row offline → the `总管等待机器` annotation (screenshot) → after grace the chief step fails, the error message contains the machine name + the new exit copy (API JSON).

## Known Boundaries and Re-Open Conditions

- **After a primary change existing threads do not follow** (the N7 cost surface): unpinned existing threads stick to the current session machine by affinity. Re-open condition: the user explicitly says "move the chief to X" — then do thread-level pin editing (PATCH thread machine + UI), no batch migration.
- **Multi-user teams**: `chief.machineId` per user (chief-record granularity), the machines-page badge shows each requester their own primary. Self-hosted single user is the running reality; multi-user badge semantics re-discussed when they surface.
- **Affinity wedged** (session machine online but not claiming): same type as T2's known boundary, no timeout — recorded, no new mechanism.
- **In-flight chief turn dies with the primary**: keeps explicit failure + resend (N9 reason); re-open condition = when the real pain of frequent primary restarts appears, then do the full "release-rerun + dispatch dedup" design.