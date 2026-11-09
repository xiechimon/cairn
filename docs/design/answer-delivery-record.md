# Answer delivery record

Status: accepted (coordinator review on #3512, 2026-11-08). Replaces the per-path delivery bookkeeping that #3467 grew over nine review rounds. Owner of the decision: the coordinator (2026-11-08).

## Problem

A worker question (`ask_user`, or the synthetic zero-change question) gets an answer from a person, the Coordinator, or a deadline default. That answer has to reach the agent exactly once. In #3467, whether an answer had reached the agent was decided separately on each path that hands text to the worker: the held ask poll, a steer into the running step, the prompt of a resumed step, a claim, an orb worker, a daemon restart. Each review found one more path that marked too early, never marked, or marked twice.

## Invariants

1. Every answer has one delivery record, keyed by `(buildId, requestId)`. Fields: `answeredAt`, `answeredBy` (`person` | `coordinator` | `default`), `text`, `deliveredAt` (null until delivered), `deliveredVia` (`ask-poll` | `steer` | `session-start`), `deliveredStepId`.
2. Exactly two functions touch delivery: `recordAnswer(buildId, requestId, answer)` creates or refuses the record, and `markDelivered(buildId, requestIds, via, stepId)` sets `deliveredAt` if it is null. Nothing else writes `deliveredAt`. `markDelivered` is idempotent: a second call for the same id is a no-op.
3. Exactly one function reads what still has to be delivered: `undeliveredAnswers(buildId)`. Every path that can hand text to the agent asks it, and only it.
4. An answer is delivered only when the daemon acks it. All three paths end in the same receiver ack by request id: the daemon acks an answer the ask poll returned once the tool result reached the agent, acks after a successful `live.steer`, and acks once a session started on a prompt that contained it. Handing it out, including in a poll response, is not delivery.
5. An answer is only handed to a daemon that declared `answersAck` (the capability gate from #3467). With no capable receiver the question stays pending and the task shows `machine-update`.
6. The daemon applies an answer at most once per conversation: its applied set is seeded at claim from `answerIds`, gains every answer it acks (poll, steer or session start), and is the only dedupe source.

## Entry points

File and function names refer to the #3467 and #3471 branches (`server/stall-needs-input`, `server/stall-escalation`); main does not have them yet.

Every path that writes or reads delivery state, including each one that leaked in #3467, and the failure mode the record removes.

| # | Entry point (current code) | Reads | Writes | Failure seen in #3467 | Under the record |
|---|---|---|---|---|---|
| 1 | `askWorkerQuestion` poll returns an answered question (`worker-questions.ts`), and the daemon's `ask_user` tool result | record | `markDelivered(…, 'ask-poll')` only through the daemon ack | human answer through a message while the poll held it was replayed later | the daemon acks after the tool result reached the agent; an interrupted poll stays unacked and is re-sent |
| 2 | `answerTaskQuestion` held branch (`thread-message.ts`) | — | `recordAnswer` only | marked delivered at settle time | the ack in row 1 marks it |
| 3 | `answerTaskQuestion` waiting-other-questions branch | — | `recordAnswer` | answer A lost when B resumed | carried by row 6 |
| 4 | `sendBuildSteer` running step, `answer` option or human text answering a pending question (`builds.ts`) | — | `recordAnswer`, steer slot | single steer slot overwrote A with B | answers never ride in the slot; row 7 carries them |
| 5 | `settleWorkerReply` (person free text, queued message) | — | `recordAnswer` | stored with no delivery path when the poll consumed it | same as row 1 or row 7 |
| 6 | `enqueueStep` for session and plan steps (`withUndeliveredAnswers`), covering continuation, rework, replan, PR wakes, schedules | `undeliveredAnswers` | — | earlier: marked at enqueue, lost when the session never started | prompt carries them; row 8 marks |
| 7 | `fetchSteer` (`machines.ts`) | `undeliveredAnswers` | — | earlier: marked at pickup, lost when `live.steer` failed | hands them out, marks nothing |
| 8 | Claim (`machine-claim.ts`, `answerIds`) and daemon `onSessionLive` (host runner, orb ready frame, journal recovery via `runTrackedStep`) | record | `markDelivered(…, 'session-start')` through the ack route | orb and recovery runs never acked; startup steer re-sent | one ack route for all three |
| 9 | Ack route (`POST /api/machine/steer/ack`, `answerIds` and `via`), used for poll, steer and session-start acks | — | `markDelivered(…, via)` | double ack | idempotent |
| 10 | Daemon `deliverSteer` (`machine-loop.ts`), serialized per step | applied set | — | concurrent events steered twice | unchanged |
| 11 | `sweepQuestionDeadlines` default answer (#3471) | — | `recordAnswer(…, 'default')` | — | same as row 3 |
| 12 | `cancelPendingWorkerQuestions` on phase change | record | closes the question; undelivered answers stay until abandoned | — | an abandoned build drops its records |
| 13 | Old daemon without `answersAck` | capability | — | answer handed out as text it could not ack | refused, `machine-update` |

## Migration

- The record lives in the existing question message content (`answers`, plus new `deliveredAt`, `deliveredVia`, `deliveredStepId`), so no table migration. `markDelivered` is the only writer of those fields; a lint-level test greps for other writers.
- Existing answered questions with no `deliveredAt` are treated as delivered on the first boot after the change (one data migration), so no old answer is replayed.

## Tests

1. Held poll returns a person's message answer and the daemon acks it: delivered once, not replayed in the next continuation (the last #3467 finding).
2. Interrupted poll: the poll response carries the answer but the tool result never reaches the agent (connection drop or step stop before the ack); the answer stays undelivered and the next pickup or continuation re-sends it.
3. Two answers, A then B, while idle: the resumed prompt carries both; the session-start ack marks both.
4. Two answers into a running step before pickup: both reach the step; one ack marks both.
5. `live.steer` fails: no mark; the next pickup re-sends.
6. Session gone before ack: the next continuation carries the answer; its session-start ack marks it.
7. Double ack and an ack for an unknown id: no change.
8. Orb worker and journal recovery: session-start ack goes through the same route.
9. Steer during orb startup: instruction answers are not re-sent.
10. Old daemon: the answer is refused, the question stays pending, `machine-update` shows.
11. A grep test: no file other than the record module writes `deliveredAt`.
