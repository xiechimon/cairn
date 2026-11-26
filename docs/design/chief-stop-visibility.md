# When the Coordinator composer offers Stop

The composer's Stop button and its Esc key act only when the press can succeed, and they never delete a message. Both send `POST .../chief/threads/:tid/stop`. `DELETE .../messages/:mid` is sent only by the explicit withdraw controls: the queued-message chip and the steering message's withdraw.

A turn has **started** once a computer claimed it (`step.claimedAt` is set and never cleared). A started turn can leave `claimed` without ending: it moves to its backup model, is held or waits for quota or capacity, is handed back by a rate limit, or is released from a silent computer. It has read its messages from then on.

Two `ChiefThread` fields are read projections (not stored), sent by the thread list, channel open, retry greeting, send and rewind responses:

- `turnRunning`: the thread has a claimed `chief` step.
- `waitingRerun`: no step is claimed and a started one is still live; `held` while a hold or quota wait is in force, `ready` when a computer can claim it now, null otherwise.

The web cannot derive either: `turnQueue` is null both for a claimed turn and for a thread whose only turn is a system turn in `waiting_quota`.

| Oldest live turn | Fields | Stop and Esc | Request body |
|---|---|---|---|
| claimed | `turnRunning` | stop the turn | none |
| started, waiting to run again | `waitingRerun` | offered; `held` shows no running state | none |
| never started, owned by a user message the transcript shows (`turnQueue.stepId`) | both off | stop that turn | that `messageId` |
| never started system turn (greeting, wake) | both off | not offered | |
| none | both off | not offered | |

A server that sends neither field leaves the web on its earlier behavior.

A running turn keeps Stop even while a later message is held (`pending[].state` `held`); a held message hides the running state only when `turnRunning` is not true.

## What the server stops

| `messageId` | Turn that is stopped | Otherwise |
|---|---|---|
| none | the claimed turn, else the started one waiting to run again | 409 `nothing-to-stop`; never-started turns are untouched |
| given | the live turn that owns the message, alone or merged with others, started or not | 409 `nothing-to-stop` when no live turn owns it, or another turn is claimed |

A claimed turn is asked to stop through `stopPending`. A turn that is not claimed ends at once: the step becomes `stopped`, the thread gets one `chief_turn_stopped` row, every owner message stays, unread steers return to the queue, its memory edit settles as stopped, pending questions are cancelled, and the computers and the in-server Coordinator are woken for the next turn. A stopped step is never claimed, swept or retried again. The reads of the step and the write run synchronously in one process, so a claim lands either before the press (the claimed path) or finds the step stopped.

`interrupt_thread` over MCP sends no `messageId`.

## Withdraw

Withdraw and steer act only on a turn that never started. A started turn's messages answer 409 `chief-message-read` and carry no `pending` entry, so they stay in the transcript without a queued chip. Later messages behind it keep theirs.

## A press on a stale page

A turn claimed or ended after the last read is corrected by the next thread refetch. Until then a press meets one of these answers. A reason of `nothing-to-stop` shows as stopped: no toast, and the thread is read again.

| Press | Server state at arrival | Answer | What the owner sees |
|---|---|---|---|
| Stop, no message | nothing claimed or waiting to run again, queued turns or none | 409 `nothing-to-stop`; queued turns are untouched | stopped; Stop then follows the table above |
| Stop, no message | the running turn now waits to run again | 200; it ends | the stopped row |
| Stop a queued message | its turn was claimed meanwhile | 200 delegated; the running turn stops | the stopped row |
| Stop a queued message | its turn ended | 409 `nothing-to-stop`; other turns are untouched | stopped, no toast |
| Withdraw a message | no live turn owns it | 409 `nothing-to-stop`; the message stays | stopped; the composer is not refilled |
| Withdraw a message | a claimed or started turn owns it | 409 `chief-message-read` | one line saying the Coordinator already read it |
| Withdraw a message already removed | no such message | 404 | nothing |
| Withdraw a message | merged into one never-started turn with other messages | 409 `chief-message-merged` | a line saying it cannot be withdrawn on its own; Stop ends that turn and keeps all of them |
| Withdraw a message | the server or network fails | 500 or no answer | a line asking to try again, over the plain cause |
| Stop a memory edit | the edit moved to a newer attempt | 409 `memory-edit-moved` | Chinese line pointing at the latest attempt |
| Stop a background task | its computer is not connected | 409 `task-computer-offline` | Chinese line saying to stop it once the computer is back |

A failed stop request never carries the server's own text, whichever handler reports it, including after the view that sent it is gone: the stop hooks mark the error, and the toast uses the copy for the reason code, or for the status when there is none. No stop hook declares its own `onError`, so a failure that arrives after the view is gone still raises the default toast.

Task threads need no field: `POST .../stop` on a build accepts `pending`, `claimed` and `waiting_quota` steps, which are exactly the states that show Stop there.
