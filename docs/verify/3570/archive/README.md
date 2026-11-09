# Confirmed user message visibility (#3570)

## Diagnosis

This is a cache-propagation bug, not evidence of a slow model. `chiefSend.onSuccess` discarded the server's committed message and invalidated queries. Conversation SSE did the same on `message` events. Both paths waited for another transcript GET before React could see the row. A first Coordinator message also waited for thread discovery. Task sends through `messageThread`, direct steer and the queue share the conversation stream; the task page and side pane share `useThreadChat`.

No persistence, protocol, queue, retry or model-execution mechanism changes. This repairs the existing TanStack Query update path; new-mechanism research is skipped for this pure bug fix. No optimistic success rows, timer increases or automatic submission retries were added.

## Measured boundaries

Command, from each checkout: `node ~/.cache/codex-scratch/pi-168/verify-runner.mjs <phase>`.

Before: pristine `4618ba6b001fbb05c95127b8e83fd6729cf78ae9`, phase `before-measured`. After: `ce56e3ade` plus this PR's implementation, phase `after-final-evidence`. The driver records real API responses, SQLite rows and animation-frame visibility in the running app, without fixture URLs. Only GET responses for transcript and Coordinator discovery are held for 3000 ms. POST and SSE are not held.

All values below are milliseconds since clicking Send. Persistence is the server-created row timestamp, not a separate filesystem durability benchmark. Browser and server share the local clock. Visible means a message or queued capsule intersects the viewport, not that a network request finished. These are deterministic delay-injection samples, not production percentiles.

| Surface | Persisted before / after | POST before / after | SSE before / after | Visible before / after |
| --- | --- | --- | --- | --- |
| Coordinator home | 54 / 32 | 82 / 60 | 82 / 60 | 3134 / 89 |
| Coordinator via keyboard navigation | 62 / 43 | 90 / 73 | 90 / 73 | 3187 / 100 |
| Task thread side pane | 48 / 43 | 67 / 70 | 66 / 62 | 3308 / 84 |

React can render within 22–29 ms of receiving confirmation in these after samples, while the GET is still held. Every sample has exactly one matching SQLite row and one API row. No daemon or worker is online: turns remain queued and no provider is exercised. This separates submission and display from Agent scheduling and response latency.

Raw observations: `before.json` and `after.json`. Screenshots live on the separate PR asset branch, linked from Proof.

## Affected paths and failure matrix

| Reader or writer | Expected behavior | Check |
| --- | --- | --- |
| Coordinator existing / first send response | Insert confirmed row; discover the returned thread without another GET | `chief-send-retry.spec.ts` existing and first-thread slow-read tests |
| Coordinator or task user SSE | Update the newest page immediately, keep other page metadata | `sse-conversation-stream.test.ts`, both conversation types |
| Direct task steer acknowledgement | Render the returned committed row without SSE | `message-confirmation.test.ts` |
| Task queue response / event | Show one queue capsule, never a delivered bubble | Both unit files; `detail-composer-queue-stop.spec.ts` slow-read test |
| Partial edit / cancel response | Never manufacture a transcript row | `message-confirmation.test.ts`; existing queue-operation e2e |
| Pre-confirmation GET completing late | Cancel that query before inserting the authoritative row | SSE stale-read regression |
| POST then SSE, replay or older loaded page | Deduplicate by server message id and preserve history cursors | Both unit files and history-paging e2e |
| Slow POST, rejected submission | No new message before acknowledgement; retain draft and show failure | Real-stack home and task rejection samples; Coordinator e2e |
| Double submission and explicit retry | One in-flight submission; reuse client key after failure | Real-stack samples, lost-response e2e and server idempotency tests |
| Reload / reconnect | Exactly one authoritative visible message or queue capsule | Real-stack home and task samples; queue e2e |

`messageThread` still returns a delivery receipt rather than a transcript row. Its immediate display uses the authoritative conversation SSE event; if that stream is unavailable, existing GET reconciliation remains the fallback. First-build / restarted-build discovery, GitHub continuation admission, assistant/tool/system rendering, pending questions and persistence semantics are unchanged. This patch does not promise pre-acknowledgement display on a slow POST or an offline browser.

## Red-first and final checks

Before implementation, `pnpm exec vitest run apps/web/test/sse-conversation-stream.test.ts --maxWorkers=4` failed for both conversation types: expected `messages: [message]`, received `messages: []`. The slow-read Coordinator e2e tests also failed their 700 ms visibility assertion on the original code. Final focused checks:

- 39 web unit tests: stream, confirmation, page boundary and send key.
- Existing server Coordinator/build idempotency tests passed.
- 22 browser tests across `chief-send-retry`, `detail-composer-queue-stop` and `transcript-history-paging` passed.
- `pnpm lint`, `pnpm typecheck`, `pnpm spec:parse` and `pnpm prepush` passed; full suites belong to CI.

The real-stack after driver also checks 1200 ms rejected POSTs, double Enter, preserved drafts, one explicit same-key retry and reload consistency for both surfaces. True 390 px mobile contexts and 1440 px desktop captures have no horizontal overflow, in light and dark. Queue captions and failure feedback remain visible; no styles or copy changed.

## UI brief and reference comparison

Surface: Coordinator chat and task thread. Goal: see one's own confirmed message without waiting for an Agent. Draft: exempt, existing-screen bug fix. Rules checked: C11 (sent content in viewport), A2 (no user-message entry animation added), R1 (390 px overflow).

| Component | Empty / first send | Waiting for read | Error / offline | Long history / question | 390 px / dark |
| --- | --- | --- | --- | --- | --- |
| Coordinator | First-thread browser regression; existing initial greeting unchanged | Real delayed-GET capture | Real rejected POST and offline-machine capture | Paging regression; pending-question rendering unchanged and not recaptured | Real mobile light and dark |
| Task composer / transcript | Existing task spec, then first reply | Real delayed-GET capture; queue capsule e2e | Real rejected queued send, retained draft and reload | Paging regression; pending-question rendering unchanged and not recaptured | Real mobile light and dark |

Opened references: `docs/design/references/coordinator-chat/claude-ai-streaming.jpg` and `docs/design/references/thread-review/t3code-working-thinking.png`. Both show the sent bubble before any reply completes. Our matching live captures keep the right-aligned compact bubble while waiting for an offline machine; the task side pane is narrower than t3code's full thread. Side-by-side comparisons are linked in PR Proof. This is not a visual redesign.

## Evidence limits and process safeguards

Live: isolated server, Vite UI, REST, SSE and SQLite with synthetic local data. Mocked: browser-held GET responses and deliberate 503 responses; stateful Coordinator/queue fixtures in e2e. Not covered: production latency distribution, real providers or daemon execution, actual wire disconnection beyond reload, pending-question and long-content screenshot matrices. No live instance writes occurred.

The first acceptance probe incorrectly searched all page text, which included controlled textarea text, and later assumed confirmed messages always remained bubbles. The corrected driver explicitly selects message bubbles plus queued capsules and checks the authoritative API union, preventing both false success and false failure. A screenshot check also caught that changing emulated color scheme did not override the app's persisted theme; the driver now reloads with the persisted theme and asserts `dataset.theme` before each light/dark capture. The failing probe intercepted those mistakes before delivery. A startup failure under host contention was reclaimed by the existing owned-stack cleanup; no timeout increase or process killing was used.

Re-run: copy `probe.mjs` and `verify-runner.mjs` from this directory to `~/.cache/codex-scratch/pi-168/`, then run the command above from the chosen checkout. `before-*` records the baseline; `after-*` additionally asserts sub-second display and the failure/reconnect/mobile paths. The runner creates and cleans only its own scratch stack. Inspect the embedded local port constants for occupancy before running. The stack is deliberately offline; this probe must never be aimed at a live data root.
