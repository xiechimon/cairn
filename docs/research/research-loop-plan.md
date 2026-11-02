# Research loop plan: cairn agents that look outward

Status: draft for ian, 2026-11-02. Baseline `origin/main` at `82f610499`. This document stands alone; it does not depend on any earlier plan version.

Labels used throughout:
- **[verified]**: read in the source (code on `origin/main`, a web page, a PR) during this session.
- **[inferred]**: reasoned from verified facts; can be re-checked.
- **[guessed]**: everything else, including predictions and numbers not yet measured.

## 0. Summary

- **End state.** When a cairn build gets stuck, cairn searches how others solved the problem before it retries. Plans for new mechanisms cite outside sources. Once a day, the Coordinator posts a short list of outside developments that match open work. What it learns is kept as sourced, expiring memory.
- **Today.** Claude Code build agents *can* search the web but are never asked to, and nothing records whether they did. Codex/GPT agents (pi runtime) have no search tool. The Coordinator and reviewers can read only local files. The learning loop looks only at cairn's own trajectories.
- **Recommendation.** Reuse what exists: info cards (read-only report cards) and the retry-lessons injection. Phase 1 adds a research card before the last retry of a stuck build. Phase 2 keeps its findings as sourced memory with an expiry date. Phase 3 asks plans for new mechanisms to cite prior art, first as a soft check. Phase 4 adds a daily intake card. No new server-side search or LLM calls; all outside access runs in daemon sessions behind `apps/daemon/src/backend/`.
- **Next step.** Run spikes S1 to S5 (section 8) before building anything. S2 (how often builds get stuck) decides whether Phase 1 is worth it.
- **Waiting on ian.** The decisions in section 10, mainly the trigger threshold, whether research blocks the retry, X as an intake source, and the memory promotion rule.

## 1. Problem

Agents in cairn work from training data. When something is slow or broken, they guess and retry rather than look up how others solved it. Example: CI was slow, and the fix that worked was time-balanced test sharding (merged as #2585, `TimedShardSequencer` with recorded file times). It came from posts ian happened to see:
- Owen Gretzinger, "How I made our CI 20x faster (steal this)", 2026-11-01 [verified]. The article covers bigger runners, sharding onto bigger machines and vitest `isolate: false`.
- sorrycc/Mayoi PR #102, "Make CI about 4x faster" [verified]. It includes "each shard keeps its tests' times, so the workers start the slowest first".

ian wants cairn itself, not his personal Claude Code setup, to do three things:
- (a) research on its own when it meets a problem, combining retrieval with what it already knows;
- (b) surface relevant outside developments without ian scrolling feeds;
- (c) keep what it learned, in the spirit of Hermes Agent's self-improving loop.

## 2. What cairn has today

| Area | Fact | Source | Label |
|---|---|---|---|
| Build agents, Claude Code runtime | `disallowedTools` is `AskUserQuestion` plus `Edit`/`Write` when `readOnly`; `WebSearch`/`WebFetch` are not removed | `apps/daemon/src/backend/claude-code.ts` (`SDK_ASK_TOOL`, `SDK_WRITE_TOOLS`, `buildClaudeSdkOptions`) | [verified] |
| Coordinator and review steps | Run `lockedDown` outside an Orb: built-in tools are limited to `Read`, `Glob`, `Grep` (`HOST_BUILTIN_TOOLS`) and `Bash` is disallowed. No web access | `apps/daemon/src/runner.ts` (`isChief \|\| isReview ? { lockedDown: true }`), `claude-code.ts` | [verified] |
| Build agents, pi runtime (Codex/GPT models via `openai-codex` OAuth) | Built-in tools are `read, bash, edit, write` (read-only: `read, bash`). No search tool; only `curl` through bash | `apps/daemon/src/backend/pi.ts` (`PI_BUILTIN_TOOLS`, `PI_READONLY_TOOLS`) | [verified] |
| Prompts | No server, daemon or shared prompt mentions research or web search. The only "research" strings describe the info deliverable kind | `git grep -i research` over `apps/*/src`, `packages/shared/src` | [verified] |
| Coordinator tools | Projects, todos, agents, models, machines, skills, secrets, MCP servers, schedules, docs, usage, issues, pull requests, workflow runs, memory (`save_memory`, `update_memory`, `delete_memory`), `search_history`/`read_history` over its own thread, `create_todo`/`split_todo` with deliverable `"code"` or `"info"`. No outward tool | `packages/shared/src/protocol/chief-tools.ts` | [verified] |
| Info cards | `output === 'info'`: read-only workspace, no commits, the report is stored as an attachment (`reportAttachmentId`), merge is refused | `apps/daemon/src/runner.ts` (`readonlyWorkspace`), `apps/server/src/services/builds.ts` (`INFO_CARD_MERGE_REFUSAL`) | [verified] |
| Info report handoff | When a todo is `blockedBy` an info card, its plan/build claim receives the report content. The handoff is snapshotted once per build, at the build's first step | `apps/server/src/services/blocker-handoff.ts` (`blockerHandoffForClaim`) | [verified] |
| Retry lessons | Builds the retry section from the last failed CI checks, plan/build rejection feedback, blocking review findings, verify verdicts and merge-gate blocks, parsed from build-conversation system messages | `apps/server/src/services/retry-lessons.ts` (`retryLessonsOf`), called from `builds.ts` | [verified] |
| CI-fix loop | At most `CI_FIX_ROUNDS_MAX = 3` fix rounds; then the build fails with a dead-loop message | `apps/server/src/services/ci-loop.ts` | [verified] |
| Learning loop | The daily reflect-curate turns trajectories into experience candidates (promoted to memory after `PROMOTION_MIN_BUILDS = 2` builds), skill drafts and guard candidates. Off unless env-enabled; the reflector calls an OpenAI-compatible `/chat/completions` endpoint from the server | `apps/server/src/trajectory-curate.ts`, `trajectory-reflect-curate.ts`, `trajectory-reflect.ts`, `services/scheduler.ts`, `packages/shared/src/experience-candidate.ts` | [verified] |
| Memory | `agent_memory` has `sourceTodoId`, `sourceBuildId`, `history`, `invalidAt`, `supersededBy`, `lastInjectedAt`. `injectMemories` injects every still-valid memory for the agent and project, with no retrieval step | `apps/server/src/db/schema.ts`, `apps/server/src/services/memory.ts` | [verified] |
| Failure attribution | `where` includes `'knowledge'`, `why` includes `'context_missing'`. It lives in the trajectory pack schema, which is a protected eval-ruler file, and is labeled after the fact | `packages/shared/src/failure-attribution.ts`, `packages/shared/src/trajectory-pack.ts`, `packages/shared/merge-gate-paths.json` | [verified] |
| Schedules | Coordinator and worker schedules, cron or one-shot, minimum interval 15 minutes, `WORKER_SCHEDULE_RUN_LIMIT = 10` | `apps/server/src/services/schedules.ts`, `chief-tools.ts` (`schedule_create`) | [verified] |
| Coordinator digest | A digest message kind already exists in the Coordinator thread | `apps/server/src/services/chief-digest.ts` | [verified] |
| Harness changes are measured | Prompt, skill and context-assembly changes are judged by paired trials | `docs/spec/29-evaluation-and-data-loop.md` | [verified] |
| Research today | Manual: tickets such as #1607 and #1775 with notes under `docs/research/`; link roundups ian feeds by hand (`link-roundup-2026-11-01.md`) | `docs/research/README.md` | [verified] |

What follows from this [inferred]:
- The brief's claim that "build agents can already use the web" holds only for the Claude Code runtime, and only for build and info steps.
- Codex-model agents cannot search at all.
- The Coordinator, which decides what work happens, is the role least able to look outward. It can, however, already delegate research by creating an info card.

## 3. Prior art

| System | What it does about outside knowledge | Who decides to retrieve | Source | Label |
|---|---|---|---|---|
| Hermes Agent (Nous Research) | Bounded curated memory (`MEMORY.md` ~2,200 chars, `USER.md`). The agent creates and updates skills with `skill_manage` after multi-step workflows, dead ends or user corrections, and a background review can stage skill changes behind an optional `write_approval` gate. Session search, cron jobs with per-job toolsets (also event-triggered by webhooks), `web_search`/`web_extract` with Exa as one backend. Opt-in `x_search` | The agent, at its discretion. Nothing enforces retrieval | hermes-agent.nousresearch.com/docs (features: skills, memory, cron, web-search, tools) | [verified] |
| Amp Librarian | A subagent that searches public GitHub and private repos, reads framework and dependency source, and returns findings | The user or main agent asks for it ("summon the Librarian") | ampcode.com/news/librarian (2025-10-20) | [verified]. Return format with file/line ranges: [inferred] from the screenshot |
| Devin | Ask Devin answers with cited code search over indexed repos and generates a context-rich prompt to hand to an Agent session. DeepWiki indexes repos | User-initiated, research before execution | docs.devin.ai/work-with-devin/ask-devin | [verified] |
| Anthropic multi-agent research system | A lead agent plans and spawns parallel search subagents; a citation step attributes claims. Effort scaling rules (1 agent / 3-10 calls for simple facts, more than 10 subagents for complex research). Multi-agent runs use about 15x the tokens of chat; token use explains 80% of BrowseComp variance | The lead agent, under explicit scaling rules in its prompt | anthropic.com/engineering/multi-agent-research-system | [verified] |
| Phased workflow (Infobip, CIKM '26) | Research, planning, task definition, implementation. Upstream research errors compound, so human review is front-loaded. When implementation shows a badly defined task, return to task definition rather than patch the code | A process rule, not the agent | arxiv.org/html/2608.30701v1 | [verified] |
| ACE, Agentic Context Engineering (ICLR 2026) | Generator, Reflector and Curator evolve an itemized playbook with incremental delta updates, avoiding brevity bias and context collapse from full rewrites. +10.6% on agent benchmarks | Execution feedback drives updates | proceedings.iclr.cc (ACE), arxiv.org/abs/2510.04618 | [verified] |
| FLARE (Jiang et al., EMNLP 2023) | Retrieve only when the model is about to produce low-confidence tokens; use the tentative next sentence as the query | A confidence threshold | aclanthology.org/2023.emnlp-main.495 | [verified] |
| OpenHands | Web search through a Tavily search API key; on by default in OpenHands Cloud, off without a key | The agent, at its discretion | docs.openhands.dev/openhands/usage/advanced/search-engine-setup | [verified] |
| Codex CLI | Hosted `web_search` tool, cached by default (an OpenAI-maintained index, less prompt-injection exposure) or `live`; separate from the sandbox's network policy; domain allowlist | Config, then the agent | learn.chatgpt.com/docs/web-search | [verified] |
| Renovate Merge Confidence | Watches dependency releases and flags undeclared breaking releases from adoption and test data across users | Automatic, on every dependency update | docs.renovatebot.com/merge-confidence | [verified] |
| Depot test splitting | Splits test files into shards balanced by historical timing; the same technique that fixed cairn's CI | Not an agent; shows the kind of fact research should find | depot.dev/docs/ci/how-to-guides/split-tests | [verified] |

Patterns across the table [inferred]:
1. Every coding-agent product gives agents a search tool, and none of them forces its use. Retrieval stays at the agent's discretion, which is exactly the failure ian describes.
2. Systems that research well split research into its own context: Amp, Anthropic and Devin each use a subagent or a separate mode. cairn's equivalent is the info card.
3. Learning loops that last (Hermes, ACE) store small, itemized, incrementally updated entries with a review gate, not rewritten blobs.
4. Feed watching is a solved, deterministic problem for dependencies (Renovate). Only cross-domain intake, such as X posts, needs an agent.

## 4. Options compared

| # | Option | Covers | Cost | Main risk | Origin |
|---|---|---|---|---|---|
| A | Prompt only: one line in the build brief telling the agent to search when stuck | (a) partly | Near zero | Same discretion problem as every product above; unmeasurable | Hermes and OpenHands pattern [inferred] |
| B | Stuck to research: when a build is rejected twice or a CI-fix loop reaches its last round, insert an info research card, then feed its findings into the retry through retry-lessons | (a) | One research card per stuck build | Injected web content reaches a build agent running with bypass permissions | The brief's direction 1, [inferred] |
| C | Research as a pipeline stage: new mechanisms, new dependencies, performance problems and technology choices get a read-only research step with cited sources before the plan; the plan must cite it | (a) upstream | One research card per qualifying task | Over-triggering slows small work; a citation check is easy to game with any URL | The brief's direction 2, [inferred]; phased-workflow paper |
| D | Daily intake: a scheduled info card scans sources (dependency releases, HN or Exa topic search, optionally ian's X timeline) and scores items against open issues and the plan | (b) | One card per day | Noise; X needs credentials on the daemon host | The brief's direction 3, [inferred]; Renovate for the dependency half |
| E | External knowledge into the learning loop: findings become memory candidates with source URL, date and expiry; `knowledge`-attributed failures trigger research | (c) | Small | Stale facts injected forever; attribution is offline and protected, so it cannot trigger in real time | The brief's direction 4, [inferred]; ACE and Hermes |
| F | A Coordinator search tool (give the locked-down Coordinator `WebSearch`) | (a), (b) | Small code change | Breaks the deliberate lock-down of the Coordinator; untrusted text in the role that dispatches work | [inferred], not recommended |
| G | A server-side search service (Exa API called from `apps/server`) | All | Metered key | Breaks the seam rule: outside access must stay behind `apps/daemon/src/backend/` | [inferred], rejected |

Recommendation: **B, then E, then C (soft), then D**, with A folded into B as the prompt the research card itself receives.

Why [inferred]:
- B targets the concrete failure: guess-and-retry on a stuck build. It reuses info cards and retry-lessons, and it is measurable with existing data (stuck builds before versus after).
- E is small once B exists, because B's report is the only new knowledge source.
- C changes how every non-trivial task starts. It needs B's measured hit rate first, or it adds latency without evidence.
- D is independent and can start right after spike S4.
- F and G are rejected because the Coordinator's lock-down and the backend seam are deliberate. Delegating to an info card gets the same result inside the existing trust boundary.

## 5. Recommended phased plan

### Phase 0: spikes (section 8)

Nothing in Phases 1 to 4 starts until S1, S2 and S5 pass. S3 gates Phase 1's prompt; S4 gates Phase 4's X source.

### Phase 1: research before the last retry

Behavior:
1. **Trigger.** The server checks a pure predicate at two points: (i) the CI loop sees red with `rounds === CI_FIX_ROUNDS_MAX - 1`, that is, before the last fix round; (ii) a build gets its second `revision:build` rejection in the current round. The predicate holds at most once per build round.
2. **Research card.** The server creates a child info todo with `output: 'info'`. Its prompt holds the failure context that retry-lessons already builds (failed checks, blocking findings, rejection feedback), plus the question "how have others solved this; what does the cited source say; how sure are you". The card is routed to an agent on the Claude Code runtime, the only runtime with a search tool today.
3. **Report shape.** At most 1,500 words. Each claim carries a URL and a fetched date, or the label "from training knowledge". The report ends with one recommended change and a confidence level.
4. **Handoff.** When the research card finishes, the server appends a system message to the stuck build's conversation: `{ kind: 'research-report', attachmentId, todoId }`. `retryLessonsOf` parses it, as it parses review verdicts, and renders an "Outside research" section inside the existing quoted-data fence. No schema migration is needed.
5. **Waiting.** The next retry step waits for the report up to a time cap, 20 minutes [guessed]; after the cap it proceeds without the report and records that research timed out.
6. **Record.** The build conversation shows the research card and its outcome, so "did it research" becomes a queryable fact (a system-message kind) rather than a guess.

Acceptance:
- An integration test drives CI red twice and asserts four things: one info todo is created; the third fix step's prompt contains the report inside the fence; a second red does not create a second card; the run proceeds after the cap when the card never finishes.
- On omarchy, the success rate of stuck builds over 14 days is reported against the S2 baseline.

### Phase 2: sourced, expiring memory from research

Behavior:
1. When a build that received a research report later merges, reflect-curate emits an experience candidate. Its content holds the recommended change, the source URL(s) and the fetched date. Evidence points at the research message.
2. Promotion follows the rule ian picks (decision 8). The recommendation is one build when the retry that used the report merged, because external facts arrive with their own evidence.
3. A promoted memory gets `invalidAt` = promotion date + 90 days [guessed]. Expiry reuses the existing `stillValid` filter. A re-promotion with a newer source extends it.
4. The `knowledge` attribution is used as a metric only: compare the share of `where: 'knowledge'` failures before and after Phase 1. It does not trigger anything at run time, because it is labeled offline in a protected file.

Acceptance: unit tests cover the candidate built from a research message, `invalidAt` set at promotion, and an expired memory no longer injected (`injectMemories`).

### Phase 3: prior-art citation for new mechanisms (soft)

Behavior:
1. The Coordinator decides per dispatch whether a task is a new mechanism, a new dependency, a performance problem or a technology choice. It says why in its dispatch reason, and the user can override with one sentence. This follows the existing decide, explain, overridable dispatch rule for plan-first; no rule table in code.
2. For such tasks the Coordinator first creates an info research card and `blockedBy`-links the code todo to it. The report reaches the planner through the existing blocker handoff, so no new plumbing is needed.
3. The plan template gains a "Prior art" section. In the soft phase, plan review raises a non-blocking finding when a flagged task's plan cites no source. After 14 days of data, ian decides whether to make it blocking (decision 4).

Acceptance:
- A Coordinator eval case with a "make X faster" task produces an info card plus a blocked code todo.
- A plan without a source for a flagged task yields a non-blocking review finding.
- The prompt change passes the paired-trial adoption judge (`docs/spec/29-evaluation-and-data-loop.md`).

### Phase 4: daily intake

Behavior:
1. A Coordinator schedule, cron `0 8 * * *` in server time, creates one info card per day.
2. The card covers three sources:
   - (i) GitHub releases of cairn's direct dependencies, read from the workspace `package.json` files with the existing GitHub connection: free and deterministic;
   - (ii) a topic search over HN and the web, with topics taken from open issue titles and the plan's current phase;
   - (iii) ian's X home timeline through agent-reach, only if S4 passes and ian agrees (decision 6).
3. Output: at most 5 items. Each has a source URL, a one-line claim, the open issue or plan item it matches, and a proposed action. It is posted as a digest in the Coordinator thread. Accepting an item creates a todo; nothing is auto-filed as a GitHub issue.
4. Dedupe: the card receives the previous 7 reports through `blockedBy`-style handoff of earlier intake cards, or reads its own earlier attachments, and drops repeated URLs. Spike S4 settles which.

Acceptance:
- Over 14 days, ian accepts or explicitly rejects at least 1 item in 5 [guessed target]. Below that, intake is narrowed or stopped.
- The integration test uses fixture release feeds and asserts at most 5 items, every item with a URL, and no repeated URL across two days.

## 6. Per-item feasibility, seams and failure modes

| Item | Feasibility | Files and seams touched | Protected or security path? | Failure modes |
|---|---|---|---|---|
| P1 trigger predicate | High [inferred]: CI round counting (`countMarkedRounds`) and rejection feedback rows already exist | New pure module `apps/server/src/services/research-trigger.ts`; call sites in `apps/server/src/services/ci-loop.ts` and the rejection path in `builds.ts` | No (`apps/*/src/**` is auto-merge) | Fires twice per round (double card); fires on infra-red CI (provider outage) where research is waste, so skip when `isProviderOutage`/`classifyStepFailure` says infra; fires on `coordinator-hold`-style paused builds |
| P1 research card creation and routing | Medium [inferred]: child info todos exist (`split_todo`), but server-initiated creation with forced Claude Code routing needs an agent selection rule | `apps/server/src/services/todo-split.ts` or `todos.ts`; agent pick by runtime | No | No Claude Code agent available or its token is rate-limited, so fall back to no research and record it; the card runs on pi and silently has no search, so assert the runtime |
| P1 report handoff into retry | High [inferred]: `retryLessonsOf` already parses system-message JSON kinds | `apps/server/src/services/retry-lessons.ts`; shared kind constant in `packages/shared/src/` | No | Report too long (clip like `BLOCKER_HANDOFF_SUMMARY_MAX_CHARS`); prompt injection from web content, mitigated by the existing quoted fence (`quoteIssueLines`, `ISSUE_FENCE_OPEN`) and the S5 spike; stale report from an earlier round, so scope by `roundStart` |
| P1 waiting with cap | Medium [inferred]: step enqueue happens immediately today; waiting needs a deferred enqueue on the scheduler tick | `ci-loop.ts`, `scheduler.ts` | No | Deadlock if the card never finishes (the cap is the guard); the step-claim invariants change, so run `verify-step-claim` if the claim or tick order changes |
| P1 research prompt | High | Prompt text in `packages/shared/src/records/prompts.ts` | No, but it is a harness change: adoption judge | Agent answers from training data and labels it as sourced, so the report schema requires URL plus fetched date per claim and review spot-checks one URL |
| P2 sourced memory candidates | High [inferred]: `memory_candidate.content` is free text, `agent_memory.invalidAt` exists | `apps/server/src/trajectory-curate.ts`, `apps/server/src/services/memory.ts` | No. A new column would touch `**/drizzle/**` (protected), so keep source and date inside `content` | Expired fact still injected (test `stillValid`); conflicting sources produce two memories (existing `conflictIds` path); reflect-curate is env-gated off, so Phase 2 is inert until it is enabled |
| P3 Coordinator research routing | Medium [inferred]: prompt plus existing `create_todo`/`blockedBy` | Coordinator system prompt (server-side prompt module) | No; harness change, adoption judge | Over-triggering on small tasks; Coordinator ignores the rule (same discretion problem), measured by counting flagged dispatches with no info card |
| P3 plan "Prior art" soft check | Medium | Plan template and plan-review prompt; optional parse helper next to `planVerificationItems` | No | Any URL passes (gaming); non-blocking findings ignored |
| P4 intake schedule and card | Medium [inferred]: schedules and info cards exist; the digest kind exists | `apps/server/src/services/schedules.ts` (Coordinator schedule), `chief-digest.ts`; no new outside access in the server | X access needs a credential on the daemon host, so it falls under the credentials rules and goes to ian | Noise; X cookies expire; GitHub API rate limit (5,000/h authenticated is ample [guessed from GitHub's published limit]); duplicates across days |
| Optional: Exa MCP for pi agents | Medium | MCP server config through the existing `mcp_servers` mechanism; key as a cairn secret | Touches `apps/server/src/services/mcp-servers.ts` only if code changes; that is a security surface, routed to ian with `/security-review` | Metered spend; key leak into transcripts (existing `guardCredentialOutputs`) |

Seam check [inferred]:
- Every outward call (web search, page fetch, X) happens inside a daemon session: Claude Code's built-in tools, or an MCP server configured through the backend.
- The server only creates todos, parses messages and builds prompts. No new GitOps, MCP or LLM client code is added outside `apps/daemon/src/backend/`.
- The existing server-side reflector call in `trajectory-reflect.ts` is not extended.

## 7. Test strategy

Layers follow `docs/spec/19-test-layering-and-blast-radius.md`:

| Layer | What | Run |
|---|---|---|
| unit (vitest light) | Trigger predicate truth table (round counts, infra-red skip, once per round); retry-lessons rendering of a `research-report` message inside the fence and clipped; memory candidate from a research message, `invalidAt` set, expired memory skipped; intake item scoring and URL dedupe | `pnpm exec vitest run --changed` locally, CI required |
| integration (vitest integration: real server plus daemon with a fake backend) | CI red twice, then info todo, then report attachment, then the third fix prompt contains the report; cap expiry proceeds without a report; intake schedule fires, fixture releases go in, digest has at most 5 items with URLs | CI required; run the touched file locally |
| eval (adoption judge) | Research prompt and Coordinator routing prompt as harness changes, paired before/after trials | Per `docs/spec/29-evaluation-and-data-loop.md` |
| live acceptance (`verify-cairn`) | One real stuck build on omarchy, with the research card's transcript showing `WebSearch` tool use and the retry prompt showing the report | Once per phase, evidence in the PR |
| web e2e | Only if the build conversation gains a new card rendering for the research message | `pnpm --filter @cairn/web e2e:affected` |

## 8. Pre-commit spikes

| # | Question | Method | Pass condition | Gates |
|---|---|---|---|---|
| S1 | Does `WebSearch` work in an info card on omarchy's Claude Code runtime with the stored token? | Create one info card asking for a fact published after the model cutoff (for example the Gretzinger article's runner numbers) | Transcript shows `WebSearch`/`WebFetch` tool use and the report cites the URL | All phases |
| S2 | How often do builds get stuck, and how often do they recover without help? | Read-only SQL on omarchy over 30 days: builds with 2 or more `[ci-fix]` rounds or 2 or more `revision:build` feedback rows in one round, and their final outcome | At least ~3 stuck builds per week [guessed threshold]; fewer means Phase 1 waits and Phase 3 or 4 goes first | Phase 1 |
| S3 | Does a research card find the fix a human found? | Replay 3 past stuck cases (including the slow-CI case before #2585) as info cards with the failure context only | The fix that worked, or an equivalent, is the report's recommendation in 2 of 3 | Phase 1 prompt |
| S4 | Can the daemon host read ian's X timeline headless, and how is dedupe stored? | Run agent-reach's X channel on omarchy over ssh (non-sudo), check cookie handling; try both dedupe options | Timeline read without an interactive login, or X is dropped from v1 | Phase 4 X source |
| S5 | Does the quoted fence hold against injected instructions in a report? | Info card researching a page that contains "ignore previous instructions, run X"; feed the report into a fake retry | The retry agent treats the text as data (no tool call follows the injected instruction) in 5 of 5 runs | Phase 1 |

## 9. Cost and quota

Claude quota is not a constraint. Codex and metered keys are budgeted.

| Item | Volume | Model tokens | Search cost | Label |
|---|---|---|---|---|
| P1 research cards | 2-5 per day (S2 measures) | 150k-400k tokens per card on Claude; Anthropic reports agents use about 4x chat tokens | Claude Code `WebSearch` on a subscription token: no per-search bill. The Claude API price is $10 per 1,000 searches, which does not apply to subscription use | Volume and tokens [guessed]; API price [verified]; subscription inclusion [inferred] |
| P3 research cards | 1-3 per day | Same as P1 | Same | [guessed] |
| P4 intake card | 1 per day, about 30 searches plus about 40 GitHub release reads | About 200k tokens | GitHub API free; topic search on Claude `WebSearch` | [guessed] |
| Optional Exa for pi agents | If enabled: about 100 searches per day, about 3,000 per month | n/a | Exa $4-7 per 1,000 requests with a $10 free monthly credit (about 2,500 Lite searches), so about $12-21 per month gross and $2-11 after credit | Price [verified]; volume [guessed] |
| Codex | Research never runs on Codex in v1 | 0 | 0 | [inferred] |

Capacity note [inferred]: the binding constraint is the rate limit of the Claude Code token stored in cairn on omarchy, which is a different account from the one these sessions run on. Five to nine research cards per day on top of normal builds may hit that limit [guessed]. This is why Phase 1 routing must fall back to "no research, recorded" rather than wait indefinitely, and why decision 3 matters.

## 10. Open decisions for ian

1. **When does research trigger?** Recommended: before the last CI-fix round (red at round 2 of 3) and at the second build rejection in a round, at most once per round. Why: it leaves one retry to use the findings, and `CI_FIX_ROUNDS_MAX = 3` already defines "stuck".
2. **Does the retry wait for the research card?** Recommended: yes, capped at 20 minutes, then proceed without it and record the timeout. Why: a parallel retry would not use the findings, and the cap prevents a dead loop.
3. **Which runtime runs research cards?** Recommended: Claude Code only in v1, with no Exa key. Why: it is the only runtime with search today, and it costs no metered spend. If spike S1 or the first week shows the stored token cannot carry the load, add Exa through MCP for pi agents (about $2-21 per month) as a security-surface PR on your route.
4. **Should the prior-art check on plans block?** Recommended: soft (non-blocking review finding) for 14 days, then you decide from the data. Why: any URL satisfies a mechanical check, and a blocking gate without hit-rate data repeats the failure of gates that revoke work silently.
5. **Who decides that a task needs upstream research?** Recommended: the Coordinator, per dispatch, stating its reason, overridable by you with one sentence. Why: it matches the existing plan-first rule; a rule table in code hardens into unauditable behavior.
6. **Is your X timeline an intake source?** Recommended: not in v1. Start with dependency releases plus topic search, and add X only after spike S4 passes and you place the X cookie on omarchy yourself. Why: it is a credential on a shared host, and the first two sources are free and deterministic.
7. **Where do intake items go?** Recommended: a digest in the Coordinator thread, at most 5 items; accepting one creates a todo; no automatic GitHub issues. Why: you asked not to scroll feeds, and automatic issues would recreate the feed inside GitHub.
8. **How does external knowledge become memory?** Recommended: promote after one build when the retry that used the research merged, store source URL and date in the memory text, expire after 90 days. Why: an external finding already carries evidence, waiting for `PROMOTION_MIN_BUILDS = 2` would lose most of them, and expiry stops stale facts from being injected forever (`injectMemories` has no retrieval step).
9. **What order?** Recommended: spikes, then Phase 1, 2, 3, with Phase 4 in parallel after S4. Why: Phase 1 fixes the concrete failure, and each later phase depends on its measured hit rate. If S2 shows few stuck builds, Phase 4 moves first.

## 11. Not verified

- Whether Claude Code `WebSearch` is available and unbilled when the session authenticates with the stored setup token (spike S1).
- The real frequency of stuck builds on omarchy (spike S2); all volume numbers in section 9 are guesses until then.
- Amp Librarian's exact return format (file and line ranges); the announcement page shows it only in a screenshot.
- agent-reach's X channel on a headless Linux host (spike S4).
