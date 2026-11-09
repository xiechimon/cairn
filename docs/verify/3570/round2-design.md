# Queue delivery correlation repair

Review round 2 exposed the remaining queue-lifecycle entry: automatic drain has no browser POST callback. The delivered user row has a new id, so the SSE consumer cannot safely identify its old capsule. Matching content would conflate legitimate equal-text sends.

## Wire and state

Extend the existing `message` SSE envelope with optional `deliveredQueue: { conversationId, messageId }`. These are existing source identities already passed to `sendBuildSteer`; no persisted state, authorization, delivery policy, new event type or queue algorithm changes. The row id still identifies the delivered transcript row. Old consumers ignore the optional envelope field. Old producers still use the existing GET reconciliation fallback.

Before the implementation below, this design records the state transition and all paths. The owner explicitly moved this task to direct ownership, so no Coordinator approval step is available; review remains the cloud review bound to the final PR head. This is a pure bug repair that carries existing correlation information across the existing event boundary, not a new delivery mechanism; no new-mechanism research is introduced.

| Path | Transition and failure behavior | Test |
| --- | --- | --- |
| Manual Send now / retry | Queue id enters sendBuildSteer, insertion, hub and SSE; one delivered row replaces that capsule | Server queue test and browser mutation regression |
| Successful turn / stop draft drain | Same event correlation without any browser POST; remove the identified capsule only | Server machine-done tests; SSE unit and live driver |
| Replacement conversation | Envelope names original conversation and capsule, delivered row belongs to new conversation | Server closed-PR continuation and SSE cross-conversation regression |
| Equal text in another queue entry | Different id remains queued | SSE regression with equal-content capsules |
| Repeated delivery event / POST acknowledgement | Upsert same row id, remove same capsule id idempotently | SSE duplicate and existing mutation tests |
| Rejected delivery | No correlated delivered event; capsule and draft remain | Existing server and browser failure tests |
| Non-queue user / assistant / system event | No metadata and no changed behavior | Existing stream/hub tests and protocol snapshot |
| Disconnect / reload | GET is authoritative: delivered rows and remaining queue read together | Existing reconnect tests and live driver |

Writers: the single queued-message insertion in `sendBuildSteer`, forwarded through `insertMessageRow` and `ConversationStreamHub.publishMessage`. Reader: `startConversationStream`, which validates the optional envelope correlation and passes it to the existing confirmed-message cache update. No daemon wire reader changes: this is the server-to-browser conversation channel only. The shared SSE schema and JSON schema snapshot define the additive field.

The transaction, message persistence and queue deletion remain in their existing order. Query cancellation prevents an older snapshot from restoring the removed capsule. A failure before insertion emits no new confirmation; no success is manufactured. No extra duplicate message event, content-based inference, retry or timeout increase is used.
