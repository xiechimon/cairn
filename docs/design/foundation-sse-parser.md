# Machine SSE framing boundary

Date: 2026-11-09
Status: Proposed; implementation and dependency approval pending

Basis: [primary-source research](../research/foundation-sse-parser-2026-11-09.md), #3564 and merged #3575. This segment changes no runtime, schema, dependency, persisted state or measurement code.

## Decision requested

| Decision | Recommendation | Status |
|---|---|---|
| D1: dependency | Declare exactly `eventsource-parser@3.1.1` directly in `apps/daemon`, using its existing transitive version; corresponding lockfile importer only | Owner approval required; earlier YAML approval does not cover this |
| D2: scope | Replace only `MachineClient.stream` framing; keep fetch/auth, Zod, native browser EventSource, server producers and reconnect ownership | Design review required before code |
| D3: EOF compatibility | Account for the installed parser's deferred trailing CR without dispatching unfinished LF records; verify every byte boundary first | Candidate bridge below; not implemented |
| D4: limits | Do not invent a payload-size cap in a framing substitution; retain current acceptance until a separate producer-wide size contract is approved | Explicit existing risk, not a claim of bounded memory |

## State and failure transitions

Connection-local state is a decoder, parser, reader and trailing decoded character. Create fresh state on each invocation; never persist it or share it between reconnects. The single runtime caller is the anonymous stream loop in `runMachine`, `apps/daemon/src/machine-loop.ts`.

| State / transition | Required result |
|---|---|
| Opening -> response | Same injected fetch, endpoint, bearer and AbortSignal; preserve current HTTP-error and missing-body rejection; no transport retry inside the adapter |
| Response -> reading | Preserve `onConnected` timing; acquire reader once; decode incrementally and feed complete decoded text to the library |
| Reading -> complete event | Join data fields according to SSE grammar, then parse JSON once and apply the existing machine event schema |
| Reading -> incomplete data | Keep only this invocation's state; never fabricate a blank-line event boundary |
| Reading -> unknown type | Ignore the same unknown JSON event types as today and continue |
| Reading -> malformed known event / invalid JSON / callback failure | Reject outward and cancel the reader in `finally`; do not swallow or log raw payloads in the adapter |
| Reading -> clean EOF | Resolve after discarding unfinished records; preserve any record actually terminated by a bare-CR blank line |
| Reading -> read failure / abort | Reject outward and cancel the reader; do not create timers or another request |
| Caller shutdown | Existing `stop()` aborts `streamCtrl` and claim work; no new shutdown state |
| Caller EOF / rejection | Existing outer loop retains reconnect/backoff ownership; parser changes must not reset that policy or introduce a second loop |

The existing outer loop catches failures without distinguishing permanent HTTP errors and logs only its first successful connection. This design does not claim visible permanent-error handling or reliable delivery. Reconnect/error-classification changes belong to their own reviewed lifecycle segment, not an implicit client-library substitution.

## Entry paths, readers and writers

| Path | Existing responsibility to preserve | Required test row before implementation |
|---|---|---|
| `routes-machine.ts` stream handler | Authenticated subscription, Hono JSON event writing, comment pings and disconnect cleanup | Real in-process server stream through the real client; auth rejection and ping frames |
| `MachineWakeHub.wake` | Team wake publication | One valid wake delivered by client; no new claim semantics |
| Hub revoke / `shutdown` | Old connection shutdown | One callback followed by caller stop/abort, no reconnect after abort |
| Hub steer / `steer` | `deliverSteer`: fetch content, apply live steer, then existing answer acknowledgement | Preserve request-id acknowledgement ordering in existing machine-steer tests |
| Hub stop / `stop` | `deliverStop`: fetch stop request, then `StepStops` delivery | Valid event reaches existing consumer exactly once |
| Hub sync / `sync` | `performSync` invocation | Existing sync command validation and reporting retained |
| Hub computer / `computer` | Computer dispatcher boundary | Valid call delivered; malformed known call rejects, never dispatched |
| Hub screen / `computer.screen` | Outbound screen dispatcher boundary | Valid channel delivered; no image/auth policy moved into parser |
| `MachineClient.stream` | Sole handwritten machine-wire framing reader | LF, CRLF, CR, comments, empty fields, multiline data, BOM, unknown fields and every UTF-8/chunk boundary |
| `runMachine` stream loop and `stop()` | Sole production stream caller; reconnect and shutdown state | Fake-clock lifecycle assertions: normal EOF, reject, abort, shutdown; no second retry owner |
| Browser `api/sse-connection.ts` | Native EventSource plus browser reconciliation | Retained, not replaced or reimplemented |
| Shared protocol schemas | Known-event validation and additive unknown-event compatibility | Existing known-malformed/unknown-event tests remain; no wire or schema change |

`wake` is not explicitly handled by the current callback; dispatch still uses the existing claim polling path. This segment must not add wake-triggered scheduling. Test doubles implementing `MachineApi` do not constitute another production framing parser.

## Installed-parser EOF evidence

Measured on the installed 3.1.1 parser: feed one complete synthetic wake record, then `reset({consume:true})`. LF and CRLF dispatch one event; `data: {"type":"wake"}\r\r` dispatches zero. An unfinished LF record dispatches zero. Thus blindly consuming/resetting at EOF does not satisfy the bare-CR contract.

Candidate thin bridge: after flushing decoder output, feed one LF only if the final decoded character is CR. That completes a deferred CR as CRLF, which denotes the same line ending. Do not append anything for an LF-ended or unterminated record. Prove the candidate against CR-only multi-record streams, CRLF split across chunks, comment-only tails, empty input, split BOM/UTF-8 and incomplete final data before accepting it. If those tests fail, return to library selection rather than add a second handwritten parser. Parser errors for unknown fields must retain the standard's ignore behavior; do not turn them into blanket fatal errors.

## Delivery and acceptance

1. Obtain D1 dependency approval and review D2-D4. No production import, installation or lockfile edit before approval.
2. Add red-first cases to the existing machine-client stream tests using the real `MachineClient`, fetch-compatible streams and schema. Demonstrate CRLF omission and multiline JSON failure before replacement; use an isolated in-process server, not the live cairn instance.
3. Replace only framing, remove the obsolete buffer/splitting loop, and keep JSON/schema/callback rejection and cleanup outside library-owned format policy.
4. Test each entry-path row, targeted Vitest with `--maxWorkers=4`, plus lint/typecheck/spec:parse/prepush. Include the real server-to-client stream acceptance alongside schema and lifecycle tests; do not substitute the earlier permissive-schema research probe for acceptance.
5. Recheck exact file owners and the complete PR head in CI/cloud review. No parent closing keyword until all #3564 domains are actually accepted. No migration is required.

Rollback is a normal revert of the later implementation, with no persisted data conversion. The docs-only proposal is not acceptance of the candidate or permission to weaken existing authorization, errors or measurement gates.

## Overlap at 16:32 UTC, 2026-11-09

1. #3575 is merged; this branch starts at fresh `origin/main`, not the old implementation head.
2. Open term matches #3643 (`pi/task-168`), #3670 and #3696 concern browser-confirmation caching, localization and transaction publication. Their bodies were read; none replaces machine-wire framing.
3. Exact-file checks for `machine-client.ts`, `machine-loop.ts`, this design and the coverage ledger returned no open PR overlap. Proceed with docs only; recheck before implementation.
4. Recent matches include #3575, #2855, #2877, #3040, #3339, #3586, #2880, #2922, #3462, #3150 and #3545. Preserve their computer, task, rendering and delivery behavior; no intentional removal.
5. Explicit empty result: no competing open machine SSE-parser replacement was found. Reuse #3564 context; create no duplicate task. Its owner-closed state is not full-program completion.
6. Publication recheck at 16:36 UTC used `eventsource-parser`, `machine SSE` and `event stream` plus the same exact paths: no matching open issues, no matching open PRs and no file overlaps. Recent matches were computer transport/history work, not framing replacement.
