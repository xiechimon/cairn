# Reply dispatch context

Status: implemented for review under [#3843](https://github.com/xiechimon/cairn/issues/3843); live deployment remains unverified. Research: [browser walk and incident trace](../research/harness-message-provenance-2026-11-09.md). Scope: task creation from a quoted Coordinator message, task execution input, and the task conversation's opening history. The owner approved preserving the relevant original image, acknowledgment, dispatch instruction, and execution reply. Existing tasks and messages are not rewritten.

## Decisions

| Decision | Reason | Reversal |
| --- | --- | --- |
| Keep owner request segments verbatim; attach an optional context snapshot to the segment. | Preserve existing citation and split semantics without attributing assistant words to the owner. JSON storage needs no SQL migration. | Remove the optional snapshot consumer; existing request text remains readable. |
| Resolve only references within the cited Coordinator thread. For assistant sources, use the producing chief step's recorded owner message IDs. | The mirror produces `<stepId>-e<entryId>` rows; step ownership supplies a causal association. Time adjacency cannot establish provenance. | Stop adding snapshots to new requests; do not mutate old snapshots. |
| Keep context roles explicit and grant attachments only from authentic owner messages. | Assistant text and synthetic wake rows cannot authorize attachments. | Revert resolver and grant expansion together. |
| Render an attributed opening conversation using existing message, Markdown/image preview, and reply-quote components. | The observed Claude and Amp behavior preserves original message boundaries. | Legacy requests continue through the existing brief renderer. |
| Use one rendering path for model context and one structured snapshot for visible history. | Prompt text must include the same relevant messages the UI shows; internal reply markers are transport metadata. | Revert shared renderer and UI consumer together. |
| Share one user-message bubble across Coordinator, task transcript and source history. Deduplicate context only after complete source rendering. | CI caught duplicated bubble styling; cloud review reproduced image loss after an earlier partial citation. The shared component and regression controls keep these constraints executable. | Revert each complete change, including its consumers and tests. |

## Snapshot and transitions

Add optional `context` to `TaskSegment`: an ordered array of source messages (`threadId`, `messageId`, `role: user | assistant`, `text`) plus an explicit incomplete-source state. Store literal owner content, including its existing reply wire, so its quote can be parsed by the shared parser. No provider images, signed URLs, secrets, or full unrelated history enter the snapshot.

On a cited owner reply, resolve its source ID in the same thread. A user source contributes that owner message. An assistant source contributes its authentic producing step's owner messages, then the response. Establish the cutoff using matching `coordinator_entry` conversation/entry order. Without entry mappings, include only the authentic original user input whose ID equals the producing step ID; mark unmapped steers incomplete. Do not use mutable message timestamps or the step's eventual owner-ID set as proof of earlier consumption. Follow nested reply references with a visited set, deduplicate by source ID, and preserve causal order. Never expand system rows, synthetic transcript prompts, orchestration envelopes, tool calls, another thread, or an unverified assistant attachment token. Missing or cyclic references retain the owner's quote and text and record incomplete context; do not guess neighboring messages.

Creation stores the snapshot atomically with request text and attachment grants. Appending owner sources resolves the same way. Whole-segment copies carry their snapshot. A partial quote carries context only when it retains a complete parseable reply prefix with the same source binding; selecting an independent sentence grants no discarded context image. Worker retries consume the stored request, not mutable Coordinator history. Board replacement of the owner's specification continues to replace its request segments, so old context cannot be resurrected after an explicit edit. Render authentic owner attachment tokens on independent lines supported by the existing resolver; ordinary Markdown blockquote indentation is not a delivery path. Strip attachment-token semantics from assistant context.

## Readers and writers

| Path | Expected behavior and regression |
| --- | --- |
| Shared request schema and JSON projection | Existing requests parse unchanged; optional snapshots round-trip; context authors are never owner request authors. Update the shared schema snapshot deliberately. |
| `coordinator-request.ts`: create, append, source-todo, split | Same-thread causal source resolution, stable ordering, no unrelated sources, owner-only image grants, no mutation on rejected append. |
| `quoteSegments` / `renderTaskText` / `buildTaskPromptText` | Preserve retained segment context; render labeled prior messages and parsed quotes without raw reply markers. Existing third-party fencing remains effective. |
| Runner attachment resolver and backend prompt | Original image token resolves using the inherited grant and reaches image input. Real bytes and actual backend call arguments are required evidence. |
| Task brief in `SideChat` / `TranscriptColumn` | Show inherited messages under `来自 Coordinator 的上下文`; original image belongs to its original user message, quotes remain quote blocks, execution transcript follows. Reuse existing components and tokens. |
| Legacy request or plain specification | Render available quote and body without metadata leakage. Do not claim missing historical content was delivered to the old agent. |
| Reload, restart, missing source, cycle, foreign source | Snapshot survives reload and restart; incomplete source is explicit and cannot expand access. Existing image download/no-vision failures remain explicit in the actual execution transcript. |

## UI brief and acceptance

Surface: existing task conversation, opening brief. References: the private Claude quote/reload and Amp image/reload captures named in the research record; existing shots in `docs/design/references/coordinator-chat/`. Compose existing user message, assistant text, `ReplyQuoteBlock`, and `ChatMarkdown` image preview, using project tokens. Rules: P1/P3/P5, C5/C11, V1/V2/V10, A2. This restores an existing conversation's lost content; no route, setting, mode, or new top-level surface is introduced.

Before UI implementation, create a draft from existing components. States: normal inherited context; legacy/plain brief; missing or cyclic source; missing image; no-vision runtime; long quote; pending question and running execution below the brief; reload; 390px; light/dark. Loading and offline retain the existing task-loading behavior and stored snapshot; they add no new control.

Red first: a minimal three-message incident must fail for missing original image grants/input and raw marker leakage before implementation. Negative controls cover cross-thread and synthetic owner sources, assistant-invented attachment tokens, later steers in the same step, unrelated messages, partial quotes that discard reply binding, cycles, and specification replacement. Verify the opening history on an isolated real server with a stateful fake provider; label the provider boundary as simulated. A real-provider acceptance claim additionally needs its own request/response evidence. Capture before/after desktop, phone, and dark states, and run lint, typecheck, spec parsing, changed Vitest, affected e2e, and prepush. PR review is cloud Codex on the pushed head. Do not mark the fix live until the deployed SHA and a deployed user journey are verified.

Design review: an independent coordinator review approved implementation after adding causal entry cutoffs, conservative original-input fallback, partial-quote grant isolation, and resolver-compatible owner token lines. This is a design review only, not the pushed-head code review.
