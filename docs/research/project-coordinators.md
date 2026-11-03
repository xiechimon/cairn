# A super-agent over per-project coordinators: how two-layer agent systems govern many projects

Researched 2026-11-03 for ian's proposal: a team-level super-agent (`总管`, after the DeepSeek DSH super-agent) on top of one coordinator per project, each like a Claude Project (instructions, knowledge, chats), each running its own threads (one claude-code or codex session each). Clicking a project in the sidebar opens that project's coordinator; clicking a task opens its thread.

Evidence labels: **measured** means this research ran it or read it in the product or database; **read** means a pinned primary source says so; **inferred** means it follows from measured or read facts and can be rechecked.

## 0. Conclusions

1. **A Claude Project is not a coordinator (measured).** In claude.ai, two chats in one project are independent conversations. Both followed the project instructions, but the second chat could not see a code word given in the first; Claude replied that chats in one project do not share conversation content automatically and that only what is written into project documents is visible to every chat (§1.2). What a project shares is scope: instructions, files and, when memory is on, a separate per-project memory. So "Claude Projects + a super-agent on top" gives **super-agent → project scope → threads**, which is option (c) below, not a stack of three agents.
2. **None of the two-layer systems studied adds a per-project agent layer under the router.** They govern many projects with scope and rules, not agents:
   - **DSH** scopes one super-agent to one repository; a second repository is a second deployment with its own profile, state directory, worker slots and panel (read: README, `docs/006-deployment.md`).
   - **sig** runs one steward over all of the owner's repos and routes each message to a Thread by explicit reference, a mentioned repo name, full-text match and recency. Each repo gets a 1,500-character project note layer and a serial/parallel setting (read: `docs/design/steward.md` §2.3, §3).
   - **Rakazo** has no router. The user picks a bot ("one bot per job"), and hard isolation is a space (read: `docs/bots-and-chats.md`, `docs/spaces.md`).
   - **Amp** has one personal Puck over projects that hold only configuration (read: docs).
   - **Anthropic** describes two levels, with routing as a classify-then-dispatch step (read).
3. **Where a middle coordinator exists, it is per effort and temporary.** Cursor Projects (one coordinator per "feature, migration, or full app"), Devin's managed-Devin coordinator and Factory Missions start a coordinator for a bounded body of work and drop it when the work ends. They grow a middle layer when one effort has many parallel workers, not when the account has many repos (read).
4. **cairn already tried per-project coordinators and reverted them.** #2500 shipped one Coordinator conversation per project on 2026-11-01. D58 reverted it the same day, because ian found his attention scattered, and #2547 merged the conversations into one. D66 then made a sidebar project "the Coordinator in that project's context" (measured: commits `5c0659184`, `608eabac0`).
5. **The data does not call for it yet.** Over the last 7 days, all 13 active todos were in one of 4 active projects, and 423 of 425 Coordinator messages had no project tag (measured, production database, read-only).
6. **Recommendation:** keep one super-agent, the Coordinator, and give each project what Claude Projects and sig give it:
   - instructions and project-scoped memory;
   - a project chat view that is the same Coordinator filtered and primed with that project;
   - per-project concurrency and priority;
   - project-scoped secrets.

   Add an on-demand effort coordinator thread only when one effort needs several parallel threads. Six PRs (§6); four decisions for ian (§7).

## 1. The shape ian proposes, and what a Claude Project really is

### 1.1 The proposal

```mermaid
flowchart TB
  ian((ian)) --> S[总管 / super-agent<br/>team level]
  S --> P1[cairn coordinator<br/>instructions · knowledge · chats]
  S --> P2[project B coordinator]
  ian -.sidebar: project.-> P1
  P1 --> T1[thread: claude-code]
  P1 --> T2[thread: codex]
  P2 --> T3[thread]
  ian -.task row.-> T1
```

### 1.2 Claude Projects, operated

Walked 2026-11-03 in claude.ai on ian's account (Max plan, Opus 5.5), with a probe project named "cairn probe: project chats":

| Step | Observation | Label |
|---|---|---|
| Create project | The project page has a composer ("New session in …"), **Instructions**, **Context** (files) and **Scheduled** (scheduled tasks). Empty-state copy: "Claude references the same knowledge every time you talk to it in this project." In the sidebar, the pinned project shows its chats nested under it | measured |
| Instructions | Set to "End every reply with the tag [PROBE]." The instructions dialog says they work "alongside your profile instructions" | measured |
| Chat A | "Remember… the code word for this project is BLUE-HERON-42." Reply: it would remember the word "in this conversation" and offered to save it as a project document so other chats could see it. The reply ended with `[PROBE]` | measured |
| Chat B (new session, same project) | Asked for the code word using any past-chat or memory tool. Claude used 2 tools, searched the project files, found nothing, said it has no tool to read other chats and that memory is off on this account, and explained that chats in one project do not share conversation content. The reply ended with `[PROBE]` | measured |
| Per-project memory | When memory is on, "Claude creates a separate memory for each project", described as "a safety guardrail that keeps sensitive conversations contained" | read (claude.com/blog/memory, 2025-09-11) |

So a Claude Project is a **scope**: instructions, files, scheduled tasks and its own memory, shared by independent chats. No agent sits over the chats, and nothing coordinates or dispatches work between them. Mapped onto cairn, project scope ≈ Claude Project, threads ≈ the chats inside it, and the super-agent is the one Coordinator. That is the "Claude Projects with a `总管` on top" shape without a per-project agent.

The probe project is still in ian's claude.ai project list; the Archive menu item did not take effect. Delete it by hand if unwanted.

## 2. What cairn does today

```mermaid
flowchart LR
  ian((ian)) -->|chat, any project| C[Coordinator<br/>one per team<br/>Pi Durable sidecar, D72]
  ian -->|click task, talk directly D65 ②| T1
  C -->|dispatch| T1[thread: claude-code<br/>plan → implement → self-check D60]
  C -->|dispatch| T2[thread: codex]
  T1 & T2 -->|≤200-char report D65 ①| C
  P[(project<br/>repo, base branch, autonomy)] -.tag + filter.-> C
  P -.repo + AGENTS.md.-> T1 & T2
```

| Fact | Source | Label |
|---|---|---|
| One active Coordinator thread per team; `projectId` only tags a turn and filters the page; per-project routes removed; migration 0085 merged the old per-project threads | commit `608eabac0` (#2547), D58 | measured |
| The picked project reaches the model only as a one-line prefix `【输入框选定项目：<name>（id: …）】` | `apps/server/src/services/chief.ts:503-506`, `picked-project.ts` | measured |
| `project` has `description`, repo fields, `baseBranch` and `autonomy`, but no instructions field | `apps/server/src/db/schema.ts` `project` | measured |
| `agent_memory.projectId` exists; `injectMemories` returns a project's rows plus team-wide rows | `schema.ts` `agentMemory`, `services/memory.ts:61-72` | measured |
| Secrets are team-scoped (`secret.teamId`) and granted per agent (`agent.secrets`); there is no project scope | `schema.ts` `secret`, `agent` | measured |
| Concurrency is per machine (`machine.maxConcurrent`, default 3) and per agent (`agent.maxConcurrentTasks`); there is no per-project limit or priority | `schema.ts` | measured |
| D60 ③: the Coordinator is a thin DSH-style router that listens, opens threads and intercepts, and does not plan or wait. D66 ①: a sidebar project opens the Coordinator in that project's context | plan | read |
| 4 active projects; 13 todos with activity in 7 days, all in one project; 425 Coordinator messages in 7 days, 2 with a project tag | `~/.cairn/server/server.db`, read-only, 2026-11-03 | measured |

## 3. How two-layer super-agent systems govern many projects

### 3.1 Summary

| Question | DSH super-agent | sig steward | Rakazo | Amp (Puck) | Anthropic orchestrator-worker |
|---|---|---|---|---|---|
| Unit of "project" | the deployment's one repository | a registered repo (`sh_repo`); a Thread may involve several (`sh_thread_repo`) | a bot ("a bot for one client") inside a space | a project = one codebase's configuration | none |
| Which project does a request belong to? | no choice: the router is scoped to one repo ("assess and route requests for the deployment's repository") | Explicit reply/quote/button first (no LLM). Then a mentioned Thread, repo or machine name, then FTS match, then recency. At most 12 candidates. A policy hook forces `ask_user` unless the match is explicit or high-confidence and unique. A routing eval runs as a merge check | the user picks the bot; in a group chat, `@Name` wakes a bot, and with no mention the first bot answers and may bring in others | Puck uses "the thread or project you are viewing as context"; the CLI matches git remotes (`amp -ox`) | "Routing classifies an input and directs it to a specialized followup task" |
| Per-project context, memory, instructions | one repo: team skill prompts, policy, the repo's own files; DSH ships no memory | Memory in three layers: resident (2,400 chars, every turn), **project (1,500 chars per repo)**, injected "whenever a Thread involving that repo is fetched", and archive. Worker-reported notes stay project-only until the owner confirms | each bot has its own instructions, memory and open-work list; shared memory per space | repo `AGENTS.md`; project env and secrets ("Project values override workspace values"); Puck loads personal and workspace skills | the lead saves its plan to memory |
| Concurrency and priority | per deployment: `maxWorkers` (default 3, max 16); a person's message gets one extra slot, and "wakes have priority over launches" | per repo `--concurrency parallel\|serial`, set only by the local CLI; machine slots; daily budget cap on model wakes | one run per bot's computer at a time; no global queue ("No queue, scan, shared slot or notification sits between a due run and its start") | per orb, per thread | the lead waits synchronously for each batch of subagents |
| Isolation of work and secrets | a separate profile, state directory, git config and agent GitHub account per deployment; one directory or worktree per Ticket; `danger-full-access` inside | per-task worktree; repo isolation, concurrency and approval are local-only settings the steward cannot change; session records stay on the machine | **space** = hard wall: chats, files, memory, computer, app connections and credentials stay inside; bots talk across spaces only if allowed; Team or Private computer per bot | project secrets as orb env; one orb per thread; OIDC workload identity | not addressed |
| What reaches the user | one panel per deployment listing only what needs a person; replies go back into the original GitHub or Feishu conversation | **one merged conversation** with deterministic done cards per Thread, a "Needs you" view and a 90-second fallback that forwards worker questions verbatim | per-bot chat with its own unread state; cards for questions and approvals | Puck "can… bring their results back to you"; thread list | the lead synthesizes |
| When is a middle layer added? | never: more repos means more deployments | never: "If Thread counts grow later, add vector recall inside `findCandidates`; the interface stays unchanged" | never as a layer; a bot may "manage other bots" (fleet tools), but only in runs the user started | never; an agent may start a thread in another project via Agent to Agent | two levels; agents "are not yet great at coordinating and delegating to other agents in real time" |

### 3.2 Products that do add a middle coordinator

| Product | When the middle coordinator appears | What it may do | Lifetime |
|---|---|---|---|
| Cursor Projects (2026-09-10) | a Project = "a feature, a migration, or a full app" | plans and delegates but "doesn't write code itself"; owns the task tracker (workers can read it, not edit it); shared Project Context; subscriptions to a Slack channel, a schedule or PRs; asks before using a new machine | until the effort ends; child coordinators exist |
| Devin managed Devins | Devin "automatically breaks down large tasks" or the user asks to parallelize | spin up, message, sleep or terminate children; woken when a child finishes or needs input; children auto-approved unless turned off | one task |
| Factory Missions | large multi-feature work (1–500 features) | the orchestrator manages workers; "you can talk to it"; validation per feature | one mission |

### 3.3 What this means for the five questions

- **Routing a request to a project.** The routers use cheap deterministic signals first (an explicit reference, the current view, a repo name), then a model pick from a short candidate list, and ask when unsure. cairn has the first signal (the composer pick, and the todo's `projectId` when a message targets a todo), but no ask-when-ambiguous rule or routing eval.
- **Per-project context.** Every system that spans repos gives each repo a small, bounded layer that is injected only when relevant (sig's 1,500 characters, Claude's per-project memory, Amp's project env). None gives the repo its own agent to hold that context.
- **Concurrency and priority.** Limits sit on the executor (DSH slots, sig per-repo serial/parallel, Rakazo one run per computer) and reserve room for a human's message. None does fair-share scheduling between projects. cairn limits per machine and per agent only.
- **Isolation.** The hard wall is a deployment (DSH) or a space (Rakazo), each with its own credentials. Inside one wall, isolation is per task (a worktree or a container). cairn's secrets are team-wide.
- **What reaches the user.** Single-user systems merge everything into one stream with per-item cards and a "needs you" list (sig, DSH's panel, cairn's Tasks panel). Per-project streams appear only where the user deliberately splits work into bots or spaces (Rakazo).

## 4. Other products, briefly

| Product | Per-project coordinator? | Project unit carries | User ↔ worker |
|---|---|---|---|
| Claude Code subagents | no; project-scoped definitions and `memory: project` | `CLAUDE.md`, `.claude/agents/` | results return to the caller; nesting up to 3 layers |
| Claude Code agent teams | no; "No nested teams" | shared task list, mailboxes | "talk to any teammate directly without going through the lead" |
| OpenAI Codex cloud | no | environment (container, setup script), `AGENTS.md` | one task, one diff |
| Linear agents | no | workspace and team guidance; "team guidance takes priority" | assign as delegate; human stays owner |
| Devin | per effort only (§3.2) | repo-pinned knowledge (now skills); **memory is personal**, not per repo | coordinator messages children |

## 5. The options for cairn

```mermaid
flowchart LR
  subgraph a["(a) today"]
    ia((ian)) --> Ca[Coordinator] --> ta[threads]
    pa[(project)] -.filter.-> Ca
  end
  subgraph b["(b) ian: 总管 → project coordinators"]
    ib((ian)) --> Sb[总管]
    Sb --> PC1[cairn coordinator] & PC2[B coordinator]
    ib -.sidebar.-> PC1
    PC1 --> tb1[threads]
    PC2 --> tb2[threads]
  end
  subgraph c["(c) 总管 + project scope"]
    ic((ian)) --> Cc2[Coordinator = 总管]
    pc[(project: instructions,<br/>memory, secrets, limits)] -.in scope.-> Cc2
    pc -.-> tc
    Cc2 --> tc[threads]
    Cc2 -.large effort only.-> EC[effort coordinator thread] --> te[threads]
  end
```

### 5.1 Trade-offs

| Dimension | (a) flat, project = filter | (b) `总管` → per-project coordinators → threads | (c) `总管` + project scope (+ effort thread) |
|---|---|---|---|
| Routing | the Coordinator picks the project from the composer pick or the todo | the `总管` picks the project, then the project coordinator picks the thread: two model decisions, two places to get it wrong | as (a), plus sig's rule: ask when the project is ambiguous |
| Context and tokens | one window holds every project | smaller windows per project, but a message through the `总管` costs a `总管` turn plus a project turn. Anthropic measures multi-agent at ~15× chat tokens | one window; project instructions and memory added only in scope |
| Memory isolation | team-wide | strong by construction | as strong as Claude Projects: project memory only in scope; D72's per-turn context selection can prefer the project's history |
| Latency | — | one extra model turn before any thread starts for `总管`-routed messages | — |
| Concurrency and priority | per machine and agent | each coordinator dispatches into the same machines; still needs a shared limit | per-project limit and priority on the dispatch queue (DSH-style slots, human wakes first) |
| Secret isolation | team-wide | the layer does not isolate secrets; a scope does | project-scoped secrets, as in Amp's projects or Rakazo's spaces |
| Conflicting dispatch | impossible: one writer | the `总管` and a project coordinator can both open threads on one repo; DSH's "one writer per state" is broken unless the `总管` stops dispatching, which makes it a router to routers | one writer; an effort thread owns only the children it creates |
| Lost decisions | none | "stop X" said to one layer is missed by the other; the Pi Durable spike measured recall of ian's verdicts as weak already (C2 3.5/6, Pi 0/6) | one transcript |
| UI | one chat | N+1 chats, the shape D58 removed | one chat; a project click = the scoped view (D66) |
| D60 thin router | fits | a project coordinator either duplicates the `总管` (routing only) or plans (against D60 ③) | fits; an effort thread owns its outcome, which D60 says threads do |
| D72 Pi Durable | one durable session | N+1 durable sessions, summaries and recoveries | one durable session |
| D71 routing | fits | independent | fits |
| Idle cost now | — | 3 of 4 projects idle for 7 days | none |

### 5.2 Failure modes

1. **Double dispatch (b).** The `总管` and the cairn coordinator both act on "fix the flaky test". Avoiding it needs a per-project dispatch lock.
2. **Stale verdict (b).** "Stop #2510" lands in one layer only; cairn has had this class of incident (#2510 merged early).
3. **Misrouted project (all).** sig's answer: deterministic signals first, ask when not unique, and a routing eval as a merge check.
4. **Scope leak (c).** Project A's memory is injected into a turn about project B. Fix: scope by the todo's `projectId` when a turn acts on a todo, not by the composer pick, and show the scope chip.
5. **Starvation (a, c).** A busy project fills every machine slot. Fix: a per-project limit and a reserved slot for ian's own messages (DSH).
6. **Runaway fan-out (effort thread).** Anthropic saw "spawning 50 subagents for simple queries". Fix: only the Coordinator opens an effort thread, with a child cap.

## 6. Recommendation and PR sketch

Adopt (c): the Coordinator is the `总管`, a project is a Claude-Project-like scope, and threads stay as they are. Do not add a permanent per-project agent.

| PR | Scope | Route |
|---|---|---|
| P1 `server(project): project instructions` | `project.instructions` column (drizzle migration) and a settings field; injected into Coordinator turns scoped to the project and into thread prompts for its todos, after the repo's `AGENTS.md` | owner (migration) |
| P2 `server(chief): project-scoped Coordinator memory` | memories written in a project-scoped turn get that `projectId`; `injectMemories({ agentId, projectId })`; team-wide stays `null`; scope = the todo's project, else the composer pick | normal |
| P3 `web(sidebar): project view = scoped Coordinator` | a project click opens the Coordinator timeline filtered by project, composer pinned, scope chip, Tasks panel filtered; a structured `scopeProjectId` on the turn replaces the text prefix | normal |
| P4 `server(dispatch): per-project concurrency and priority` | `project.maxConcurrent` and `project.priority` checked at claim alongside machine limits; ian's own message wakes take a reserved slot | owner (machine claim files, TLA+ rerun) |
| P5 `server(secrets): project-scoped secrets` | `secret.projectId` (nullable = team); a step gets only its project's and team secrets | owner + `/security-review` (credentials surface) |
| P6 `server(chief): effort coordinator thread` (later, behind a flag) | a thread kind that can only create child todos, message children and read its tracker; children wake it; child cap; ian can talk to it (D65 ②) | owner (Coordinator tools) |

Optional alongside P3: sig's ask-when-ambiguous rule for project routing, plus a small routing eval.

## 7. Decisions for ian

1. **Shape.** Recommended: (c), one `总管` with Claude-Project-style scopes. Alternative: (b), which reopens D58 and adds a model hop and a second writer.
2. **Project memory default.** Recommended: memories from a project-scoped turn stay project-only, and ian promotes one to team-wide when he wants. Alternative: team-wide by default.
3. **Isolation strength.** Recommended: project-scoped secrets inside one team (P5). Alternative: a hard wall per client (a separate team, like Rakazo's spaces) for work that must never mix.
4. **Effort coordinator (P6).** Recommended: defer until one effort needs more than about 3 parallel threads. Alternative: build now.

## 8. Not done

- Cursor Projects, Amp Puck, Devin and Factory were read from official docs and changelogs, not operated.
- The Claude Projects walk ran with account memory off, so per-project memory is cited from Anthropic's announcement, not observed.
- DSH and sig were read at pinned commits, not run in this round (DSH was installed and walked earlier in `docs/research/dsh-sig-walk-2026-11.md`). Rakazo was read from its docs at `3d0887f`.
- No measurement of an extra hop's tokens or latency on cairn's own sidecar.

## 9. Sources

- DSH super-agent `deepseek-ai/dsh-superagent-prototype` at `6337fc8` (2026-10-31): `README.md`; `docs/001-domain.md`; `docs/003-execution.md` "Concurrency"; `docs/006-deployment.md` "Start and stop"; `docs/007-architecture.md` (`WorkerSlots`); `prompts/orchestrator.md:1`; `src/policy.ts:93`, `src/limits.ts:6`
- sig `iefnaf/sig` at `b048eab` (2026-11-01): `docs/design/steward.md` §1, §2.2–2.5, §3.1–3.4; `apps/connector/src/cli.ts:17,81` (repo-config)
- Rakazo at `3d0887f` (2026-11-02): `docs/bots-and-chats.md`, `docs/spaces.md`, `docs/memory.md`, `docs/groups.md`, `docs/fleet-management.md`, `docs/run-execution.md`, `docs/computer.md`
- Amp: https://ampcode.com/docs/puck ; https://ampcode.com/news/meet-puck (2026-07-20); https://ampcode.com/docs/projects
- Anthropic: https://www.anthropic.com/engineering/building-effective-agents ; https://www.anthropic.com/engineering/multi-agent-research-system
- Claude Projects: https://support.claude.com/en/articles/9517075-what-are-projects ; https://claude.com/blog/memory ; walk on claude.ai, 2026-11-03 (§1.2)
- Claude Code: https://code.claude.com/docs/en/sub-agents ; https://code.claude.com/docs/en/agent-teams
- Cursor: https://cursor.com/changelog/projects (2026-09-10); https://cursor.com/docs/release-notes/cloud-agents
- Devin: https://docs.devin.ai/work-with-devin/advanced-capabilities ; https://docs.devin.ai/product-guides/memory ; https://docs.devin.ai/product-guides/knowledge
- Factory: https://docs.factory.com/cli/configuration/custom-droids ; https://docs.factory.com/docs/missions/overview
- OpenAI Codex: https://learn.chatgpt.com/docs/environments/cloud-environment
- Linear: https://linear.app/docs/agents-in-linear ; https://linear.app/developers/agents
- cairn: commits `5c0659184` (#2500), `608eabac0` (#2547); plan rows D58, D60, D65, D66, D70, D71, D72; `apps/server/src/db/schema.ts`; `apps/server/src/services/{chief,memory,picked-project}.ts`
