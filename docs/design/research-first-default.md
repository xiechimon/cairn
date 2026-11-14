# Research first by default: the person decides, Cairn researches

Status: accepted by the owner on 2026-11-14, with every decision below as recommended. Cairn is meant for other people, so P0 to P3 are scheduled in order; P0 is implemented in the PR that adds this document. Code facts are checked on `origin/main` at `81d86ea33`; usage numbers come from a read-only query of the omarchy server database over the last 30 days.

## Problem

The owner wants one working rule to hold for everyone who uses Cairn, not only for him: the person states needs and makes architecture decisions; the agents research the rest themselves, which means finding strong open-source implementations on GitHub, reading their source and comparing them, and they come back with a proposal that carries only the real decisions. He wants it built into the product ("into the project, not the repository"), so every member of a project sees the decision at work.

Today the rule mostly lives on the owner's machine:

- Unlocked Claude Code steps load the machine user's settings (`CLAUDE_SETTING_SOURCES = ['user', 'project', 'local']` in `apps/daemon/src/backend/claude-code.ts`), so his `~/.claude` instructions reach threads that run on his machines. A teammate's machine has none of them.
- Skills come from the daemon machine's `~/.agents/skills` (`CAIRN_SKILLS_DIR`, spec 14). His `research` skill ("prior art first … read the source code itself … web fetching goes through agent-reach") and his `agent-reach` skill exist only there.
- Personal copies drift. On 2026-11-14 the local agent-reach skill told agents to run `agent-reach doctor --json`; agent-reach 1.6.1 rejects that flag (`BAD_INPUT: unrecognized arguments: --json`) because all of its output is now JSON. Nobody else ever had that skill to break.

## What Cairn already has

| Area | Fact | Source |
|---|---|---|
| Research threads | Read-only `info` todos with `researchPrompt` (tier 1 single agent, tier 2 multi-agent). Every claim needs a URL and fetched date; a report with no fetch counts as a failed research run. Runs only on a Claude Code route (409 otherwise) | `services/research-thread.ts`, `shared/records/research-prompts.ts` |
| Research before planning | Opens a research thread and blocks the code thread when the title or spec matches an English regex: `faster\|performance\|latency\|slow…`, `new mechanism\|dependency\|technology choice` | `services/research-before-plan.ts`, called from `thread-message.ts` |
| Live trigger rate | 4 research-before-plan threads for 30 owner-created tasks. 26 of those 30 titles contain Chinese, which the regex cannot match | omarchy DB |
| Stuck, intake, citations | Stuck-retry research, a daily intake, and a citation check by a model from the other vendor (D63, D64) | `research-stuck.ts`, `research-intake.ts`, `research-citations.ts` |
| Prior-art rule in plans | `PLAN_PRIOR_ART_RULE`: feature plans search the web and GitHub for similar implementations and write a `Prior art` section with links plus a reuse-or-build decision; `plan.ts` validates it. It is appended only to `plan` steps. In 30 days there were 45 plan steps, against 158 `session` steps (the D60 thread path) and 2,716 build steps, and session steps never see the rule | `shared/records/prompts.ts`, `daemon/src/step-prompt.ts` |
| Coordinator prompt | "You only route." When a request is unclear it uses `ask_user`. It has no rule about research and none about which questions belong to the person | `buildChiefSystemPrompt` in `services/chief.ts` |
| `ask_user` description | Shared by the Coordinator and every thread (`WORKER_ASK_USER_TOOL`): "Use it whenever the answer would change what you do next." That is the opposite of the owner's rule | `shared/protocol/chief-tools.ts` |
| Worker system prompt | Attachment note, agent description, project instructions, memories. It has no working rule of its own | `composeWorkerSystemPrompt` in `daemon/src/step-prompt.ts` |
| Team and project text | The team `charter` goes only to the Coordinator. Project `instructions` (up to 16,000 characters) go to every thread in that project | `chief.ts`, `machine-claim.ts` |
| Shared skills | The server already distributes a team skills manifest to machines | `daemon/src/team-skills.ts` |
| Search | Claude Code uses its native `WebSearch`/`WebFetch`. pi gets `web_search`/`web_fetch` through Exa or Brave, with the key in SecretBox and a $20 monthly cap. Locked steps get no search | `daemon/src/backend/web-search.ts` |
| Thread questions | 28 `ask_user` questions in 30 days. In a sample of 12, most were legitimate (lockfile approvals, credentials, a real phone); one was a UI direction choice | omarchy DB |

What follows: the machinery for research exists. What is missing is a product-level statement of the rule, a trigger that works in the owner's language, the rule on the path most threads take (session steps), a method for reading source code, and a research toolkit that does not depend on each person's machine.

## Prior art (read through agent-reach on 2026-11-14)

| Product | What it does | Pattern taken |
|---|---|---|
| Cursor Team Rules ([docs](https://cursor.com/docs/rules)) | Admins create rules in the dashboard. A rule can be enforced, applies to every repository of the team "without requiring individual setup", and takes precedence in the order Team → Project → User | Rules live in the product at team level, above project and personal settings |
| Amp Librarian ([news](https://ampcode.com/news/librarian), [plugin source](https://ampcode.com/@amp/plugins/librarian.ts)) | A built-in subagent that searches public GitHub, clones repositories into a scratch directory, reads source in parallel, and returns file and line links pinned to a revision (`github.com/<org>/<repo>/blob/<rev>/<path>#L32-L42`) | Research by reading source, with permalinks as evidence |
| Kiro specs ([requirements-first](https://kiro.dev/docs/specs/feature-specs/requirements-first/)) | Requirements, then design, then tasks. For the design, the person's role is to "iterate on architectural decisions, validate technology choices" | The person's role is defined per phase and limited to decisions |
| Devin plan mode ([modes](https://docs.devin.ai/desktop/devin-local/modes)) | The agent explores read-only, asks clarifying questions, offers "multiple options for you to choose from with an interactive interface", and writes a plan for approval | Decisions are shown as options with a recommendation |
| Anthropic multi-agent research (cited in `docs/research/research-loop-plan.md`) | A lead agent with parallel search subagents; claims are attributed to sources | Already adopted as tier 2 |

## Design

### 1. One product rule with three layers

A shared constant in `packages/shared` (for example `DECISION_BOUNDARY_RULES`) is the product default. It ships with Cairn, is versioned in code and judged by evals, and is the same for every team. Following Cursor's precedence, the layers are:

1. **Product default** (new; not editable): injected into the Coordinator's static prompt, into every unlocked worker system prompt (`composeWorkerSystemPrompt`), and into the `ask_user` description.
2. **Team charter** (exists): teams add their own rules. Proposed: the charter also goes to worker threads, not only the Coordinator.
3. **Project instructions** (exist): per-project rules, unchanged.

Personal machine settings still load, but they are no longer where the rule lives.

Draft rule text. Agent-facing product prompts may be Chinese; this is the meaning in English:

- The person states needs and makes architecture decisions. You research and decide everything else.
- Before you design a new mechanism, add a dependency, fix a performance problem or choose a technology, find two or three strong open-source implementations of the same thing, read their source (not only the README or a blog post), compare them, and cite file permalinks pinned to a commit.
- Do not ask the person for facts you can find in the code, the docs or your research. Decide implementation details by your own recommendation, and say what you chose and why in your report.
- Bring the person only real decisions. Give each one its options, the evidence links and your recommendation.

### 2. What the agent does on its own and what it asks

| On its own | Asks the person |
|---|---|
| Finding and reading open-source implementations, docs, issues and discussions | Architecture and product direction: what to build, which of two designs, a deliberate reversal of a recorded decision |
| Choosing libraries, file layout, naming, test strategy, the shape of an internal API | Irreversible or external actions: payments, credentials, deleting data, publishing |
| Small reversible choices that leave the request's scope unchanged | Anything the team charter or the project instructions route to a person, such as lockfile approval in this repository |
| Recording each choice in a "decided myself" list in its report | Needs that stay ambiguous after research, asked once and batched into one card |

This matches the repository's own rule ("agents decide by their own recommendation … ask for payments, credentials, intended-behavior or design changes") and turns it into product behavior.

### 3. Where a user sees it

- **Coordinator chat.** When a request involves design work, the Coordinator replies with one line, such as "I'll look at how others did this first", and opens a research thread. It does not ask the person implementation questions.
- **Proposal, not just a report.** A research report ends with two sections: "Decided myself" (each item with its reason) and "For you to decide" (at most three decisions, each with options, evidence links and one option marked recommended). The thread or the Coordinator shows the second section as the existing `ask_user` card, with the recommended option first; the answer is stored as a task decision (`appendDecisionsNote`), so it is not asked again.
- **Settings (later phase).** The charter dialog shows the product rule read-only above the team charter, so a team can see what Cairn already does and what it added.

### 4. The research toolkit ships with Cairn

- **Method in the product.** `researchPrompt` gains a source-reading method taken from Amp Librarian and the owner's research skill: search GitHub (`gh search repos` and `gh search code`, or the web search tool); make shallow clones into the step's scratch directory; read the relevant files; build a comparison table with file permalinks at a commit SHA; label each claim as read first-hand, inferred or guessed. Session threads get the same method through the shared rule.
- **Bundled research skill.** Cairn ships a `research` skill through the existing team skills manifest as a built-in, so every machine has the same version whatever is in `~/.agents/skills`. Threads that decide to research mid-task load it.
- **Web access.** Claude Code keeps its native search. pi keeps `web_search`/`web_fetch`. GitHub reading uses the machine's `gh` and `git`, which every Cairn machine already needs.
- **agent-reach as an optional capability.** The daemon detects `agent-reach` on `PATH` and reports its version and channel status (`agent-reach doctor`, which makes no network calls) with the machine's capabilities. The bundled skill routes through agent-reach only on machines that have it, with a minimum version, so a CLI change breaks one tested place instead of each person's copy. Cairn does not install it automatically: it is a Python tool that downloads browsers, and this repository does not run install scripts without authorization. Channels that need a login (X, Reddit, Xiaohongshu) stay personal: the cookies belong to one person and never go into a profile, and the harness-profile rule already forbids secret values there.

### 5. Triggers

- **Phase 0 stopgap:** add Chinese keywords to `researchBeforePlanReason` (`性能`, `变慢`, `更快`, `延迟`, `新机制`, `依赖`, `选型`, `技术方案`, `架构`).
- **Phase 2:** the Coordinator decides. `create_todo` gains an optional `research: { reason }` field, and `holdCodeThreadForPriorResearch` reads that field instead of the regex. The Coordinator is already a model that reads Chinese and already sets `difficulty`.
- **Every phase:** a session thread doing feature work runs its own prior-art step under the shared rule, even when no separate research thread was opened, and its report or PR has a `Prior art` section. This moves `PLAN_PRIOR_ART_RULE` from plan steps only to the shared rule.

## State, protocol and paths

| Phase | Persisted or wire change | Paths that read or write it |
|---|---|---|
| 0 | None: prompt text and one tool description | `buildChiefSystemPrompt`, `composeWorkerSystemPrompt`, `WORKER_ASK_USER_TOOL` and the Coordinator `ask_user`, `researchPrompt`, `researchBeforePlanReason` |
| 1 | Built-in skill entries in the team skills manifest; a machine capability field for agent-reach | Manifest build and `materializeTeamSkills`; the machine capability report in `services/machine*.ts`, a security surface that merges under Merge routes with `/security-review` |
| 2 | `create_todo` `research` field, stored with the todo request | `create_todo` handler, `holdCodeThreadForPriorResearch`, `split_todo`, Coordinator eval fixtures; its own one-page design before code |
| 3 | Report sections "Decided myself" and "For you to decide" parsed into an `ask_user` card | Info report handoff (`blocker-handoff.ts`), `chief-questions.ts`, `worker-questions.ts` |

## Failure behavior

- **No search tool on the step** (locked, or pi without a key): the research run fails loudly, as `researchPrompt` already requires. The thread continues and marks its proposal "not researched"; it does not present training knowledge as research.
- **GitHub rate limit or a failed clone:** the report lists each blocked source with the reason and cites what it did read. Clones are shallow, size-capped and temporary.
- **Cloned code or pages contain instructions:** they are data. The research thread is read-only, and its report enters other sessions only inside the quoted-data fence, as today.
- **Over-triggering on small tasks:** a one-line fix (`Kind: fix`) skips research, as the plan rule already allows. The Phase 2 trigger belongs to the Coordinator and is measured.
- **Under-asking (an agent decides a real architecture question itself):** the report's "Decided myself" list makes this visible, and the person can reverse it with one message.

## Measurement

- Coordinator eval cases run through the paired-trial adoption judge (spec 29), with requests written in Chinese: a request to make X faster should open research; a request to change a button color should not; "should we use A or B" should come back as a proposal with a recommendation.
- Weekly: the share of feature threads whose report or PR cites at least two GitHub source permalinks; `ask_user` questions per thread; and, on a sample, the share of questions that are real decisions.

## Phases

- **P0, prompt only (one PR, under 400 lines):** the shared rule in the Coordinator prompt, the worker prompt and the `ask_user` description; the prior-art rule for session threads; the source-reading method in `researchPrompt`; Chinese keywords in the regex; eval cases.
- **P1, toolkit:** the bundled research skill in the team manifest, and agent-reach detection as an optional capability.
- **P2, the Coordinator decides research:** the `create_todo` field replaces the regex.
- **P3, the proposal card and settings:** the report's decision section becomes an `ask_user` card, and the settings show the product rule.

## Decisions for the owner

Decided (owner, 2026-11-14): Cairn is meant for other people, so the rule goes into the product and all four phases are scheduled in order. Decisions 1 to 4 are taken as recommended: the rule is a product default teams cannot remove; the team charter will reach worker threads (P1); agent-reach is a detected optional capability (P1); a new dependency is the agent's call given evidence, unless a team, project or repository rule says otherwise.

1. Is the rule a product default that teams cannot remove (recommended), or default charter text that a team can delete?
2. Should the team charter also reach worker threads? Recommended: yes.
3. Should agent-reach be an optional capability that Cairn detects (recommended), or a pinned version that Cairn installs on every machine?
4. Is the "asks the person" list in section 2 right? In particular, is a new dependency the agent's call, given evidence, unless a team rule says otherwise?
5. P0 is implemented now.
