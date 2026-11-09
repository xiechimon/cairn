# Review round 1: queue lifecycle reconciliation

Finding: [the confirmed delivery left an actionable queue capsule behind](https://github.com/xiechimon/cairn/pull/3643#discussion_r4512200076). This was introduced by immediate cache insertion: the previous GET used to replace queued and delivered state together.

Bug-class search: all queued-message entry points in `useThreadChat` (Send now, retry, edit, cancel, stop-and-send and ordinary queue) use `sendSteer`. Delivered responses now carry the source capsule identity into `cacheUserMessage`. A confirmed user row removes that capsule in the same page update that adds the bubble; a replacement conversation also removes it from the source cache. Partial edit/cancel acknowledgements cannot remove a capsule through this path, and a rejected delivery retains it. Normal queue acknowledgement and SSE propagation remain unchanged.

Red-first: two `message-confirmation.test.ts` cases (same and replacement conversation) expected an empty queue but received the old capsule. The new slow-read queue-delivery browser test also failed: expected zero capsules, received one. Both pass after the fix. The focused stream/confirmation files pass 34 tests and the queue browser file passes 15 tests.

Live verification: run the adjacent `probe.mjs` through `verify-runner.mjs` from the implementation checkout, using phase `after-round1-verified`. It repeats the initial visibility, rejection, duplicate-submit, retry, reconnect and phone/theme checks, then clicks Send now with a 3000 ms reconciliation GET delay. `result.json` records one delivered bubble, zero stale capsules, one authoritative delivered API row and zero queued rows. `queue-delivery-response.json` is the actual HTTP 201 response. Screenshot: separate PR asset branch.

The queue-delivery leg seeds a claimed worker step in the isolated SQLite database; no daemon, provider or actual work execution is involved. An earlier probe tried delivering while the synthetic task only had a pending step and correctly received HTTP 409; the retained capsule was an intercept, not a reason to bypass admission or increase a timeout. The driver now asserts HTTP 201 before asserting delivery UI.

This is the same cache-propagation repair, with no server, protocol or persistence changes. Source and target query cancellation prevents older in-flight snapshots from restoring the removed capsule. The existing GET reconciliation remains enabled.
