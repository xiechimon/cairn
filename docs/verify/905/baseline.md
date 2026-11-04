# #905 evidence baseline — the duration distribution and available signals of "planning" steps

Measure the real shape before changing the shape (ticket requirement 1). Two parts:
A. how long planning steps really take in real-run data, and how slow the first visible signal is;
B. which signals actually exist on that timeline, judging one by one whether they can be safely exposed to the UI.

## A. Duration distribution (local real-run data, 2026-09-23 … 2026-10-02)

Data source = the server DB of the user's local deployment (`~/.pacman/server/server.db`, read-only queries).
Step duration is measured as the first-to-last `createdAt` span of that step's transcript rows (row ids embed the stepId, `msg-<stepId>-N` / tool row id = the toolCall id; the prompt row's `createdAt` = the claim moment, so the span ≈ the real claim → last-model-output duration).

39 done plan steps, span distribution (seconds):

| percentile | value |
|---|---|
| min | 3s |
| p25 | 9s |
| p50 | 15s |
| p75 | 29s |
| p90 | 67s |
| max | 137s |

The whole tail comes from real user tasks (137s / 95s / 89s / 76s / 67s / 56s / 45s on 09-29/09-30); the dense batch of 7-12s steps on the evening of 10-02 is verify-stack traces. Conclusion: **planning steps are routinely a dozen-plus seconds, but 1-2 minutes under real tasks is not anomalous** — the "8s processing" in the user's screenshot is exactly the start of a tail step, and the UI gives zero information in that window.

The first persisted signal (the first transcript row after the prompt row): plan steps average 4s, max 35s (build steps average 2s / max 7s; merge steps average 16s / max 18s).
⚠️ This metric **underestimates** the black-box window: `text_delta` is a transient stream that never lands in the DB, and persisted rows only appear when a tool completes / a message ends — the model's thinking phase (`thinking_delta`) is completely invisible in the DB, and can only be confirmed to exist through the signal inventory below.

## B. Signal inventory (what actually exists on that timeline)

Evidence path = pinned by code reading (file:line at this repo's origin/main @ 67509706):

| signal | produced at | currently reaches | UI-visible? | can it be safely exposed |
|---|---|---|---|---|
| `text_delta` (model streaming body) | pi/claude-code backend → runner (`runner.ts:811`, 250ms aggregation `TRANSCRIPT_DELTA_FLUSH_MS`) | → server `reportTranscriptDelta` (`machines.ts:1097`) → SSE `text_delta` → liveTextStore | ✅ already visible (typing face) | already exposed |
| `thinking_delta` (model thinking stream) | both backends emit it (`pi.ts:437`, `claude-code.ts:183`) | **the runner's switch has no case, it is dropped outright** | ❌ | **content not exposed** (chain-of-thought can contain sensitive intermediate reasoning, and the ticket only asks "what is it doing"); **the fact "thinking" + the event's arrival moment can be safely exposed** — it is the only activity evidence during the thinking phase |
| `toolcall_end` without result (the call block finishes streaming, the tool starts executing, the name is known) | mapped in `pi.ts` (emitted the moment the call block completes; only `tool_execution_end` carries the result) | the runner only returns when `result !== undefined` (`runner.ts:834`) — the no-result half is dropped | ❌ only appears once the tool finishes | ✅ the tool name + argument summary already land in the DB with the final text and get displayed; exposing the "started executing" moment leaks nothing new |
| `toolcall_end` with result | same as above | → `client.tool` → server persists + SSE `message` | ✅ already visible | already exposed |
| `auto_retry_start/end` (protocol 400 auto-retry) | backend | the runner only writes a log (`runner.ts:875`) | ❌ | ✅ "auto-retrying (round N)" directly answers "why so long" |
| `compaction_start/end` (context compaction) | backend | the runner only writes a log (`runner.ts:890`) | ❌ | ✅ same |
| `message_end` (round boundary) | backend | the runner lands it in a local transcript buffer, uploaded at the step's final text | ❌ (during live) | ✅ as the phase fact "waiting for the model's next round" |
| heartbeat (30s, `runner.ts:658`) | daemon | the server only updates `step.lastHeartbeatAt`, emits no SSE | ❌ | ✅ but 30s granularity is too coarse — enough to tell the daemon is alive, not enough for "moving vs stuck" |
| chief `activeRun.tool` (the r5 §3.5 shape) | — | **no writer anywhere in the DB** (a Multica forensics residue [inferred] shape; `chief.ts:416` writes only `{phase}`) | the panel row is always empty | dead code slot — taken over by real signals in this ticket |

### The black-box window's composition (before the change)

claim → first text_delta consists of, in order: workspace preparation (git worktree, seconds) → credential/skill issuance → session open → model first-token latency → **the thinking phase (up to tens of seconds, `thinking_delta` all dropped)**. Through this whole stretch the UI shows only `处理中… + 本步：规划中`; and if the model goes straight to calling tools after the thinking phase, the tool-execution window (`toolcall_end` without result dropped) is likewise silent. The black box the user sees = the superposition of four phases — "preparing + starting + thinking + tool executing" — while on the daemon side **every one of them has events arriving** (the runner's watchdog resets off exactly these, `runner.ts:812`) — the signals exist, they were just never forwarded.

### Judgment

Safe exposure face = **phase (what it is doing) + tool name + retry round + last-signal moment**;
not exposed = any new face of thinking/text content increments (text already has its existing exposure channel, thinking content does not go on the wire). The "moving vs stuck" criterion = the freshness of the last-signal moment: the daemon refreshes it only when an event **really arrives**, never faking a heartbeat during silence — the number growing is the honest presentation of "stuck" (the #471 law: never mount a number that can lie).

## Reproduce the queries

```sh
sqlite3 "file:$HOME/.pacman/server/server.db?mode=ro" "
with rows as (
  select s.id as sid, s.kind, m.id, m.createdAt,
    row_number() over (partition by s.id order by m.createdAt) as rn,
    min(m.createdAt) over (partition by s.id) as t0
  from step s join message m on m.conversationId = s.buildId and m.id like '%'||s.id||'%'
  where s.claimedAt is not null and s.status='done')
select kind, count(distinct sid),
  cast(avg((first_t-t0)/1000.0) as int), max((first_t-t0)/1000)
from (select r1.sid, r1.kind, r1.t0, min(r2.createdAt) first_t
      from rows r1 left join rows r2 on r2.sid=r1.sid and r2.rn>1
      where r1.rn=1 group by r1.sid) group by kind;"
```
