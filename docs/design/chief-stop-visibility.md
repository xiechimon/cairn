# When the Coordinator composer offers Stop

The composer's Stop button and its Esc key act only when the press can succeed. The server accepts `POST .../chief/threads/:tid/stop` for a claimed turn and `DELETE .../messages/:mid` for an unstarted turn that one user message owns.

`ChiefThread.turnRunning` is a read projection (not stored): true while the thread has a claimed `chief` step. It is sent by the thread list, channel open, retry greeting, send and rewind responses. The web cannot derive it: `turnQueue` is null both for a claimed turn and for a thread whose only turn is a system turn in `waiting_quota`.

| Oldest live turn | `turnRunning` | Stop and Esc |
|---|---|---|
| claimed | true | stop the turn |
| unstarted, owned by a user message the transcript shows (`turnQueue.stepId`) | false | withdraw that message |
| unstarted system turn (greeting, wake), `pending` or `waiting_quota` | false | not offered |
| none | false | not offered |

A server that does not send the field leaves the web on its earlier behavior.

A running turn keeps Stop even while a later message is held (`pending[].state` `held`); a held message hides the running state only when `turnRunning` is not true.

## A press on a stale page

A turn claimed or ended after the last read is corrected by the next thread refetch. Until then a press meets one of these answers. A reason of `nothing-to-stop` shows as stopped: no toast, and the thread is read again.

| Press | Server state at arrival | Answer | What the owner sees |
|---|---|---|---|
| Stop a turn | no live turn has started, queued turns or none | 409 `nothing-to-stop`; queued turns are untouched | stopped; Stop then follows the table above |
| Stop a turn | a turn that started now waits to run again (backup model, quota hold or wait) | 409 `chief-turn-waiting-to-retry`; nothing changes | Chinese failure line; the thread is read again and Stop follows the table above |
| Withdraw a message | no live turn owns it | 409 `nothing-to-stop`; the message stays | stopped; the composer is not refilled |
| Withdraw a message | a claimed turn owns it | 409 without reason | Chinese line saying the Coordinator already read it; Stop now stops that turn |
| Withdraw a message already removed | no such message | 404 | nothing |

Task threads need no field: `POST .../stop` on a build accepts `pending`, `claimed` and `waiting_quota` steps, which are exactly the states that show Stop there.
