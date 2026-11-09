# Foundation replacement: SSE framing

Date: 2026-11-09
Status: Research draft only; not implementation acceptance, dependency authorization or a change to PR #3575

Tracking: #3564. Parent coverage ledger: [foundation library replacement](foundation-library-replacement-2026-11-09.md).

## Scope and evidence convention

Read means first-hand source inspection. Measured means a command executed in this workspace. Inferred means a conclusion from those observations. No background-agent tool is available, so this inspection was performed directly. The designated-source table has no SSE-specific row; this comparison covers WHATWG's normative EventSource behavior and two maintained projects, eventsource-parser and eventsource-client.

## Existing paths

- Read: `packages/shared/src/protocol/sse.ts` declares schemas, channel metadata and a ping interval, not a wire parser. Replacing that file with a framing library would cross responsibilities without removing the actual handwritten parser.
- Read: `apps/daemon/src/machine-client.ts`, `MachineClient.stream`, decodes UTF-8 incrementally, searches only for LF/LF frame separators and parses each `data:` line as independent JSON. Fetch, bearer authentication, abort propagation, schema validation and reader cancellation are caller-owned behavior.
- Read: `apps/web/src/api/sse-connection.ts` uses native browser `EventSource`. Its sequence reconciliation and connection timers are business/lifecycle behavior, not a duplicate SSE format parser. Retain this native implementation in a framing-only batch.
- Inferred: the narrow replacement target is the daemon's framing loop, not shared schemas or the browser connection lifecycle. This is not an exhaustive inventory of SSE emitters or provider transports.

## Numbered overlap check

Measured with `node scripts/github-overlap.mjs --repo xiechimon/cairn`, searching open issues, open PRs and PRs merged since 2026-11-02, with terms `SSE`, `eventsource-parser`, `server-sent` and `event stream`.

1. Same request: #3564. Reuse it; create no duplicate task.
2. Open #3575 contains the current diff/YAML segment and this program's coverage ledger. Do not add SSE implementation to it.
3. Exact planned-path checks covered `packages/shared/src/protocol/sse.ts`, `apps/daemon/src/machine-client.ts` and this research path. Only #3467, head `server/stall-needs-input`, overlaps: it changes the daemon client's steer/ack API, not `stream`. Read its patch. Decision: wait for the current segment and recheck #3467 before implementing; preserve its answer-delivery changes.
4. Open title/body matches #3586 (`duet/server-pr2`, Tasks projection) and #3600 (`perf/task-thread-paging`, transcript pagination) use stream/schema terminology but do not replace SSE framing. Read both bodies; no same-intent implementation found.
5. Recent merged matches #2855, #2877, #3339, #2880, #2922, #3462, #2687, #3040, #2764, #3150 and #3545 concern computer routing, presentation, enrollment or delivery. Do not treat these lexical matches as authorization to revert their behavior.
6. Explicit empty results: alternative-term open-issue search returned no matches; exact-file scan found no other open PR touching the shared SSE schema or this research file. No separate SSE-parser replacement appeared in the returned open-PR titles and bodies.

No plan, ticket, build or PR was created. Repeat the overlap check when implementation paths change and before publication.

## Primary-source comparison

| Source | Observed behavior | Trade-off and fit |
|---|---|---|
| [WHATWG SSE parsing](https://html.spec.whatwg.org/multipage/server-sent-events.html#parsing-an-event-stream), sections 9.2.5 and 9.2.6, read 2026-11-09 | Read: LF, CRLF and CR are valid line endings. Consecutive data fields join with LF; a blank line dispatches an event. UTF-8 decoding strips an initial BOM. An incomplete final event is discarded. Connection-level last-event-ID persistence is separate from parsing an individual event. | Inferred: use this as the acceptance contract, not the current single-line emitter shape. Do not dispatch an unfinished record at EOF. |
| [eventsource-parser 3.1.1 README](https://github.com/rexxars/eventsource-parser/blob/346987da04f9b97514be1bbc6be433d081cac2ab/README.md), [parser source](https://github.com/rexxars/eventsource-parser/blob/346987da04f9b97514be1bbc6be433d081cac2ab/src/parse.ts), installed source and package manifest | Read: parser-only `createParser({onEvent})`, incremental string feeding, multiline records, line-ending handling, reset and optional pending-buffer limit. MIT, Node >=18, ESM/CommonJS exports. First-party repository API reports not archived, last push 2026-10-25. | Inferred: best narrow candidate because fetch/auth/cancellation stay in Cairn. Already transitive at 3.1.1, but direct declaration in the actual consuming package still requires owner approval. No dependency change is authorized here. |
| [eventsource-client source](https://github.com/rexxars/eventsource-client/blob/d0447a007f146357f4bba967247defead16421f9/src/client.ts), [README](https://github.com/rexxars/eventsource-client/blob/d0447a007f146357f4bba967247defead16421f9/README.md) | Read: fetch-based client wrapping eventsource-parser; owns connection state, timers, reconnects, last-event-ID and iterators. Reader completion schedules reconnect; fetch failures also schedule reconnect. MIT; README supports Node >=18. Repository API reports not archived, last push 2026-10-26. | Inferred: broader than the framing defect. Introducing it would change existing lifecycle/error ownership and needs a separate design, not a silent parser substitution. Do not adopt it in the proposed narrow batch. |

Read: the parser repository's public security-advisories API returned an empty list on 2026-11-09. This does not establish that no vulnerabilities exist or replace a dependency/security review. Its optional buffer cap bounds pending parser state, not every successfully dispatched payload. A production bound and its failure behavior require an explicit design; no arbitrary numeric limit is selected here.

Read and measured: parser event IDs are per-event values: feeding `id: 7`, then two data events, produces IDs `7` and undefined. The broader client retains connection-level ID state itself. Cairn currently ignores IDs/retry fields; a framing-only replacement must not accidentally introduce replay or reconnect policy.

## Focused in-memory experiment

Measured using `node --input-type=module`, Node's `stripTypeScriptTypes` and the installed parser. The experiment extracts the current `MachineClient.stream` method from source, injects an in-memory fetch/reader and a permissive schema stub, then compares framing with `createParser` plus `TextDecoder`. It does not validate authentication, Zod behavior, a live server or production deployment. No source, cache or test-output files were written by the experiment.

| Input | Current framing | Candidate framing |
|---|---|---|
| LF record | 1 event | 24 of 24 two-chunk splits passed |
| CRLF record | 0 events | 26 of 26 two-chunk splits passed |
| JSON split across two data fields | SyntaxError | 31 of 31 two-chunk splits passed |
| Unicode payload, including splits inside UTF-8 bytes | 1 event with unsplit input | 38 of 38 two-chunk splits passed |
| Incomplete final record followed by reset | Not compared | No event dispatched |

The 119 chunk-boundary assertions are targeted research evidence, not the repository's test suite or implementation acceptance. Bare-CR EOF behavior, bounds, aborts and schema/error compatibility remain unverified.

## Candidate next batch and required acceptance

Inferred recommendation: after the current segment is settled, propose a daemon-only eventsource-parser adapter. Keep native browser EventSource, shared schemas, injected fetch, bearer headers, reader cleanup and outer retry policy. No code or manifest changes are made in this draft.

Before implementation, obtain direct-dependency approval, recheck open file owners and submit the failure/lifecycle design for coordinator review. Enumerate every caller of `MachineApi.stream` and its handling of normal EOF, parser failure, schema failure, abort and permanent HTTP errors. Tests must precede the replacement.

| Boundary | Required behavior/test |
|---|---|
| UTF-8 and framing | LF/CRLF/CR, every chunk boundary, BOM, comments, data-field joining and empty fields |
| Schema compatibility | Valid known event delivered once; unknown type ignored; malformed known event and invalid JSON retain existing failure visibility |
| EOF and cancellation | Discard unfinished event; cancel the reader on all exits; abort does not create another connection or timer |
| Authentication and HTTP | Preserve bearer and injected fetch; do not replay unauthorized requests or hide permanent failures |
| ID and retry fields | Parse format without adding replay, resume headers or reconnect behavior |
| Memory bounds | Design and test incomplete-line and accumulated-data limits plus visible terminal failure; do not claim pending-buffer limits cap all payload sizes |
| Existing consumers | Inventory stream/reconnect callers and test each lifecycle row; preserve #3467 steer/ack changes |

Other #3564 domains remain incomplete. OTel PRs #3566/#3568 and runtime task #3567 were still open when checked; their implementation remains owned elsewhere. No evaluation ruler, outcome exporter or protected measurement path was edited.
