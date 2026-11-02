# Research loop plan: cairn agents that look outward

Status: revised 2026-11-02 after the owner's decisions (plan decision D63, which builds on the thread model of D60). Code facts are checked against `origin/main` at `456edfe36`. This document stands alone; it does not depend on any earlier plan version.

Labels used throughout:
- **[verified]**: read in the source (code on `origin/main`, a web page, a PR) during this session.
- **[inferred]**: reasoned from verified facts; can be re-checked.
- **[guessed]**: everything else, including predictions and numbers not yet measured.
- **[D60 work]**: depends on the thread model of D60, which is decided but not yet built on `origin/main`.

## 0. Summary

- **End state.**
  - A stuck build gets outside research before its last retry.
  - Work on a new mechanism starts with a research thread whose report the code thread reads.
  - Once a day, the Coordinator digest lists at most 5 outside developments that match open work.
  - Findings that helped a merged retry are kept as sourced memory that expires after 90 days.
  - Every runtime that runs unlocked work can search the web, including pi.
- **Thread model (D60).**
  - Research runs as its own thread: one thread, one session, owning the work to the end.
  - The Coordinator only listens, opens threads and intercepts. Opening a research thread, and choosing a strong or cheap model for it by task complexity, is routing, not planning.
  - The Coordinator does not wait. The code thread waits on the research report through the blocker handoff, or the stuck-retry path injects the report.
- **Search for pi.** Recommended: a daemon-side `web_search` / `web_fetch` tool behind `apps/daemon/src/backend/`. It reads the provider key from the per-step secret vault and calls Exa first, with Brave as the alternative. Claude Code keeps its native `WebSearch`. Locked steps (Coordinator, review, `remoteToolsOnly`) stay without search.
- **Next step.** Run spikes S1 to S6 (section 10). S2 (how often builds get stuck) decides whether Phase 1 goes first.
- **Waiting on ian.** The questions still open in section 12: the search option, the provider, a monthly spend cap, citation-check frequency, and whether Phase 1 waits for D60.

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
| Claude Code runtime, build and info steps | `disallowedTools` is `AskUserQuestion` plus `Edit`/`Write` when `readOnly`; `WebSearch`/`WebFetch` stay available | `apps/daemon/src/backend/claude-code.ts` (`SDK_ASK_TOOL`, `SDK_WRITE_TOOLS`, `buildClaudeSdkOptions`) | [verified] |
| Locked steps | Coordinator and review steps run `lockedDown` outside an Orb. Built-in tools are limited to `Read`, `Glob`, `Grep` (`HOST_BUILTIN_TOOLS`), `Bash` is disallowed, and only the host MCP server is kept. `remoteToolsOnly` sets built-in tools to none | `apps/daemon/src/runner.ts` (`isChief \|\| isReview ? { lockedDown: true }`), `claude-code.ts`, `pi.ts` (`sessionToolNames`) | [verified] |
| pi runtime (Codex/GPT models through the `openai-codex` OAuth provider) | Built-in tools are `read, bash, edit, write` (read-only: `read, bash`). No search tool | `apps/daemon/src/backend/pi.ts` (`PI_BUILTIN_TOOLS`, `PI_READONLY_TOOLS`) | [verified] |
| pi MCP bridge | `opts.mcpServers` endpoints are registered through the `cairn-mcp-bridge` extension (`pi.registerMcpServer`). Tools are exposed through `MCP_TOOL_ALLOWLIST` (`mcp__*` plus resource tools) unless `remoteToolsOnly` | `pi.ts` (`mcpRegisterExtension`, `MCP_TOOL_ALLOWLIST`) | [verified] |
| pi custom tools | Remote tools (relayed to the server) and local tools (run in the daemon) are both wrapped with `defineTool` into `customTools`. Local tools today are `get_secret`, the create-tag tool and the skill loader | `pi.ts` (`customTools`, `localTools`), `runner.ts` (`localToolDefs`) | [verified] |
| Where MCP servers come from | The daemon resolves granted slugs from the machine's Claude config file (`~/.claude.json`, `CLAUDE_CONFIG_FILE_NAME`). The grant is the agent's `mcpServers` list, and dispatch eligibility checks the machine's reported MCP capability. Credentials for an MCP server live in that file's `env` on each host | `apps/daemon/src/backend/mcp-config.ts`, `apps/server/src/services/mcp-servers.ts`, `apps/server/src/services/dispatch-eligibility.ts` | [verified] |
| Secret channel | Per-step credentials carry a `SecretVault` (names plus `take(name)`). Secrets are not in the shell environment; `get_secret` is the agent's only way to read one, and every read is audited | `apps/daemon/src/credentials.ts`, `apps/daemon/src/secret-channel.ts` | [verified] |
| Prompts | No server, daemon or shared prompt mentions research or web search. The only "research" strings describe the info deliverable kind | `git grep -i research` over `apps/*/src`, `packages/shared/src` | [verified] |
| Coordinator tools | Projects, todos, agents, models, machines, skills, secrets, MCP servers, schedules, docs, usage, issues, pull requests, workflow runs, memory, `watch_todos`, its own history search, `create_todo` and `split_todo` with deliverable `"code"` or `"info"`, `run_builds`. No outward tool | `packages/shared/src/protocol/chief-tools.ts` | [verified] |
| Routing today | `run_builds` routes by agent: `assignment.plan/build.agentId`. A model is a property of the agent (`create_agent`/`update_agent` `modelId`). No per-thread model choice exists | `chief-tools.ts` | [verified] |
| Blockers | `blockedBy` edges are set only through `split_todo` sub-cards; `create_todo` has no blocker parameter | `chief-tools.ts` | [verified] |
| Info cards | `output === 'info'`: read-only workspace, no commits, the report is an attachment (`reportAttachmentId`), merge is refused | `runner.ts` (`readonlyWorkspace`), `apps/server/src/services/builds.ts` (`INFO_CARD_MERGE_REFUSAL`) | [verified] |
| Report handoff | A plan/build claim on a todo `blockedBy` an info card receives the report. The handoff is snapshotted once per build, at its first step | `apps/server/src/services/blocker-handoff.ts` (`blockerHandoffForClaim`) | [verified] |
| Retry lessons | The retry section is built from failed CI checks, rejection feedback, blocking review findings, verify verdicts and merge-gate blocks, parsed from build-conversation system messages | `apps/server/src/services/retry-lessons.ts` (`retryLessonsOf`) | [verified] |
| CI-fix loop | At most `CI_FIX_ROUNDS_MAX = 3` fix rounds, then the build fails with a dead-loop message | `apps/server/src/services/ci-loop.ts` | [verified] |
| Learning loop | Daily reflect-curate turns trajectories into experience candidates (promoted after `PROMOTION_MIN_BUILDS = 2`), skill drafts and guard candidates. Off unless env-enabled | `apps/server/src/trajectory-curate.ts`, `trajectory-reflect-curate.ts`, `services/scheduler.ts` | [verified] |
| Memory | `agent_memory` has `sourceTodoId`, `sourceBuildId`, `invalidAt`, `supersededBy`. `injectMemories` injects every still-valid memory, with no retrieval step | `apps/server/src/db/schema.ts`, `apps/server/src/services/memory.ts` | [verified] |
| Failure attribution | `where` includes `'knowledge'`. It lives in the trajectory pack schema, a protected eval-ruler file, and is labeled after the fact | `packages/shared/src/failure-attribution.ts`, `packages/shared/src/trajectory-pack.ts` | [verified] |
| Schedules and digest | Coordinator and worker schedules (cron or one-shot, minimum 15 minutes); a Coordinator digest message kind | `apps/server/src/services/schedules.ts`, `apps/server/src/services/chief-digest.ts` | [verified] |
| Thread model | D60: no fixed role agents; the Coordinator opens a thread; one thread, one session, owns plan, tests, implementation and self-check; the Coordinator picks model and machine per task; the Coordinator does not plan or wait (events are pushed). Decided, not built | Owner's plan decision table, D60 | [D60 work] |

What follows from this [inferred]:
- Only Claude Code build and info steps can search today. Codex-model threads cannot.
- The Coordinator cannot search, and under D60 it should not: it routes, and research is work that a thread owns.
- Two pieces the research loop needs belong to D60 and do not exist yet: opening a thread with a per-thread model, and blocking a code thread on a research thread outside `split_todo`.

## 3. Prior art

| System | What it does about outside knowledge | Who decides to retrieve | Source | Label |
|---|---|---|---|---|
| Hermes Agent (Nous Research) | Bounded curated memory (`MEMORY.md` ~2,200 chars). The agent writes skills with `skill_manage` after multi-step workflows, dead ends or corrections; a background review can stage skill changes behind an optional `write_approval` gate. Session search, cron jobs with per-job toolsets, `web_search`/`web_extract` with Exa as one backend, opt-in `x_search` | The agent, at its discretion | hermes-agent.nousresearch.com/docs (skills, memory, cron, web-search, tools) | [verified] |
| Amp Librarian | A subagent that searches public and private GitHub code, reads dependency source and returns findings | The user or main agent asks for it | ampcode.com/news/librarian (2025-10-20) | [verified]; file/line return format [inferred] from a screenshot |
| Devin | Ask Devin answers with cited code search and generates a context-rich prompt for an Agent session | User-initiated, research before execution | docs.devin.ai/work-with-devin/ask-devin | [verified] |
| Anthropic multi-agent research system | Lead agent plans and spawns parallel search subagents; claims are attributed to sources; an LLM judge grades factual and citation accuracy | The lead agent, under explicit effort-scaling rules | anthropic.com/engineering/multi-agent-research-system | [verified] |
| Phased workflow (Infobip, CIKM '26) | Research, planning, task definition, implementation. Upstream research errors compound, so review is front-loaded | A process rule | arxiv.org/html/2608.30701v1 | [verified] |
| ACE, Agentic Context Engineering (ICLR 2026) | Generator, Reflector and Curator evolve an itemized playbook with incremental delta updates, avoiding context collapse | Execution feedback | proceedings.iclr.cc (ACE), arxiv.org/abs/2510.04618 | [verified] |
| FLARE (Jiang et al., EMNLP 2023) | Retrieve only when the model is about to produce low-confidence tokens | A confidence threshold | aclanthology.org/2023.emnlp-main.495 | [verified] |
| OpenHands | Web search through a Tavily API key; off without a key | The agent | docs.openhands.dev/openhands/usage/advanced/search-engine-setup | [verified] |
| Codex CLI | Hosted `web_search`: cached by default (an OpenAI-maintained index, less prompt-injection exposure) or `live` for the latest information; separate from the sandbox network policy; domain allowlist | Config, then the agent | learn.chatgpt.com/docs/web-search | [verified] |
| Renovate Merge Confidence | Watches dependency releases and flags undeclared breaking releases | Automatic | docs.renovatebot.com/merge-confidence | [verified] |
| Depot test splitting | Shards balanced by historical timing; the technique that fixed cairn's CI | Not an agent; an example of what research should find | depot.dev/docs/ci/how-to-guides/split-tests | [verified] |

Patterns across the table [inferred]:
1. Every coding-agent product gives agents a search tool, and none forces its use. That is exactly the failure ian describes, so cairn needs triggers, not just a tool.
2. Systems that research well give research its own context (Amp, Anthropic, Devin). In D60 terms, that is a research thread.
3. Learning loops that last (Hermes, ACE) store small, itemized, reviewed entries.
4. Dependency watching is deterministic (Renovate). Only cross-domain intake needs an agent.

## 4. Options compared

| # | Option | Covers | Main risk | Status |
|---|---|---|---|---|
| A | Prompt only: tell agents to search when stuck | (a) partly | Same discretion problem as every product above | Folded into the research thread's prompt |
| B | Stuck to research: at CI-fix round 2 of 3 or a second rejection in a round, a research thread runs and its report feeds the retry | (a) | Injected web content reaches a build session running with bypass permissions | **Decided (D63)** |
| C | Research before planning for new mechanisms, dependencies, performance problems and technology choices; the plan cites it | (a) upstream | Over-triggering; any URL satisfies a mechanical check | **Decided: soft for 14 days (D63)** |
| D | Daily intake: dependency releases plus topic search, scored against open work | (b) | Noise | **Decided: Coordinator digest, at most 5 items, no X in v1 (D63)** |
| E | Research findings become sourced, expiring memory | (c) | Stale facts | **Decided: only after a merged retry that used the report, 90-day expiry (D63)** |
| F | Give the locked Coordinator a search tool | (a), (b) | Breaks the Coordinator's lock-down and D60's "does not plan" | Rejected |
| G | A server-side search service in `apps/server` | All | Breaks the backend seam rule | Rejected |

## 5. Search for every runtime

ian's decision: research is not tied to Claude Code; pi gets a search tool. Claude Code keeps its native `WebSearch`/`WebFetch`, which costs nothing per search. Locked steps stay without search under both options.

| | Option 1: team MCP search server | Option 2: daemon-side search tool for pi |
|---|---|---|
| Shape | An Exa (or Brave) MCP server entry in each daemon host's `~/.claude.json`, granted by slug; pi registers it through `cairn-mcp-bridge` and exposes `mcp__exa__*` | A local tool pair `web_search` / `web_fetch`, built in the daemon like `get_secret` and passed to pi as `localTools`, then `defineTool` into `customTools`. The tool calls the provider over HTTPS with a key it takes from the step's `SecretVault`. The agent never sees the key |
| Code files | None for the basic path. A machine-capability report already covers MCP slugs (`dispatch-eligibility.ts`). Grants change only if D60 replaces agent `mcpServers` | New `apps/daemon/src/backend/web-search.ts` (provider client: Exa first, Brave second, one interface, injectable `fetch`); `apps/daemon/src/runner.ts` (add the tool to `localToolDefs` when the step is not locked and the provider secret is granted); `packages/shared/src/` (tool names and result shape) |
| Backend seam | Holds: the daemon's MCP client already sits behind `apps/daemon/src/backend/` | Holds if the provider client lives in `apps/daemon/src/backend/web-search.ts` and `runner.ts` only wires it |
| Security surfaces (`packages/shared/merge-gate-paths.json`) | No code change. Any change to `apps/server/src/services/mcp-servers.ts` is a security surface (external entry auth) | `apps/daemon/src/credentials.ts` and `secret-channel.ts` are security surfaces, touched only if the vault API changes; reading `creds.secrets.take` from a new file needs no change there. Granting a team secret to a research thread goes through `apps/server/src/services/secrets.ts` (security surface) if D60 changes how grants attach to threads |
| Where the key lives | Plain text in `~/.claude.json` `env` on every daemon host; outside SecretBox; rotated by hand per host | Team secret in SecretBox, delivered per step, audited per read, absent from the shell environment |
| Supply chain | A stdio server is typically launched with `npx` at run time, which downloads and runs a package on the host; a remote HTTP server instead sends queries and key to a third-party endpoint | No new package; a direct HTTPS call to the provider API |
| Testing | Needs a live or stubbed MCP server | Unit tests with a fake `fetch`; an integration test with a fixture provider |
| Locked steps | Locked steps keep only the host MCP server, so no search | The tool is not added when `lockedDown` or `remoteToolsOnly` |
| Provider swap | Edit every host's config | One interface, provider chosen by which secret is granted |

**Recommendation: Option 2.** The key stays in SecretBox and the audited secret channel instead of plain text on every host. Nothing is downloaded at run time. The provider sits behind one tested interface. It also fits D60: grants follow the thread's step credentials rather than a fixed agent's `mcpServers` list [inferred]. Option 1 remains a zero-code stopgap if spike S1 needs search on pi before Option 2 lands.

Providers, with prices read on 2026-11-02:

| Provider | Price | Free allowance | Notes | Label |
|---|---|---|---|---|
| Exa (first choice) | From $4 per 1,000 search requests (higher tiers up to $12); page contents $1 per 1,000 pages | $10 credit per month | Neural search plus contents in one API; also a Hermes Agent backend | [verified] exa.ai/pricing |
| Brave Search API (alternative) | $5 per 1,000 requests | $5 credit per month (with attribution) | Independent index | [verified] brave.com/blog/most-powerful-search-api-for-ai |
| Tavily (alternative) | $0.008 per credit pay-as-you-go; a basic search costs 1 credit | 1,000 credits per month | OpenHands' default | [verified] docs.tavily.com/documentation/api-credits; credits per search [inferred] |

Metered cost: see section 11.

## 6. Harness and model for research

What the sources say:
- Anthropic's multi-agent research post [verified]:
  - Token usage alone explains 80% of BrowseComp performance variance.
  - An Opus lead with Sonnet subagents beat single-agent Opus by 90.2% on their internal research eval.
  - Multi-agent runs use about 15 times the tokens of a chat.
  - The lead runs 3 to 5 subagents in parallel, each using 3 or more tools in parallel, which cut research time by up to 90% on complex queries.
  - Multi-agent setups fit breadth-first questions. Most coding tasks have fewer truly parallel parts.
- OpenAI's Codex docs [verified]: cached web search lowers, but does not remove, prompt-injection risk. Live search is for tasks that depend on the latest information.

Two tiers for cairn [inferred]:

| Tier | Used for | Harness | Default model role (mirrors the repository's model table) |
|---|---|---|---|
| 1: single agent | Stuck-retry research; prior-art research for one task | One research thread, one session, with parallel tool calls (several searches per turn) and a 3-to-15-call budget in its prompt | Implementation role (`claude-sonnet-5-5`, or `gpt-6.1-sol` on pi); the Coordinator picks this tier by default |
| 2: multi-agent | Daily intake; large questions (technology choice, new subsystem) | A lead research thread fans out 3 to 5 sub-searches in parallel, then merges | Lead: orchestration role (`claude-opus-5-5`); sub-searches: implementation role; dedupe and extraction: mechanical role (`claude-haiku-5-5`) |

Rules for both tiers:
- **Search mode.** Live search, because stuck builds and intake need fresh facts. The provider tool has no cached mode, so injection risk is handled by three controls instead:
  - the research thread is read-only (info deliverable);
  - the report enters other sessions only inside the quoted-data fence;
  - citations are checked.
- **Citation check.** A session from the other vendor than the report's author checks that each cited URL supports its claim, using the rubric from Anthropic's LLM judge (factual accuracy, citation accuracy, source quality). Claims that fail are dropped or marked "unsupported" before the report is handed off.
- **Model choice.** Model choice is routing. Under D60 the Coordinator makes it when it opens the thread [D60 work]. Until then, the closest primitive is choosing which agent runs the research card in `run_builds`.

## 7. Recommended phased plan

Phase 0, spikes (section 10), comes first, as decided in D63.

### Phase 1: research before the last retry (decided)

Behavior:
1. **Trigger, server-side.** A pure predicate fires when CI is red with `rounds === CI_FIX_ROUNDS_MAX - 1`, or on the second `revision:build` rejection in a round. It fires at most once per round and skips infra failures (`isProviderOutage`, `classifyStepFailure`). It does not create work. It pushes a "stuck" event to the Coordinator for that thread. A dedicated event kind is new work; `watch_todos` shows that per-thread events reach the Coordinator today [verified].
2. **Routing, Coordinator.** On the event, the Coordinator opens a research thread (info deliverable) at tier 1 and chooses its model by the failure's complexity. It does not plan the research and does not wait for it [D60 work]. The interim equivalent on `origin/main` is `create_todo` with `output: "info"` plus `run_builds` with a chosen agent [verified primitives].
3. **Research thread.** Its prompt holds the failure context that retry-lessons already builds (failed checks, blocking findings, rejection feedback) and asks how others solved it. The report:
   - is at most 1,500 words;
   - gives every claim a URL and fetched date, or the label "from training knowledge";
   - ends with one recommended change and a confidence level.
   The citation check (section 6) runs before handoff.
4. **Injection.** When the report is ready, the server appends `{ kind: 'research-report', attachmentId, todoId }` to the stuck build's conversation. `retryLessonsOf` renders it as an "Outside research" section inside the quoted-data fence. This is the stuck-retry injection path, and it needs no schema migration.
5. **Waiting (decided).** The code thread's last retry waits for the report for at most 20 minutes, then continues without it. Whether research happened, or timed out, is recorded as a message kind.

Acceptance:
- An integration test (CI red twice) asserts:
  - one stuck event and one research thread;
  - the third fix prompt contains the fenced report;
  - a repeat red in the same round does not open a second thread;
  - the retry proceeds after 20 minutes without a report.
- Over 14 days on omarchy, the stuck-build success rate is compared with the S2 baseline.

### Phase 2: sourced, expiring memory (decided)

Behavior:
1. When a retry that used a research report merges, reflect-curate emits an experience candidate whose content holds the change, the source URLs and the fetched date. Evidence points at the research message.
2. It is promoted after that one merged build, and `invalidAt` is set to promotion plus 90 days. A newer source re-promotes it and extends the expiry.
3. The `knowledge` attribution is a metric only: its share of failures is compared before and after Phase 1.

Acceptance: unit tests cover the candidate built from a research message, `invalidAt` set at promotion, and an expired memory no longer injected.

### Phase 3: research before planning for new mechanisms (decided: soft)

Behavior:
1. When the Coordinator opens a thread for a new mechanism, dependency, performance problem or technology choice, it opens a research thread first. It picks tier 1, or tier 2 for large questions, and blocks the code thread on it. This is routing: the Coordinator states the reason in one line, and the user can override it [D60 work for the blocker edge; today only `split_todo` creates `blockedBy`].
2. The code thread's first step receives the report through the existing blocker handoff. The thread's own plan then gains a "Prior art" section that cites it.
3. For 14 days the check is soft: a plan for a flagged task without a cited source gets a non-blocking review finding. ian then decides from the data whether it blocks.

Acceptance:
- A Coordinator eval case ("make X faster") opens a research thread plus a code thread blocked on it.
- A plan without a source gets the non-blocking finding.
- The Coordinator and research prompt changes pass the paired-trial adoption judge (`docs/spec/29-evaluation-and-data-loop.md`).

### Phase 4: daily intake (decided)

Behavior:
1. A Coordinator schedule (cron `0 8 * * *`, server time) opens one tier-2 research thread per day.
2. Sources:
   - GitHub releases of cairn's direct dependencies through the existing GitHub connection (free, deterministic);
   - a topic search with topics from open issue titles and the plan's current phase.
   - No X timeline in v1. X is added only after S4 passes and ian places the cookie himself.
3. Output: at most 5 items, each with a source URL, a one-line claim, the matching open issue or plan item, and a proposed action. Items go into the Coordinator digest. Accepting an item opens a thread; nothing becomes a GitHub issue automatically.
4. Dedupe against the previous 7 reports; spike S4 picks the mechanism.

Acceptance:
- An integration test with fixture release feeds asserts at most 5 items, every item with a URL, and no repeated URL across two days.
- Over 14 days, at least 1 item in 5 is accepted or explicitly rejected [guessed target]; below that, intake is narrowed.

### Phase 1b: search tool for pi (Option 2, in parallel with Phase 1)

Behavior:
- `web_search` and `web_fetch` are local tools for unlocked pi steps when the provider secret is granted.
- Results are clipped and returned with URL and fetched date.
- Every call is logged with the step id so search volume is measurable.

Acceptance:
- Unit tests cover provider request and response mapping, the missing-key message, and the tool being absent for `lockedDown` and `remoteToolsOnly` steps.
- An integration test runs a pi info step with a fixture provider and shows `web_search` in its transcript.

## 8. Per-item feasibility, seams and failure modes

| Item | Feasibility | Files and seams | Protected or security path? | Failure modes |
|---|---|---|---|---|
| P1 trigger and stuck event | High [inferred]: round counting (`countMarkedRounds`) and rejection rows exist | New `apps/server/src/services/research-trigger.ts`; calls from `ci-loop.ts` and the rejection path in `builds.ts`; a new event kind toward the Coordinator | No | Double fire in one round; firing on infra-red CI; the Coordinator ignores the event, which the 20-minute cap absorbs, and "no research" is recorded |
| P1 Coordinator routing of research threads | Interim high, using `create_todo` info plus `run_builds`; target [D60 work] | Coordinator prompt; D60's thread-opening API | No; a harness change, judged by the adoption judge | Wrong tier chosen; the research thread lands on a runtime without search, so it asserts a search tool or Claude Code |
| P1 report injection | High [inferred]: `retryLessonsOf` already parses system-message kinds | `apps/server/src/services/retry-lessons.ts`; shared kind constant in `packages/shared/src/` | No | Report too long (clip it); prompt injection from web text (quoted fence, citation check, spike S5); a stale report from an earlier round (scope by `roundStart`) |
| P1 20-minute wait | Medium [inferred]: fix steps are enqueued immediately today | `ci-loop.ts`, `scheduler.ts` | No | The research thread never finishes (the cap guards); claim or tick order changes (run `verify-step-claim`) |
| P1b pi search tool | High [inferred]: the `localTools` to `defineTool` path exists and is used by `get_secret` | `apps/daemon/src/backend/web-search.ts` (new), `apps/daemon/src/runner.ts`, `packages/shared/src/` | No, unless the vault API changes (`credentials.ts`, `secret-channel.ts`) or thread secret grants change (`secrets.ts`); then it is a security surface on ian's route with `/security-review` | Key leaks into a transcript (results must never echo the key; `guardCredentialOutputs` stays in place); provider outage (return a clear error, no retry storm); runaway spend (per-step call cap plus the monthly cap in decision 3) |
| P1 citation check | Medium | A check step on the research thread before handoff, run by the other vendor | No | The checker cannot fetch a page (the claim is marked unverified rather than dropped silently); double the tokens per report |
| P2 sourced memory | High [inferred]: `memory_candidate.content` is free text; `agent_memory.invalidAt` exists | `apps/server/src/trajectory-curate.ts`, `apps/server/src/services/memory.ts` | No; a new column would touch `**/drizzle/**`, which is protected, so source and date stay in `content` | An expired fact still injected (test `stillValid`); reflect-curate is env-gated off, so Phase 2 stays inert until it is enabled |
| P3 research-first routing | Medium; the blocker edge outside `split_todo` is [D60 work] | Coordinator prompt; D60 thread API | No; adoption judge | Over-triggering on small tasks; the Coordinator skips it (count flagged threads without a research thread) |
| P4 intake | Medium [inferred]: schedules, info deliverables and the digest exist | `apps/server/src/services/schedules.ts`, `chief-digest.ts`; no outside access in the server | No in v1 (no X credential) | Noise; GitHub rate limit; repeats across days |

Seam check [inferred]:
- Every outward call happens inside a daemon session: Claude Code's built-in tools, or the pi tool in `apps/daemon/src/backend/web-search.ts`.
- The server only detects triggers, records messages and builds prompts. No new GitOps, MCP or LLM client code is added outside `apps/daemon/src/backend/`.

## 9. Test strategy

Layers follow `docs/spec/19-test-layering-and-blast-radius.md`:

| Layer | What | Run |
|---|---|---|
| unit (vitest light) | Trigger predicate truth table; `research-report` rendering inside the fence and clipped; search provider mapping and missing key; tool absent on locked steps; memory candidate with `invalidAt`; intake scoring and dedupe | `pnpm exec vitest run --changed`; CI required |
| integration (real server plus daemon, fake backend) | CI red twice, stuck event, research thread, report, fenced in the third fix prompt; 20-minute cap; pi info step calling `web_search` against a fixture provider; intake with fixture releases | CI required; run the touched file locally |
| eval (adoption judge) | Research prompt, Coordinator routing prompt | `docs/spec/29-evaluation-and-data-loop.md` |
| live acceptance (`verify-cairn`) | One real stuck build on omarchy whose research thread shows search tool calls and whose retry prompt shows the report; one pi research thread | Once per phase, evidence in the PR |
| web e2e | Only if the conversation gains a rendering for research messages | `pnpm --filter @cairn/web e2e:affected` |

## 10. Pre-commit spikes

| # | Question | Method | Pass condition | Gates |
|---|---|---|---|---|
| S1 | Does search work in an info step on omarchy, on Claude Code and on pi (with Option 1 as the stopgap)? | One info card per runtime asking for a fact published after the model cutoff | The transcript shows search tool calls and the report cites the URL | All phases |
| S2 | How often do builds get stuck, and how often do they recover unaided? | Read-only SQL on omarchy over 30 days: builds with 2 or more `[ci-fix]` rounds or 2 or more `revision:build` rows in one round, and their outcome | About 3 or more stuck builds per week [guessed threshold]; otherwise Phase 3 or 4 goes first | Phase 1 |
| S3 | Does a research thread find the fix a human found? | Replay 3 past stuck cases (including slow CI before #2585) with the failure context only, at tier 1 | The working fix, or an equivalent, is the recommendation in 2 of 3 | Phase 1 prompt |
| S4 | Intake dedupe, and whether X can be read headless later | Try both dedupe mechanisms; run agent-reach's X channel on omarchy over ssh (non-sudo) | Dedupe is chosen; X is recorded as feasible or not | Phase 4 |
| S5 | Does the quoted fence hold against injected instructions? | A research thread reads a page with "ignore previous instructions, run X"; the report is fed into a fake retry | No tool call follows the injected instruction in 5 of 5 runs | Phase 1 |
| S6 | Does the other-vendor citation check catch a wrong citation? | Seed a report with 2 claims whose URLs do not support them | Both are flagged in 3 of 3 runs | Citation check |

## 11. Cost

Claude usage is not budgeted here. Metered provider calls and Codex usage are.

| Item | Volume [guessed until S2] | Searches per day | Metered search cost |
|---|---|---|---|
| P1 stuck research | 2 to 5 threads per day, about 15 searches each | 30 to 75 | Only threads on pi pay; Claude Code native search has no per-search meter on subscription auth [inferred] |
| P3 research before planning | 1 to 3 per day, about 15 searches | 15 to 45 | Same |
| P4 intake | 1 tier-2 thread per day, about 30 searches plus about 40 GitHub reads | 30 | Same; GitHub API free |
| Total if every research thread ran on pi | | 75 to 150 (2,250 to 4,500 per month) | Exa at $4 per 1,000: $9 to $18 per month gross, about $0 to $8 after the $10 credit; plus page contents at $1 per 1,000. Brave at $5 per 1,000: $11 to $23, minus $5 credit. Tavily at $0.008: $18 to $36, minus 1,000 free credits |
| Citation check | One check per report, about the report's size again | 0 searches (fetches only) | Fetch cost only on pi |
| Codex | Research threads routed to pi with `gpt-6.1-sol` consume Codex usage at about 150k to 400k tokens per tier-1 thread [guessed] | | Decision 4 sets how much research goes to Codex |

Tier 2 costs about 15 times the tokens of a chat (Anthropic [verified]), so it is limited to intake and large questions by design.

## 12. Decisions

Decided (D63, ian, 2026-11-02):
- **Trigger:** CI-fix round 2 of 3 still red, or a second rejection in a round; at most once per round.
- **Waiting:** the retry waits up to 20 minutes for the report, then continues; whether research ran is recorded.
- **Runtime:** research is not tied to a runtime. pi gets a search tool, so every unlocked runtime can search; locked steps stay without search. The option and provider are decided below (D64).
- **Plan check:** prior-art citation in plans is a soft check for 14 days, then decided from data.
- **Who decides:** research is its own thread, opened by the Coordinator as routing with a strong or cheap model by complexity, under D60.
- **X:** no X timeline in v1; added only after S4 and ian placing the cookie himself.
- **Intake:** Coordinator digest, at most 5 items, accepting opens work, no automatic issues.
- **Memory:** only after a merged retry that used the report, with source and date, 90-day expiry.
- **Order:** spikes S1 to S6 first, then phases.

Decided (D64, ian, 2026-11-02, all as recommended):
- **Search option for pi:** Option 2, the daemon-side `web_search`/`web_fetch` tool reading the key from the secret vault; Option 1 (MCP server in `~/.claude.json`) only as a stopgap for S1.
- **Provider:** Exa first, Brave as the configured alternative.
- **Spend cap:** $20 per month for metered search, enforced in the tool, which returns "search budget exhausted" past it.
- **Codex share:** research threads route to Claude models by default, and to pi with `gpt-6.1-sol` only when the citation check needs the other vendor or Claude is unavailable.
- **Citation check:** every tier-2 report and every report injected into a retry; reports a code thread reads only as background are covered by that thread's own review.
- **Phase 1 and D60:** Phase 1 does not wait for D60's thread API; it runs on an info todo plus `run_builds` routing, opened by the Coordinator on the stuck event, behind a thin "open research thread" function that D60 later replaces.

No decisions remain open; S1 and S2 can still reorder the phases as stated in section 10.

## 13. Not verified

- Whether native `WebSearch` works with the token stored in cairn on omarchy, and whether a pi step can reach a search provider from that host (S1).
- The frequency of stuck builds on omarchy (S2); every volume and cost figure in section 11 is a guess until then.
- Amp Librarian's exact return format; the announcement shows it only in a screenshot.
- Tavily's credit cost per basic search, inferred from its docs' credit model.
- Exa's tier boundaries between $4 and $12 per 1,000; the pricing page lists several endpoint columns.
