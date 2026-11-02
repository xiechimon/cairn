# Pi Durable spike: adopt it for the Coordinator, or keep D70 C2–C4?

> **Question.** Should cairn's Coordinator run on Earendil's Pi Durable (`@earendil-works/pi-durable`) instead of the server-owned context built in D70 C2 (#2635, rolling summary) and C3 (#2637, server-assembled turns), with C4 (model switch) still to come?
>
> **Background.** D70 (2026-11-02) put the Coordinator on Pi with server-owned context, after Rakazo. C1 (#2628) and C5 (#2632) followed; C2 and C3 are open and C3 carries `coordinator-hold`. ian paused C3/C4 for this comparison. D56 (2026-11-01) had already decided against moving the Coordinator onto pi-durable, citing the step claim protocol and the experimental API; this spike re-checks that with measurements.
>
> **Method.** Measured 2026-11-02/03.
> - Sources: the two Earendil posts, Cloudflare's and Vercel's Pi harness docs, the `@earendil-works/pi-durable` 1.4.0 and 1.5.0 package sources, open issues on `earendil-works/pi`.
> - A throwaway prototype outside the repo (`/tmp/pd-spike/proto`): pi-durable 1.4.0 (cairn pins the `pi-*` packages at 1.4.0), Node SQLite storage, pi-ai's faux provider as a stub model. Installed with scripts disabled. The lockfile was not changed.
> - The production Coordinator thread `chief-01a199d6-…` from a read-only backup (`sqlite3 … ".backup"`): 7,105 rows, 6,431 of them conversational, 272 user turns, 2026-09-30 to 2026-11-02.
> - Summaries and recall answers from `claude-haiku-5-5` via `claude -p` (the D67 Coordinator model). Every other model call used the stub.
>
> Tags: **measured** = output produced or source read in this spike; **inferred** = derived from measurements, checkable. Untagged lines describe sources.

## 0. Recommendation

**Keep C2 + C3 (merge them, then push C4), and borrow three designs from Pi Durable. Do not adopt the package now.**

The three borrowed designs, each a small change to the D70 path:

1. Compaction on the old model before a model switch, and chunked summarizing when the new window is smaller (§4). Pi Durable does neither automatically.
2. A per-tool replay rule for Coordinator turns cut off by a daemon crash: read tools rerun, dispatching tools come back to the model as "interrupted and may have partially run" (§2).
3. An idempotency key per submission (`requestId`), already planned in #2501 (D56).

Not borrowed: Pi Durable's summary template. On old decisions, C2's prompt recalled 3.5 of 6 and Pi's built-in template 0 of 6 (§1.3). C2 keeps its prompt, with one fix: keep ian's verdicts verbatim.

Why not adopt (details in §1–§6):

- **Placement conflicts with D69 and D70.** Pi Durable's storage has exactly one owner process, and that process also makes the model calls. Server-hosted breaks D69 (no model SDK on the server); daemon-hosted moves the Coordinator transcript off the server, against D70 ①, and strands it when the Coordinator is re-bound to another machine, as on 2026-11-02. The only clean fit is a server-backed `Storage` over the machine protocol: new protocol surface on the owner route, with every commit a round trip (inferred).
- **Defaults are wrong for this thread.** On Haiku 5.5 (1M window in pi-ai's registry) the default policy averages 405k context tokens per turn on this thread, against 27.5k for C2 + C3 (measured, replay). Tuned to compact near 70k it averages 43.9k, still 1.6× C3 (measured, replay).
- **The summarizer is single-shot.** Everything before the cut goes into one summarization request on the conversation's current model. Switching to a model whose window is smaller than that prefix fails the turn with `Compaction failed: … prompt is too long` (measured). Importing today's history raw would need a 583k-token summarization request (measured, replay).
- **Not production-stable.** Marked experimental; 6 of the 9 releases after 1.0.0 (2026-10-01) carry breaking changes (measured, CHANGELOG); no conversation delete (#11026), no tool approval (#10852), CJK token underestimate in compaction (#10583).
- **Its summaries forget a Coordinator's decisions.** On six questions about old decisions, Pi's built-in summarizer prompt recalled 0, C2's 3.5 (measured, §1.3). Adopting Pi would mean overriding its summarizer through `beforeCompact` anyway.
- **The wins are already covered or not needed.** Crash resume is covered by the step claim protocol plus item 2 above; forks and multi-conversation concurrency have no Coordinator use under D65 and D70 ③ (§3).

Revisit when any of these holds: Pi Durable drops "experimental" and keeps a minor version without breaking changes for a month; cairn needs runtime-level forks or multiplayer steering of the Coordinator; or D69's executor/server split changes.

## 1. Context and compaction

### 1.1 What each design sends

| | C2 + C3 | Pi Durable |
|---|---|---|
| Summary | Background step folds the oldest 50 rows when ≥100 are uncompacted; 40k-char transcript cap per batch; summary ≤20,000 chars; never takes a user turn | Background task when context > `window − reserveTokens − backgroundTokens`; blocking above `window − reserveTokens`; summarizes everything before a cut that keeps `keepRecentTokens` verbatim; no length cap beyond `maxTokens = min(0.8 × reserveTokens, model.maxTokens)` |
| Summarizer model | Whatever runs the digest step (Haiku) | The conversation's current model; a `beforeCompact` hook can supply a summary instead (measured, `harness/compaction.js`) |
| Defaults | fixed | `reserveTokens` 16,384, `keepRecentTokens` 20,000, `backgroundTokens` 32,768, per-model `modelOverrides` (measured, `harness/agent.js`) |
| Raw tail | Newest ≤100 uncompacted rows, each capped at 8,000 chars; tool calls as `[called name {args≤200}]`, tool results dropped | Every entry since the head verbatim, including full tool results |
| Summarizer input | The rendered rows | Serialized transcript, tool results cut to 2,000 chars, thinking dropped, previous summary first |
| Token estimate | CJK-aware (`estimateTokens`) | Provider-reported usage of the newest response plus `chars/4` for the rest; #10583 reports CJK undercounting |

### 1.2 Tokens per turn on the production thread (measured, replay)

Replay of all 6,431 conversational rows, sampled at the first request of each of the 272 user turns, with the same estimator (C3's CJK-aware one) for every variant, a fixed 6k system prompt and tool definitions, and the summary sizes measured in §1.3 (C2 11.9k tokens, Pi 5.6k). Logs: `tokens-measured.log`; `tokens.log` is the same replay with guessed sizes (7k/3k), which moves no conclusion. Tool rounds inside a turn add the same tool results to both designs and are not counted. Script: `/tmp/pd-spike/sim/tokens.py`.

| Variant | Mean | Median | p95 | Max | Newest turn | Compactions | Largest summarizer input |
|---|---|---|---|---|---|---|---|
| C2 + C3 | 27.5k | 24.5k | 54.1k | 88.6k | 67.9k | (C2 folds every 50 rows) | ≤40k chars per batch |
| Pi Durable defaults, Haiku 5.5 (1M) | 404.5k | 403.7k | 875.1k | 948.7k | 115.9k | 9 | 583k |
| Pi Durable defaults, a 200k model | 75.9k | 74.3k | 141.0k | 149.8k | 115.9k | 49 | 170k |
| Pi Durable tuned: blocking 100k, background 70k | 43.9k | 39.0k | 68.2k | 142.7k | 39.3k | 100 | 139k |
| Tuned, tool results capped at 8k chars | 46.5k | 42.4k | 70.0k | 142.7k | 39.3k | 78 | 137k |

- C3's own measurement (#2637: 54.7k tokens for the newest 100 rows) matches the replay's newest turn, 67.9k including the system prompt and summary (measured).
- Over the thread's 272 turns: C2 + C3 sends 7.5M context tokens, Pi Durable defaults on Haiku 110.0M, tuned Pi 11.9M (measured, replay). At pi-ai's Haiku 5.5 list price ($0.10 per million input, $0.01 cached), that is $0.75 vs $11.00 uncached, or $0.08 vs $1.10 fully cached (inferred). The money is small on Haiku; the gap is 15× and grows with any larger model, and time to first token grows with context.
- The gap between tuned Pi and C3 comes from tool results: Pi keeps them verbatim in the raw tail; C3 keeps only the call line and lets the model fetch details with `read_history`. One tool result in this thread is 3.89M chars (measured).

### 1.3 Recall of old decisions (measured)

The rows from 2026-10-13 to 2026-10-27 (1,154 conversational rows, 15 days, the oldest busy stretch after the test traffic) were folded into one summary by each design, with `claude-haiku-5-5` via `claude -p`. Then Haiku answered six questions about decisions in that stretch from the summary alone (the raw rows are outside both designs' windows by then). Ground truth comes from the raw rows; scoring 1 / 0.5 / 0. Scripts: `/tmp/pd-spike/sim/recall_*.py`; answers: `/tmp/pd-spike/recall/{c2,pi}_qa.json`.

- **C2 arm**: the exact #2635 prompt and limits (50-row batches, 40k-char transcript cap, previous summary + new rows, 20,000-char cut). 47 calls, 68 min sequential, 764k output tokens. Final summary 19,280 chars (11.9k tokens).
- **Pi arm**: Pi Durable 1.4.0's own `SUMMARIZATION_SYSTEM_PROMPT` and `SUMMARIZATION_PROMPT`, copied from the package, its serializer rules (tool results cut to 2,000 chars, previous summary first), and the chunking of the tuned policy (a compaction every ~50k tokens of context). 37 calls, 30 min, 316k output tokens. Final summary 18,039 chars (5.6k tokens); it has no length cap.

| Question (ground truth) | C2 | Pi |
|---|---|---|
| Q1 ian's verdict on #72 / pacman#1277 (B: a diverged branch with commits fails to a human; no union claim) | 0 — "no explicit verdict", reports a later close | 0 — "don't know" |
| Q2 ian's final instruction on #100 on 10-27 and what the Coordinator found (stop and withdraw, keep records; #100 was still a todo, nothing to cancel) | 0 — instruction missing, reports later #100 work | 0 — instruction missing, reports later #100 work |
| Q3 root cause of #89 / cairn#1671 and the two fixes (GLM-5.3 is not multimodal; switch to a vision model per step, or degrade to a text note) | 1 | 0 — "don't know" |
| Q4 how #77 was dispatched and why plan first (build 01a13603, plan mode because of the red lines on `select.tsx`, `ui/`, S3/S5) | 0.5 — build and red lines, not the plan-first reason | 0 — "don't know" |
| Q5 which project #82 belongs to (pacman-gh-probe, `HUE0hx6…`) | 1 | 0 — "don't know" |
| Q6 what #1312 describes (build cannot resume the plan session, no fallback; split same-machine / cross-machine) | 1 | 0 — "don't know" |
| **Total** | **3.5 / 6** | **0 / 6** |

Pi's template is a working checkpoint (Goal, Progress, Next Steps, Critical Context): each fold keeps what is in flight and lets finished items fall out, which suits a coding session and loses a Coordinator's history of decisions (inferred from the answers). C2's prompt asks to keep decisions, who made them, and todo/PR references, and it keeps 2.1× the tokens. Both arms lost ian's verdicts (Q1, Q2) when later events on the same todo overwrote them. One run per arm, one model; the gap is large enough that a rerun is unlikely to flip it, but the exact scores are not stable (inferred).

## 2. Crash and restart (measured)

Prototype `crash.mjs`: a SQLite-backed harness, the stub model streaming at 60 tokens/s, `kill -9` of the process mid-turn, then a new process opens the same file, resubmits with the same `requestId`, and calls `harness.resume()`. Log: `/tmp/pd-spike/crash.log`, `crash-tools.log`.

| Killed during | After restart |
|---|---|
| Model streaming | The request is sent again and the turn completes (8.6 s); the cut-off partial stays in the transcript with `stopReason: aborted` |
| A `replay: "never"` tool (`dispatch_thread`, sleeps 3 s) | The tool does not rerun; the model receives `[error] Tool dispatch_thread was interrupted and may have partially run` and answers (0.8 s). The tool ran exactly once (in the killed process) |
| A `replay: "safe"` tool (`search_history`) | The tool reruns once and the model gets its result (3.3 s). Two executions in total, one per process |
| Any of the above | Resubmitting with the same `requestId` returned the original submission id (`8`); no duplicate turn |

What cairn has today: a Coordinator turn is a step; the daemon claims it, heartbeats, and the scheduler releases an abandoned claim so another claim reruns the whole turn (D56: "step claim protocol already covers crash resume"). The difference is granularity: cairn reruns the turn, Pi Durable resumes at the last checkpoint and knows which tool calls are unsafe to repeat. With C3, a rerun turn is rebuilt from `chief_message`, so the only real risk is a dispatching tool (`run_builds`, a thread start) that ran before the crash and runs again. Borrowing the replay rule (item 2 in §0) closes that without the package (inferred).

## 3. Concurrency and forks (measured)

Prototype `fork-switch.mjs`. Log: `/tmp/pd-spike/fork-switch.log`.

- `root.fork(entryId)` created conversation 15 that sees the root's first exchange and nothing after it (2 entries vs the root's 4); a later root message did not appear in the fork.
- One harness ran a root turn and a fork turn concurrently; both answered in 14 ms with the stub.
- A fork gets a fresh provider session id, so it does not share the parent's prompt cache key (source: README).

Mapping to D65:

| D65 item | Pi Durable equivalent | Fit |
|---|---|---|
| ① a thread writes a ≤200-char report into the Coordinator stream | a `write` submission with a custom entry kind | equivalent to inserting a `chief_message` row |
| ② answer or talk to a thread directly from the Coordinator conversation, not through the model | none; this is routing to an external harness session | not a fork |
| threads themselves | D70 ③ runs threads on claude-code/codex, not Pi | forks do not reach them |
| messages while the Coordinator is busy | durable inbox; `whenBusy: "steer"` joins after the current tool round | cairn has `queued_message`; steering is new but small |

Forks would matter only if threads ran as Pi conversations inside the Coordinator's harness, which D70 ③ rules out (inferred). One fork-shaped use exists: a history-search subagent (Cloudflare sample: a child conversation owned by the `search_history` tool). C3's `read_history` / `search_history` tools cover the same need.

## 4. Model switch (measured)

Same prototype: a root conversation on a 200k stub model, then `configure({ model: small })` with a 32k window.

| Case | Result |
|---|---|
| Context 48.9k, switch to 32k | Blocking compaction on the **new** model: a 24.6k-token summarization request to `small`, then the answer. Works because the prefix fits the new window |
| Context 121.4k, switch to 32k | Summarization request of 96.6k tokens to `small` fails; the turn settles `unanswered` / `model_error` / `Compaction failed: Summarization failed: prompt is too long: 96634 tokens > 32000 maximum` |
| Same context, `root.compact()` on the old model first, then switch | Summary made by `big` (72.6k-token request); the first turn on `small` sends 24.3k tokens and succeeds |

- Pi Durable reads the compaction policy and the summarizer from the conversation's current model at each check (`compactionPolicy(settings, ref)`, `runtime.agent()`), and the summarization request uses `cacheRetention: "none"` (measured, source).
- The provider session id survives model changes (README), but a provider cache is per model, so the first request after a switch is uncached in both designs (inferred).
- D70 ② wants exactly the order that worked: compact on the old model while its cache is warm, then switch; and catch the summary up first when the new window is smaller. Pi Durable leaves that ordering to the host (call `compact()` before `configure()`), and it has no chunked summarizing, so a prefix larger than the summarizer's window always fails. C4 must do both; with C2's 50-row batches the summarizer input is already bounded (≤40k chars), so the smaller-window case cannot fail that way (inferred).

## 5. Fit with cairn's architecture

**Where a harness would live.**

| Place | What breaks |
|---|---|
| Server | D69: the server holds no model SDK; pi-ai and pi-durable (4.4 MB unpacked; in 1.5.0 five `@earendil-works` packages plus `diff` and the Photon WebAssembly image library) would enter a 1 GB VPS process with a ~384 MB heap target (measured for sizes, npm) |
| Daemon, local SQLite | The transcript leaves the server: against D70 ① ("server-owned context") and against D69's plan that the control plane holds state. Re-binding the Coordinator to another machine (done on 2026-11-02, Chief → Mac `kCB6xv`) loses or forks the conversation, since only one process may own a storage (Earendil post, Vercel docs) |
| Daemon, server-backed `Storage` | Fits D69 and D70. Needs a `Storage` implementation over the machine protocol (the interface is small and has a conformance suite), new endpoints in `routes-machine.ts` (security surface, owner route), and every commit becomes an HTTP round trip; Vercel notes the same trade-off for its log-backed storage ("each step waits for the log, so turns are slower") |
| A separate VPS or Cloudflare DO | A third place holding conversation data, a new deploy target, and the Cloudflare harness has no event replay, no delete, and a 15-minute alarm cap (Cloudflare docs) |

**Seam discipline.** `biome.json` restricts `@earendil-works/*` imports to `apps/daemon/src/backend/` behind the AgentBackend seam (measured). A Pi Durable harness fits there as a new backend (`backend/pi-durable.ts`); a server-hosted harness would need an exception to that rule, which is what D69 forbids.

**Integration cost, if adopted (inferred).**

- Dependencies: add `@earendil-works/pi-durable`; bump `@earendil-works/chord` from 1.0.4 to 1.4.0 (pi-durable 1.4.0 depends on chord 1.4.0) — a lockfile change for ian. 1.5.0 is already out with breaking changes (JSON-schema tools via `pi-schema`, a new `SqliteExecutor` method).
- Daemon: a `pi-durable` backend; Coordinator tools re-declared with `defineTool` and a replay rule each (today they are MCP tools from `mcp-config.ts`).
- Protocol: server-backed storage endpoints and claim semantics for "who owns the Coordinator storage now".
- Two transcripts: Pi's `pi_*` entries vs `chief_message`, which 18 server and web files read today (measured, grep). Either dual-write and reconcile, or move every reader to Pi's views.
- Migration of today's history: a raw import is not viable (one 583k-token summarization request on Haiku defaults, §1.2). Seed each thread with a compaction entry made from the C2 summary through a `beforeCompact` hook, plus the newest rows.
- Compaction policy: per-model `modelOverrides` for every Coordinator model, and a CJK-aware estimate until #10583 lands.

Estimate: 6–8 PRs, at least two on the owner route (lockfile, machine protocol), against the 2 already-open PRs plus C4 on the D70 path.

**Questions from the C-track session.**

| Question | Answer |
|---|---|
| Can compaction run on a cheap model? | Not by setting: the summarizer is the conversation's current model. A `beforeCompact` hook can return its own summary, so the host can call a cheap model there; the hook then owns retries and size limits (measured, source) |
| Can it pin the old model on a switch? | No automatic pinning. The host calls `compact()` on the old model before `configure()`; that order worked, the reverse failed (§4, measured) |
| Can state stay on the server? | Only through a custom `Storage` implementation (see the table above); the shipped backends are memory, JSONL, SQLite, IndexedDB and Cloudflare DO SQLite (measured, package exports) |
| One Coordinator thread per team (#2547)? | Fits: one storage per team, `harness.root()` is the single root conversation, created on first use (README). Extra conversations and forks would go unused |
| Can its numbers feed C1's meter? | Partly. `pi.usage` records input, output, cache read/write and cost per `provider/model`, compaction spend included (measured, prototype `harness.usage()`); the context size is `estimateContext` (newest reported usage plus `chars/4`), so a `contextTokens` figure would need the same CJK correction as #10583 (inferred) |

## 6. Maturity (measured unless marked)

- Released 2026-10-01 together with Pi 1.0 (Earendil post; npm `1.0.0` at 2026-10-01T19:11Z). The Cloudflare post is dated 2026-10-16. The "2026-10-31" date in the spike brief does not match either source.
- Versions: 0.0.1 on 2026-09-19; 1.0.0 to 1.5.0 between 2026-10-01 and 2026-11-02, ten 1.x releases. CHANGELOG lists breaking changes in 1.0.3, 1.0.4, 1.1.0, 1.2.0, 1.4.0 and 1.5.0.
- README: "**Experimental.** The API changes without notice between releases." Cloudflare: Pi packages are pinned per `agents` release because the API "can change in minor releases".
- Open issues mentioning durable on `earendil-works/pi`: 24, including no permanent delete of a conversation (#11026, append-only store), no tool approval or client-side tools (#10852), compaction retention miscalibrated for CJK text (#10583), handoff at the context limit ends the run (#11557), durable tasks cannot keep the conversation busy (#11332). The repo has 119k stars and was pushed the day of this spike.
- Production users found: Cloudflare (`PiHarness` in the Agents SDK, optional peer, `~1.4.0`) and Vercel (`durable-harness/pi-durable`, "recommended"). Both describe it as a harness for new agents, not a migration target.
- Blockers for cairn production use: the delete gap (cairn keeps conversation data on a public repo's product and may need deletion), API churn under a pinned-version policy, and the CJK estimate (inferred).

## 7. PR plan

### Path A — keep C2 + C3 (recommended)

1. **#2635 (C2)**: merge, with one prompt line added: keep ian's verdicts and stop/withdraw instructions verbatim with their todo number (the two questions both arms missed, §1.3).
2. **#2637 (C3)**: remove `coordinator-hold`, rebase on C2, merge (owner route: machine protocol). Then turn `CAIRN_COORDINATOR_SERVER_CONTEXT` on for the Mac Coordinator and watch the C1 meter for a day.
3. **C4 (model switch, D70 ②)**: built and reviewed in the C-track session, not yet pushed; it measured about 21k tokens for the first turn after a switch with catch-up vs about 55k without. Before pushing, check it covers this rule: before a model change, run one C2 fold on the old model if uncompacted rows exist; if the new model's window is smaller than summary + tail, fold until it fits; never send a summarizer request larger than the summarizer's window (C2 batches already bound it). Tests: the three cases of §4 against a stub, including the failing one.
4. **Coordinator replay rule**: tag each Coordinator tool read-only or dispatching; when a re-claimed turn finds a dispatching call with no recorded result, give the model "interrupted, may have partially run" instead of rerunning it. Tests: kill the daemon mid-tool in the integration harness.
5. **#2501** (D56 idempotency key on message submit) stays as planned.

### Path B — adopt Pi Durable (if ian decides otherwise)

1. Lockfile: add pi-durable 1.4.0 and bump chord to 1.4.0 (ian confirms; `CAIRN_ALLOW_LOCKFILE_CHANGE=1`).
2. Server-backed `Storage` for Pi Durable over the machine protocol, passing pi-durable's storage conformance suite (owner route, `/security-review`).
3. Daemon backend `backend/pi-durable.ts`: harness per Coordinator, tools via `defineTool` with replay rules, `modelOverrides` for Haiku/Sonnet, a CJK-aware token estimate in a `beforeCompact` hook until #10583 lands.
4. Mirror Pi entries into `chief_message` for the UI (or move readers), with a reconciliation test.
5. Migration: seed each Coordinator thread from its C2 summary plus the newest rows; keep the old rows read-only in `chief_message`.
6. Host-ordered model switch: `compact()` on the old model, then `configure()`.
7. Close #2637 and C4 as superseded; C2 stays as the seed source.

## 8. Artifacts

All outside the repo, under `/tmp/pd-spike/` (not committed): `proto/` (prototype and `node_modules`), `crash*.log`, `fork-switch*.log`, `tokens.log`, `sim/` (replay and recall scripts), `recall/` (summaries, per-call logs, Q&A).
