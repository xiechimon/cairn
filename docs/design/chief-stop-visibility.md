# When the Coordinator composer offers Stop

The composer's Stop button and its Esc key act only when the press can succeed. The server accepts `POST .../chief/threads/:tid/stop` for a claimed turn and `DELETE .../messages/:mid` for an unstarted turn that one user message owns.

`ChiefThread.turnRunning` is a read projection (not stored): true while the thread has a claimed `chief` step. It is sent by the thread list, channel open, retry greeting, send and rewind responses. The web cannot derive it: `turnQueue` is null both for a claimed turn and for a thread whose only turn is a system turn in `waiting_quota`.

| Oldest live turn | `turnRunning` | Stop and Esc |
|---|---|---|
| claimed | true | stop the turn |
| unstarted, owned by a user message the transcript shows (`turnQueue.stepId`) | false | withdraw that message |
| unstarted system turn (greeting, wake), `pending` or `waiting_quota` | false | not offered |
| none | false | not offered |

A running turn keeps Stop even while a later message is held (`pending[].state` `held`); a held message hides the running state only when `turnRunning` is not true.

A server that does not send the field leaves the web on its earlier behavior. A turn claimed or ended after the last read is corrected by the next thread refetch; a Stop press in that window is answered by the server's refusal as before.

Task threads need no field: `POST .../stop` on a build accepts `pending`, `claimed` and `waiting_quota` steps, which are exactly the states that show Stop there.
