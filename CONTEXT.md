# Cairn domain model and vocabulary

This file fixes, for each domain concept, a three-column mapping between the Chinese UI word, the English word and the internal code name, and settles the boundaries between concepts (positioning is in `docs/spec/18-positioning-and-differentiation.md`). Implementation contracts (the full phase enum, REST and SSE endpoints, record shapes) are not here; they live in the `docs/spec/` architecture specs (map ticket #41).

Internal names are renamed only where a word is overloaded, and each rename is marked (see `密钥`).

## Tenant hierarchy

| Chinese UI word | English word | Internal name | Definition / boundary |
|---|---|---|---|
| `团队` | Team | `team` | The top-level tenant boundary; projects, Agents, machines, resources, and plans all belong under it. |
| `项目` | Project | `project` | The unit under a team that aggregates todos, repos, and files. |
| `仓库` | Repo | `repo` | The code source bound to a project, in two forms: GitHub connected (`githubRepo`) or a local folder (`localPath`, which must be a git repository — the server's three-state validation: not_absolute / not_found / not_git). It is a property of Project, not an independent tenant layer. The hosted (Cairn-hosted) form has been removed. **Per-form discardability fork** (ADR 0016): with `githubRepo` the source of truth is remote and a dead machine can be replaced to continue the run; `localPath` is a single-machine cached form — the source of truth lives on that machine's filesystem, and if the machine is lost the progress goes with it, with no machine-swap continuation. **Dual execution sources** (ADR 0017 / #1213): a `githubRepo`-form project may optionally mount a `localPath` as a same-machine execution accelerator — the source of truth is always GitHub (the server only validates the absolute-path form, and the daemon materializes with a double condition "path exists + that path's origin is the same repo as githubRepo", silently falling back to a GitHub clone otherwise); the same project executed by two kinds of machines each uses the source it can reach. **Execution boundary of the local form** (#1210): the `localPath` of a local-form project is a path on the registering machine's filesystem, and steps are only executable on the machine where the repo lives; if the path is unreachable on another execution machine, the daemon fails explicitly before clone/fetch, with the step's errorMessage naming the machine, the path, the reason, and the remedy (pin the task back to the machine where the repo lives, or use the GitHub form for the project when developing across machines). |

_Avoid_: **Workspace** — it is not a domain entity; it only means the task checkout directory on the execution machine's local disk (`~/.cairn/workspaces/<conversationId>`); do not use it to mean team or any UI layer.

## Task lifecycle

| Chinese UI word | English word | Internal name | Definition / boundary |
|---|---|---|---|
| `任务` | Todo | `todo` | One thing the user wants done; persistent and sequenced (`#seqNum`); a card on the board is one todo. |
| `阶段` | Phase | `phase` | The todo's current state. The board's columns are only one view of the phases, not independent entities. |
| `运行` | Build | `build` | One execution of a todo: one run = one build = one conversation = one worktree + branch. Its id equals `conversationId`. |
| `对话` | Conversation | `conversation` | An alias view of the message stream a build produces, sharing its UUID; not an independent entity. |
| `方案` | Plan | `plan` | The typed planning artifact card inside a build (Context / Changes / Edge cases / Verification); not an independent entity. |
| `标签` | Tag | `tag` | The category label of a todo. **The vocabulary source and the count cap fork by repo form**: `githubRepo` projects use the repo's actual label set (dynamic — however many labels the issues carry); `local` projects use a fixed 6-word vocabulary (bug / feature / improvement / refactor / docs / chore), seeded with the project, at most 1 per todo. In both forms the executing agent back-fills it at dispatch time, with no human creation/picking UI (ADR 0002 D4/D5, ADR 0005 D2/D4). |
| `占位标题` | Placeholder title | `title` (placeholder state) | The truncated first-line title persisted when the todo is saved (first line of the body, ≤50 chars); after claiming the task, the executing agent uses an LLM summary to back-fill the formal title over it. **Local projects only** — todos created from issues in GitHub projects use the issue title directly and have no placeholder state (ADR 0005 D5). |
| `来源` | Source | `sourceKind` / `sourceRef` | Where the todo comes from — **external source or orchestration source** (#640 / r14 §5.3: no longer limited to external); at most one per todo, belonging to the existing provenance family of `todo`. Two families: `github-issue` / `github-issue-self` (external, `sourceRef` shaped like `github:owner/repo#123`) — todos in GitHub projects **have landing points on both sides**: a claimed one records that issue, a self-dispatched one creates one (ADR 0005 D6, ADR 0006 D1), but **the issue's state is not rewritten and not auto-overwritten** — the issue side remains the source of truth and cairn only displays the diff (ADR 0006 D5/D6); `orchestration` (orchestration, `sourceRef` shaped like `chief:<uuid>`) — a child card split out by a chief orchestration round, pointing at that request's orchestration conversation (per-request granularity, answering "which request split this"; together with `createdBy`/`sourceBuildId`, which answers "who created it", the three layers each answer one question, r14 §5.3). At most one source; the mirror write of GitHub-connected projects takes the slot first (r14 §5.7). |

Boundary rulings:
- **No Goal concept** — there is only one work unit, the `todo`; "Goal" is not introduced.
- **`待验收` and `审核` are two UI words for the same phase**; the canonical name takes the column name `待验收`; `完成` (`done`) is an action/button, not a phase name.
- **`待处理` refers only to the board's "needs my attention" column** (`confirm` / `review` / `failed`). A `todo` sits in the `待开始` column with the chip word `待开始`; `queued` (started, waiting for a free machine) sits in the `执行中` column with the chip word `排队中` (#1400, column position #1447). Chip words may differ from column names (`确认` / `审核` / `失败` all sit in the `待处理` column), but when a chip word shares characters with a column name, that phase must be in that column.
- Build and Conversation are two faces of one entity (execution vs message stream); they are not split into two id systems.
- **New todos have no "title" input surface** — the user only writes the task body; title = placeholder title → agent back-fills, in two stages (ADR 0002, **local projects only**; GitHub-project todos take the title from the issue, see ADR 0005 D5); the label state axis is not introduced, having been subsumed by `phase`.
- **The source of truth for labels and titles forks by repo form** — `githubRepo` projects take metadata truth from the issue, `local` projects keep it inside cairn (ADR 0005 D1). The fork is driven by constraints, not preference: local projects have no external source of truth to defer to. Do not assume the two forms behave identically when reading this vocabulary.
- **`issue` is not a cairn entity** — a GitHub issue appears only as an external reference inside "source". Cairn creates issues on GitHub and writes their titles (ADR 0006 D1/D3), but **introduces no Issue record, mirrors no state, and does no auto-sync** — the truth direction is always issue → cairn (ADR 0005 D1, ADR 0006 D5).

## Execution bodies

| Chinese UI word | English word | Internal name | Definition / boundary |
|---|---|---|---|
| `机器` | Machine | `machine` | A registered execution host (`cairn` daemon + embedded pi runtime) that claims and runs build steps. One machine can carry steps of multiple Agents; it is not a property of an Agent. |
| `Agent` | Agent | `agent` | An execution role configured with model, responsibilities, skills, tools, keys, MCP, and memory; runs on some machine. |
| `总管` | Chief | `chief` | The dispatch-and-conversation agent, one per "user × team", responsible for assigning tasks; domain-wise distinct from worker Agents that do the work. |
| `主力机` | Primary machine | `chief.machineId` | The chief's default execution machine (#895): the second level of the chief new-thread pinning default chain (`todo.machineId` → this slot → null); pinning semantics are the same as `todo.machineId` — deterministic, no automatic fallback, unpinning belongs to the user; null = automatic (any online machine claims it + conversation affinity). It governs only the chief thread's pinning, not worker dispatch. The setting surface is the "machine" slot in the Agent tab of chief settings (PATCH /chief); the machines page shows a read-only three-state marker (chief host / round in progress / waiting for machine). |
| `记忆` | Memory | `memory` | Experience entries an agent accumulates while working. The todos.dev write path is unmeasured [black box]; the replica uses a minimal mechanism (02-architecture-parity §4.4, all marked [inferred], pending #46 calibration). |

Boundary: Agent ≠ Machine (one is a configured role, the other the physical host that carries it). Chief is its own concept, never called a kind of Agent. The chief panel is a floating window (ADR 0013, superseding ADR 0004's right-docked column); its vocabulary is in "Chief panel and machine binding" below.

## Resources and configuration

| Chinese UI word | English word | Internal name | Definition / boundary |
|---|---|---|---|
| `技能` | Skill | `skill` | A reusable-process folder containing `SKILL.md`, taught to Agents; an Agent may carry it by default or be granted it. |
| `模型服务` | Provider | `provider` | A credential-configured model source (three protocols: api_key / oauth / custom endpoint). |
| `模型` | Model | `model` | One named selectable option under a Provider. [Exclusion: built-in models go through Pro and are out of the replica's scope.] |
| `MCP 服务器` | MCP server | `mcpServer` | An external MCP server connected by the team, giving an Agent extra tools (direction: external → Agent); tool names `mcp__<identifier>__<tool>`. |
| `团队密钥` | Secret | `secret` | A key-value pair authorized per Agent and issued per step, write-only; the plaintext is not pre-placed in the task shell environment (the agent takes it explicitly through the retrieval channel, and retrieval leaves an audit row). |
| `API 密钥` | API key | `apiKey` | A credential shaped like `cairn_…`, used for machine registration and as an MCP Bearer, with read/write tool whitelists. |

Boundary rulings:
- **`密钥` is an overloaded word, forcibly split into two senses** — `secret` (team secret) ≠ `apiKey` (access token). The two words are kept strictly separate in code.
- **MCP has only one direction as an entity** — `mcpServer` means the team connecting external tools (external → Agent). todos.dev itself being connectable by external MCP clients is a capability of `apiKey`; no separate `McpClient`/`McpGateway` concept is introduced.
- Provider ≠ Model (one is a credential-configured source, the other a selectable option under it).

## Records and observability

| Chinese UI word | English word | Internal name | Definition / boundary |
|---|---|---|---|
| `定时` | Schedule | `schedule` | Automatically re-runs a todo on a cron or one-shot schedule; each round triggers a new build, pausing at the confirm/review gates. |
| `通知` | Notification | `notification` | The collective name for desktop browser push + in-site unread; one concept, multiple delivery channels. |
| `记录流` | Transcript | `transcript` | The ordered message and tool-call record of a build; it is a facet of the build, not an independently operable entity. |
| `段` | Segment | `segment` (row form `msg-<stepId>-<n>`) | **One continuous run of same-type deltas** output by the model within a single turn (`text` or `thinking`). Tool calls are independent records, not segments. A segment is closed at the **write side** (type change / tool arrival / message end / step wrap-up); the streaming period and the persisted period share one source — the same segment is both the row that appears immediately during streaming and the row in the final version. |
| `Token 用量` | Token usage | `tokenUsage` | The accounting reading aggregated by "build × model × input/output/cache-read/cache-write"; a value object with no lifecycle of its own. |

## Chief panel and machine binding

Moved from the former `GLOSSARY.md`. Each entry names the canonical UI word and the words to avoid.

| UI word | English | Definition | Avoid |
|---|---|---|---|
| `总管` | Chief | The resident orchestration agent, one per user × team: it plans tasks, dispatches builds and talks with people. | `主管`, boss |
| `总管面板` | Chief panel | The chief's only conversation surface, shaped as a floating window (ADR 0013). | `抽屉`, drawer, `竖板`, `主管` pane (the first three name the retired right-docked panel; code identifiers such as `chief-drawer.tsx` are cleaned up with #1009 A0) |
| `悬浮窗` | Floating window | A floating card window anchored to the bottom right of the content area: no modal, no scrim, resident across pages, open state persisted (closed by default). Follows the Multica floating chat window. | `悬浮卡`, `浮窗`, `浮层` |
| `常驻` | Resident | How the floating window exists: mounted once in the root layout, not remounted on route change, kept (inert) when closed, open state kept across reloads. | `常开`, `永挂` |
| `最小化` | Minimize | The floating window's only way to collapse: it returns to the bottom-right FAB and keeps its draft, scroll and thread. It is not a destructive close. | `关闭` (for the floating window), `收起` |
| `贴右竖板` | Right-docked panel | Historical (ADR 0004, retired): a full-height panel docked to the right edge that pushed the content column aside. Appears in old tickets and ADRs; not used in new copy. | |
| `让位` | Yield | Historical (ADR 0004 D2/D7/D8, retired): the content column narrowing or pushing the right pane away when the panel opened. The floating window overlays, so nothing yields. | |
| `归属机` | Home machine | The one machine an agent is bound to: all of that agent's steps go to it, and it is required when the agent is created. The only answer to which machine an agent belongs to (ADR 0019). | `绑定机`, `钉选` (the retired mechanism below) |
| `换绑` | Rebind | Moving an agent's home machine to another machine. The target must be able to run the agent (runtime and models present), otherwise the rebind is refused. | `迁移` (short for whole-machine migration, a different thing), `改派` |
| `整机迁移` | Machine migration | Rebinding every agent of one machine to another in one go. Agents that pass the check move; the rest stay with the reason listed. A partial migration is a normal outcome, not a failure. | `撤离`, evacuate (kept in code identifiers, not in copy) |
| `钉选` | Pin | Historical (ADR 0018 decision 4, retired): four separate ways to name an execution machine on a task, build, chief thread or schedule. All retired when home machines landed; appears in old tickets. | |
