# DeepSeek Harness super-agent and sig: hands-on walk, 2026-11

> Issue: #2489. Walked 2026-11-01 on ian's Mac.
> Sources pinned for this walk:
> - DeepSeek Harness (DSH) `deepseek-ai/deepseek-harness` at `ce7073d5` (2026-10-30), npm `@deepseek-ai/dsh@0.2.1-rc.3`.
> - Super-agent prototype `deepseek-ai/dsh-superagent-prototype` at `6337fc82` (2026-10-31).
> - sig `iefnaf/sig` at `b048eab5` (2026-11-01).
>
> Evidence labels: **measured** means this walk ran it and saw the output; **read** means the claim comes from the pinned source or docs; **inferred** means it follows from measured or read facts and can be rechecked.

## 0. Conclusions

1. **The shared shape is real.** Both products ship a resident router over isolated worker sessions: DSH's super-agent on one host as a DSH plugin bundle (measured: installed, booted, panel walked, 1197 tests passing on its simulated host), sig as a Cloudflare Durable Object plus connectors on the owner's machines (read). A self-hosted router is no longer something cairn can claim as its difference.
2. **DSH's fast path is the most transferable idea.** Later events on a subscribed thread go to the owning worker without an Eval; the router sees only first events and hand-backs (§2.2). Adopt it for #2487.
3. **Neither product judges worker progress.** DSH's watchdog is a service health check run from another profile; sig's is heartbeats plus a silence-and-idle-CPU stall rule (§2.3, §3.3). #2488's loop and drift detection has no reference implementation here.
4. **Both treat human attention as the budget** (DSH's philosophy doc, sig's three allowed message sources and daily cap). That is the acceptance bar for #1784.
5. **Neither has what cairn's differentiation should rest on**: a merge gate bound to the judged patch and model-checked, eval-gated harness changes with a protected ruler, and per-task containers (§6).
6. **Do not build a cairn layer on DSH plugins now**; reach DSH through ACP as one more runtime (§7).
7. **Not done in this walk**: the live GitHub loop of the super-agent, any DSH model turn, and a sig deploy. They are blocked on an agent GitHub account, a working DeepSeek provider and Cloudflare credentials, all ian's (§8).


## 1. What was run

| Step | Result | Label |
| --- | --- | --- |
| Install `@deepseek-ai/dsh@0.2.1-rc.3` into a scratch prefix (`--ignore-scripts`), separate `DSH_HOME`; ian's global DSH 0.2.0 untouched | `dsh --version` prints `0.2.1-rc.3` | measured |
| Build the prototype bundle (`pnpm install --ignore-scripts`, `pnpm build`), create the `superagent` profile from the Web template, `dsh plugin --profile superagent add link:<checkout>` | Bundle builds in ~2 s; profile loads it | measured |
| `scripts/dsh-superagent start` (tmux session, port 3082) | Runtime ready; health shows every effect kind `ready`, `github: paused`, exit code 3 "waiting for setup: The GitHub Source names no repository" | measured |
| Open the panel: Overview, Settings → Sources, Settings → Eval | Screenshots 01–04 below | measured |
| Prototype test suite on its simulated DSH host (`pnpm exec vitest run`) | 59 files, 1197 tests pass in 14.5 s, including the fan-out, hand-back, resume and stop cases quoted in §2.2 | measured |
| A plain DSH Web profile on a scratch git repo (port 3083), one task: fix `add()`, add a `node:test` test, commit, then review with one subagent | Did not run: the model provider configured on this Mac refused `deepseek-v4-pro` (HTTP 404 "not supported by any configured account in this group") and returned "Upstream service temporarily unavailable" for `deepseek-v4.1-flash` through five retries. Screenshot 05 | measured |
| Live GitHub loop: allowed person mentions the agent on an Issue, Ticket, worker, PR, review comment fan-out | Not run. It needs a dedicated agent GitHub account (the Source drops every comment whose author is the agent login, `src/sources/github.ts:227`, `:397`, so ian's account cannot be both requester and agent) and a working model provider. Both are ian's to provide (§8) | read |
| sig | Read only; see §3 for why it was not deployed | read |

Screenshots (`docs/research/assets/dsh-sig-walk-2026-11/`):

- `01-overview-setup.jpg`: Overview before setup. Only two blocks, both actionable: "Deployment check failed; dsh-superagent takes no work" and "No one may originate work: the lists on every Source are empty". Healthy parts take no space.
- `02-settings-sources.jpg`: the GitHub Source card: repository, agent CLI wrapper, four receive-all switches (new Issues, new PRs, comments, default-branch CI), all off by default.
- `03-settings-eval-policy.jpg`: Policy version hash, two default accept rules ("Copy fixes", "Visual fixes"), per-Source allowed list and bot list, and the admission table (receiving scope × on/off list × addressed/not).
- `04-settings-eval-mode.jpg`: accept mode Off / Observe (default) / Auto, Eval time limit 120 s, assessor model override.
- `05-dsh-session-provider-retry.jpg`: the plain DSH session stuck in model retries.


## 2. DSH super-agent

The prototype is a DSH *bundle* (three Cordis plugins plus a panel) for **one GitHub repository** on **one host**, with an optional Feishu Source (`README.md`, `docs/006-deployment.md` "What runs"). Its own README says it is research code, and that some designs in the companion article *Exploring Super-agent Design* "are directions for future development and are not implemented in this prototype". That article was not found online during this walk; the claims about it in #2487 and #2488 come from secondhand coverage. Everything below is the prototype as shipped.

### 2.1 Router and dispatch (slow path)

- **Domain** (read, `docs/001-domain.md`): Source → Trigger → Thread → Eval → Decision → Ticket (with an immutable Mandate) → Assignment → Executor; replies leave through a Channel. Only the Engine writes Triggers, Threads, Decisions, Tickets and Assignments (`docs/007-architecture.md` "One writer per state").
- **Gate, then model.** Eval has a deterministic gate (who sent it, did it address the agent, admission table, bot list) and a model assessment by the **main Session** (`orchestrator` in code). An allowed person who mentions the agent is an *explicit* request, which the main Session can accept directly with `orchestrator_route`; anything *inferred* (unaddressed messages, listed bots, unlisted follow-ups) needs an assessment that judges every enabled accept rule (`docs/002-authorization.md`).
- **Proactive work is opt-in and staged.** Accept mode `off` / `observe` (default: a positive assessment is recorded as "would accept" and nothing runs) / `auto`. Screenshot 04.
- **One Eval per Thread at a time**; Triggers that arrive meanwhile batch into the next Eval. An Eval that times out is requeued twice, then recorded `unavailable` (`src/core/evals.ts`; tests "serializes evals per thread and debounces…", "counts an Eval's deadline from its delivery…").
- **Dispatch.** Accept atomically creates the Ticket, its Mandate, its Subscriptions, the acknowledgement and the first Assignment (test "records an accept with its ticket, subscriptions and acknowledgement together, or none of them"). The Executor creates one DSH Session `worker-<ticket>` and one directory per Ticket; an operator-written *prepare command* (typically `git worktree add`) fills the directory (`docs/003-execution.md`).
- **The router does not plan.** Its prompt says workers investigate and implement; it routes and replies (`prompts/orchestrator.md`). Its preset caps shell and job waits at 5 s, and a `noWait` guard refuses `sleep` and long waits so candidates are never delayed (`docs/007-architecture.md` "Presets and wait limits").

### 2.2 Fast path: Thread subscriptions

- A Ticket subscribes to the Thread it started on and to the PRs it opens. Every later Trigger on a subscribed Thread **fans out to the live Tickets as Input, with no Eval and no gate**; a person's message there is owned by that Ticket's worker, and the main Session only gets a `follow_up` notice on which it may do nothing but stop the work (`src/core/intake.ts:38-59`, `docs/002-authorization.md` "Subscriptions").
- Bot and CI messages reach live Tickets as context but never wake an ended Ticket. A person's message resumes an ended Ticket under the same Mandate, with no new Decision, unless a person stopped it (tests "delivers a person's later message on a subscribed thread to the live ticket as context, and not to Eval", "does not hand a bot's message to an ended ticket", "resumes an ended ticket on any person's message on its thread, under the same mandate and without a Decision").
- **Hand-back.** A worker hands a message back once when it is outside its scope or belongs elsewhere; it goes to a fresh Eval only after no Ticket still owns it. A worker can drop an attached Thread it finds unrelated, but not its own Threads (`orchestrator_trigger_handback`, `orchestrator_thread_unrelated`; tests under "hand-back").
- **Context follows.** A worker can subscribe to a related Issue or PR for context; that lends no authority and does not resume the Ticket (`orchestrator_thread_follow`).
- **Many-to-many.** A Thread can feed several Tickets; Correlation between Threads adds context but never routes (`docs/001-domain.md` "Rejected concepts").
- **Durability.** Every relay, launch, delivery and reply is an effect row written in the same SQLite transaction as the decision and executed after commit, with backoff and per-kind health (`src/app/effects.ts`, `docs/007-architecture.md` "Effects"). A restart resumes interrupted Assignments oldest first with a recovery note telling the worker to check git and GitHub before repeating an outside action (`docs/003-execution.md` "Restart").

### 2.3 Watchdog

What ships is a **service watchdog, not a progress judge**:

- `scripts/dsh-superagent status` exits 0 (healthy), 1 (down, duplicated or runtime error; a restart may fix it), 2 (a part such as a Source reports an error; restart will not fix it) or 3 (waiting for setup) (measured: exit 3 on first start).
- The operator creates an **hourly DSH automation task in a different profile** that runs `status`, restarts on 1 with `--respect-stop`, and speaks only on 2, 3 or a failed restart (`docs/006-deployment.md` "Hourly check"). The watchdog lives outside the process it watches.
- Inside the process, Ticket **stages** (`src/core/stage.ts`) classify what each Ticket waits for (person/delivery, person/answer, person/review, person/blocked-failed, working/queued, idle, working); the overview lists only the `person` ones. Background work after a turn gets at most 30 minutes before its jobs are killed and the Ticket reports waiting (`docs/003-execution.md` "Background work and worker slots"). Transient provider failures retry three times.
- Nothing in the prototype judges whether a worker is looping or drifting. That part of #2488 is not something the prototype can teach by example.

### 2.4 Memory

- DSH itself ships **no memory**. Memory is a default-off MCP overlay (Memorix, MCP reference memory, Engram) (`deepseek-harness/docs/user/guide/mcp-memory.md`).
- The super-agent's continuity is **structural**: one SQLite file holds Triggers, Threads, Decisions, Tickets with Inputs and Assignments, the effect queue and the outbox; each Ticket keeps its own DSH Session, which survives restarts and is resumed for follow-ups (`docs/007-architecture.md` "Persistence"). Cross-person facts ("this Feishu user is that GitHub account") are prompt text in a team skill, not a data model (`docs/001-domain.md`).
- Nothing deletes old records yet (`docs/007-architecture.md` "Persistence").

### 2.5 Devices and pairing

- The super-agent runs on **one host as the operator's OS user** with `danger-full-access` presets; account wrappers choose credentials but are "not a security boundary" (`docs/003-execution.md` "Execution variables", `docs/006-deployment.md` "Permissions and isolation"). There is no multi-machine pairing.
- DSH reaches other machines through SSH workspaces (`packages/ssh`: `fs-ssh`, `sandbox-ssh`, `subprocess-ssh`) and can be published behind a reverse proxy with a launch token (`docs/user/guide/public-deployments.md`). Process confinement is Seatbelt / bwrap / Landlock "same-world only" (`packages/sandbox/README.md`).
- So the "cloud loop plus your own machines" reading in the video is sig's shape, not this prototype's (inferred).

### 2.6 UI

- The panel is a plugin page inside the DSH Web app, built on DSH design tokens. Tabs follow the pipeline: Overview, Source, Trigger, Eval, Execution, Settings (`docs/005-panel.md`; screenshots 01–04).
- It answers three questions in order: does anything need me now, is the system healthy, what is the history of one piece of work. Principle 6 is "Quiet by default: healthy states take no extra space" (measured: the empty-state overview shows only two red, actionable rows).
- Every setting is versioned with a save history; prompts are editable per part with "Default updated" diffs after upgrades (`docs/004-prompts.md`).

### 2.7 Communication: attention as the budget

`docs/000-philosophy.md`: "Take as little human attention as possible, and give as much value as possible." The worker acknowledges a request once (≤100 words), stays quiet while working, and writes again only for a result, a decision or a failure; questions are structured, one at a time (`prompts/replies.md`). Every GitHub message starts with a disclosure line (`docs/004-prompts.md`).

### 2.8 Merge

The host has no merge logic. The worker never enables auto-merge as the agent account; the default Delivery requirements allow auto-merge only for its own PR, when ready, with approvals covering the head commit, and under 200 changed lines, and withdraw it before pushing again (`docs/003-execution.md` "Merging"). Enforcement is left to GitHub branch protection.


## 3. sig

sig is a personal agent ("steward") that runs as one Cloudflare Worker with one SQLite-backed Durable Object, plus a "connector" daemon on each of the owner's machines that drives pi or Claude Code (`README.md`). This is the "resident router in the cloud plus your own machines" shape the video describes.

**Why it was read, not deployed.** It needs no payment: its deploy guide expects one Worker and one Durable Object to idle far below Cloudflare's paid minimums, with the model as the real cost (`docs/deploy.md` "Costs"). A deploy does need four things only ian can do: authorize a Cloudflare account, choose a login password of at least 15 characters (`.dev.vars.example`, `package.json` `cloudflare.bindings`), paste a model API key in its Settings, and sign in. Local `wrangler dev` needs the same password and key. This walk stopped at those credential steps (§8). Paths below are relative to the sig checkout.

### 3.1 Router and dispatch

- The steward is a single never-ending pi-durable session. Plain code holds derived state, done cards and fallbacks; the model handles judgment calls (`docs/design/steward.md` §0.2, §4.1).
- Nearly every owner message is a model run (`apps/steward/src/steward.ts:3327`). Three paths skip the model: fixed chat commands (`apps/steward/src/dispatch.ts:15-27`), card button callbacks, and quoting a card whose worker question is open, which relays the answer straight to the worker (`steward.ts:3293-3300`).
- Routing signals, strongest first: explicit reply or quote, mention, semantic match (SQLite FTS, no vectors), recency. `find_threads` returns at most 12 candidates. A `beforeTool` hook allows an attach only when it is explicit, or high-confidence with a single candidate; anything else becomes `ask_user` (`steward.md` §3.1–3.3).
- Continuing an existing session or starting a new one on the same branch with a handoff brief is a code rule (`decideContinuation`, `apps/steward/src/handoff.ts:54`). So is machine choice: named machine, then the Thread's last machine, then online, then most free slots; a tie goes to the owner (`dispatch.ts:44-60`).
- A self-check runs a corrective turn when a reply claims a dispatch that no `start_worker` call made (`apps/steward/src/wake-text.ts:212-226`).
- **Routing eval** (`docs/routing-eval.md`): 106 labelled cases (11 should-ask). Thresholds: wrong route under 2%, missed ask under 3%, unnecessary ask under 15%. It is a required merge check for changes to the prompt, tools, candidate search or model. The deepseek-flash baseline of 2026-10-17 passed 88.7% in both runs.

### 3.2 Fast and slow paths

- There is no model-free path for a *new instruction* to a running worker: it goes through the model (`send_to_worker`, `steward.md` §4.3). The model-free paths are the quote-reply relay and, per ADR-0011, a browser subscribed to a session view sending `send` or `interrupt` straight to that worker.
- Worker events are tiered (`apps/steward/src/ledger.ts:2197-2291`): `started`, `progress`, `lost` and `resumed` never wake the model; a done report wakes it at normal priority for bookkeeping only (the owner's card is a code template); `blocked` or `needs_decision` wake it at high priority, and after 90 s the question is forwarded verbatim. Wakes merge over 3 s; external activity merges over 10 minutes.
- A daily budget cap (`DAILY_BUDGET_USD`, default $1) stops event, routine and follow-up wakes past the cap. Owner messages, done cards, fallback pushes, digests and stall or machine notices continue (`apps/steward/src/budget.ts:10-29`, `steward.ts:3648-3665`).

### 3.3 Watchdog and liveness

Two layers, both code, no model:

- **Connector**: application heartbeat every 25 s with a 60 s pong timeout (`apps/connector/src/client.ts:59-60`); reconnect backoff 1–60 s. A stall watchdog counts a worker as stalled only when it has been silent 8 minutes **and** its whole process tree used about no CPU; first strike respawns, second settles `error:stall` (`apps/connector/src/watchdog.ts`). Auto-resume after a transient loss at most twice an hour, then `broken`.
- **Steward**: `sweepWorkers` every 60 s sends one stall notice after 20 minutes of silence and reaps a worker after 10 minutes offline or 45 minutes silent while online (`steward.ts:228-231`, `:2771`). Commands must be acked within 15 s and are marked ambiguous on reconnect rather than blindly re-sent (`docs/design/connector-do-protocol.md` §4.2). A machine-offline notice is debounced 2 minutes and sent only when in-flight work is affected (`apps/steward/src/machine-status.ts:14`).

Like DSH, nothing judges whether a worker loops or drifts; the stall rule is silence plus idle CPU.

### 3.4 Memory

- The Durable Object's SQLite holds the ledger: machines, repos, Threads with FTS and five versions of each summary, workers, reports, timeline, questions, routines, follow-ups, notes, usage and PR consent (`apps/steward/src/schema.ts`; `steward.md` §2.2). pi-durable compacts the conversation; "the ledger is the real memory".
- Notes have three layers: resident (2,400 characters, rendered into every turn), per project (1,500 characters) and archive. Writes are propose-then-commit. Only what the owner said directly may enter the resident layer; worker-sourced or inferred notes need the owner's confirmation. Unused resident notes produce an archive-or-keep card, at most every 30 days (`steward.md` §2.3–2.5).
- Full session records stay on the machine and are streamed on request, never stored in the cloud (ADR-0005).

### 3.5 Device pairing

- An 8-character single-use pairing code, valid 10 minutes, rate-limited. The connector then holds an HMAC bearer token `st1.<keyId>.<deviceId>.<epoch>.<issuedAt>.<mac>` with 0600 permissions. Revocation bumps the device epoch and closes the socket with 4403; a newer connection closes the older one with 4409 (`connector-do-protocol.md` §3.4, §5; `packages/protocol/src/closeCodes.ts:6`).
- Repos are registered only from the web Machines page. Isolation (worktree or in-place), concurrency and approval are local settings written only by `sig repo-config`; commands from the steward that carry them are rejected (`apps/connector/src/cli.ts:607-613`). The model has no registration tool.

### 3.6 Isolation and merge

- No sandbox. Write tasks get a per-task git worktree on branch `sig/<thread>-<n>`; read-only tasks run in the repo with a restricted tool set. pi runs with approvals unless the repo is approved; Claude Code always runs with `--dangerously-skip-permissions` (`apps/connector/src/claude-adapter.ts:190`; `docs/design/connector-pi.md` §8, §13).
- A done card with unpushed commits asks the owner for PR consent; only that path pushes and runs `gh pr create` (`apps/connector/src/pr.ts`). sig never merges.

### 3.7 UI and attention

- `/app` is a plain HTML workspace with no frontend build: one continuous conversation, a Threads sidebar, a "Needs you" view (questions, PR consent, offline dispatches, memory asks), Machines and pairing, today's spend, and per-Thread session records with direct send and interrupt (`apps/steward/ui/workspace.html`; ADR-0004, ADR-0005, ADR-0011).
- Only three things may message the owner: code templates, explicit `notify_user` / `ask_user` calls, and the final text of a run the owner started. Ordinary model text in event-driven runs is discarded. A wake defaults to `no_action`, and any proactive action must name its source, which the tool checks (`steward.md` §0.3–0.4, §6.2; `docs/spec.md` §7.6).


## 4. Comparison with cairn

cairn column: `apps/server/src/services/` (chief, machines, builds, memory), `apps/daemon/src/` (claim loop, orb), `.claude/skills/verify-*` (TLA+), `integration/eval/`. Where cairn has nothing, the cell says so.

| Concern | DSH super-agent prototype | sig | cairn today |
| --- | --- | --- | --- |
| Router | Main Session (`orchestrator`) on one host; deterministic gate then model assessment per Thread; never plans | One never-ending pi-durable steward in a Durable Object; model run per owner message; code rules for continuation and machine choice | Chief / coordinator conversation in the server (`chief.ts`, `chief-tools.ts`, `chief-turns.ts`) |
| Unit of work | Ticket with immutable Mandate (Policy version, scope, strength, matched rules) | Thread with workers | Todo / build with steps, plan documents, merge routes |
| First event (slow path) | Eval: gate + assessment, one per Thread at a time, batched | Model routing with ≤12 candidates; attach only when explicit or single high-confidence, else ask | User message → `chiefMessage` row → a `chief` step a daemon claims (`chief.ts:411`, `:495`); chief wakes only on watched todos entering confirm, review, done or failed (`chief.ts:625`) |
| Later events on the same work (fast path) | Subscription fan-out to the Ticket's worker, no Eval; hand-back, unrelated, context follow | Only quote-reply relay and direct session send; new instructions go through the model; worker events tiered so progress never wakes the model | Partly. In the product, a 60 s poller steers PR review comments into the owning build (`pr-feedback.ts`), and CI failures and merge conflicts enqueue a fix step on that build (`ci-loop.ts:944`, `:337`), with no chief turn. Missing: subscriptions as a record, webhooks, hand-back, context follows, chat topics, and the dev-workflow coordinator sessions, which still relay these events by hand (#2487) |
| Watchdog | `status` exit codes plus an hourly automation task in another profile; Ticket stages; 30-minute background cap | Connector heartbeat 25/60 s and stall rule (8 min silent + idle CPU); steward sweep every 60 s; command acks | Scheduler tick sweeps (`scheduler.ts:484-493`): machines offline after 150 s, claimed steps without a heartbeat for 120 s released, zombie todos, quota waits, failed retries; `CI_FIX_ROUNDS_MAX` caps CI fix loops; step claim and stop modelled in TLA+ `StepClaim` (#2488) |
| Progress / drift judge | No | No | No (#2488) |
| Memory | None in DSH (MCP overlay, default off); structural state in SQLite; one Session per Ticket | Ledger in DO SQLite; three-layer notes, propose-then-commit, owner confirms inferred notes | `agent_memory` entries injected into the chief and worker prompts by scope (`memory.ts:61`, `chief.ts:873`, `machine-claim.ts:212`); pending `memory_candidate` rows; issue-fence text refused; a memory-regression bench |
| Devices / pairing | Single host; SSH workspaces in DSH | Pairing code → HMAC device token with epoch; revoke closes 4403 | Daemon per machine. Enrollment by API key, or a device-code-like browser approval (`enroll/start` → owner confirms → `enroll/poll`, 10-minute TTL, `routes-machine.ts:181-235`); machine bearer token afterwards; credentials issued per step (`credentials.ts`) |
| Isolation | Operator's OS user, `danger-full-access`; per-Ticket directory via prepare command | User's shell; per-task git worktree; Claude Code with permissions skipped | With `CAIRN_EXECUTOR=orb`: one nspawn container per build conversation, cloned from a base image, user namespace, own network zone with proxied egress, idle stop 20 min, removal 72 h (`orb/provider.ts:168`, `:245`, `orb/lifecycle.ts`, `scripts/ops/orb/cairn-orb.nspawn`). Otherwise `HostOrbProvider` runs on the host unisolated (`machine-loop.ts:292-296`) |
| Merge | Prompt text plus GitHub branch protection; agent never self-enables auto-merge | Owner consents to each PR; never merges | Evidence-bound gate: verdicts bound to `headSha`/`patchDigest`, merge pinned to judged commit, routes per ADR 0028, TLA+ checked |
| Harness eval | No eval of routing or harness changes; DSH has a benchmark runner for coding tasks (`BENCHMARK.md`) | Routing eval (106 cases) as a required check for router changes | Paired-trial adoption judge, trajectory packs, about ten benches, harness-eval merge route; ruler is a protected path (spec 29 E0–E2, ADR 0025). The self-optimizing loop (E3, E4) has no tickets yet |
| Attention | Ack once, quiet while working, panel shows only what needs a person | Three allowed message sources; event runs default to no action; daily budget cap | Phase entries notify and push through `notifyPhaseEntry` (`todos.ts:77`) and `thread-push.ts`; `notify_user` is in-app only; push digest slots and an 08:00 chief digest exist (`scheduler.ts:494-507`, `chief-digest.ts:28`) (#1784) |
| UI | Plugin panel in DSH Web: Overview / Source / Trigger / Eval / Execution / Settings | Plain HTML workspace: conversation, Threads, Needs you, Machines, spend, session records | Board, chief panel, task views |


## 5. What cairn should adopt

Ordered by value to cairn. Each item names its ticket.

1. **Thread subscription fast path → #2487.** cairn's product already steers polled PR comments, CI failures and conflicts into the owning build without a chief turn (§4). What it lacks is the general mechanism, and the day-long relaying #2487 describes happened in the dev-workflow coordinator sessions, outside that path. Adopt DSH's model nearly as is: a subscription between a cairn thread and its PR, issue and chat topic; later events go straight to the owning worker as input; the coordinator sees only first events, hand-backs and stop requests. Take these rules with it, each with a test, because the prototype has a test for each (§2.2): a person's follow-up is owned by the worker and gets no coordinator turn; bot and CI events reach a live worker but never resume an ended one; a person's message resumes an ended thread under its original authorization unless a person stopped it; hand-back happens once per message and only after no other thread owns it; context follows grant no authority. Add sig's tiering on the same path: progress events never wake a model; questions wake at high priority and are forwarded verbatim after a timeout (§3.2).
2. **Watchdog session → #2488.** Neither product judges progress, so cairn designs this part itself. Take from them: run the watchdog outside the process it watches (DSH's hourly check in another profile, §2.3); classify each thread by what it waits for, first matching row wins, as DSH's stage table does; detect a stall by silence **and** an idle process tree, not silence alone (sig, §3.3), which avoids flagging long builds; say nothing when healthy.
3. **Quiet by default → #1784.** Use DSH's "attention is the budget" rule and sig's three allowed message sources as the acceptance criteria: one acknowledgement, silence while working, a message only for a result, a decision or a failure; event-driven runs default to no action; every proactive message names its source. Add sig's daily model budget cap, under which owner messages and needs-human notices still go out.
4. **Durable effects (no ticket yet).** DSH writes each relay, launch, delivery and reply as a row in the same transaction as the decision and runs it after commit, with per-kind health that reports only after three consecutive failures (§2.2). Check cairn's dispatch and notification paths against this before #2487 adds more relays.
5. **Observe-first rollout for proactive work (no ticket yet).** DSH's `observe` accept mode records "would accept" without acting (§2.1). cairn could use the same staging for any new autonomous trigger, such as the watchdog acting rather than only flagging.
6. **Device revocation by epoch (no ticket yet).** sig's epoch bump with a 4403 close kills a stolen device token at once (§3.5). Compare with cairn's machine token revocation; this touches a security surface (`routes-machine.ts`), so it needs its own security review.

Not adopted: DSH's single-host, operator-user execution and prompt-text merge rules, and sig's per-PR owner consent, all of which cairn replaces with orbs and the evidence-bound gate.


## 6. Proposed differentiation rewrite

Spec 18 §1 still states the thesis as "two hard gates + AI review with teeth + versioned plan documents", and §3.4 withdraws the chief from the differentiation pillar. Since then ADR 0026 and ADR 0028 replaced the human merge gate with machine trust, and this walk shows two shipped products with cairn's routing shape. A resident router over isolated workers on the user's own machines is now table stakes (inferred from §2 and §3). The proposal below is for ian to accept or edit; neither spec 18 nor the plan's §1.1 is changed in this PR.

**Proposed thesis (replaces spec 18 §1 and the plan's §1.1 lead):**

> cairn is a self-hosted agent team whose output is trusted because of how it lands, not because of who routed it. Three things carry that trust, and neither DeepSeek Harness's super-agent nor sig has them:
>
> 1. **An evidence-bound merge gate, model-checked.** A merge is allowed only for the exact patch a verdict judged: verdicts bind to `headSha` and `patchDigest`, a stale or repeated verdict never satisfies the gate, and the REST merge is pinned to the judged commit. TLA+ models (`MergeGate`, `LocalLanding`, `RepeatedVerdict`, `ReviewHeadCausality`, plus `StepClaim` for who may run a step) are checked by TLC with negative controls. DSH leaves merge rules to prompt text and GitHub branch protection (§2.8); sig asks the owner for PR consent and never merges (§3.6).
> 2. **Harness eval and self-evolution under a ruler the agents cannot edit.** A change to prompts, skills, tools, context or routing is adopted only when a code judge on paired trials says it helps (`integration/eval/adoption/judge.mts`), every build leaves a trajectory pack, rejections feed the bench, and the ruler itself is a protected path (spec 29, ADR 0025). The self-optimizing outer loop (spec 29 E3, E4) is not ticketed yet, so the claim today is eval-gated change, with self-evolution as the stated next step. sig's routing eval is the closest analogue, a fixed 106-case merge check on one surface; DSH has a coding benchmark runner but nothing that gates harness changes.
> 3. **Per-task isolation that is a real boundary.** With the orb executor, each build conversation runs in its own orb, an nspawn container on omarchy (`apps/daemon/src/orb/provider.ts`), rather than as the operator's OS user. The orb executor is opt-in today (`CAIRN_EXECUTOR=orb`); making it the default where it is available is what lets this pillar hold. DSH's workers run with `danger-full-access` and its docs call the wrappers "not a security boundary"; sig runs Claude Code with `--dangerously-skip-permissions` in a worktree.
>
> The router (chief/coordinator), the daemon and pairing are necessary plumbing, and cairn should match the best existing designs there (§5) rather than claim them as differentiators.

**What changes against spec 18:**

| Spec 18 item | Today | Proposed |
| --- | --- | --- |
| P1 thesis | Two hard gates, AI review with teeth, versioned plans; scarcity against Multica and todos | The three pillars above; scarcity checked against DSH super-agent and sig as of 2026-11-01 |
| P3 semantic axis | Human Confirm and Review gates | Machine-verified gate (ADR 0026/0028) plus eval-gated harness changes; human gates remain where the route sends work to ian |
| P5 not aligned | Multica's three tenets | Add: "workers as the operator's OS user" (DSH, sig) and "merge rules as prompt text" (DSH) |
| P6 chief | Withdrawn from differentiation, survival by measurement | Unchanged in substance; its measurement now includes the slow-path share once #2487 lands |
| Maintenance trigger | Multica adds gates or todos goes self-hosted | Add: DSH or sig ships a merge gate bound to judged patches, a protected eval ruler, or per-task containers |

Sources for the rewrite: §2.5, §2.8, §3.6 of this document; `.claude/skills/verify-merge-gate/SKILL.md`; `docs/spec/29-evaluation-and-data-loop.md`; ADR 0021, 0025, 0026, 0028; `docs/research/amp-native-sandbox-orb.md`.


## 7. Should cairn build on DSH's plugin system?

**Recommendation: no cairn layer on DSH's plugin system now. Treat DSH as one more agent runtime the daemon can drive, through ACP.**

- **Stability.** DSH calls itself a developer preview with "compatibility-breaking changes" (`deepseek-harness/README.md`). The super-agent bundle pins `engines.dsh ^0.2.1-alpha.2` and lists "the agent's profile on its own pinned DeepSeek Harness installation" as an open question (`docs/007-architecture.md` "Open questions"). Measured on this Mac: ian's installed 0.2.0-rc.2 was already outside the bundle's range, and the bundle's `link:` install printed unresolved peer-dependency warnings for at least 23 DSH packages. cairn's seam discipline (`biome.json`, `apps/daemon/src/backend/`) exists to keep a moving dependency behind one thin bridge; a Cordis plugin layer inverts that, making DSH the host and cairn the guest.
- **Shape mismatch.** A DSH bundle is single-host and runs as the operator's OS user with `danger-full-access` (§2.5). cairn's value is in the server-side gate, the multi-machine daemon and per-task orbs, none of which a DSH plugin can provide.
- **What fits instead.** DSH ships an ACP server (`deepseek-harness/packages/acp`: create, resume and close sessions, attach MCP servers, answer permission prompts over JSON-RPC stdio). cairn's #1607 research already recommends one ACP client bridge for externally installed CLIs (`docs/research/1607-acp-execution-surface.md` §0). DSH can be a candidate on that list once the ACP bridge exists, so DeepSeek models run under cairn's gate, orb and eval like any other runtime.
- **Reopen the question** when DSH leaves developer preview and the super-agent's open question about pinned, isolated profiles is resolved.


## 8. Gaps in this walk

| Gap | Why | What unblocks it |
| --- | --- | --- |
| DSH super-agent live GitHub loop (mention → Ticket → worker → PR → review comment fan-out → hand-back) | Needs a dedicated agent GitHub account; the Source ignores comments authored by the agent login, so one account cannot be both requester and agent | ian creates a machine account with write access to a private scratch repo and signs a `gh` wrapper in with `GH_CONFIG_DIR`; then rerun §1 with a working model |
| Any DSH model turn | The model provider configured on this Mac refused `deepseek-v4-pro` and was unavailable for `deepseek-v4.1-flash` on 2026-11-01 | ian checks or replaces the DeepSeek provider configuration |
| sig deploy | Needs a Cloudflare login, a login password, a model key and sign-in, all ian's | ian does those four steps; the walk then pairs this Mac as a connector and runs one read-only and one write task |
| The *Exploring Super-agent Design* article | Not found online on 2026-11-01; the progress-judging watchdog it reportedly describes is not in the prototype | A link to the article |

The scratch state of this walk lives outside the repository under `/tmp/walk2489` (separate `DSH_HOME`, scratch git repo, tmux session `dsh-superagent` on port 3082) and touches no real repository or data.

