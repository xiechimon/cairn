# Queue confirmation subscription handoff

The coordinator authorized one final fix for PRRT_kwDOUSKs6c61PjWy after confirming this path is in scope. Bug class: queue lifecycle / subscription handoff. This refines the replacement-conversation row of the existing queue correlation design; persistence, scheduling and delivery policy remain unchanged. This is a pure bug repair, so new-mechanism research is skipped.

## States and transition

The browser initially subscribes to the source build. `sendBuildSteer` inserts a delivered row into a replacement build before publishing the todo update that switches the browser. The target stream has no message replay, so target-only publication loses that confirmation.

Retain the normal target message event. For a correlated user delivery whose source differs from its target, `ConversationStreamHub.publishMessage` also publishes the confirmation to the source stream, with an optional top-level `conversationId` identifying the row's actual destination. The source frame must not clear source live buffers. Both frames carry the same transcript id and source queue identity. `startConversationStream` caches the row under its explicit destination, removes only its source capsule, and reconciles both caches. Existing handlers still refresh the todo, enabling the build switch. The source history never acquires a row that belongs to the target.

Old producers omit the optional field and retain stream-local behavior. Consumers on main ignore it and retain their existing GET reconciliation; the old consumer does not insert message events into transcript caches. No new event type, dependency, persisted field or daemon protocol is introduced.

## Readers, writers and failures

| Entry path | Expected behavior | Regression |
| --- | --- | --- |
| Closed-PR automatic completion | Source subscriber receives confirmation before target subscription; target cache is seeded | Server rollover subscription test; browser source-to-target rollover with held GET |
| Stop-draft completion | Same forwarding with the stop draft's queue identity | Parameterized server rollover test |
| Manual delivery into replacement build | Same forwarding; POST acknowledgement and SSE upsert the same target row | Parameterized server rollover test; existing mutation replacement test |
| Locally merged build continuation | Same forwarding without a GitHub probe | Parameterized server rollover test |
| Same-build delivery | One message event, no forwarding or duplicate | Existing completion/stop/manual queue tests |
| Duplicate source and target frames | One target row; only the identified capsule removed | Browser stream test with equal-content sibling and both subscriptions |
| Non-queue messages | No source forwarding; existing stream behavior unchanged | Existing hub and conversation stream tests |
| Rejected delivery | No delivered confirmation; queue remains cancellable | Existing queue failure tests |
| Disconnect/reload | Authoritative GET restores persisted transcript and queue | Existing browser reload tests |

Writers are `sendBuildSteer`, `insertMessageRow`, and `ConversationStreamHub.publishMessage`. The shared SSE schema defines the optional destination field; the only cache reader is `startConversationStream`, using `cacheUserMessage`. Manual POST delivery already uses the returned conversation id. Chief messages do not roll over build identities. A diff-wide search found no other cross-build confirmation producer.

No buffering or durable replay is added. Disconnected clients still reconcile through GET. Existing pre-commit transaction publication behavior is unchanged. Tests must observe an actual source subscription, not merely spy on target publication; the browser regression must switch builds without reloading while target GET is held.
