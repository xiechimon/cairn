# Orchestrating cairn with cairn: feasibility checks, pilots and closing gaps (living document, since 2026-11-06)

> **Current status (2026-11-07 09:05Z)**: Pilot 3 (#123, coordinator built into the server, capability-based routing) **passed**, see §2d: chat → coordinator → capability-based routing → Codex implementation → PR #3377 → Mergify merge → thread done. Every step has a Langfuse span with `cairn.route.*`. It stalled at G13 (the recorded route pinned it to Claude over quota); after fix #3355 was merged and deployed, the stalled step switched to Codex on its own. New gap G14: #3377 merged with an unaddressed Codex P2; follow-up task #124 → PR #3383 merged without human intervention. Merge guard PR #3330 merged (`749f36b74`), and #3292 merged.
>
> Earlier (03:05Z): ian replaced the Claude subscription token. The `session` route is back to claude-code first (Codex fallback); `review` remains Codex gpt-6.1-sol. A real read-only task (#122, see §2c) verified that the claude-code step authenticated and delivered a report. Before that: cairn completed pilot 2 from chat through merge and thread completion (#121 → PR #3283, merged via Mergify), with just one request for the coordinator to retry. Seven gap-fix PRs merged: #3260 #3261 #3262 #3270 #3276 #3283, plus #3263 opened by cairn itself. (#3292 and the merge guard branch, still open then, have since merged.)

Labels: **measured** = output run firsthand or original text read in this session; **inferred** = derived from measured evidence and reproducible; **guess** = everything else.
All calls target the live service on omarchy at `http://127.0.0.1:8787`, deployed in `~/Code/AgentProjects/cairn-exec`. No keys or tokens were printed or decrypted; the calling scripts placed tokens in request headers only in memory.

## 0. Calling the live API as owner (measured)

- Authentication is in `apps/server/src/lib/token-auth.ts:66-78`: only `Authorization: Bearer <token>` is accepted, comparing the token's sha256.
- `~/.cairn/token` contains one line, `CAIRN_TOKEN=<value>` (parsed by `parseAccessTokenFile` in `apps/server/src/config.ts`). The earlier "plain Bearer returned Unauthorized" happened because the entire line (including `CAIRN_TOKEN=`) was used as the token (inferred: the whole line was 60 characters; after removing the prefix, `/api/teams` returned 200).
- Correct invocation: `T=$(sed -n 's/^CAIRN_TOKEN=//p' ~/.cairn/token)`, then pass `-H "Authorization: Bearer $T"`. `/healthz` requires no authentication; `/api/health` does not exist and returns 401 because it passes through authentication middleware first.

## 1. Capability × status

| # | Capability | Status | Evidence |
|---|---|---|---|
| 1.1 | Live service health and deployed version | Available | measured: `cairn-server.service` active; self-deployed to `02eeb8b79` (#3233) at 21:53:10Z. At the start of this session it was `cea821020` (#3172), 2 commits behind main. #3189 and #3236 are both deployed (`git merge-base --is-ancestor`) |
| 1.2 | Team | Available | measured: 1 team, `Owner's team` (`lIH2x-…`), `claudeUsage=subscription-only`, `autonomyPaused=false`; project `cairn` = `_L-wtSVW5r2DDd_H2KLV8` → `xiechimon/cairn`, `mergePolicy=autonomous`, `shipRoute=merge-gate` |
| 1.3 | Machine online | Available | measured: `omarchy` online, `enabledRuntimes=[pi, claude-code]`, `claudeLogin=ok`, `codexLogin=ok`, concurrency limit 16, 0 running. `omarchy-enroll-probe` offline (test machine, can be deleted). Mac is not registered as a machine |
| 1.4 | Harness login | Partially available | measured: claude-code and pi available, Codex OAuth logged in. No separate `codex` runtime: provider `openai-codex` runs on `pi` (`dispatch-eligibility.ts:19-24`); an ACP adapter also exists but requires daemon configuration `CAIRN_ACP_AGENTS`, and the server runtime gate does not recognize it |
| 1.5 | Coordinator model | Partially available | measured: the coordinator actually runs `openai-codex / gpt-6-luna` on pi (Langfuse `chat gpt-6-luna` times match coordinator turns). The settings page's `模型路由` shows coordinator=claude-opus-5-5 for display only; dispatch never reads it (`coordinator-route.ts:94-120`: without `CAIRN_COORDINATOR_*` environment variables, it uses the chief agent row directly) |
| 1.6 | Worker thread routing | Available | measured: routing rule `session` = claude-code / claude-sonnet-5-5 / thinking low, pinned to omarchy, falling back to openai-codex / gpt-6.1-sol on quota or failure (changed to Codex first at 22:09Z, restored at 02:53Z). `review` = openai-codex / gpt-6.1-sol / high. Capability-based harness selection is not live yet: rules have only a fixed primary model and fallback list; harness selection by task type and difficulty awaits #3259 |
| 2.1 | Chat → task → thread | Available (#3260 deployed; first call may time out, see G1b) | measured: coordinator has `create_todo` and `open_thread{todoId}` tools (`chief-tools.ts:352-366, 806-810`). Its prompt includes `GITHUB_OVERLAP_RULE`, requiring `scripts/github-overlap.mjs` or keyword searches and stopping creation if checks are incomplete; the coordinator has no shell, and `issues`/`pull_requests` only paginate by state and return titles. Pilot round 1 therefore refused to create a card (see §2) |
| 2.2 | Specify harness or machine per task | Missing | measured (code): `open_thread` accepts only `todoId`; `update_todo` has no routing field. Only team routing rules or a manual `PATCH todo.routeOverride` are available |
| 2.3 | Thread opens its own PR | Available (code) | measured (code): daemon automatically pushes the branch after a step ends (`推送分支` tool enabled by default, `runner.ts:1849-1870`); agent runs `gh pr create` itself (`prompts.ts:286-296`); server then detects the PR and records `build.prNumber`. Never completed live: only 2 of the cairn project's 2752 builds had PRs (#2043, #2045, 10-27) |
| 3.1 | PR auto-fix (D109 S3) deployed | Available | measured: #3189 is deployed. Code: `pr-watch.ts` polls every 60 seconds (300 seconds when GitHub quota is low); logs contain `ci pr-checks sweep` every minute (currently 0 candidates) |
| 3.2 | Auto-fix switch | Partially available | measured (code): only per-PR `thread_pr.autoFix`, default `true` (`schema.ts:837`); no team, project or flag switch, nor an API to change it (it only turns off automatically at the cap). `/api/flags` returns empty |
| 3.3 | Wake harness session | Available (code), unverified live | measured (code): three triggers: conflict (dirty), CI failure (green on base), review comments by writers. Steer if a step is running; merge into the prompt if a step is pending; otherwise queue a new `session` step on the same build, reusing the original session id and pinned to the original machine (`pr-wakes.ts:314-352`, `machine-claim.ts:564-575`). Caps: 2 conflicts, 3 CI wakes per head, 3 reviews, 10 total |
| 4.1 | Langfuse wiring | Available | measured: service environment has `CAIRN_OTEL_ENDPOINT` (local loopback `:3000/api/public/otel`) and `CAIRN_OTEL_HEADERS` (keys: `Authorization`, `x-langfuse-ingestion-version`). Langfuse v4.68.0 runs in docker (`ops/langfuse`), `/api/public/health` returns 200, project `cairn-local` |
| 4.2 | Recent traces exist | Available | measured (ClickHouse `events_core`, counts only): 980 events today, latest 13:47:43Z. By name: `step build` 193, `invoke_agent` 191, `chat glm-5.3` 190, `LLM Call` 175, `Tool: bash` 113, `chat gpt-6-luna` 26, `coordinator turn` 4, etc. |
| 4.3 | Operations producing traces | Partially available | measured: coordinator turns (`coordinator turn`, session = chief thread id, with `cairn.thread_id`), build root (`invoke_agent`, session = todo id, with `cairn.build_id`), `step <kind>`, pi's `chat <model>` and `execute_tool`. Missing (code): dispatch/claim, PR polling and wakes, and server tool executor have no spans; claude-code has tool spans but no LLM spans |
| 4.4 | Read traces via API | Missing | measured: server uses a write-only ingestion key; `/api/public/v2/observations` returns 403 (missing `traces:read`); old `/api/public/traces` returns 404 in v4 events_only mode. This session could only query ClickHouse counts directly |
| 4.5 | Langfuse UI entry | Partially available | measured: UI is local to omarchy at `http://127.0.0.1:3000` (compose bound to loopback); tailscale serve exposes only 8787. cairn UI has no links to Langfuse |
| 5 | End-to-end pilot | **Available** (run 2) | See §2: chat → dispatch → harness → PR [#3263](https://github.com/xiechimon/cairn/pull/3263) → all CI green → merged. Required 4 human interventions (overlap check, two operational fixes, push approval); merged via admin, and cairn's thread did not finish (G12) |

Another incident found along the way (measured): today 00:00–11:47Z, the coordinator triggered 1192 builds; 1194 builds (including user-triggered ones) reported `404 Model "glm-5.3" is not supported`, about 100 per hour, from two research verification cards (#116, #117, 516 each). Permanent model errors neither back off nor stop.

## 2. Pilot timeline (run 1)

Original task: "Freeze the clock in pr-screens captures so failed-thread screenshots stop showing false diffs (the time text differs between base and head). Open a PR."

| Time (UTC) | Event | Result | Source |
|---|---|---|---|
| 21:55:04 | As owner, `POST /api/teams/:id/coordinator/messages` (projectId=cairn); coordinator thread `chief-01a199d6-b6a7-7265-9428-f8077b79c6d4` | Sent successfully | measured |
| 21:55–21:57 | Coordinator paginated through issues (open 3 pages + closed 27 pages) and PRs (closed 11 pages) for overlap | About 45 tool calls | measured |
| 21:57:12 | Coordinator refused to create a card: tools cannot read bodies or files, or search | **Blocked → gap G1** | measured |
| 22:01:01 | I ran the full check with `scripts/github-overlap.mjs` and sent the result to the coordinator as owner | — | measured |
| 22:01:14–15 | `create_todo` → task #120 `6lZR1Jxn8vjh-hMsCp7x3`; `open_thread` → build `01a1b2e1-5b1a-…` | Dispatched successfully | measured |
| 22:01:21 | Workspace hook `.agents/setup` exited 1: mise's current node was 26.13.0 (system configuration `node=latest`), without corepack | **Blocked → gap G8** (operational fix applied) | measured |
| 22:04:51 | Added daemon drop-in `50-mise-node-24.conf` (`MISE_NODE_VERSION=24`, matching repository `.nvmrc`), then restarted daemon (0 running steps at restart) | — | measured |
| 22:05–22:07 | Retried build `01a1b2e4-…`: setup passed (49 seconds), claude-code returned `Failed to authenticate: OAuth token revoked` | **Blocked → gap G9** (ian must log in) | measured |
| 22:09:33 | Changed routing rule `session` to openai-codex / gpt-6.1-sol (pi), claude-code sonnet fallback; reason recorded in `DECISIONS-ian.md` | — | measured |
| 22:09:56 | Retried build `01a1b2e9-4e99-7217-944e-256f79060e3b` (Codex, pi, omarchy) | Started execution | measured |
| 22:10–22:21 | Thread wrote a plan, regression tests before implementation, ran 29 node tests and 3 live-server tests, zero pixel difference for light and dark screenshots; lint, typecheck and spec passed; commit `49fe9c5d3` | — | measured (thread messages) |
| 22:21 | `pnpm prepush` blocked by english-only-gate: daemon injected 33 lines of Chinese brief into tracked `AGENTS.md` at runtime. Thread asked for approval instead of bypassing the hook | **Blocked → gap G10** | measured |
| 22:24:49 | As owner I approved the thread's recommendation (restore AGENTS.md to HEAD, run hooks normally, push, then restore injected content). Message delivered as `revision`, continuing the same session | — | measured |
| 22:34:17 | **Thread opened PR [#3263](https://github.com/xiechimon/cairn/pull/3263)** `ops(120): freeze seeded PR screenshot timestamps`, author `app/cairnwright`, 6 files changed. Before pushing, thread determined `~/.cairn/github-create/lock` was stale (unchanged mtime) and deleted it | PR opened, CI running | measured |
| 22:36:41 | cairn's automatic `review` step (claude-code) failed because the token was revoked; thread entered failed; `sweepFailedRetries` automatically restarted it, queuing a rework session | **→ gap G11** | measured |
| 22:37:39 | Created `review` routing rule = Codex gpt-6.1-sol | — | measured |
| 22:44 | Rework session (Codex) confirmed fix still valid, reran harness tests 5/5, pushed second commit `f06625b53` to #3263; thread then stayed `building`, with no new review step | **→ gap G12** | measured |
| 22:59:27 | **#3263 merged** (merge commit `9dfe66ad0`, `mergedBy=xiechimon`: admin merge by ian or the coordinating session, not cairn's own merge route). 43 checks SUCCESS, only FAILURE was `cairn/merge-gate` (`phase-not-review`) | Merged | measured |
| 23:01 | cairn gate already knew PR was merged (`pr-not-open: merged`), but thread #120 stayed `building`; `ci pr-checks sweep` recorded it as `unreadable: 1`, without automatically finishing as done | **G12** | measured |

Langfuse links (local to omarchy): coordinator turns `http://127.0.0.1:3000/project/cairn-local/traces/62701649b9a373fe53d3e0def5aece7e` (21:55, 92 spans), `…/traces/aa743b3623cda2a1bdf1ea4828532a1c` (22:01, card creation and dispatch); session view `http://127.0.0.1:3000/project/cairn-local/sessions/chief-01a199d6-b6a7-7265-9428-f8077b79c6d4`. Worker thread spans (60 `chat gpt-6.1-sol` calls and read/edit/bash/ask_user tool calls) sit under the build trace; root span `invoke_agent` (session = todo id) is emitted only when the build ends (measured: ClickHouse counts).

Also confirmed during the pilot: `apps/web/pr-screens/capture-core.ts` already freezes the browser clock with `page.clock.setFixedTime`; false diffs come from real timestamps written by the seeded live server. This was therefore a real task, not work already completed by someone else (measured).

## 2b. Pilot run 2 (after #3260 and #3270 deployment)

Original task: "In Langfuse a running thread cannot be found by its session until the build ends … Make step spans … also carry langfuse.session.id and session.id set to the todo id, with a test. Open a PR." (gap L2: cairn fixing its own Langfuse gap)

| Time (UTC) | Event | Result | Source |
|---|---|---|---|
| 23:42:43 | Self-deployed to `28530da30`, including #3260 (`github_overlap`) and #3270 | — | measured |
| 23:43:03 | Sent to coordinator as owner; **no manual overlap results this time** | — | measured |
| 23:43:34 | Coordinator called `github_overlap` itself (4 terms, planned path `runtime-otel.ts`); one `openIssues` search request exceeded 6 seconds, tool failed closed as designed, coordinator created no card | **Minor block → G1b** | measured |
| 23:45:58 | I asked it to retry (direct fetch of the same search on the machine took only 158–915 ms) | — | measured |
| 23:46:09 | `github_overlap` returned complete results: no item with the same request; found open #3259 also changing the target file and recorded it in the task spec | Success | measured |
| 23:46:18–20 | `create_todo` → task #121 `GLOLN1L4gRFDfXfeQnVwT`; `open_thread` → build `01a1b341-8e5e-7310-8a91-c7f519516ccc` | Dispatched successfully | measured |
| 23:46–00:02 | Thread (Codex gpt-6.1-sol, pi, omarchy) implemented and tested in just 1 session step, opening **PR [#3283](https://github.com/xiechimon/cairn/pull/3283)** at 00:00:58, `server(3279): tag runtime steps with the todo session` (author `app/cairnwright`, 1 commit, 2 files changed) | — | measured |
| 00:11:05 | Automatically entered Mergify queue (rule `bot`) | — | measured |
| 00:19:35 | **Merged** (`a934e33`, via Mergify; 38 checks SUCCESS, only `cairn/merge-gate` red) | — | measured |
| 00:20–00:21 | cairn advanced #121 to review itself, then finished as **done** | **End-to-end success** | measured |

Langfuse for run 2: coordinator turns under session `chief-01a199d6-…`; build trace (root span `invoke_agent`, session = `GLOLN1L4gRFDfXfeQnVwT`) is `http://127.0.0.1:3000/project/cairn-local/traces/8a330d739337f44e8de37994c3bdcd26` (measured: ClickHouse contains this trace and its child `step session`).

Conclusion: just one human intervention (asking coordinator to retry `github_overlap`, see G1b); cairn completed chat through merge and thread completion itself. PR CI and Codex cloud review were green, so no CI-failure wake occurred; PR auto-fix (D109 S3) remains unverified live in this run.

## 2c. claude-code authentication recheck (2026-11-07, measured)

| Time (UTC) | Action | Result | Basis |
|---|---|---|---|
| 02:52 | ian replaced the Claude subscription in cairn's `设置 → 订阅` | Only this subscription in the list, created at 02:52:17Z | measured (API, no token values) |
| 02:53 | `PATCH /api/teams/:id/routing-rules/session` restored claude-code / claude-sonnet-5-5 (low), fallback openai-codex / gpt-6.1-sol; `review` unchanged | Returned rule matched request | measured |
| 02:54:19 | Sent a real read-only task through coordinator: diagnose G2 (model_not_found retries), report only, no PR | Coordinator created #122 `Trace model-not-found step retry behavior` (output=info) and opened a thread | measured |
| 02:54:40–02:55:50 | Daemon logs: `Loading claude-code runtime…`, executor record `backend=claude-code, model=claude-code/claude-sonnet-5-5, effort=low` | session step `done`; no `authenticat`/`revoked` in daemon logs; usage recorded sonnet 6160 output tokens | measured |
| 02:56 | Report attachment (`reportAttachmentId`) contained a diagnosis with file:line references | Thread entered review | measured |
| — | Langfuse: session=#122 had 1 `step session`, 14 tool spans (11 Bash, etc.) | claude-code still has no LLM `chat` span (G5); `invoke_agent` root span appears only after build ends | measured (ClickHouse counts) |

## 2d. Pilot run 3 (after #3304 built-in coordinator and #3259 and #3329 capability-based routing deployment)

Live commit `aa9eb3f40` (deployed 07:02:21Z, includes #3304, #3259, #3329, #3330). Task: fix `isRetryableError` in `pi.ts` (problem diagnosed by #122).

| Time (UTC) | Action | Result | Basis |
|---|---|---|---|
| 07:02:42 | Sent task via `POST /api/teams/:id/coordinator/messages` | Sent successfully | measured |
| 07:02:43–07:03:02 | Coordinator (in-server, openai-codex/gpt-6.1-sol) called `threads` → `github_overlap` (succeeded first try) → `create_todo` → `open_thread` | Created #123 `Fix pi retry classification for HTTP statuses and permanent model errors` and opened a thread in about 20 seconds, without human intervention | measured |
| — | (a) Langfuse `default.events_core`, trace `466ea981db5ca7be95e3093d39d4b61e` | 1 `coordinator turn` (AGENT); 5 `chat gpt-6.1-sol` (GENERATION, model=gpt-6.1-sol); 1 each tool span `threads`, `github_overlap`, `create_todo`, `open_thread`; all environment=live | measured (ClickHouse query) |
| 07:02:43–07:05:47 | session step `JgyoRiss6JUBuLfTDOmhO` stayed pending for about 3 minutes | — | measured |
| 07:05:47 | (b) `step_route` row: kind=session, difficulty=standard, harness=claude-code, claude-sonnet-5-5, machine=omarchy, reason=`rule default (standard: no available candidate)`, rejected=[sonnet unavailable, gpt-6.1-sol unavailable] | Both candidates deemed unavailable, so claimed using rule default | measured (read-only SQLite) |
| 07:05:47–07:05:48 | Daemon loaded claude-code runtime; 1 second later systemd stopped server (`deploy.json` unchanged, not self-deployment. Coordinator later confirmed one of its agents stopped service to back up the database and consolidated queued summaries into one placeholder summary, changing nothing else) | Step failed: `team skills distribution failed: fetch failed`, and could not send failure report back | measured (journal) |
| 07:06:19 | Server restarted on same commit | — | measured |
| 07:08:00 | Abandoned-step cleanup returned it to pending (`sessionId` empty, no checkpoint) | — | measured |
| 07:08–08:33 | Stayed pending, unclaimed | **Blocked → gap G13** | measured |
| 08:23:14 | G13 fix PR [#3355](https://github.com/xiechimon/cairn/pull/3355) merged via Mergify, `51e4513eb`; last Codex cloud review round had no findings | — | measured |
| 08:33:07 | First scheduling cycle after deployment: `step_route` row rewritten to harness=pi, gpt-6.1-sol, reason=`re-routed: claude-sonnet-5-5 no longer runnable (quota); standard: gpt-6.1-sol ranked 2, higher ranks unavailable`; step claimed | Stalled step recovered on its own, fix verified live | measured (read-only SQLite) |
| 08:33:12 | Daemon executor record: `backend=pi, model=openai-codex/gpt-6.1-sol, effort=low` | Implementation started | measured (journal) |
| 08:47:28 | cairn (app/cairnwright) opened PR [#3377](https://github.com/xiechimon/cairn/pull/3377) `fix(pi): restrict retry classification to HTTP statuses`, changing `pi.ts` and `map-pi-event.test.ts` | — | measured |
| 08:59:27 | Mergify bot queue merged #3377, `f0e472ebe`; thread entered done on its own at 09:01:41 | **Pilot 3 passed: chat → merged PR** | measured |
| — | (b) Follow-up check: `step session` span (trace `e98dbe15aa2fb387b77f82101e04ddb6`) has `cairn.route.harness=pi`, `provider=openai-codex`, `model=gpt-6.1-sol`, `difficulty=standard`, `reason=re-routed: …`, `rejected=[sonnet quota]`, matching the `step_route` row. Same trace has 1 `invoke_agent`, 31 `chat gpt-6.1-sol`, 32 tool spans, all environment=live | Passed | measured (ClickHouse) |
| — | Codex cloud review on #3377 left an **unaddressed P2**: relay errors with status first followed by a colon, such as `503: {...}`, no longer counted as retryable. P2 does not block merge under the rules, and cairn merged without responding | **→ gap G14** | measured |
| 09:02:26 | Sent this P2 to coordinator as a new task | Coordinator created #124 `Accept status-first 5xx relay errors in pi retry classification` and opened a thread (overlap check passed first try) | measured |
| 09:03–09:18 | #124's step claimed on first try: `step_route` = pi / gpt-6.1-sol, reason `standard: gpt-6.1-sol ranked 2, higher ranks unavailable` (Claude still rejected for quota) | — | measured |
| 09:35:32 | cairn's PR [#3383](https://github.com/xiechimon/cairn/pull/3383) merged via Mergify, `ee55c9411`; Codex cloud review had no findings; thread done at 09:38 | Follow-up fix complete without human intervention; I replied to and closed the review thread on #3377 | measured |

G13 cause (measured, code and live data):
- Recorded `step_route` was treated as in-flight, retaining the recorded model; `decideStepRoute` no longer checked candidates.
- At claim time `routedModelRunsOn` deemed Claude unavailable: machine reported 98% of Claude's seven-day window used, above `QUOTA_REJECT_PERCENT = 70`.
- Claude's rate-limit state was only `allowed_warning`, so it neither entered quota waiting nor triggered fallback.
- Result: step pinned to a model that would never be claimed. Codex gpt-6.1-sol was available but could not be used.

The `cairn.route.*` span attributes in (b) have not been checked yet: the step never actually ran. Check after the fix is deployed.

## 3. Gap list (ordered by when they blocked the pilot)

| # | Gap | Minimal fix | Type | Owner-routed? | Status |
|---|---|---|---|---|---|
| G1 | Coordinator cannot complete overlap rule; all code requests rejected | Add read-only `github_overlap` tool running the same queries as `scripts/github-overlap.mjs` on server; change coordinator prompt to call it; cap terms at 6 (GitHub search allows at most 5 ORs) | Code | No | **PR [#3260](https://github.com/xiechimon/cairn/pull/3260)**: Codex cloud review found P1 (daemon relay 10-second timeout); changed to shared 8-second budget with concurrency, thread replied to and resolved; Auto-fix enabled |
| G8 | mise node=latest(26) on omarchy has no corepack; every build dies in `.agents/setup` | Operations: daemon drop-in `MISE_NODE_VERSION=24` | Configuration | No | **Fixed** (22:04Z, measured setup passed) |
| G9 | Team Claude subscription token stored in cairn revoked; error instead says preflight `claude auth status` = not logged in, misleading users into checking machine login | ian reruns `claude setup-token`; wording should distinguish team subscription token rejected from machine not logged in | Login + code (wording in `apps/daemon/src/backend/claude-code.ts`) | Token: needs ian; wording: no | **Closed**: ian replaced token 11-07, verification passed; route restored, real step authenticated (§2c). Wording: **PR [#3270](https://github.com/xiechimon/cairn/pull/3270)** (merged) |
| G10 | Worker thread cannot push cairn repository: daemon injects runtime brief into tracked `AGENTS.md`, english-only-gate reads workspace and fails | Gate skips uncommitted CAIRN-RUNTIME marker blocks; committed blocks still fail | Code (`scripts/english-only-gate.mjs`) | No | **PR [#3262](https://github.com/xiechimon/cairn/pull/3262) merged** (22:51Z) |
| L1 | Failed Langfuse spans say only `ERROR failed`, without cause, machine or model | Write sanitized failure reason into status message and `cairn.error_message`; add build, todo, machine to step spans | Code (`runtime-otel.ts`) | No | **PR [#3261](https://github.com/xiechimon/cairn/pull/3261) merged** (22:42Z), self-deployed (`268629921`) |
| L2 | Running threads cannot be found by todo in Langfuse: root span emitted only at end, child spans lack session id | Step spans also carry `langfuse.session.id` = todo id | Code (`runtime-otel.ts`) | No | **Fixed by cairn itself**: task for pilot 2, PR [#3283](https://github.com/xiechimon/cairn/pull/3283) merged |
| G11 | After opening PR cairn runs its own `review` step, default claude-code, failing due to revoked token; `sweepFailedRetries` does not recognize credential issue (`isProviderAuthFailure` does not recognize claude-code credential wording), so automatically restarts implementation session instead of failed review | Configuration: create `review` routing rule = Codex gpt-6.1-sol (ian's decision: all reviews use Codex). Code: classify both claude-code credential failures as requiring human action; restart failed step kind | Configuration + code (`packages/shared/src/task-failure.ts`, `services/needs-you.ts`) | No | Configuration **changed** (22:37Z); credential failures no longer automatically retry: **PR [#3270](https://github.com/xiechimon/cairn/pull/3270)**; restarting failed step kind remains pending |
| G12 | After automatically restarted rework session ends, thread stays `building`; does not finish after external PR merge either | inferred (code tracing): thread with existing PR does not enter review when session ends; waits for `pollOne` in `ci-loop.ts` to see green checks before advancing. After merge head branch is deleted, `commits/<branch>/check-runs` returns 404, `pollOne` logs unreadable every minute; merge reconciliation `reconcileOne` handles only review phase. Minimal fix: when `pollOne` sees PR no longer open, move thread to review for existing merge reconciliation to finish | Code (only `services/ci-loop.ts`) | No | **PR [#3276](https://github.com/xiechimon/cairn/pull/3276) merged and deployed**; measured at 00:34Z: #120 automatically finished as done |
| L3 | Running cairn tests inside thread sends test spans to live Langfuse (178 fixture spans at 23:39–23:53Z, session names like `todo-mapi-10-…`, absent from live DB). inferred cause: pi runtime subprocesses inherit daemon `CAIRN_OTEL_*`; claude-code path sanitizes via `claudeCliEnv`, pi does not | Operations: add `CAIRN_OTEL_ENVIRONMENT=live` to live server and daemon spans, filter environment = live in Langfuse (done). Code: sanitize OTel variables in pi step environment too | Configuration + code (`apps/daemon/src/backend/`) | No | Configuration **changed** (00:24Z); code **PR [#3292](https://github.com/xiechimon/cairn/pull/3292), merged (00:47Z)** (sanitizes pi bash subprocess environment; pi's own in-process `LLM Call` spans remain, marked environment=local, filterable) |
| G1b | First `github_overlap` call timed out (6 seconds per request, 8-second total budget), succeeded on retry; inferred: 3 searches and up to 8 concurrent file requests sent together may encounter GitHub secondary search rate limits or slow responses | Send searches sequentially first, file requests use remaining budget; or retry timeout once. Observe a few runs before deciding | Code (`github-overlap.ts`) | No | Observing |
| G2 | Permanent model errors (model_not_found) retry indefinitely, about 100 builds per hour | Stop requeuing non-retryable provider errors and notify | Code | To check | Diagnosed (by cairn task #122 using claude-code, see §2c): cairn classifies it as non-retryable, but `retryable` in `pi.ts` only logs; retries likely come from pi SDK automatic retries (`maxRetries: 3`, inferred). Code not changed yet |
| G3 | Coordinator actually uses gpt-6-luna, UI shows opus | — | — | — | Handed to sibling session routing-capability (PR #3259); ian chose vani deepseek-v4.1-flash for coordinator |
| G4 | Cannot specify harness or machine per task | — | — | — | Same as above, owned by routing-capability |
| G13 | Step returned to pending after abandonment stays pinned to recorded model; model can never be claimed because quota exceeds routing threshold (70%), with no quota wait or fallback, so stays pending (pilot 3, #123) | For steps whose session has not started, recorded route is only a claim-time record: reroute against current candidates and update `step_route` row | Code (`services/step-route.ts`; claim code in protected `machine-claim.ts`, unchanged) | No | **Closed**: PR [#3355](https://github.com/xiechimon/cairn/pull/3355) (`51e4513eb`). First Codex review found claimed steps also lack sessionId and would be rerouted during credential retrieval; changed to reroute only pending steps. Codex lane modified protected `machine-claim.ts` midway; I asked it to revert that, final change only in `step-route.ts`. Verified live 08:33Z |
| G14 | cairn's own PRs merge with unaddressed Codex P2: `review-gate` blocks only P0/P1, cairn PR flow does not read review findings (#3377) | cairn PR watch wakes thread on new findings, queues only after fixes or written reasons for declining; or merge-route requires no unresolved review threads for cairnwright PRs | Code (`pr-wakes.ts` / merge-route) | To check | Fixed this instance via new task #124 (PR #3383 merged). ian answered yes (11-07): cairn harness must address every Codex finding on its own PRs (including P2/P3: fix or reply in thread with reason for declining); cannot become ready until addressed; repository review-gate unchanged. Research: `docs/research/review-findings-before-ready-2026-11-07.md`. measured: Codex and review-gate do not review drafts (`codex-gate-core.mjs:255`; #3101 converted to draft after review), so cannot start as draft. Plan: server GraphQL reads unresolved Codex threads → if any, convert to draft (Mergify dequeues) and wake thread (Codex bot no longer filtered by write permission) → server marks ready after zero remain, triggering review on new head; Mergify `bot` queue adds `#review-threads-unresolved = 0` safeguard. PR #3401 paused after five rounds (11-07 15:4xZ, handed to ian): r1 hold record → r2 fix dismissed/hold write order/unanswered questions → r3 idempotently reconcile from GitHub on each poll → r4 ownership by actor converting to draft (Codex: OAuth token is ian's, manually created drafts would be treated as cairn's) → r5 ownership via `cairn-review-hold` label + human removing label on this head = override (Codex: cairn's own label cleanup also emits UnlabeledEvent, treated as override when new findings appear on same head, preventing another hold). All CI green, **correction**: I previously wrote "Mergify `#review-threads-unresolved = 0` kept #3401 out of queue (measured)"; this was wrong. #3401 author was xiechimon (lane used ian's gh to open PR), taking `default` queue, while safeguard was added only to `bot`. measured timeline: Codex left P2 on 7d73bf82b at 15:29:44Z, Mergify still queued at 15:33:55Z, merged at 15:39:18Z as `4a14b42bb` (r5 version, with cairn's own label removal treated as human override bug) into main. Earlier queue exclusion was because review-gate had not completed or PR was draft, not the safeguard. Root cause (inferred): cairn uses ian's OAuth token; GitHub cannot distinguish cairn actions from ian actions, so any ownership scheme based on GitHub events encounters this. ian decided (11-07): choose (c), remove human override rules; cairn-held PRs release only at zero Codex findings, except when watch is disabled in panel; later open separate PR to use cairnwright App identity for cairn GitHub writes, then restore human override based on event actor not being cairnwright[bot] |
| G5 | Dispatch, PR polling and wakes lack spans; claude-code lacks LLM spans | Add spans | Code | Dispatch in `machine-claim.ts`: **yes** | Pending |
| G6 | Langfuse traces unreadable via API, UI local to omarchy only | Operations: create read-only key; Mac uses `ssh -L 3000:127.0.0.1:3000 omarchy` | Configuration | No | Pending |
| G7 | Auto-fix has no switch API | Observe default-enabled behavior on #3263 first | Code | No | Observing |

Live configuration changes in this session (all reversible):
1. `~/.config/systemd/user/cairn-daemon.service.d/50-mise-node-24.conf`: `MISE_NODE_VERSION=24`. Reason: G8. Undo: delete file, `daemon-reload`, restart daemon.
2. Team routing rule `session`: changed from claude-code / claude-sonnet-5-5 (low, fallback openai-codex gpt-6.1-sol) to openai-codex / gpt-6.1-sol (medium, fallback claude-code sonnet). Reason: G9. Restore after ian replaces token. **Restored** (11-07 02:53Z): claude-code / claude-sonnet-5-5 (low), fallback openai-codex / gpt-6.1-sol.
3. Created team routing rule `review` = openai-codex / gpt-6.1-sol (high), pinned to omarchy. Based on ian's decision that all reviews use Codex gpt-6.1-sol, see G11. G9 closed, implementation defaults to Claude Code and cairn internal review uses Codex, restoring two vendors; when implementation falls back to Codex, implementation and review still share a vendor. Codex cloud review on PRs is unaffected.
4. Added `CAIRN_OTEL_ENVIRONMENT=live` to both `~/.config/cairn/server.env` and `~/.config/cairn/otel.env`, then restarted server and daemon (00:23:57Z, 0 running steps). Reason: L3. Undo: delete both lines, restart.

## 4. Daily orchestration with cairn (recommendations)

### 4.1 What to tell the coordinator

In cairn's `协调者` chat, select project `cairn`, request one independently verifiable item at a time, and end with the deliverable, such as "…, open a PR." Useful phrasing:

- **Goal + symptom + deliverable**: "pr-screens failed-thread screenshots have different time text between base and head, causing false diffs. Freeze the clock and open a PR." Coordinator puts the original request in the task spec, then adds discovered facts itself.
- Include known affected files directly. After #3260 deploys, coordinator uses these paths in `github_overlap` to check for open PRs changing them.
- Do not pack multiple PRs into one sentence; if splitting is needed, coordinator splits by independently verifiable outcomes.
- If a thread waits on a question or approval, reply in the thread (the pilot's push approval resumed it this way); no new task needed.
- Ask progress: "How is #120?", "Which threads are waiting for me?" (coordinator has `threads` and `needs_you` tools).

### 4.2 Where to look in Langfuse

(measured: `/project/cairn-local/sessions`, `/traces` and individual trace pages all return 200; ClickHouse also contains session ids. I did not log into the UI to check each page; this part is inferred.)

On Mac run `ssh -o BatchMode=yes -o ConnectTimeout=5 -L 3000:127.0.0.1:3000 omarchy`, then open `http://127.0.0.1:3000` and select project `cairn-local`.

| What to see | Where | Filter |
|---|---|---|
| Each coordinator turn (tools called, model used) | Sessions → `chief-<thread id>` (main thread is `chief-01a199d6-…`) | trace name `coordinator turn`, tag `coordinator` |
| A task's execution | Sessions → todo id (e.g. `6lZR1Jxn8vjh-hMsCp7x3`) | trace name `build`, root span `invoke_agent`; underneath: `step session` / `step review`, `chat <model>`, tools |
| Why it failed | Traces, filter level = ERROR | After #3261 deploys, status message and `cairn.error_message` contain sanitized cause, plus `cairn.machine_id` |
| Abnormal retry storm | Count Traces by name, look for many ERRORs in `invoke_agent` for same todo | Today's glm-5.3 retry storm is immediately visible here |

Current limits: running tasks wait until build ends for root span to appear (L2); dispatch, claim, PR polling and wakes have no spans (G5). For those steps, read thread system messages in cairn UI.

### 4.3 What still needs Claude Code until gaps close

| Task | Reason | When no longer needed |
|---|---|---|
| Overlap check for code requests | Coordinator cannot complete it itself (G1) | After #3260 merges and deploys |
| Operational fixes (mise, systemd, routing rules, expired tokens) | cairn lacks these operational capabilities; failure wording misleads (G9) | Wording fixed by #3270; operations still need human or Claude Code |
| Thread stuck in `building`, not finishing after merge | G12 | After G12 fixed |
| Merge | cairn's merge-gate requires thread at review checkpoint; #3263 merged via admin this time | After G12 fixed and thread can enter review normally, cairn merges via `mergePolicy=autonomous` or enters Mergify queue |
| Watch CI and fix PR issues | cairn PR wakes (D109 S3) deployed and enabled by default, but pilot has not actually triggered CI-failure wake | Verify CI failure → wake → fix in next pilot |

**Recommended daily routine**: ian speaks only to coordinator and looks only in Langfuse. Keep just one Claude Code duty session: on each wake, handle new blockers via §3 gap table, turning each into a small PR or recorded configuration change. Stop scheduled ticks after #3260 and G12 are closed and one task runs from chat to merge without human intervention.

## 5. Deviations in this session

- Three edits (`scripts/english-only-gate*.mjs`, `#3260` terms cap, and one test) were made directly via shell to other worktrees in this session. A hook then warned not to write other worktrees from this session; subsequent edits were delegated to Codex in the respective worktree.
- #3263 was not merged by cairn itself (`mergedBy=xiechimon`).

## 6. "#3263 merged with red checks": verification showed no incident

**Initial suspicion**: PR page showed red `pr-evidence` and `merge-route`, merger `xiechimon`, and no GitHub app. I initially inferred ian manually bypassed checks with admin privileges (this inference was wrong).

**Verification results (measured)**:
- Mergify comment on #3263: queued at 22:46 (rule `bot`), "Merged into `main` as `9dfe66a` at 22:59 UTC".
- `.mergify.yml` configures `merge_bot_account: xiechimon`, so every Mergify merge appears on GitHub as merged by xiechimon, without an app. Same for #3283 in pilot 2 (00:19Z).
- Check timeline on head `f06625b53`: `review-gate` passed 22:37:44, `merge-route` passed 22:48:09, `pr-evidence` passed 22:49:55, merge at 22:59:27. `pr-evidence` and `merge-route` turned red only when rerun after merge at 23:01:5x; PR page shows this rerun's results.
- Only red check at merge was `cairn/merge-gate` (`phase-not-review`), absent from Mergify queue conditions.

**Conclusion**: merge followed normal Mergify route without bypassing checks. The `enforce_admins` entry I previously added to `DECISIONS-ian.md` had a false premise and was deleted.

**Hardening retained (defense in depth, not incident fix)**: `main` has `enforce_admins=false`, and cairn's team GitHub connection uses an admin token. Thus cairn's own `POST /api/builds/:id/merge` (`mergeThroughGithub`) could theoretically merge with red checks. Branch `server/merge-requires-green-checks` (`275a5643b`) reuses gate `requiredChecksReadiness` to check before sending PUT, with a test that no merge request is sent when required checks are red; all 29 TLA+ results matched expectations. Since `builds.ts` already has two open PRs (#3259, #3164), wait for one to merge before opening this PR.

**Lesson**: GitHub actor alone cannot establish who merged. When Mergify uses `merge_bot_account`, actor is that account. First read Mergify's PR comment, then check conclusions at merge time, rather than now.
