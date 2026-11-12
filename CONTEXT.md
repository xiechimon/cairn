# Cairn domain model and vocabulary

This file fixes, for each domain concept, a three-column mapping between the Chinese UI word, the English word and the internal code name, and settles the boundaries between concepts (positioning is in `docs/spec/18-positioning-and-differentiation.md`). Implementation contracts are not here. The phase enum and board columns live in `packages/shared/src/phase.ts`, record shapes in `packages/shared/src/records/`, and REST, SSE and machine wire in `packages/shared/src/protocol/`.

Internal names are renamed only where a word is overloaded, and each rename is marked (see `密钥`).

## Tenant hierarchy

| Chinese UI word | English word | Internal name | Definition / boundary |
|---|---|---|---|
| `团队` | Team | `team` | The top-level tenant boundary; projects, Agents, machines, resources, and plans all belong under it. |
| `项目` | Project | `project` | The unit under a team that aggregates todos, repos, and files. |
| `仓库` | Repo | `repo` | The code source bound to a project, in three forms: GitHub connected (`githubRepo`), a local folder (`localPath`, which must be a git repository — the server's three-state validation: not_absolute / not_found / not_git), or a bare repository the server hosts (`hosted`, provisioned by `provisionHostedRepo` and served by `routes-git-hosting.ts`). It is a property of Project, not an independent tenant layer. **Per-form discardability**: with `githubRepo` or `hosted` the source of truth is remote from the execution machine and a dead machine can be replaced to continue the run; `localPath` is a single-machine cached form — the source of truth lives on that machine's filesystem, and if the machine is lost the progress goes with it, with no machine-swap continuation. **Dual execution sources** (#1213): a `githubRepo`-form project may optionally mount a `localPath` as a same-machine execution accelerator — the source of truth is always GitHub (the server only validates the absolute-path form, and the daemon materializes with a double condition "path exists + that path's origin is the same repo as githubRepo", silently falling back to a GitHub clone otherwise); the same project executed by two kinds of machines each uses the source it can reach. **Execution boundary of the local form** (#1210): the `localPath` of a local-form project is a path on the registering machine's filesystem, and steps are only executable on the machine where the repo lives; if the path is unreachable on another execution machine, the daemon fails explicitly before clone/fetch, with the step's errorMessage naming the machine, the path, the reason, and the remedy (pin the task back to the machine where the repo lives, or use the GitHub form for the project when developing across machines). |

_Avoid_: **Workspace** — it is not a domain entity; it only means the task checkout directory on the execution machine's local disk (`~/.cairn/workspaces/<conversationId>`); do not use it to mean team or any UI layer.

## Task lifecycle

| Chinese UI word | English word | Internal name | Definition / boundary |
|---|---|---|---|
| `任务` | Todo | `todo` | One thing the user wants done; persistent and sequenced (`#seqNum`); a card on the board is one todo. |
| `阶段` | Phase | `phase` | The todo's current state. The board's columns are only one view of the phases, not independent entities. |
| `运行` | Build | `build` | One execution of a todo: one run = one build = one conversation = one worktree + branch. Its id equals `conversationId`. |
| `对话` | Conversation | `conversation` | An alias view of the message stream a build produces, sharing its UUID; not an independent entity. |
| `方案` | Plan | `plan` | The typed planning artifact card inside a build (Context / Changes / Edge cases / Verification); not an independent entity. |
| `标签` | Tag | `tag` | Historical. The tag UI is being retired (#3481): project settings no longer renders a Tags tab, and the client hooks have no consumers. Backend tag routes and persisted categories remain until that ticket closes. Do not add tag UI. |
| `占位标题` | Placeholder title | `title` (placeholder state) | The truncated first-line title persisted when the todo is saved (first line of the body, ≤50 chars); after claiming the task, the executing agent uses an LLM summary to back-fill the formal title over it. **Local projects only** — todos created from issues in GitHub projects use the issue title directly and have no placeholder state. |
| `来源` | Source | `sourceKind` / `sourceRef` | Where the todo comes from — **external source or orchestration source** (#640); at most one per todo, belonging to the existing provenance family of `todo`. Two families: `github-issue` / `github-issue-self` (external, `sourceRef` shaped like `github:owner/repo#123`) — todos in GitHub projects **have landing points on both sides**: a claimed one records that issue, a self-dispatched one creates one, but **the issue's state is not rewritten and not auto-overwritten** — the issue side remains the source of truth and cairn only displays the diff; `orchestration` (orchestration, `sourceRef` shaped like `chief:<uuid>`) — a child card split out by a Coordinator orchestration round, pointing at that request's orchestration conversation (per-request granularity, answering "which request split this"; together with `createdBy`/`sourceBuildId`, which answers "who created it", the three layers each answer one question). At most one source; the mirror write of GitHub-connected projects takes the slot first. |

Boundary rulings:
- **No Goal concept** — there is only one work unit, the `todo`; "Goal" is not introduced.
- Chip words live in `apps/web/src/phase.ts` and board columns in `packages/shared/src/phase.ts` (`BOARD_COLUMNS`). Use those values; do not invent column names. The review phase has two words for one phase, and `done` is an action, not a phase name.
- Build and Conversation are two faces of one entity (execution vs message stream); they are not split into two id systems.
- **New todos have no "title" input surface** — the user only writes the task body; title = placeholder title → agent back-fills, in two stages (**local projects only**; GitHub-project todos take the title from the issue); the label state axis is not introduced, having been subsumed by `phase`.
- **The source of truth for labels and titles forks by repo form** — `githubRepo` projects take metadata truth from the issue, `local` projects keep it inside cairn. The fork is driven by constraints, not preference: local projects have no external source of truth to defer to. Do not assume the two forms behave identically when reading this vocabulary.
- **`issue` is not a cairn entity** — a GitHub issue appears only as an external reference inside "source". Cairn creates issues on GitHub and writes their titles, but **introduces no Issue record, mirrors no state, and does no auto-sync** — the truth direction is always issue → cairn.

## Execution bodies

| Chinese UI word | English word | Internal name | Definition / boundary |
|---|---|---|---|
| `机器` | Machine | `machine` | A registered execution host (`cairn` daemon + embedded pi runtime) that claims and runs build steps. One machine can carry steps of multiple Agents; it is not a property of an Agent. |
| `Agent` | Agent | `agent` | An execution role configured with model, responsibilities, skills, tools, keys, MCP, and memory; runs on some machine. |
| `Coordinator` | Coordinator | `chief` | The dispatch-and-conversation agent, one per "user × team", responsible for assigning tasks; domain-wise distinct from worker Agents that do the work. |
| `主力机` | Primary machine | `chief.machineId` | The Coordinator's default execution machine (#895): the second level of the Coordinator new-thread pinning default chain (`todo.machineId` → this slot → null); pinning semantics are the same as `todo.machineId` — deterministic, no automatic fallback, unpinning belongs to the user; null = automatic (any online machine claims it + conversation affinity). It governs only the Coordinator thread's pinning, not worker dispatch. The setting surface is the "machine" slot in the Agent tab of Coordinator settings (PATCH /chief); the machines page shows a read-only three-state marker (Coordinator host / round in progress / waiting for machine). |
| `记忆` | Memory | `memory` | Experience entries an agent accumulates while working. written by the Coordinator and injected into later turns. Direct in-place edits of memory files are planned in `docs/design/memory-inplace-edit.md`. |

Boundary: Agent ≠ Machine (one is a configured role, the other the physical host that carries it). Coordinator is its own concept, never called a kind of Agent. The Coordinator's only conversation surface is the home route `/app`; there is no floating Coordinator window. Its vocabulary is in "Coordinator panel and machine binding" below.

## Resources and configuration

| Chinese UI word | English word | Internal name | Definition / boundary |
|---|---|---|---|
| `技能` | Skill | `skill` | A reusable-process folder containing `SKILL.md`, taught to Agents; an Agent may carry it by default or be granted it. |
| `模型服务` | Provider | `provider` | A credential-configured model source (three protocols: api_key / oauth / custom endpoint). |
| `模型` | Model | `model` | One named selectable option under a Provider. |
| `MCP 服务器` | MCP server | `mcpServer` | An external MCP server connected by the team, giving an Agent extra tools (direction: external → Agent); tool names `mcp__<identifier>__<tool>`. |
| `团队密钥` | Secret | `secret` | A key-value pair authorized per Agent and issued per step, write-only; the plaintext is not pre-placed in the task shell environment (the agent takes it explicitly through the retrieval channel, and retrieval leaves an audit row). |
| `API 密钥` | API key | `apiKey` | A credential shaped like `cairn_…`, used for machine registration and as an MCP Bearer, with read/write tool whitelists. |

Boundary rulings:
- **`密钥` is an overloaded word, forcibly split into two senses** — `secret` (team secret) ≠ `apiKey` (access token). The two words are kept strictly separate in code.
- **MCP has only one direction as an entity** — `mcpServer` means the team connecting external tools (external → Agent). Cairn itself being connectable by external MCP clients is a capability of `apiKey`; no separate `McpClient`/`McpGateway` concept is introduced.
- Provider ≠ Model (one is a credential-configured source, the other a selectable option under it).

## Records and observability

| Chinese UI word | English word | Internal name | Definition / boundary |
|---|---|---|---|
| `定时` | Schedule | `schedule` | Automatically re-runs a todo on a cron or one-shot schedule; each round triggers a new build, pausing at the confirm/review gates. |
| `通知` | Notification | `notification` | The collective name for desktop browser push + in-site unread; one concept, multiple delivery channels. |
| `记录流` | Transcript | `transcript` | The ordered message and tool-call record of a build; it is a facet of the build, not an independently operable entity. |
| `段` | Segment | `segment` (row form `msg-<stepId>-<n>`) | **One continuous run of same-type deltas** output by the model within a single turn (`text` or `thinking`). Tool calls are independent records, not segments. A segment is closed at the **write side** (type change / tool arrival / message end / step wrap-up); the streaming period and the persisted period share one source — the same segment is both the row that appears immediately during streaming and the row in the final version. |
| `Token 用量` | Token usage | `tokenUsage` | The accounting reading aggregated by "build × model × input/output/cache-read/cache-write"; a value object with no lifecycle of its own. |

## Coordinator panel and machine binding

Moved from the former `GLOSSARY.md`. Each entry names the canonical UI word and the words to avoid.

| UI word | English | Definition | Avoid |
|---|---|---|---|
| `Coordinator` | Coordinator | The resident orchestration agent, one per user × team: it plans tasks, dispatches builds and talks with people. | `主管`, boss |
| `Coordinator 面板` | Coordinator panel | The Coordinator's only conversation surface: the home route `/app`. There is no floating Coordinator window, no drawer and no right-docked Coordinator panel. | `抽屉`, drawer, `竖板`, `主管` pane, Coordinator window, `悬浮窗` (all name retired surfaces) |
| `归属机` | Home machine | The one machine an agent is bound to. A step goes to that machine when nothing else routes it; a routing rule or a task route override may send a step to any machine that passes the hard constraints (runtime, model, capabilities, local-path). The home machine is required when the agent is created and is the only answer to which machine an agent belongs to. | `绑定机`, `钉选` (the retired mechanism below) |
| `换绑` | Rebind | Moving an agent's home machine to another machine. The target must be able to run the agent (runtime and models present), otherwise the rebind is refused. | `迁移` (short for whole-machine migration, a different thing), `改派` |
| `整机迁移` | Machine migration | Rebinding every agent of one machine to another in one go. Agents that pass the check move; the rest stay with the reason listed. A partial migration is a normal outcome, not a failure. | `撤离`, evacuate (kept in code identifiers, not in copy) |
| `钉选` | Pin | Historical (retired): four separate ways to name an execution machine on a task, build, Coordinator thread or schedule. All retired when home machines landed; appears in old tickets. | |
