# Review round 2: automatic delivery uses the same identity handoff

Finding: [automatic queue delivery lacked the source capsule identity](https://github.com/xiechimon/cairn/pull/3643#discussion_r4512329205). Round 1 fixed the browser POST callback but missed server-driven delivery. This is a recurrence of the same queue-lifecycle bug class; the safeguard is now at the event producer, not only the initiating caller.

Design was recorded before implementation in `../round2-design.md`. The existing message event carries optional `deliveredQueue` identities through sendBuildSteer, transcript insertion, stream hub and the browser consumer. It is emitted once, not as a duplicate event. Persistence, authorization, queue selection and worker protocols are unchanged. Both manual and automatic delivery now use the same cache reconciliation. Equal-content messages are distinguished by id.

Red-first: six regressions failed on cd6139d0d: two browser-cache cases (same/replacement conversation), three server cases (successful completion, stopped completion, manual delivery), and the closed-PR replacement-build case. The shared JSON-schema snapshot then failed on the additive optional field; its generated update contains only that field. All now pass. Focused verification: 176 tests across six web/server/shared files, plus the single real-daemon steer integration test with a stub LLM.

Live driver: `node ~/.cache/codex-scratch/pi-168/verify-runner.mjs after-round2`. The adjacent probe and runner reproduce it on an isolated stack. A stateful synthetic machine is enrolled, associated with a seeded claimed step and sends the real machine-done protocol; no actual daemon or provider executes work in this live leg. The main visibility, POST failure, duplicate-submit, explicit retry, reconnect and phone/theme checks are repeated too.

With transcript GET held for 3000 ms, automatic drain displayed one delivered bubble and removed the source capsule in 77 ms. API truth: one delivered row, zero queued rows. `automatic-delivery-event.json` is the actual browser-observed event with both source identities; `result.json` has the timing and assertions. Manual Send now also passed in 235 ms. Screenshot lives on the separate PR asset branch.

The synthetic machine enrollment credentials stay in memory, are never printed and are not archived. Earlier rejection and no-provider limits still apply. The integration leg separately exercised a real daemon with a stub LLM; this is not evidence of real-provider performance.
