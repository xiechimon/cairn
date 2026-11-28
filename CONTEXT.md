# Cairn domain model and vocabulary

This file fixes, for each domain concept, a three-column mapping between the Chinese UI word, the English word and the internal code name, and settles the boundaries between concepts (positioning is in `docs/spec/18-positioning-and-differentiation.md`). Implementation contracts are not here. The phase enum and its labels live in `packages/shared/src/phase.ts`, the task panel's sections in `apps/web/src/board/tasks-sections.ts`, record shapes in `packages/shared/src/records/`, and REST, SSE and machine wire in `packages/shared/src/protocol/`.

Internal names are renamed only where a word is overloaded, and each rename is marked (see `密钥`).

## Tenant hierarchy

| Chinese UI word | English word | Internal name | Definition / boundary |
|---|---|---|---|
| `团队` | Team | `team` | The top-level tenant boundary; projects, machines, resources, and plans all belong under it. |
| `项目` | Project | `project` | The unit under a team that aggregates todos, repos, and files. |
| `仓库` | Repo | `repo` | The code source bound to a project, in three forms: GitHub connected (`githubRepo`), a local folder (`localPath`, which must be a git repository — the server's three-state validation: not_absolute / not_found / not_git), or a bare repository the server hosts (`hosted`, provisioned by `provisionHostedRepo` and served by `routes-git-hosting.ts`). It is a property of Project, not an independent tenant layer. **Per-form discardability**: with `githubRepo` or `hosted` the source of truth is remote from the execution machine and a dead machine can be replaced to continue the run; `localPath` is a single-machine cached form — the source of truth lives on that machine's filesystem, and if the machine is lost the progress goes with it, with no machine-swap continuation. **No local accelerator on the GitHub form**: the #1213 dual execution source (a `githubRepo`-form project mounting a `localPath` as a same-machine accelerator) was removed by the owner on 2026-11-20; a GitHub-form project carries no `localPath`, always runs from its GitHub clone, and a local-to-GitHub conversion drops the local folder. **Execution boundary of the local form** (#1210): the `localPath` of a local-form project is a path on the registering machine's filesystem, and steps are only executable on the machine where the repo lives; if the path is unreachable on another execution machine, the daemon fails explicitly before clone/fetch, with the step's errorMessage naming the machine, the path, the reason, and the remedy (route the task to the machine where the repo lives, or use the GitHub form for the project when developing across machines). |

_Avoid_: **Workspace** — it is not a domain entity; it only means the task checkout directory on the execution machine's local disk (`~/.cairn/workspaces/<conversationId>`); do not use it to mean team or any UI layer.

## Task lifecycle

| Chinese UI word | English word | Internal name | Definition / boundary |
|---|---|---|---|
| `任务` | Todo | `todo` | One thing the user wants done; persistent and sequenced (`#seqNum`); a row in the `任务` panel is one todo. |
| `阶段` | Phase | `phase` | The todo's current state. The task panel's sections are only one view of the phases, not independent entities. |
| `运行` | Build | `build` | One execution of a todo: one run = one build = one conversation = one worktree + branch. Its id equals `conversationId`. |
| `对话` | Conversation | `conversation` | An alias view of the message stream a build produces, sharing its UUID; not an independent entity. |
| `方案` | Plan | `plan` | The typed planning artifact card inside a build (Context / Changes / Edge cases / Verification); not an independent entity. |
| `标签` | Tag | `tag` | Retired (#3481, #5344). The tag UI, vocabulary routes, `tag`/`todo_tag` tables and `tagIds` wire fields are all removed. `github_label`/`todo_github_label` are the only label state; the `tag`/`tags` keys on GitHub-task metadata mean GitHub label names. Do not add tag UI or category fields. |
| `占位标题` | Placeholder title | `title` (placeholder state) | The truncated first-line title persisted when the todo is saved (first line of the body, ≤50 chars); after claiming the task, the executing agent uses an LLM summary to back-fill the formal title over it. Every task starts here: a task a person writes gets a placeholder title, and the Coordinator names the task it creates. |
| `来源` | Source | `sourceKind` / `sourceRef` | Where the todo comes from — **orchestration source, or nothing**; at most one per todo, belonging to the existing provenance family of `todo`. `orchestration` (orchestration, `sourceRef` shaped like `chief:<uuid>`) — a child card split out by a Coordinator orchestration round, pointing at that request's orchestration conversation (per-request granularity, answering "which request split this"; together with `createdBy`/`sourceBuildId`, which answers "who created it", the three layers each answer one question). A task a person creates has no source. The `github-issue` / `github-issue-self` values survive only on rows written before 2026-11-28 and are read, never produced. |

Boundary rulings:
- **No Goal concept** — there is only one work unit, the `todo`; "Goal" is not introduced.
- Chip words live in `apps/web/src/phase.ts`, phase labels in `packages/shared/src/phase.ts`, and the task panel's section order and labels in `apps/web/src/board/tasks-sections.ts`. Use those values; do not invent section names. The review phase has two words for one phase, and `done` is an action, not a phase name.
- Build and Conversation are two faces of one entity (execution vs message stream); they are not split into two id systems.
- **New todos have no "title" input surface** — the user only writes the task body; title = placeholder title → agent back-fills, in two stages; the Coordinator names a task it creates. The label state axis is not introduced, having been subsumed by `phase`.
- **Titles and labels live only inside cairn** — no repo form defers to an outside source: `github_label` / `todo_github_label` are the label state, and a title comes from the owner's words or the Coordinator. Cairn never creates, renames, comments on or closes a GitHub issue.
- **`issue` is not a cairn entity** — Cairn holds no Issue record, no issue state and no issue link. An agent that works a GitHub issue does it in its own task with `gh` or a GitHub MCP connector, outside Cairn's domain model.

## Execution bodies

| Chinese UI word | English word | Internal name | Definition / boundary |
|---|---|---|---|
| `执行机` | Runner | `machine` | A registered execution host (`cairn` daemon + embedded pi runtime) that claims and runs build steps. The Chinese UI says `执行机` and the English UI says `Runner` (owner, 2026-11-15); code, tables and the wire keep `machine`. One Runner is the default Runner (`team.defaultMachineId`). |
| `Agent` | Agent | `agent` | Retired (#5347). The configured execution role is replaced by two team-level records: `routing_rule` (per route use: provider, modelId, thinkingLevel, fallbackModels, home `machineId`, requiredCapabilities) picks model and machine, and `work_policy` (per route use: tools, mcpServers, skillsAllowlist, defaultSkill, secrets) grants capabilities; `GET /api/teams/:id/routing-settings` is the surface, and every `/api/teams/:id/agents` route returns 410. Do not reintroduce per-agent configuration. |
| `电脑` | Computer | `computer` | An execution host computer and any physical computer named in setup steps (`在你的电脑上运行…`). A registered host is called `执行机`. |
| `Coordinator` | Coordinator | `chief` | The dispatch-and-conversation agent, one per "user × team", responsible for assigning tasks; domain-wise distinct from the builds it dispatches. |
| `主力机` | Primary machine | `chief.machineId` | Retired with agents and pinning: the `chief` row carries no `machineId`, and Coordinator steps route through routing rules like any other step. |
| `记忆` | Memory | `memory` | Experience entries written by the Coordinator while working and injected into later turns. Direct in-place edits of memory files are planned in `docs/design/memory-inplace-edit.md`. |

Boundary: routing rule ≠ machine (one names model, home machine and constraints, the other the physical host that claims the step). Coordinator is its own concept, never called a kind of Agent. The Coordinator's only conversation surface is the home route `/app`; there is no floating Coordinator window. Its vocabulary is in "Coordinator panel and machine binding" below.

## Resources and configuration

| Chinese UI word | English word | Internal name | Definition / boundary |
|---|---|---|---|
| `技能` | Skill | `skill` | A reusable-process folder containing `SKILL.md`; a work policy grants it through `skillsAllowlist` or names it as `defaultSkill`. |
| `服务商` | Provider | `provider` | A credential-configured model source (three protocols: api_key / oauth / custom endpoint). The settings section and every string say `服务商`; `模型服务` and `模型提供方` are retired copy. |
| `模型` | Model | `model` | One named selectable option under a Provider. |
| `MCP 服务器` | MCP server | `mcpServer` | An external MCP server connected by the team and granted to steps through a work policy (direction: external → step); tool names `mcp__<identifier>__<tool>`. |
| `团队密钥` | Secret | `secret` | A key-value pair authorized through a work policy and issued per step, write-only; the plaintext is not pre-placed in the task shell environment (the agent takes it explicitly through the retrieval channel, and retrieval leaves an audit row). |
| `API 密钥` | API key | `apiKey` | A credential shaped like `cairn_…`, used for machine registration and as an MCP Bearer, with read/write tool whitelists. |

Boundary rulings:
- **`密钥` is an overloaded word, forcibly split into two senses** — `secret` (team secret) ≠ `apiKey` (access token). The two words are kept strictly separate in code.
- **MCP has only one direction as an entity** — `mcpServer` means the team connecting external tools (external → step, granted by a work policy). Cairn itself being connectable by external MCP clients is a capability of `apiKey`; no separate `McpClient`/`McpGateway` concept is introduced.
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
| `归属机` | Home machine | The machine named by a routing rule (`routing-rule.machineId`). A step goes to that machine when nothing else routes it; a task route override may send a step to any machine that passes the hard constraints (runtime, model, capabilities, local-path). Agents no longer exist: every `/api/teams/:id/agents` route returns 410, and models, machines and permissions come from routing rules and work policies (`GET /api/teams/:id/routing-settings`). | `绑定机`, `钉选` (the retired mechanism below), agent home machine |
| `换绑` | Rebind | Historical (retired with agents): moving an agent's home machine to another machine. No route serves it now; changing where a step runs means editing the routing rule. | `迁移`, `改派` |
| `整机迁移` | Machine migration | Historical (retired with agents): rebinding every agent of one machine to another in one go. No route serves it now. | `撤离`, evacuate (kept in code identifiers, not in copy) |
| `钉选` | Pin | Historical (retired): four separate ways to name an execution machine on a task, build, Coordinator thread or schedule. All retired when home machines landed; appears in old tickets. | |

## Status words

One word per state, in every surface that shows that state (row notes, badges, dialogs, toasts). The gate in `apps/web/test/unslop-signs.test.ts` (rule T5) reads the Avoid column of this table and of the register table below and fails on any listed form in the zh/en tables, `t()` literals and the desktop dialog copy. A backticked cell starting with `/` is a regular expression; any other backticked cell is a literal.

| State | Chinese | English | Avoid |
|---|---|---|---|
| connected | `已连接` | Connected | |
| not connected | `未连接` | Not connected | `没连上` |
| connecting | `正在连接` | Connecting | |
| cannot connect | `无法连接` | Cannot connect | `连不上`, `不可达`, `/\b[Uu]nreachable\b/`, `/\b[Bb]roken\b/` |
| online / offline (Runner) | `在线` / `离线` | Online / Offline | `掉线` |
| needs sign-in | `需要登录` | Needs sign-in | |
| needs authorization | `需要授权` | Needs authorization | |
| waiting for authorization | `等待授权` | Waiting for authorization | |
| authorization revoked | `授权已撤销` | Authorization revoked | `授权已收回` |
| checking | `正在检查` | Checking | |
| not checked | `未检查` | Not checked | `还没检查`, `Not checked yet` |
| not started | `尚未开始` | Not started | |
| expired | `已过期` | Expired | |
| unavailable | `不可用` | Unavailable | `用不了` |
| needs attention | `需要处理` | Needs attention | |
| failed to load | `未能加载` | did not load | `没加载`, `没能加载` |
| empty list | `暂无…` | No … | `还没有` |

## Copy register

Copy is neutral and precise: written Chinese, no spoken softeners, no slang, no jokes. Name the party (`服务商`, `执行机`, `Coordinator`), never `那边`. English has no contractions.

| Write | Instead of (Avoid) |
|---|---|
| `未能保存` / Could not save | `没能`, `没保存`, `没生成`, `没完成`, `没通过`, `没成功`, `没找到`, `没删`, `没改`, `没复制`, `没拍`, `没发` |
| `尚未` / `暂无` | `还没` |
| `运行`, `重新运行`, `继续运行` | `跑` |
| `获取` | `拿到`, `拿不到`, `没拿到`, `拿新` |
| `无法使用`, `无法运行`, `无法接收` | `接不了`, `跑不了` |
| `安装` | `装好`, `装上` |
| `无响应` | `卡住` |
| `未响应` | `没回` |
| `有误`, `填写有误` | `不对`, `填错` |
| `更换` | `换个` |
| `当前` | `这会儿` |
| `通常` | `多半`, `一般就好` |
| `即将` | `马上` |
| `均保留` | `都还在` |
| `已不存在` | `已经不在了` |
| `粘贴到` | `粘到`, `/(?<!粘)贴到/` |
| `执行任务` | `干活` |
| `请重试`, `请稍后重试` | `再试一次`, `稍后再试`, `重试一下` |
| `点击` | `点一下` |
| `API key` (a provider or app key) | `/API Key\b/`, `/(?<!API )\bkey\b(?=[^A-Za-z]*[\u4e00-\u9fff])/` |
| `执行机` / Runner, `this computer` for `本机` | `/机器(?!人)/`, `/(?<!\{)\b[Mm]achines?\b(?![}：:])/` |
| `服务商` / provider | `模型服务`, `模型提供方` |
| `cannot`, `did not`, `it is` | `/\b[A-Za-z]+n['’]t\b/`, `/\bI['’]m\b/`, `/\b[Ii]t['’]s\b/`, `/\b[Yy]ou['’]re\b/`, `/\b[Ww]e['’]re\b/`, `/\b[Tt]hat['’]s\b/`, `/\b[Tt]here['’]s\b/`, `/\b[Ll]et['’]s\b/` |
| (drop the filler) | `/\bjust\b(?! now)/` |

