# #892 measurement gate — withPlan distribution in a real closed loop, full enumeration of gate-bypass paths, and rubber-stamp signals

> Settled item: `docs/spec/18-positioning-and-differentiation.md` §5 honest-list item 2, "withPlan usage unknown".
> Headline: **the concern holds in data, and the shape is worse than rubber-stamping — physical bypass, not ritual pass-through**.
> Live data on this machine: 28 builds / 17 done cards — confirm gate entered 13 times but only 3 confirm presses,
> review gate entered 6 times but only 1 merge-step release; **15/17 (88%) done landings via board drag (phase change),
> both gates skipped**. Data, caliber, and per-path enumeration are reproducible below.

## 0. Ruling summary

| Question | Answer |
|---|---|
| withPlan distribution | 28 builds: withPlan=1 **17 (61%)**, direct execution **11 (39%)**. Chief dispatches were **8/8 all direct execution** (code default + explicit system prompt); the 3 user-side direct executions = 1 first-launch direct start (#2, 2026-09-25) + 2 failure restarts (inheriting the original chief round's withPlan=false) |
| Confirm-gate bypass paths | 6 bypassable/substitutable paths on the code side (key 8 of the fully enumerated 20 write surfaces in §4); 3 actually exercised per the data: chief direct execution, drag confirm→done, failure restart inheriting direct execution |
| Review-gate bypass paths | Drag review→done (no merge step, 3 cases); chief `complete_todos` (review→done without a merge step, 1 case with full-chain log evidence) |
| Rubber-stamp signal | The 4 genuine gate presses all had non-trivial dwell (confirm 4m43s / review 7m30s and up) — **not rubber-stamping**; but they account for only 2/17 of done landings. The 8-second chief self-release is the only "in-and-out" sample |
| Versioned-plan documents | The `plan` table has **0 rows** across 28 builds — the "version-comparable plan document" differentiation pillar saw **zero usage** in the observation window (including the 5 withPlan builds after the #560 upload channel landed) |

**Reading**: the actual shape of the "two hard gates" claim in a real closed loop is not even "one gate + one ritual" — it is **"two gates + a side-door key"**: the proper funnel was walked end to end exactly once, on the very first task (#1 hello.txt, 2026-09-23); every done landing afterwards bypassed the gates fully or partially. Sample skew must be stated honestly as well: 12 of the 18 cards are connectivity-test/smalltalk cards (nothing to review by construction), and among the 3 real work cards (#1, #16, #18), 1 went through the gates end to end while 2 went via chief direct execution. Improvement-ticket suggestions are in §6.

## 1. Caliber notes (recomputable)

**Data source**: this machine's real deployment SQLite — `~/.pacman/server/server.db` (snapshot 2026-10-05 16:5x, read directly in WAL mode). Always open in **read-only URI mode**:

```sh
sqlite3 'file:<home>/.pacman/server/server.db?mode=ro' "<SQL>"
```

Second dataset (the user's own deployment on mea): the same read-only queries after `ssh mea`, see Appendix C.

**Table structure quick reference** (columns used here): `build(id, todoId, withPlan, prevPhase, triggerSource, createdAt)`; `step(id, buildId, kind[plan|build|merge|review|chief], status, createdAt, claimedAt, prompt)`; `todo(id, seqNum, title, phase, phaseAt, hasPlan, hasChanges, latestBuildId)`; `notification(type[plan_ready|build_review|chief_message], entityId, createdAt)`; `plan(id, buildId, version, content)`; `chief_message(threadId, role, content, createdAt)`. **conversationId ≡ buildId** (UUIDv7); a build conversation's transcript lives in the `message` table, chief conversations in the `chief_message` table.

**Three caliber conventions** (must-read before recomputing; skipping them will produce wrong numbers):

1. **Notification rows are upserts** (`services/notifications.ts:114` upsertAndPublish, primary key = `userId:todoId`) — the `createdAt` of `plan_ready`/`build_review` is the **last** gate-entry moment, not the first. For cards entering a gate multiple times (#5, #12, #14, #18), dwell is computed from the last row. Only #12 is materially affected in this dataset (its first entry row was overwritten by build B; the moment is recovered from conversation rows, see the note in Appendix A).
2. **`todo.phaseAt` is the last phase-change moment**, not the original done-landing moment (#1's done actually landed at 09-23 20:07 while phaseAt shows 10-01 06:44 — an unaudited phase change happened afterwards, mechanism [unverified]).
3. **The "release" criterion for the confirm gate** = a step row of kind='build' appears in some **withPlan=1** build of that todo (`builds.ts:510-514`: the confirm action → enqueue build step; the action itself leaves no log row). The "proper release" criterion for the review gate = a step row of kind='merge' appears (both the REST merge and the chief merge_builds enqueue a merge step, `builds.ts:699`). **A review→done without a merge step can only come from `complete_todos` or a manual phase change** — distinguishable via the toolcall logs in chief_message.

**Recompute SQL for the overall distribution and the per-build ledger** (this machine; produces the numbers in §2/§3/Appendix A):

```sh
# withPlan × triggerSource distribution
sqlite3 'file:<home>/.pacman/server/server.db?mode=ro' \
  "SELECT withPlan, triggerSource, COUNT(*) FROM build GROUP BY 1,2"

# Per build: todo number, plan/direct, step composition, plan table rows
sqlite3 -header 'file:<home>/.pacman/server/server.db?mode=ro' "
SELECT b.id, t.seqNum, b.withPlan, b.triggerSource, b.prevPhase,
  (SELECT COUNT(*) FROM step s WHERE s.buildId=b.id AND s.kind='plan')  AS planSteps,
  (SELECT COUNT(*) FROM step s WHERE s.buildId=b.id AND s.kind='build') AS buildSteps,
  (SELECT COUNT(*) FROM step s WHERE s.buildId=b.id AND s.kind='merge') AS mergeSteps,
  (SELECT COUNT(*) FROM plan  p WHERE p.buildId=b.id)                   AS planDocs
FROM build b JOIN todo t ON t.id=b.todoId ORDER BY b.createdAt"

# Gate-entry moments (last row)
sqlite3 'file:<home>/.pacman/server/server.db?mode=ro' \
  "SELECT entityId, type, datetime(createdAt/1000,'unixepoch','localtime')
   FROM notification WHERE type IN ('plan_ready','build_review') ORDER BY createdAt"

# Done-landing moments + final card states
sqlite3 -header 'file:<home>/.pacman/server/server.db?mode=ro' \
  "SELECT seqNum, phase, hasPlan, hasChanges, datetime(phaseAt/1000,'unixepoch','localtime')
   FROM todo ORDER BY seqNum"
```

**Dwell computation** (generates the Appendix A ledger and the §5 dwell table): confirm dwell = `plan_ready` moment → (the createdAt of the confirming build step, or the phaseAt of a drag-to-done, whichever comes first); review dwell = `build_review` moment → (merge-step createdAt / `complete_todos` toolcall createdAt / phaseAt, whichever comes first). Equivalent zero-dependency Python script (runs on the read-only connection):

```python
# ledger.py — python3 ledger.py   (adjust the db path as needed)
import sqlite3, datetime
db = sqlite3.connect("file:<home>/.pacman/server/server.db?mode=ro", uri=True)
db.row_factory = sqlite3.Row
c = db.cursor()
cin  = {r["entityId"]: r["createdAt"] for r in c.execute(
        "SELECT entityId, createdAt FROM notification WHERE type='plan_ready'")}
rin  = {r["entityId"]: r["createdAt"] for r in c.execute(
        "SELECT entityId, createdAt FROM notification WHERE type='build_review'")}
for t in c.execute("SELECT * FROM todo ORDER BY seqNum"):
    builds = c.execute("SELECT * FROM build WHERE todoId=? ORDER BY createdAt",(t["id"],)).fetchall()
    steps  = c.execute("""SELECT s.* FROM step s JOIN build b ON s.buildId=b.id
                          WHERE b.todoId=? ORDER BY s.createdAt""",(t["id"],)).fetchall()
    confirm_out = next((s["createdAt"] for s in steps if s["kind"]=="build"
                        and next(b for b in builds if b["id"]==s["buildId"])["withPlan"]), None)
    merge_out   = next((s["createdAt"] for s in steps if s["kind"]=="merge"), None)
    print(t["seqNum"], t["phase"], len(builds),
          "confirm:", (cin.get(t["id"]) or 0) and
          round(((confirm_out or t["phaseAt"]) - cin[t["id"]])/3.6e9, 2) or "-",
          "review:", (rin.get(t["id"]) or 0) and
          round(((merge_out or t["phaseAt"]) - rin[t["id"]])/3.6e9, 2) or "-")
```

**Dataset boundaries**: 18 cards / 28 builds / 99 steps, window 2026-09-23 19:53 → 2026-10-05 15:42 (12.8 days). A single-person (the user), single-machine, real-usage record — exactly the mirror the "self-use first" criterion of §2 calls for, but n is small and 12/18 are smoke cards; read the conclusions as "morphological evidence", not statistical significance. Three known mechanism-version changes within the observation window affect the interpretation, marked item by item in §5.

## 2. Dataset overview

- 1 team, 2 projects, 18 todos, 28 builds, 99 steps, 761 build-conversation messages, 769 chief messages, 29 notification rows.
- Todo final states: 17 done + 1 review (#18 README icon, still at the gate when the observation window closed).
- Composition: **12 connectivity-test/smalltalk cards** (titles like `测试消息/你好/空消息`, nothing to review), 3 real work cards (#1 hello.txt, #16 README check, #18 README icon), 3 others (#2 M6 credential verification, #5/#14 repeated reruns of same-named test cards).
- The `schedule` table has 0 rows — the timer path (§4 #4) was **never enabled** locally, zero data evidence.
- The chief exists and is active: 16 chief threads, 41 chief steps, 8 chief-triggered builds.

## 3. Conclusion 1: withPlan distribution

All 28 builds (recompute SQL in §1):

| withPlan | triggerSource | n | Notes |
|---|---|---|---|
| 1 | user | 17 | All from directly created-and-run cards on the web surface (before #640 the UI still went through startBuilds explicitly carrying a plan) |
| 0 | chief | 8 | **100% direct execution**. Code default `chief-tools.ts:673` (withPlan defaults to false) + the explicit system prompt "single work unit: directly run_builds to dispatch the task (withPlan:false…)" (`chief.ts:687-688`) |
| 0 | user | 3 | #2 M6 (one first-launch direct start on 2026-09-25, manually chosen direct execution); #18's two failure restarts (`builds.ts:465` restart inherits the original round's withPlan — the original round was a chief direct execution) |

User-side first-launch choices (excluding restart inheritance): 17 with plan vs 1 direct — **94% chose with-plan on the first-launch surface**. But of these 17 with-plan builds, **only 3 ever had the confirm button pressed** (§5), so "chose the gate" and "actually walked the gate" are two different things. On the chief side, 8/8 without exception went direct — **the user never had the plan/direct choice on chief dispatches** (since #640 the start button's only entry is orchestrate, and the withPlan chooser is the chief's LLM).

## 4. Conclusion 2: all paths that bypass the gates (code enumeration + data evidence)

All **20** server-side write surfaces that can change phase / create builds / pass gates are pinned line by line in Appendix B (file:line). Here only the **actually exercised ones in the data + high-risk unexercised ones** are listed:

### 4.1 Exercised in this dataset (really happened)

| Path | Code point | Evidence |
|---|---|---|
| **A. Chief direct execution skips confirm** | `chief-tools.ts:673` (default false) + `chief.ts:687-688` (explicit prompt) + `builds.ts:396` (first step = build step) | 8/8 chief builds have withPlan=0; 10 `run_builds` dispatches in chief_message (1 native + 9 `mcp__pacman__run_builds` tool-name variants): 9 with explicit `withPlan:false` + 1 defaulting (the tool default is also false) |
| **B. Board drag → done (both gates skipped)** | `routes.ts:1257` PATCH → `todos.ts:355-378` → `canBoardDrop(_, 'done')` returns true for **every source phase except failed** (`packages/shared/src/phase.ts:112-113`); writes only phase/phaseAt, **no build created, no merge step, no notification, no actor recorded** | **15/17 done cards** have no merge step and no complete_todos call record → they can only land on this surface. Three sweep clusters: 09-30 16:06:08–11 (5 cards/4 seconds), 10-04 14:17:42–45 (3 cards/4 seconds), 10-04 14:20:14–15 (2 cards/2 seconds), plus 5 single cards. Includes cards dragged from confirm directly to done (#4–#11, #13, #15: 10 cards that **never had confirm pressed**) and cards dragged away from review (#2/#16/#17: 3 cards **dragged off the gate**) |
| **C. Chief `complete_todos` passes the review gate** | `chief-tools.ts:850-880` (review→done **without a merge step**, no permission gate outside the funnel) | #14: `build_review` notification at 23:04:13 → chief receives [wake:gate] (the prompt says "when user confirmation or an answer is needed, state the next action") → at 23:04:21 the chief calls `complete_todos` (chief_message has the complete toolcall and the `{"transitioned":[...]}` receipt) → done. **Gate entry to agent self-release: 8 seconds, zero human involvement** |
| **D. Failure restart inherits direct execution** | `builds.ts:465` (restart inherits the original round's withPlan) | #18's two user-triggered direct-execution builds (10762/10767) are both failed→queued restarts; the original round was a chief direct execution — the user sent feedback and restarted on the failure surface, and got a new round without the confirm gate |

### 4.2 High-risk but unexercised in this dataset

| Path | Code point | Why high-risk |
|---|---|---|
| E. Timer reruns always direct-execute + evict gate-parked builds | `scheduler.ts:80` (withPlan:false hardcoded) + `scheduler.ts:51-63` (cancelGateBuild: a confirm/review-parked build is Cancelled and rerun as direct execution — **a human's pending decision at the gate is silently discarded by the timer**) | The local schedule table has 0 rows so it never fired; once enabled, the very scenario the "gate value proposition = walk away and queue" (§5 item 1) serves is the scenario it serves, and every fire skips confirm |
| F. Agent-side self-confirm / self-merge | chief `confirm_builds` (`chief-tools.ts:726-730`), MCP `confirm_builds`/`merge_builds` (`mcp-face.ts:342-357`, key-granted one-time pre-authorization) | 0 calls in this dataset (the chief tried `merge_builds` once and was blocked by the **XMON-77 agent permission gate 403** — this defense line is proven effective, a positive finding); `complete_todos` is evidenced (C), and confirm_builds is the same family with the same risk |
| G. REST surface has zero authentication | `routes.ts:354-359` (auto-login cookie; the only server-side gate is the optional global PACMAN_TOKEN, off by default) | PATCH phase=done / steps confirm / merge can be called bare by any HTTP client; acceptable under the single-machine self-use threat model, but it means "gate actions carry no identity" is structural |
| H. The executing agent loops back through its own MCP | `machines.ts:711-718` (claimMcpSlugs: if the user configured the agent with an MCP server pointing back at this pacman + a key with Confirm/Merge authorization) | The executor can press its own gates. Zero evidence; a configuration-surface problem |

**The review gate's front door was never skipped by withPlan**: a finished build step always parks at review (`builds.ts:983-987`) — direct execution only skips confirm, and the review bypasses are only B/C/drag. **failed→done is blocked on every surface** (the system edge table `phase.ts:44` + the manual matrix `phase.ts:104` + the complete_todos funnel) — the #702 ruling is measured intact.

## 5. Conclusion 3: rubber-stamp signal (quantifiable "ritualization" metrics)

**Confirm-gate dwell distribution** (13 entries; entry-moment caliber per §1):

| Exit | n | Dwell distribution |
|---|---|---|
| Confirm button pressed (build step appears) | **3** | #1 4m43s (recovered from conversation rows, notification row missing); #3 **114.6h** (parked at the gate for 4.8 days before pressing, then immediately stopped the build — more like clearing an obstacle than approving); #12 ≈5h11m |
| Dragged to done (confirm never pressed) | 10 | 30s (#10: plan_ready to drag-off within half a minute), 1.0h, 1.1h, 1.3h, 1.4h, 3.4h, 11.6h, 20.4h, 27.1h, 59.5h |
| Parked at gate then dragged back to todo (409 at wrap-up) | 0 in its own row (counted in the cards above) | #5 build A, #14's withPlan round: the plan step finished after the card had already been dragged back to todo, and the machine's done report hit `illegal phase transition: todo -> confirm` 409 (daemon.log, 3 occurrences) — the third class of manual intervention: **a card parked at the gate is dragged back to todo but the in-flight step is not stopped** |

**Review-gate dwell distribution** (6 entries):

| Exit | n | Dwell |
|---|---|---|
| Released via merge step (front door) | **1** | #1 7m30s (19:58 build_review → 20:05 the user clicked merge; during which the user had the agent self-check the diff in the conversation — **the only "human reviewed the diff and released" event**) |
| Chief complete_todos | 1 | #14 **8 seconds** (gate-entry notification to agent self-release; the only "in-and-out" sample, but the presser was an agent, not a human) |
| Dragged to done (no merge step) | 3 | #2 120.1h, #16 24.7h, #17 16.7h (all three parked at review for 1–5 days before being swept; the #16/#17 drags happened 5 minutes after the chief reported "merge_builds rejected with 403" — a human saw the agent could not pass the gate and passed it through the side door on the agent's behalf) |
| Still at the gate | 1 | #18 (still in review when the observation window closed) |

**"Something to look at" surface** (whether there was anything reviewable at the gate):

- **Plan surface**: the `plan` table has **0 rows** across 28 builds; only #1 has the `hasPlan` bit set. All 12 confirm-gate entries happened **in the B-C10 era** (#703 only plugged "two rounds without plan.md still enter confirm" at 2026-10-03 22:00) — at the gate there was only conversation text, no plan document. **The versioned-plan-document pillar (one of the three §1 claims) saw zero usage in the observation window**, including the 5 withPlan builds after #560 (plan upload persistence, 2026-10-01) — the channel had **zero real samples** in the window, quality [unverified].
- **Review surface**: 3 of the 6 gate entries had a diff to look at (#1 had 1 file; #16/#18 hasChanges=1); #2/#14/#17 have hasChanges=0 — **half the time at the review gate there was no change artifact to review** (the B-C11 family, the same pre-#703 old disease).

**Rubber-stamp reading**: defining "ritualization" as "the human pressed the gate without looking" — the **only 4 human gate presses in the data** (#1 confirm 4m43s, #12 confirm 5h11m, #3 confirm 114.6h, #1 merge 7m30s) all had non-trivial dwell, which does **not** constitute rubber-stamping; the problem is not "pressed too fast" but that **88% of dones never pass through the gates at all**. The degraded form claimed in §5 needs correcting: not "one gate + one ritual", but "two gates + a front door nobody guards and a side door everybody takes".

**Positive findings** (recorded honestly, to keep the conclusion from reading one-sided):

- #1 (the first task) walked the full gate: confirm 4m43s + review 7m30s + merge-step landing — **the funnel completed once in real usage**, and both releases had substantive dwell.
- The XMON-77 agent permission gate is proven effective: the chief tried `merge_builds` and was blocked by a 403 `Agent Chief lacks the 『合并分支』 authorization` (2026-10-04 14:15:33, full receipt in chief_message) — **enforcement with teeth actually bit on this surface**. The gap is that `complete_todos` is not inside that permission model (path C evidenced).
- The mea second dataset (Appendix C): 16/18 withPlan, the AI review step ran 5 times (3 done, 2 failed), the card is still failed and never passed the gate — **the review teeth really held the merge on that side**.

## 6. Improvement-ticket suggestions (suggestions only, no action taken)

Sorted by "claim-survival impact × evidence exercised":

1. **The chief must not self-release the review gate** — `complete_todos` (chief/MCP surface) made review→done a one-shot write with no merge step, no permission gate, and no actor record. Suggestion: bring it into the XMON-77 permission model (listed alongside merge_builds in the `合并分支` authorization family), or change it to only allow parking the card **at review and waking a human**. Evidence: #14 8-second self-release.
2. **Manual phase change → done gets a confirmation + an audit row** — the PATCH phase surface (`routes.ts:1257`) is the actual channel for 88% of done landings, but dragging confirm→done/review→done skips the full semantics of both hard gates, with **zero notification, zero actor, zero timeline row** (`todos.ts:399-403` explicitly attaches no notification). Suggestion: dragging from confirm/review toward done requires an explicit confirmation popover (reusing the #755 reset-gate form) + one announcement row. Evidence: 15/17.
3. **Gate actions record the actor** — `steps {action:'confirm'}` (`builds.ts:510-514`) and complete_todos both fail to record "who". The claim is "a human is forcibly present", but the database cannot answer "who was present". Suggestion: write an announcement row on the action surface (same family as the existing merge/review ones, `builds.ts:693-698`/`:533-538`). This is the common prerequisite of 1 and 2 — without an actor, "the gate was pressed by a human" remains forever an inference.
4. **Give the plan/direct choice on chief dispatches back to the charter or the human** — the `chief.ts:687-688` prompt hardcoded withPlan:false as the default behavior, evidenced 8/8. If the two gates are a product claim, the orchestrator should not unilaterally revoke one of them on every dispatch. Suggestion: add a "dispatch with plan" tier to the charter, or let the orchestrate request carry an explicit withPlan passthrough.
5. **Validate the plan.md persistence channel with real samples** — after #560: 0 rows, 0 samples. Suggestion: an e2e/verify ticket pinning the full chain "withPlan build produces plan.md → plan table row → confirm card has something to review" (accept mechanism effectiveness on real artifacts, not by reading code).

Not recommended (the data does not support it): cutting the drag shortcut itself — dragging the 10 no-code-to-review test cards from confirm to done is a reasonable manual cleanup of "nothing to review"; the problem is only that **cards with artifacts under review** (#2/#16/#17) also took this door, which is exactly the case the ticket-2 confirmation popover bites.

## 7. Reconciliation against honesty-list item 2

The original criterion in `docs/spec/18-positioning-and-differentiation.md` §5 item 2 — "count the withPlan distribution in a real closed-loop run" —
This document is that count. **The item moves from unknown to measured — concern confirmed**: direct execution 39% (chief side 100%),
confirm release 3/13, review front-door 1/6, done via drag 15/17, versioned plan documents 0 rows.
spec §5 item 2 updates with this PR (unknown → measured conclusion + pointer); items 1
(gate value proposition vs unattended operation) and 5 (Chief keep/remove) gain evidence:
timer path should pass improvement #6 before enable; Chief in data is the main gate bypasser, not consumer.

## Appendix A: per-todo ledger (this machine, 2026-10-05 snapshot)

Columns: seq / title (truncated) / final state / builds (W=with-plan D=direct) / confirm in·out / review in·out / done-landing mechanism. "-" = no row.

| seq | Title | Final state | builds | confirm in→out | review in→out | done mechanism |
|---|---|---|---|---|---|---|
| 1 | `写一个 hello.txt` | done | 1W | [notification row missing, recovered from conversation]→**19:58 confirm pressed** (4m43s) | 19:58→**20:05 merge step** (7m30s) | **front door end to end** (the later phaseAt 10-01 06:44 touch [unverified]) |
| 2 | `M6 凭证链路验证:回一行字` | done | 1D | never entered (direct) | 09-25 18:07→dragged away 09-30 18:15 (120.1h, no merge) | review dragged to done |
| 3 | `测试` | done | 1W | 09-25 20:21→09-30 14:56 confirm pressed (114.6h, build stopped right after) | never entered | dragged to done after confirm |
| 4 | `你好` | done | 1W | 09-29 11:36→dragged away 09-30 14:40 (27.1h) | never entered | confirm dragged to done |
| 5 | `空消息，待用户说明需求` | done | 2W | 22:30→dragged away 09-30 10:08 (11.6h); build A's done report hit 409 (card dragged back to todo) | never entered | confirm dragged to done |
| 6 | `检查 README 是否需要更新` | done | 1W | 11:30→dragged away 14:54 (3.4h) | never entered | confirm dragged to done |
| 7 | `请求重新规划任务…` | done | 1W | 14:40→dragged away 16:06 (1.4h) | never entered | confirm dragged to done (sweep cluster 1) |
| 8 | `测试消息，无实际任务` | done | 1W | 14:48→dragged away 16:06 (1.3h) | never entered | confirm dragged to done (sweep cluster 1) |
| 9 | `确认是否可开工的寒暄询问` | done | 1W | 15:02→dragged away 16:06 (1.1h) | never entered | confirm dragged to done (sweep cluster 1) |
| 10 | `测试消息，无实际任务` | done | 1W | 16:12:07→dragged away 16:12:37 (**30s**) | never entered | confirm dragged to done |
| 11 | `用户打招呼，暂无具体任务` | done | 1W | 10-01 02:19→dragged away 22:44 (20.4h) | never entered | confirm dragged to done |
| 12 | `测试消息，确认链路可用` | done | 2W | build A entered gate ≈10-01 17:33→22:44 confirm pressed (≈5h11m; the first entry row was overwritten by the upsert, moment recovered from conversation rows); build B entered gate 10-02 17:26→never pressed | never entered (build A's build step finished but the build_review row is missing; entry [unverified]) | dragged to done after confirm (sweep cluster 2, 10-04 14:17:42) |
| 13 | `发送测试消息确认连通` | done | 1W | 10-02 02:45→dragged away 10-04 14:17 (59.5h) | never entered | confirm dragged to done (sweep cluster 2) |
| 14 | `测试消息确认连通性` | done | 2W+1D | the withPlan round's done report hit 409 (card dragged back to todo); the chief round was direct, never entered | 10-02 23:04:13→23:04:21 | **chief complete_todos** (8s, full evidence in chief_message) |
| 15 | `用户打招呼，纯寒暄` | done | 1W | 10-02 17:48→dragged away 10-04 14:17 (44.5h) | never entered | confirm dragged to done (sweep cluster 2) |
| 16 | `核对 README 是否需更新…` | done | 1D | never entered (chief direct execution) | 10-03 13:38→dragged away 10-04 14:20 (24.7h; earlier at 14:15 the chief's merge_builds was rejected with 403) | review dragged to done (sweep cluster 3) |
| 17 | `测试消息，回复ok即可` | done | 1D | never entered (chief direct execution) | 10-03 21:37→dragged away 10-04 14:20 (16.7h) | review dragged to done (sweep cluster 3) |
| 18 | `README 页首加应用图标…` | **review** | 7D (6 chief + 2 user restarts) | never entered (all direct; the 3 plan steps all failed/stopped — review-verdict auto-reflow rounds) | entered gate 10-05 15:42, **still at the gate** | — |

The basis for judging "dragged to done": no merge step + no complete_todos toolcall + the phaseAt moment landing (the mechanism collapses into the manual-phase-change surface; **per-card "drag UI" vs "bare PATCH" is indistinguishable** — both share one server entry and both leave zero audit rows, which is itself the argument for improvement ticket 3).

## Appendix B: full enumeration of server-side write surfaces (20 entries, file:line)

The complete list below comes from read-only code reconnaissance (worktree @ 67509706). Each entry: entry point / caller identity / gates it can skip or pass / conditions / whether a one-time human action is required.

| # | Entry | file:line | Caller | Gate impact | Condition | One-time human action? |
|---|---|---|---|---|---|---|
| 1 | REST `POST /api/projects/:id/builds` withPlan=false | routes.ts:1122 → builds.ts:396 | any HTTP client (web hooks.ts:648-661 still wired; the UI no longer uses it) | skips confirm | body explicitly false | conscious choice |
| 2 | `POST /api/todos/:id/orchestrate` → chief run_builds default false | routes.ts:600; chief.ts:687-688; chief-tools.ts:673 | web start button / drag into executing (the only entry after #640) → chief LLM | skips confirm | explicit prompt + tool default | **no** |
| 3 | MCP `run_builds` default false | mcp-face.ts:315 | external MCP client (holding a 'Run Builds' authorized key) | skips confirm | withPlan omitted | once at authorization |
| 4 | Timer rerun withPlan:false hardcoded | scheduler.ts:80; cancelGateBuild :51-63 | the timer | skips confirm (every fire); evicts gate-parked builds | schedule due | once when scheduling |
| 5 | REST `PATCH /api/todos/:id` phase=done | routes.ts:1257 → todos.ts:355-378 → shared phase.ts:112-113 | web drag / any bare HTTP | **both gates skipped** (any phase → done except failed source) | canBoardDrop(from,'done')===true | yes (but zero audit) |
| 6 | same, phase=building (from todo/queued) | manual-drop-matrix.test.ts:124-129 | bare PATCH (the web now goes through orchestrate) | lands at post-confirm phase with no build | source in the start column | yes |
| 7 | chief `complete_todos` | chief-tools.ts:449 → :850-880 | chief LLM | **passes review** (no merge step) | phase=review | **no** (no permission gate) |
| 8 | MCP `complete_todos` | mcp-face.ts:370-371 | MCP client ('Complete Todos' authorization) | passes review (same as above) | phase=review | once at authorization |
| 9 | chief `confirm_builds` | chief-tools.ts:726-730 → builds.ts:510 | chief LLM | **agent presses the human gate** | phase=confirm | **no** |
| 10 | MCP `confirm_builds` | mcp-face.ts:342-349 | MCP client ('Confirm Builds' authorization) | agent presses the human gate | phase=confirm | once at authorization |
| 11 | chief `merge_builds` | chief-tools.ts:742 → builds.ts:656-701 | chief LLM | agent passes review (the XMON-77 tool gate at :675-689) | phase=review (or #702 recovery) | no |
| 12 | MCP `merge_builds` | mcp-face.ts:350-357 | MCP client ('Merge Builds' authorization) | same as above | same as above | once at authorization |
| 13 | REST `POST /api/builds/:id/merge` | routes.ts:1140 | any HTTP (web merge popover) | passes review (enqueues a merge step) | phase=review | yes |
| 14 | REST `POST /api/builds/:id/steps {confirm}` | routes.ts:1213 → builds.ts:510-514 | any HTTP (web confirm button) | **is the confirm gate itself**; no actor record | phase=confirm | yes |
| 15 | machine surface `POST /api/machine/done/:stepId` (merge step) | routes-machine.ts:385 → machines.ts:1670-1800 → builds.ts:1049-1051 | machine daemon (machine token) | review lands as done (hosted: server-side ff check :1807-1835; github/local: trusts the machine report) | the step was claimed by that machine | no (trusted machine surface) |
| 16 | machine-surface claim (build step) queued→building | routes-machine.ts:228; machines.ts:946-948 | machine daemon | withPlan=false: claiming is the gate-skip moment | first step = build | no |
| 17 | executing agent loops back through its own MCP | machines.ts:711-718 | the executing agent (if configured with an MCP server pointing back at pacman + an authorized key) | can self-release both gates | agent.mcpServers configuration | configure once |
| 18 | `steps {restart}` | builds.ts:447-507 | web failure surface | none (failed→queued; **withPlan inherited** :465) | phase=failed | yes |
| 19 | `restoreFailedReview` | builds.ts:625-652 (callers :663/:520) | merge/review action surfaces | none (it is the gate's **entry**; data gate :637-647) | build leg done + artifact present | yes |
| 20 | scheduler `cancelGateBuild` | scheduler.ts:51-63 | the timer | discards gate-parked decisions (old build Cancelled) | confirm/review parked + latestBuildId | nobody present at fire time |

Authentication model (who can call what): REST `/api/*` is **de facto unauthenticated** (auto-login cookie, routes.ts:354-359; the only server-side gate = the optional global PACMAN_TOKEN, token-auth.ts:68-86, off by default); the machine surface = Bearer machine token (routes-machine.ts:118-125); the MCP surface = Bearer apiKey + per-key tool authorization (mcp-face.ts:441-455; the authorization list includes Confirm/Merge/Complete Todos, shared mcp.ts:44-58); the chief has no credential of its own — triggered by REST messages, it receives the full 51-tool set at machine claim time (machines.ts:849), a plaintext "trust face" (chief-tools.ts:5-8). The executing agent's relay tool surface **excludes** gate tools (machines.ts:1122-1123) — the executor can bypass gates only via #17's self-configured MCP.

**Non-bypass surfaces (verified)**: stop only rewinds (builds.ts:228-238/246-279); a plan step without plan.md only gets one bounded rewrite (:962-975, dead after #703 :901-928); reset only returns to todo (todos.ts:489-562); a blocking review verdict only reflows to planning (:1022-1046). failed→done is sealed on every surface.

## Appendix C: the mea second dataset (comparison, not merged into the main conclusions)

The user's own deployment on mea (`/home/measure/.pacman/server/server.db`, read-only queries): 1 todo, 18 builds, window 10-01 23:52 → 10-02 03:31. withPlan=1 for 16, direct execution 2 (the last rounds); 15 plan steps failed (the relay/540s-wall problem from the #519 night, see the wiki record); **the AI review step ran 5 times (3 done, 2 failed)**; the todo is still failed — **the gate held there; nothing passed**. Evidence it adds: the AI review's teeth really bit in a real failure flow (2 blocking reflow retries); direct execution only happened as "the manual lane change after 15 consecutive failed plan rounds". [unverified] item: 0 chief threads on the mea side — the chief bypass path has no data on that machine.

## Attached: evidence anchors

- All snapshot queries against the local DB are recomputable from the §1 SQL; the conversation/chief_message corroborating rows (#14's complete_todos toolcall, #16's merge_builds 403, #1's confirm/merge injection rows) can be replayed one by one with `SELECT … FROM message WHERE conversationId='<buildId>'` / `SELECT … FROM chief_message WHERE threadId='chief-<id>'`.
- Code reference baseline = this PR branch (67509706 baseline plus this file and the spec §5 update).
- [unverified] list: ① the mechanism of #1's post-done phase change (phaseAt 10-01 06:44); ② #12 build A's missing review-entry row; ③ drag vs bare PATCH indistinguishable per card (same entry, zero audit); ④ the plan upload channel (post-#560) has zero real samples, quality unknown; ⑤ the mea side has zero chief-path data.
