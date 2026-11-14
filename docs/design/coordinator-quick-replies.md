# Coordinator quick replies

Status: accepted (owner decision 2026-11-11: the Coordinator may attach a few suggested replies to its latest message; the web shows them as chips under that reply and a click sends one. 2026-11-13: generated after the reply, the common way, instead of only when the model calls a tool. 2026-11-14: 1–3 short automatic predictions according to the number of natural directions, never padded to three).

Density references and UI brief: [T3 Code, Claude Code and Open WebUI](../research/coordinator-suggestion-density-2026-11-14.md). T3 predicts one short next prompt; Cairn borrows concise wording, not its single-suggestion limit, and retains click-to-send chips rather than switching to a Tab-only composer hint.

## Storage

No migration. The Coordinator conversation already lives in `chief_message`, whose `content` column is JSON and already carries typed system rows (`chief_notice`, `chief_turn_error`, `chief_digest`). Suggestions are one more typed system row:

- id `quick-replies-<stepId>`: one row per Coordinator turn; a later write in the same turn replaces the earlier one (`upsertChiefMessage`).
- role `system`, content a JSON string `{"kind":"quick_replies","stepId":"…","replies":["…"]}` validated by `quickRepliesContentSchema` (`packages/shared/src/records/quick-replies.ts`): 1 to 3 replies, each 1 to 80 Unicode code points. This is the storage/tool compatibility ceiling, not the automatic predictor's target. Existing/tool-provided long text remains readable through the composer preview rather than growing a multi-line chip.

Nothing else stores or clears suggestions. Visibility is derived from the conversation each time it is read, so no path has to remember to clear them.

## Writer: a request after the reply

After a Coordinator turn ends with an answer the user will see, the runtime asks the same model once more (`apps/server/src/coordinator/runtime/suggest-replies.ts`).

- Owner decision 2026-11-14: use a small independent task instead of relying on the full turn's prompt cache. Keep the same model, but send only a fixed prediction instruction and JSON containing the latest four nonempty user/completed-assistant text messages, in chronological order. Each message is at most 500 Unicode code points: long messages retain the first 250 and last 249 with an ellipsis between them, so the latest answer's closing next step survives. System instructions, tools, tool results, thinking, images, older messages, volatile context and the main provider session id are not forwarded. No extended reasoning setting is inherited. Tool execution is disabled (`toolChoice: 'none'`). This borrows Open WebUI's bounded-text approach with a smaller per-message allowance; it does not depend on cache reuse.
- It runs on the in-server runtime, which is where a Coordinator turn runs. A daemon-run turn has no second request; its chips come only from the tool below.
- Skipped for every event/wake turn and unsuccessful or empty answers. Cold-cache ordinary replies are eligible because prediction input is independently bounded. Also skipped when the tool already supplied chips, a question is pending, a stop is pending, or a newer user message arrived. Eligibility is checked again before storing the result, so stale results cannot overwrite greeting chips or reappear after new activity.
- The answer is JSON `{"replies":["…"]}` containing 1–3 likely next-user messages, ordered by likelihood. One natural next step calls for one prediction; a second or third must represent a genuinely distinct likely direction, never padding. Each targets 6–12 Chinese characters or 3–8 English words. The automatic reader keeps valid predictions of at most 32 Unicode code points; it rejects longer text rather than truncating an instruction's meaning. Empty output is acceptable. `sanitizeQuickReplies` collapses whitespace, strips markdown markup, and drops empties and case-insensitive duplicates. A conservative keyword filter also drops destructive-action terms; it can suppress benign discussion and is not a semantic authorization boundary. The prediction prompt forbids irreversible approvals, including a bare yes or continue. Actual confirmations still use `ask_user`, whose pending state suppresses prediction and chips.
- Reported request usage is added to the turn even when the result is empty, invalid or unsuccessful. Context-window occupancy remains that of the main answer, not the sum of two requests. Pricing uses the existing provider/model rates; a subscription with zero catalog rates has no reliable dollar cost estimate.
- Budget for the small task as uncached input; any cache reads are an optimization, not a prerequisite. There is no miss-triggered suspension, near-quota suppression or unused-suggestion frequency throttle. Ignoring chips and typing a different message does not clear cache: both send paths append an ordinary user message. Prediction does not mutate the main conversation or its provider session.
- The final answer is mirrored before prediction starts. The resulting row is stored and published over the existing conversation stream before the step is marked done. That message event refetches the transcript and delivers chips without a page reload. Prediction failure or publication failure does not fail the completed answer. Stop polling remains active during prediction, and stops abort the extra request.

### Pre-dispatch limits

Owner decision 2026-11-14: bound recent-text input rather than disabling suggestions whenever full context is too large. These limits control input exposure even on a total cache miss; they are not a hard dollar ceiling.

- Conversation data is at most four messages × 500 code points, independent of the main context size. Both its JSON task transcript and the final provider JSON payload must fit within 16,384 UTF-8 bytes. The second check uses the installed SDK's `onPayload` hook before network transmission, including provider formatting. An oversized serialized request is skipped, not retried with another model. This bounds submitted input size, not an exact token count; tokenization and provider framing vary.
- Request at most 256 output tokens. OpenAI Responses, Completions and Anthropic payloads must contain a positive integer output limit no greater than 256 (`max_output_tokens`, `max_completion_tokens` or `max_tokens`); a missing or enlarged limit blocks transmission. The local reply-character limit is not an output-token budget.
- The installed Codex subscription adapter omits that output limit. Codex prediction is enabled with bounded recent-text input, but 256 is not an enforceable output ceiling on this channel. Codex uses low reasoning effort instead of inheriting the main turn's setting: a live check found that the current model rejects `none`. Other adapters use their no-extra-reasoning default. The prompt requests short JSON; neither this nor the deadline establishes a hard output or dollar ceiling. This limitation is separate from controlling the amount of uncached input.
- Requests use SSE and `maxRetries: 0`: no SDK HTTP retries, WebSocket fallback or continuation retries can multiply the extra request. The eight-second deadline bounds waiting, not input fees already charged. Main-answer retry and transport settings are unchanged.
- No new persisted state, counters, endpoints or UI placeholders. A blocked request returns no suggestions and adds no prediction usage. A dispatched request that fails or returns invalid text still contributes its reported usage. These are per-request limits, not a daily/team spend budget or a promise of cache hits. Subscription catalog zeros still do not establish dollar prices.

## Writer: the `suggest_replies` tool

Kept, for a turn that already knows the replies, and for a daemon-run turn.

- Defined in `CHIEF_REPLY_TOOLS` (`packages/shared/src/protocol/chief-tools.ts`), outside the pinned 47-tool vocabulary. Registered for the in-server runtime and the daemon-run Coordinator.
- Executed in `executeChiefTool` through `services/chief-quick-replies.ts`, which writes the same row. The relay path already refuses calls without a claimed chief step.
- A new project channel's greeting turn still calls it before the greeting, with 2 or 3 things that project is most likely to do right now. The server preserves those chips and avoids a redundant prediction request, retaining #4343.
- Refused in event turns (`[wake:…]`). The working rules tell the model it need not call the tool; the server asks after the reply.

## Wire

Unchanged endpoints. The row reaches the web in `GET /api/conversations/:id/messages` and on the conversation SSE stream (`convHub.publishMessage`), like a notice. Old clients ignore an unknown system row. Old servers never write one, so new clients show no chips.

## Reader: `liveQuickReplies(rows, {running, runningStepId})`

Shared pure function, used by the web `mapChief` to set `ChiefContent.quickReplies`. It returns the replies of the newest valid row only when:

| # | Row | Expected | Test |
|---|---|---|---|
| 1 | Latest message is the Coordinator's reply from the same turn, turn finished or still running | chips shown | shared `quick-replies.test.ts` "shows…", "same turn is still running"; e2e "shows chips", "chips stay while the turn that offered them is still running" |
| 2 | Owner sends anything after it (chip or typed; a user row exists after it) | hidden | shared "owner send"; e2e "click sends" |
| 3 | A newer turn starts | hidden | shared "hidden once a newer turn runs"; server "new event turn"; e2e "chips hide while a newer Coordinator turn is running" |
| 4 | A question is pending | hidden; dock wins | shared "pending question"; e2e "hidden with question" |
| 5 | Any non-assistant row after it (notice, thread report, turn error, stop marker) | hidden | shared "later system row" |
| 6 | Turn produced no reply text | hidden | shared "no anchor" |
| 7 | Row absent or fails the schema | no chips | shared "absent/invalid"; server "old messages" |
| 8 | Rewind past the turn | row deleted with the turn's rows | existing rewind delete covers `chief_message` |

A project channel whose greeting turn fails, or that has no model configured, still shows the three fixed chips (`做个计划`, `接一个仓库`, `接着最近的活`). Those are client-side and do not depend on the tool.

## Click

`QuickReplies` (`apps/web/src/chief/quick-replies.tsx`) renders the chips under the latest Coordinator reply. Every chip is one 28px line within the conversation width, including on 390px phones. A nested text span ellipsizes long legacy/tool text inside the rounded outline. Hover or keyboard focus previews the complete original text in the empty composer; a click calls `onSend(text)` with that full text, the same path as typing. Question chips and other consumers of the shared chip style are unchanged. While the send is in flight the chips are disabled; on failure they stay; on success the new owner row hides them.

## Failure behaviour

- Post-turn request fails or returns nothing: no row, no chips, the turn still succeeds.
- Tool rejected (caps, event turn): tool error to the model, no row.
- Row written but the turn then fails or is stopped: the error or stop row follows it, row 5 hides the chips.
- Send fails: toast, chips stay enabled again, draft in the composer untouched.
