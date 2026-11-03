# Agent-to-machine routing: pin each agent to a machine, or dispatch to any machine that qualifies?

> Question (ian, 2026-11-03): should a cairn agent (Planner, Implementer, CodeReviewer, …) be bound to one machine, or should its work go to any machine that qualifies?
> Trigger: omarchy went down for a reinstall; every worker agent is pinned to `omarchy` or `omarchy-orb`, so their build steps sat `pending` while the Mac was online and idle.
> Baseline: `origin/main` = `2f2956012` (the claim code is unchanged since `c5b4cfda4`). `path:line` refers to that tree.
> Tags: **[measured]** = read in source or primary docs, or observed with a command this session; **[inferred]** = derived from measured facts and checkable; **[guess]** = everything else.
> Scope: worker steps (plan, build, review, verify, merge). The Coordinator (chief) path is out of scope; it is already bound to the Mac and runs on Pi (D70).

## 0. Answer

Pool with a preference, not a pin. Each agent (or, after D60, the session routing rule) states **what a machine must have** as hard constraints, and optionally **which machine it prefers**. A step goes to its preferred machine while that machine can take it; when the preferred machine is offline, quota- or login-blocked, or missing a capability, any other eligible machine takes it at once; when the preferred machine is merely busy, others take it after an overflow delay. A sandbox requirement is a hard constraint and never falls back to an unsandboxed host. A step that continues a session prefers the machine that holds the session, and falls back to a fresh session with the existing hand-off note when that machine is gone.

This is the shape the pool-based products and schedulers in §2 share (Cursor pools, Devin Outposts, Claude Code environments, Nomad, Kubernetes): hard constraints as labels or capabilities, soft preference as a weighted affinity, a free pool for the rest. The two personal-machine products (Amp runners, sig) keep a *thread* on its machine, but neither binds a *role* to a machine, and sig puts "wait or switch" to the owner instead of waiting silently. It also reverses ADR 0019 (2026-10-12), which chose a hard pin over a pool. ADR 0019's own premortem named the failure seen today as its first risk (§1.4), and its main argument against the pool, the model-mismatch hole, is now closed by checks that already exist (§1.3).

## 1. What cairn does today

### 1.1 The claim rule [measured]

- A worker step is claimable only by `agent.machineId`. In `tryClaim`, `apps/server/src/services/machine-claim.ts:387-389`: `if (agentRow.machineId !== machineId) { if (runtime !== 'claude-code' || !claudeBlocked(agentRow.machineId)) continue; }`. The single exception: a claude-code step may go elsewhere when the home machine's Claude rate limit is blocked (`claudeBlockedReader`, `machine-claim.ts:257-268`). An *offline* home machine is not an exception.
- The chief path uses the same rule (`machine-claim.ts:299-301`).
- After the pin, the claim also requires: runtime enabled on the machine (`runtimeGatePasses`), the Claude usage gate, the Claude login gate, `capabilityGatePasses`, and the agent's `maxConcurrentTasks` (`machine-claim.ts:390-399`). Machine concurrency is checked before candidates are listed (`machine-claim.ts:336`).
- The claim itself is a compare-and-set: `UPDATE step SET status='claimed', machineId=… WHERE id=? AND status='pending'` inside a transaction (`machine-claim.ts:449-466`). Two machines racing for one step cannot both win.
- The D60 session routing rule can override the pin: `applyRoute` replaces `machineId` with `route.machineId ?? agentRow.machineId` (`apps/server/src/services/routing-rules.ts:36-45`). Routing rules are off unless `setRoutingRulesEnabled(true)`; the production DB has no `routing_rule` rows (§1.5).

### 1.2 How the pin came to be [measured]

- Before 2026-10-13 cairn had task-level pins (`todo.machineId`, `build.pinnedMachineId`, `chiefThread.pinnedMachineId`, `schedule.machineId`) with unpinned steps going to any online machine FIFO, a worker session-affinity gate (T2), and an explicit failure after a 10-minute offline grace for pinned steps (T3). See `docs/research/machine-execution-plane.md` §2-4 and `docs/spec/21-single-machine-orchestration-defaults.md` (retired header, line 3).
- ADR 0018 decision 4 (same week) chose "agents not bound to machines + capability declaration / capability gate". ian overturned it on review ("还是稳定一点好", align with Multica, where `agent.runtime_id` binds an agent to one daemon). ADR 0019 (`git show a1e6bee3b`, removed from the tree by D61) made `agent.machineId` the single answer and retired all task pins; commit `c05a5ab44` (#1271) implemented it.
- ADR 0019 gave three reasons: (1) the capability gate checked the runtime but not the model the machine's claude-code had configured, so a step could land on a machine that cannot run its model; (2) four scattered pin columns gave no single answer for "where does this step go"; (3) the chief was a special case. Its premortem listed as death cause 1: "home machine offline = every agent on it stops", mitigated only by a visible reason and a manual rebind / evacuate action (`POST /api/machines/:id/evacuate`).
- D60 (2026-11-02) then removed fixed-role agents from the user layer: "model and machine are chosen by the coordinator per task, rules in one place". D62 ① starts that with one session routing rule. D69 says the control plane moves to a VPS and "agents pick a machine" among Mac and omarchy. So the plan already moved away from the per-agent pin in words, but the claim code still pins.

### 1.3 Which pieces of a pool already exist [measured]

- `requiredCapabilities` on `agent` (`apps/server/src/db/schema.ts:408`) with `{ mcpServers?, models? }` (`packages/shared/src/records/machine-capabilities.ts:35-39`), checked by `capabilityGatePasses` (`apps/server/src/services/dispatch-eligibility.ts:66-71`).
- `homeMachineRejectReason` (`dispatch-eligibility.ts:192-222`) already checks the model ADR 0019 worried about: the runtime is enabled, and for claude-code the model is either live in the catalog or in the machine's self-reported `claudeCodeReport.models`. That is a per-machine predicate today used only at bind time; it can run at claim time against every machine.
- `GET` agent-machine fit (`agentMachineFitRowSchema`, `machine-capabilities.ts:57-65`, served from `apps/server/src/routes-agents.ts`) already computes `canRun` per machine for an agent.
- Session hand-off across machines: the claim passes `priorMachineId` when the prior session ran elsewhere (`machine-claim.ts:423-425`, `:510`), and the daemon opens a fresh session with a note instead of failing (`apps/daemon/src/runner.ts:209-215`). Review and verify steps always start a fresh session (`machine-claim.ts:501-506`).
- Repository source: GitHub projects clone from GitHub and use `project.localPath` only as an accelerator when the path exists on the claiming machine (`apps/daemon/src/workspace.ts:146-172`, ADR 0017). Only `repoKind = 'local'` projects need the path (`apps/server/src/services/git.ts:124-126`).
- Offline detection: a machine is marked offline after `MACHINE_STALE_OFFLINE_MS = 150_000` without presence (`apps/server/src/services/machines.ts:431`); a claimed step with no progress for `BUILD_ABANDONED_STEP_MS = 120_000` is released back to `pending` (`apps/server/src/services/builds.ts:2357-2422`). A *pending* step is never released or failed for an offline home; `step-queue.ts:107-117` only labels it `machine-offline` for the UI.

Gaps in those pieces [measured]:

- `missingCapabilityItems` returns no gaps when a machine has not reported `mcpServers` or `models` (`dispatch-eligibility.ts:38-57`): the capability gate fails open on missing reports. Fine under a pin, unsafe in a pool.
- `requiredCapabilities` cannot express the executor kind (Orb vs host), a repo path, a desktop/browser, or a CLI login. The Orb is a property of a daemon process started with `CAIRN_EXECUTOR=orb` (`apps/daemon/src/machine-loop.ts:292-296`), registered as its own machine (`omarchy-orb`), and nothing in the machine record says "this machine is an Orb executor".
- `agent.mcpServers` (the servers the agent wants) is not a claim gate; `declaredMcpGaps` exists (`dispatch-eligibility.ts:73-82`) but is not used in `tryClaim`.

### 1.4 The incident, as seen in the production DB [measured, `sqlite3 -readonly ~/.cairn/server/server.db`, 2026-11-03 02:43 UTC]

| Agent | Runtime / model | Pinned to | Machine online |
|---|---|---|---|
| Chief | claude-code / haiku-5-5 | xmonsMac-3574.local | yes |
| Planner, Implementer, TestEngineer, orb-builder | claude-code / sonnet-5-5 | omarchy-orb | no (last seen 11-02 12:40) |
| CodeReviewer, SecurityAuditor, Verifier | claude-code / sonnet or haiku | omarchy | no (last seen 11-02 12:40) |
| eval-harbor | relay-186 / glm-5.3 | eval-harbor-omarchy-1518 | no (never seen) |

- Two build steps created 11-03 01:24 UTC (todos 106 and 107, assigned to Planner and eval-harbor) were still `pending` 79 minutes later. The Mac (`enabledRuntimes = ["claude-code","pi"]`, `maxConcurrent = 8`, Claude login `ok`) was online the whole time.
- The team holds one stored Claude subscription (`claude_subscription`: 1 row). With it active, the login gate does not depend on the machine (`claudeCodeLoginBlocks` returns false, `machine-claim.ts:160-167`), so claude-code eligibility on the Mac is not blocked by credentials [inferred].
- Projects: `cairn` is `repoKind = github` with `localPath = /Users/xmon/Code/AgentProjects/cairn` (a Mac path). Any machine can build it from GitHub; the Mac gets the local accelerator [inferred from §1.3].

### 1.5 Machines and routing rules now [measured]

Machines: `xmonsMac-3574.local` (local, online), `omarchy`, `omarchy-orb`, `mea` (offline since 10-16), `eval-harbor-omarchy`, `eval-harbor-omarchy-1518` (never seen). `routing_rule`: no rows.

## 2. How comparable products route work to an executor

All entries were read on 2026-11-03 from the products' own docs or source (URLs in §6). Quotes are under 15 words.

| Product | Binding | Machine offline | Hard "must run here" | Soft preference | Resume |
|---|---|---|---|---|---|
| Amp | User picks a runner (`--runner-id`, host + dir) or a per-thread orb; no pool | A sleeping Mac leaves the runner picker after ~90 s; its threads pause and "carry on where they stopped" on wake; no failover | choose that runner; shared runners for GPU / macOS signing | none | orb sleeps with files and services; runner = same disk |
| Cursor cloud agents | Managed VM, a named My Machine, or a Team Pool (labels `pool=`, `repo=`, custom) claimed by workers | A pool queue waits for a worker; a follow-up to an offline worker waits `workerReadyTimeoutSeconds` (default 0) then "reconnects to a fresh machine from the pool"; `worker=` targeting fails "instead of falling back" | `pool=`, `worker=`/`machine=`, `repo=` | default-pool resolution order; hibernation + reconnect window = sticky with fallback | fresh worker loses the workspace unless a hibernation snapshot is woken |
| Devin | Hosted snapshot VMs; Outposts = a named queue, any worker claims by CAS (409 on loss) | `claim_deadline`: "expired claims return to the queue automatically" | pick the outpost (for example `gpu-h200`); Local Hands for the user's laptop | none | `kind: resume` on the same image digest; worker dirs restored, stamp files detect a missed restore |
| OpenHands | User-selected backend; one sandbox per conversation | not documented | backend / runtime config | none | sandbox pause / resume API |
| Factory | An LLM orchestrator "reads each machine's description" to route | not documented | pick the machine; free-text descriptions | a default environment; remote delegation on/off | Droid Computers keep state |
| Claude Code (cloud and self-hosted environments) | Session goes to an environment queue, "not to an individual runner"; a runner claims it under a lease | lease lapses after ~60 s without polling; the session requeues to another runner within minutes | environment picker / org default / `--environment`; Remote Control for "my laptop" | org default only | transcript stays server-side; resumes on a fresh runner at the next message; unpushed files are lost |
| sig | Steward picks among machines that have the repo: named > the Thread's last machine > online > most free slots; a tie goes to the owner (`dispatch.ts`) | offline at dispatch: ask the owner to wait or switch to another machine with the repo; mid-task drop = `unreachable`, not failed; reconnect reconciles and resumes | repo present and the agent CLI logged in on that machine | last machine and free slots, under the hard repo filter | `decideContinuation`: same agent, machine, repo, mode and context < 80% resumes; otherwise a new session with a hand-off brief |
| DeepSeek DSH prototype | One host; per-ticket session and directory, `maxWorkers` slots | queued until a slot frees; a host restart ends running assignments with a recovery note | n/a | none | same session, directory, branch and PR on retry |
| GitHub Actions | All `runs-on` labels (and group) must match; free pool | matching runner idle 60 s without picking up → re-queued; no match → queued, cancelled after 24 h | `runs-on` labels / `group` | none | none |
| Buildkite | `queue` + agent tags, all must match | unmatched jobs expire after 30 days (configurable); 3 min without heartbeat → agent lost, job exit `-1`, opt-in auto retry | `agents:` rules | none | retry is a new job |
| GitLab | Runner tags, all must match; `run_untagged` | source constants: pending with no matching runner 1 h → dropped; pending 1 day → dropped; running without updates 30 min → dropped | `tags:` | none | `retry:when` |
| Nomad | `constraint` filters, scoring places | missed heartbeats → allocation `lost` → replaced elsewhere; `disconnect` tunes it | `constraint` | `affinity` weight -100..100; "placement is still successful" without a match | `ephemeral_disk { sticky = true }`, best effort |
| Kubernetes | `nodeSelector` / required nodeAffinity; scoring | NotReady node → NoExecute taint, default `tolerationSeconds=300`, then eviction and replacement | `nodeSelector`, required affinity, taints | preferred nodeAffinity weight 1-100; the Pod is scheduled even without a match | StatefulSet + PersistentVolume [inferred] |

What this says for cairn [inferred from the table]:

1. **Every product that runs agents on executors it does not own converged on one shape**: a named queue or pool, outbound-polling workers, an atomic claim, and a lease that returns work to the queue when a worker vanishes (Cursor pools, Devin Outposts, Claude Code environments). Cairn already has the claim, the lease (`BUILD_ABANDONED_STEP_MS`) and the outbound poll; it lacks the pool.
2. **Only Amp runners and sig keep work on one personal machine and wait.** Both are "my own machines" products, the closest to cairn. Even there the pin is per thread, not per role, and sig asks the owner to wait or switch rather than waiting silently. No product binds a *role* to a machine; Multica, which ADR 0019 followed, binds an agent to a runtime, and Cursor's `worker=` fails fast instead of queueing forever.
3. **Hard constraints are labels or capabilities; soft preference is a weight with automatic fallback** (Nomad `affinity`, Kubernetes preferred nodeAffinity, Cursor hibernation window). None of the CI systems has a soft preference.
4. **Offline grace values in the wild**: 60 s lease (Claude Code), 60 s re-queue (GitHub), 3 min heartbeat (Buildkite), 300 s (Kubernetes), 30 min running / 1 h pending (GitLab). Cairn's 150 s stale mark sits inside that range; it has no pending-side limit at all.
5. **Resume across machines is accepted as lossy everywhere**: the transcript lives on the control plane and the workspace is either snapshotted or lost. Cairn pushes the conversation branch at the end of each step (`machine-execution-plane.md` §1, pillar four), so only the model session is lost on a hop, and the daemon already writes a hand-off note.
6. **"Must run here" is a named machine or pool plus repo presence**, never a probe of a logged-in CLI or browser (Cursor `repo=`, sig's repo filter). Cairn's equivalents are the `local` project path and the Orb executor.

## 3. What makes a machine eligible for a cairn role

| Requirement | Who needs it | Machine-bound? | Expressible today? |
|---|---|---|---|
| Runtime enabled (`claude-code`, `pi`, `gemini`) | all | per machine | yes, `enabledRuntimes` [measured] |
| Model available | claude-code agents | per machine (`~/.claude/settings.json`) unless the catalog marks it live | yes at bind time (`homeMachineRejectReason`), not at claim time [measured] |
| Claude credential | claude-code agents | no while a team subscription is stored; yes when the machine's own login is used (`claudeUsageGatePasses`, `claude-rate-limit.ts:45-58`) | yes [measured] |
| Codex / ChatGPT login | codex steps | per machine (`chatgpt-login` #2284 is still planned in the plan's B2 row) | no [measured from plan; inferred no gate] |
| Repository | all build-type steps | only for `repoKind = local`; GitHub and hosted projects clone anywhere | implicit; a `local` project fails at prepare on another machine [measured] |
| Orb sandbox | agents that run unsupervised (today Planner, Implementer, TestEngineer, orb-builder via `omarchy-orb`) | yes: nspawn on omarchy only, root setup; D69 plans rootless Docker/Podman on omarchy and Apple `container` or OrbStack on the Mac | no; only as a pin to the Orb machine [measured] |
| MCP servers | agents with `mcpServers` | per machine (`~/.claude.json`) | reported in `capabilities.mcpServers`; gated only through `requiredCapabilities`, fail-open on missing reports [measured] |
| Skills | all | per machine (`capabilities.skills`) | reported, not gated [measured] |
| Heavy-work slots and e2e ports | build and test steps that run Playwright | per machine (`CAIRN_HEAVY_SLOTS_DIR`, port leases) | a capacity limit, not an eligibility rule; machine `maxConcurrent` covers it coarsely [inferred] |
| Desktop / browser / a logged-in GUI app | none of today's roles; possible future "use ian's Chrome" steps | yes | no [inferred] |
| Session to continue | plan and build steps that continue a session | yes: claude-code and pi session files live on the machine that ran them | handled by fallback to a fresh session (§1.3) [measured] |

Per role [inferred from the table]: Planner, Implementer, TestEngineer need runtime + model + repo + (if required) sandbox, and prefer the session machine. CodeReviewer, SecurityAuditor and Verifier always start fresh sessions, read only, and need runtime + model + repo: they are the easiest to pool. Merge steps need the repo and push credentials, which come from the server per step.

## 4. Failure modes per option

Options: **A** pinned (today); **B** capability pool (any eligible machine, FIFO); **C** pinned with fallback (prefer the pin, others take over on failure); **D** project-scoped preference (the project names a preferred machine, otherwise pool).

| Failure | A pinned | B pool | C pinned + fallback | D project preference |
|---|---|---|---|---|
| Preferred machine offline | step waits until a human rebinds (today: 79 min and counting) [measured] | another machine takes it within one claim poll [inferred] | another machine takes it once the server marks the machine offline (≤150 s) [inferred] | as C, per project |
| Two machines claim the same step | impossible: CAS on `status='pending'` [measured] | same CAS [measured] | same | same |
| Sandbox expected, absent | cannot happen while pinned to an Orb machine | silent escape to an unsandboxed host unless the sandbox is a hard capability [inferred] | same risk on fallback unless hard | same |
| Machine lacks the model / MCP | caught at bind time; drift after binding leaves the step stuck with a reason | caught at claim if the gate runs per machine and fails closed; today it fails open on missing reports [measured] | same as B on fallback | same as B |
| Quota per machine | pinned steps wait for that machine's window; the existing claude-code exception moves them | spreads load only when machines use different accounts; with one shared team subscription every machine hits the same limit [inferred] | as B | as B |
| Session resume on the same machine | always local | each hop loses context unless affinity is kept [inferred; spec 21 called this a correctness gap] | affinity by default; a hop only on failure, with the hand-off note [inferred] | as C |
| One busy machine, another idle | queue builds behind the pin (ADR 0019 premortem 3) | load spreads | spreads only on failure unless an overflow delay exists | spreads only across projects |
| Local-kind project on the wrong machine | cannot happen | prepare fails the step | same on fallback | avoided if the preference is the path's machine; still a hard constraint |
| Predictability ("where did my step run?") | fully predictable | lowest | predictable except on failure | predictable per project |

## 5. Recommendation

### 5.1 Routing rule

For a pending worker step S and a polling machine M, compute in one pure function `machineEligibility(S, M)`:

1. **Hard constraints** (all must hold, failing closed on missing reports): runtime enabled; the effective model is runnable on M (the `homeMachineRejectReason` check, moved to claim time); every `requiredCapabilities` item present; `executor = orb` when the agent requires a sandbox; for `repoKind = local`, M is the machine that owns the path; M's concurrency and the agent's `maxConcurrentTasks` have room; M is not Claude-blocked for a claude-code step.
2. **Preference order** among eligible machines, following sig's `dispatch.ts:44-60` order: (a) for a step that continues a session, the machine of the prior session; (b) the agent's or routing rule's `preferredMachineId`; (c) any eligible machine.
3. **When a less-preferred machine may take S**:
   - a step with no session to continue (every review and verify step, first plan or build step): immediately when the preferred machine is offline (presence stale, 150 s), blocked, or fails a hard constraint;
   - a step that continues a session: wait for the session machine for `sessionGraceMs` (default 5 minutes, the Kubernetes `tolerationSeconds` default) after it goes offline, then fall back with the existing hand-off note; the code is safe because the conversation branch is pushed after every step;
   - any step whose preferred machine is merely at capacity: after `overflowAfterMs` (default 10 minutes);
   - `machineAffinity = 'required'` (for example a desktop-bound step) never moves; after `sessionGraceMs` offline it raises an inbox item naming the machine, the way sig asks the owner to wait or switch.

### 5.2 Data model

- `agent.machineId` keeps its column but becomes `preferredMachineId` in meaning (nullable; null = no preference). Add `agent.machineAffinity: 'preferred' | 'required'`, default `'preferred'`. Mirror both on `routing_rule` so D60's single routing rule carries them.
- Extend `requiredCapabilities` with `executor?: 'orb'` (no runtime field: the runtime follows the model). Machines report `capabilities.executor: 'orb' | 'host'` from the daemon (`CAIRN_EXECUTOR`).
- Sandbox fallback: **not allowed by default.** An agent that requires the Orb waits for an Orb executor. Whether a "sandbox preferred" level exists is an open question for ian (§7).
- `missingCapabilityItems` fails closed when the machine has not reported the relevant list.
- Keep `POST /api/machines/:id/evacuate` and the delete guard; they become rebinding the preference.

### 5.3 Claim protocol impact

The claim remains a CAS on `status='pending'`; only the candidate predicate changes. The step-claim TLA+ model hard-codes the guard `home = m` with a constant `home` (`.claude/skills/verify-step-claim/model/StepClaim.tla:46, 66, 103, 124`). The change replaces it with `m \in Eligible` where eligibility depends on `online`, so **the `verify-step-claim` model must be updated and rerun** (P1 to P7), with a new invariant: a step whose agent requires the Orb is never claimed by a host executor, and a negative control that drops the executor check.

### 5.4 Draft decision row

| D71 | Worker routing: preference plus a capability pool, not a per-agent pin (amends ADR 0019, implements D60 ① and D69 ②) | Basis: `docs/research/agent-machine-routing.md`. Measured 11-03: every worker agent pinned to omarchy/omarchy-orb; with omarchy down, two build steps stayed `pending` 79 min while the Mac was online. ① A step goes to any machine passing the hard constraints (runtime, model, required MCP, Orb executor when required, local-path project owner, capacity, Claude block), failing closed on missing reports. ② Preference order: session machine for continued sessions → the agent's / routing rule's preferred machine → any (sig's order). ③ Fallback: steps without a session move at once when the preferred machine is offline, blocked or missing a capability; session steps wait 5 min for their machine, then hop with the hand-off note; any step overflows after 10 min when its machine is only full; `machineAffinity = required` never moves and raises an inbox item. ④ An agent that requires the Orb never falls back to a host. ⑤ The claim stays a CAS; the step-claim TLA+ model is updated (`home = m` → `m ∈ Eligible`) and rerun before merge. | Proposed |

### 5.5 PR list

| # | Scope | Paths | Route |
|---|---|---|---|
| 1 | Daemon reports `executor` in capabilities; shared schema adds `executor` to capabilities and `requiredCapabilities` | `packages/shared/src/records/machine-capabilities.ts`, daemon capability report (`apps/daemon/src/machine-loop.ts`; `machine-client.ts` only if the wire body changes) | owner route if `apps/daemon/src/machine-client.ts` changes |
| 2 | `machineEligibility` predicate in `dispatch-eligibility.ts`: model check at claim time, executor, local-path owner, fail-closed capability reports; unit tests for each failure mode in §4 | `apps/server/src/services/dispatch-eligibility.ts` | agent route |
| 3 | Migration: `agent.machineAffinity`, `routing_rule.machineAffinity`; `machineId` read as preference; UI copy "preferred machine" / "must run here" | `apps/server/src/db/`, `apps/web/src/` agent form | agent route |
| 4 | `tryClaim` and the chief loop use the predicate and the preference order with offline / blocked / overflow fallback; `step-queue.ts` reports "waiting for preferred machine, falls back at T" | `apps/server/src/services/machine-claim.ts`, `step-queue.ts` | **owner route** (`services/machine*.ts` is a security surface); `/security-review`; other-vendor review |
| 5 | Step-claim TLA+ model: eligibility set, Orb invariant, negative control; rerun P1-P7 | `.claude/skills/verify-step-claim/model/` | goes with #4 |
| 6 | Alert when a pending step has no eligible online machine for N minutes (inbox item naming the missing constraint) | `apps/server/src/services/step-queue.ts`, scheduler | agent route |

Order: 1 → 2 → 3 → 4+5 → 6. Until #4 merges, the only way to unblock work is a manual rebind (evacuate) of the agents to the Mac, which is a production change for ian to approve; the Orb-pinned agents would then run on the Mac host without a sandbox.

## 6. Sources

In-repo (baseline `2f2956012`): `apps/server/src/services/machine-claim.ts`, `dispatch-eligibility.ts`, `routing-rules.ts`, `step-queue.ts`, `builds.ts`, `machines.ts`, `git.ts`, `claude-rate-limit.ts`, `apps/server/src/db/schema.ts`, `packages/shared/src/records/machine-capabilities.ts`, `apps/daemon/src/runner.ts`, `workspace.ts`, `machine-loop.ts`, `.claude/skills/verify-step-claim/model/StepClaim.tla`. History: ADR 0018 and ADR 0019 (`git show a1e6bee3b`), commit `c05a5ab44` (#1271), `docs/research/machine-execution-plane.md`, `docs/spec/21-single-machine-orchestration-defaults.md`, `docs/research/dsh-sig-walk-2026-11.md`, `docs/research/amp-native-sandbox-orb.md`. Plan rows D51, D55, D60, D62, D69, D70 (`~/.claude/plans/cairn-plan.md`). Production DB read with `sqlite3 -readonly ~/.cairn/server/server.db` at 2026-11-03 02:43 UTC.

External (fetched 2026-11-03):

- Amp: https://ampcode.com/docs/cli/runners, https://ampcode.com/docs/orbs, https://ampcode.com/docs/orbs/sizes-and-costs, https://ampcode.com/docs/macos-and-ios/runner, https://ampcode.com/news/agents-anywhere, https://ampcode.com/news/shared-runners, https://ampcode.com/docs/cli/spawning-orbs
- Cursor: https://cursor.com/docs/cloud-agent, https://cursor.com/docs/cloud-agent/self-hosted, https://cursor.com/docs/cloud-agent/self-hosted/pool, https://cursor.com/docs/cloud-agent/self-hosted/my-machines
- Devin: https://docs.devin.ai/onboard-devin/environment, https://docs.devin.ai/cloud/outposts/overview, https://docs.devin.ai/cloud/outposts/orchestration, https://docs.devin.ai/cloud/outposts/reference, https://docs.devin.ai/work-with-devin/local-hands
- OpenHands: https://docs.openhands.dev/openhands/usage/agent-canvas/architecture, https://docs.openhands.dev/openhands/usage/sandboxes/remote, https://docs.openhands.dev/openhands/usage/api/v1
- Factory: https://docs.factory.com/workstreams/machines, https://docs.factory.com/remote-control, https://docs.factory.com/droid-computers/overview (the older `/web/machine-connection/overview` returns 404)
- Claude Code: https://code.claude.com/docs/en/self-hosted-environments, https://code.claude.com/docs/en/self-hosted-environments-reference, https://code.claude.com/docs/en/claude-code-on-the-web, https://code.claude.com/docs/en/cloud-environments, https://code.claude.com/docs/en/remote-control
- sig: https://github.com/iefnaf/sig (main @ `b048eab`): `docs/spec.md` §9, `docs/design/steward.md`, `apps/steward/src/dispatch.ts`
- DeepSeek DSH prototype: https://github.com/deepseek-ai/dsh-superagent-prototype (`docs/003-execution.md`, `docs/007-architecture.md`); self-described research prototype
- GitHub Actions: https://docs.github.com/en/actions/reference/runners/self-hosted-runners, https://docs.github.com/en/actions/reference/limits
- Buildkite: https://buildkite.com/docs/agent/cli/reference/start#agent-targeting, https://buildkite.com/docs/agent/queues, https://buildkite.com/docs/pipelines/configure/build-timeouts#scheduled-job-expiration, https://buildkite.com/docs/agent/lifecycle
- GitLab: https://docs.gitlab.com/ci/yaml/#tags, https://docs.gitlab.com/ci/runners/configure_runners/, `app/services/ci/stuck_builds/drop_pending_service.rb` and `drop_running_service.rb` on gitlab-org/gitlab master
- Nomad: https://developer.hashicorp.com/nomad/docs/job-specification/constraint, `/affinity`, `/reschedule`, `/disconnect`, `/ephemeral_disk`
- Kubernetes: https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/, https://kubernetes.io/docs/concepts/scheduling-eviction/taint-and-toleration/

Not found: Factory and OpenHands offline behavior; Devin claim-deadline and queue-wait values; GitHub mid-job runner loss; the DSH design article (not fetched).

## 7. Open questions for ian

1. Sandbox: may an agent that normally runs in the Orb fall back to an unsandboxed host when no Orb is online? Recommended: no by default; add a per-agent `sandbox: preferred` only if you want availability over isolation for some roles.
2. Timers: session grace 5 minutes and overflow 10 minutes when the preferred machine is only busy. Or never overflow (fallback only on failure)? Or, like sig, ask you instead of moving automatically?
3. ADR 0019's "还是稳定一点好" chose predictability. Does the session-machine-first, then preferred-machine order keep enough predictability, or do you want some roles (for example SecurityAuditor) to stay `required`?
4. Immediate unblock while the code changes: rebind (evacuate) omarchy's agents to the Mac now? That runs Orb-pinned roles unsandboxed on the Mac.
