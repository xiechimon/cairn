# Several quotes, each with its own reply — plan, 2026-11-27

## User scenario

Someone who installed Cairn today reads a long Coordinator reply and wants to answer two different sentences in it. They select the first sentence, press `引用` (or R), type a short answer to that sentence in the small quote box and press Enter; they select a second sentence and do the same. Each quote now sits above the composer input as its own item, showing the quoted words and the answer typed for it, with an × to drop it. The composer input stays empty and free: they can type an overall message there, or nothing. One press of Send sends one message; their bubble shows each quote followed by its answer, then the overall text. Nothing new is asked of them: no account, key or setting. The staged quotes live only in the page; a reload drops them while the typed main draft survives through the server draft, as today.

Owner's words (2026-11-27, production Coordinator chat, translated from Chinese): "When I quote… I can use many quotes, and then this blocks the frame where I normally type. Your logic is wrong: every reply should have its own, that is every piece of text has its own reply… instead of taking over my main input. And the style should be redesigned; the shadow should wrap all the way around, being bare like this doesn't feel good. Use your judgement."

Why: today one quote at a time is staged as a grey "Reply: …" banner inside the composer, a second quote replaces the first, and the answer typed in the quote box is pasted into the main input, so the main input becomes the reply to that one quote. The composer's drop shadow falls only below the card, so its top edge reads bare.

| Situation | What the user sees | What the system does | Wait and cost |
|---|---|---|---|
| Quote A with answer, quote B with answer, main text, Send | One bubble: A, its answer; B, its answer; main text | Sends one message whose content carries both quotes and the main text | One Coordinator turn, as any message |
| One quote, no answer typed, main text | Quote item shows the quote only; bubble shows quote then main text | Same message shape as today's single quote | none |
| Quotes staged, main input empty, Send | Message sent with the quotes and their answers | Send is enabled while any quote is staged | none |
| × on one item | That item disappears, others stay | Its source mark clears | none |
| Escape in the empty composer | All staged quotes clear | as today's cancel-reply | none |
| Withdraw a queued quoted message | Its quotes come back as items, its main text back into the input | Parses the stored content | none |

## Scope

1. Wire (`packages/shared/src/reply-quote.ts`). Messages that hold one quote and one text keep today's bytes: `<!-- reply source=ID -->`, the `>` lines, a blank line, then the text. Older readers, stored messages and rollbacks all agree on those bytes; reply and main text are only trimmed, so internal CRLF survives as before. Any other shape (two or more quotes, or one quote that has its own reply and a main text too) writes counted blocks. Each block is `<!-- reply source=ID lines=N -->`, then the `>` lines, then, when N > 0, a blank line and exactly N reply lines. Blocks follow one another directly, and the main text comes after a blank line. The parser takes exactly N lines as the reply. It starts a new block only when the next line is a counted marker, and it reads everything after the blocks as plain text. So no reply or main text, whatever it contains, is ever read as markup. Content whose first marker has no `lines=` is parsed exactly as today, as one quote whose reply is all the rest. An old message whose text contains marker lines therefore keeps its meaning. Version and rollback: the desktop app ships server and web together, so every reader runs the same version. An older build reading a counted message does not match the marker, so it shows the raw text instead of losing words. `parseReplyQuote` and `encodeReplyQuote` are replaced by `parseReplyQuotes` / `encodeReplyQuotes`, and every caller moves to them.
2. Readers of message content and what each takes:
   - `replyQuoteText`: thread titles, memory corrections, queued capsules, steer provenance. Takes each reply, then the main text.
   - `renderReplyText`: task brief. Renders each quote as a blockquote with its reply under it, then the main text.
   - `resolveTaskReplyContext`: dispatch context and image grants. Follows every quote's source and gathers each source's owner message and assistant message.
   - `quoteSegments`: partial task from a selection. Inherits context and image grants only when the partial keeps the complete list of sources, all known.
   - `chief-message-rows.tsx`, `detail/spec-block.tsx`, `board/thread-lead.tsx`: render through `QuotedReplies`.
   - `draftFromSent`: withdraw and failed-send restore.
3. Composer state is a list of staged items `{id, sourceMessageId, quote, range?, reply}`. Writers:
   - Quote-box Enter appends a new item. Quoting the same passage twice gives two items; each × removes its own.
   - × removes one item by id.
   - Escape in the composer clears every item, only when the main text and its attachments are empty (as today's cancel-reply).
   - A send removes exactly the item objects it encoded, so a passage quoted again after a send survives that send's late success.
   - Withdraw, a failed send returned from the outbox, and the queue capsule's remove all append the items parsed from the content, with new ids. A restore from the outbox records which items it added under that outbox key, and a late arrival of that same entry removes exactly those items, not others with equal text.
   - The non-held queue remove and the steer withdraw restore the items and append the main text below any draft. Before this change the queue remove dropped the text when a draft existed, which lost words; this is the one change to existing behaviour outside the quote flow.
   - Send now refused before enqueue (two machines online, none named) stages that quote with its answer as an item instead of losing it.
   - Readers: the item list, the send encoder (read at call time through a ref, so a send fired after an upload finishes uses the items present then), and the marks.
   - Thread switch, reload and other tabs start with no items: staged items live only in this page, as the quote box does today.
4. Nothing is written into the main input by the quote box; the "Reply to this message" placeholder swap is removed. Send is enabled with an empty main input while any item is staged (`sendEmpty` on the composer wire). A single-quote message restores as one item whose reply is its text, so a failed or withdrawn single quote never lands in the main input either. Items render inside the composer card above the input: a left-ruled quote line (one line, truncated, `min-w-0`) with its reply under it (two lines, `break-words`), and an × (28px). The list is capped at `max-h-40` and scrolls, so the input is never pushed out, including above the 390px soft keyboard.
5. Sent bubble, task brief and thread lead render every quote with its reply through `QuotedReplies` / `ReplyQuoteBlock`.
6. Marks: each staged item marks its own span (`useQuoteMarks`, CSS Highlight API); removing the item drops its range; hovering or focusing an item marks its source message, and leaving clears it.
7. Shadow: `--composer-drop` (light and dark) gains a centred blur layer so the shadow wraps all four sides. It is the one composer elevation token, so every surface on it changes together (same thing looks the same everywhere): Coordinator composer, the quote box (`selection-reply.tsx`), the detail read-only composer (`detail/composer.tsx`), the question card and the archived-project bar. Acceptance screenshots cover each of them; the visual-baseline goldens that move are regenerated from CI and listed in the `Visual-Surfaces:` trailer.
8. Unchanged: the quote box, Send now (sends only that quote with its answer, now encoded through the same function), the Quote pill, attachments, touch behaviour, the pending-question card (a quote sent while a question waits goes as an ordinary message, as today).

## Edge cases

| Edge case | What the user sees | Proving test | Slice/Status |
|---|---|---|---|
| Two quotes each with a reply plus main text | One bubble with both quote/reply pairs, then the main text; owner's words in titles and capsules carry no markup | `packages/shared/test/reply-quote-wire.test.ts` › "the owner words of a two-quote message are each reply then the main text, with no markup"; `apps/web/e2e/chief-selection-quote.spec.ts` › "two quotes, each with its own reply, and the main text go out as one message" | this change |
| Two quotes, main input empty | Sends both quotes and replies, no main text | `apps/web/e2e/chief-selection-quote.spec.ts` › "two staged quotes go out with an empty main input" | this change |
| Reply, main text or an older single-quote message holding marker and `>` lines | Shown as typed text, never as an extra quote | `packages/shared/test/reply-quote-wire.test.ts` › "marker-looking lines inside replies, main text or an older message never become another quote" | this change |
| One quote and one text, from the quote box or the main input | Same bytes as today | `apps/web/e2e/chief-selection-quote.spec.ts` › "selecting a reply shows the pill; R opens the quote box and Enter stages the quote with its own reply, leaving the main input free" | this change |
| One quote with its own reply plus main text | Both shown, reply first | `packages/shared/test/reply-quote-wire.test.ts` › "one quote with its own reply and a main text shows both, reply first" | this change |
| Task brief from a two-quote message | Each quote then its reply, then the main text | `packages/shared/test/reply-quote-wire.test.ts` › "a task brief from a two-quote message shows each quote with its reply, then the main text" | this change |
| Task from a two-quote message | Dispatch context holds both sources' owner and assistant messages and the image grant | `apps/server/test/coordinator-reply-context.test.ts` › "a message quoting two replies inherits the context of both" | this change |
| A source message missing or quoted twice | Missing source contributes nothing and marks the context incomplete; a duplicate is gathered once | `apps/server/test/coordinator-reply-context.test.ts` › "a missing source adds nothing and a source quoted twice is gathered once" | this change |
| Partial selection keeps one of two sources | No inherited context and no image grant | `packages/shared/test/task-request.test.ts` › "inherits a quoted message context only while the quote keeps every one of its sources" | this change |
| Quote-box Enter | Main input keeps what the user typed; the item shows the reply | `apps/web/e2e/chief-selection-quote.spec.ts` › "selecting a reply shows the pill; R opens the quote box and Enter stages the quote with its own reply, leaving the main input free" | this change |
| Same passage quoted twice, or the same words at two places | Two items; × removes only the pressed one | `apps/web/e2e/chief-selection-quote.spec.ts` › "the same passage quoted twice gives two items, and × removes only the pressed one" | this change |
| Remove one of two items | Other item stays; sent content holds only it | `apps/web/e2e/chief-selection-quote.spec.ts` › "removing one of two staged quotes sends only the other; quotes alone can be sent with an empty input" | this change |
| A message of quotes alone, no reply and no main text, waiting in the queue | The queue row reads the quoted words, never markup or a blank row | `apps/web/e2e/chief-home-busy.spec.ts` › "a queued message of quotes alone is listed by its quoted words" | this change |
| Send now while other items are staged | Only that quote goes; staged items stay | `apps/web/e2e/chief-selection-quote.spec.ts` › "Send now from the quote box sends only that quote and leaves the staged ones" | this change |
| Send now refused before enqueue | The quote and its answer stay as an item; the existing choose-a-machine toast shows | `apps/web/e2e/chief-selection-quote.spec.ts` (not written) | later: accepted, needs two online machines with none named; the catch path is one line |
| Withdraw a held single-quote message | The quote comes back as an item with its text as the reply; main input untouched | `apps/web/e2e/chief-reply-quote.spec.ts` › "withdrawing a held quoted message restores the quote, and resending carries it" | this change |
| Withdraw a held multi-quote message while a draft exists | Items appended; main text appended below the draft | `apps/web/e2e/chief-reply-quote.spec.ts` › "at 1440px a withdrawn message with ten quotes restores them as items that scroll inside the card" | this change |
| Remove a queued message while a draft exists | Its text is appended below the draft instead of dropped | `apps/web/e2e/chief-home-busy.spec.ts` › "queued messages sit above the composer and can be removed" | this change |
| Withdraw an unread quoted steer while a draft exists | The draft stays; the quote comes back as an item with the steer text as its reply | `apps/web/e2e/chief-home-busy.spec.ts` › "withdrawing an unread quoted steer while a draft exists keeps the draft and brings the quote back as an item" | this change |
| Ten quotes staged at 1440 and 390 | List scrolls inside the card; input stays visible; long text wraps without horizontal scroll | `apps/web/e2e/chief-reply-quote.spec.ts` › "at 390px a withdrawn message with ten quotes restores them as items that scroll inside the card" | this change |
| Send fails and the outbox returns it | Items come back with their replies, main text back in the input | `apps/web/e2e/chief-selection-quote.spec.ts` › "a send that fails brings every quote back with its reply" | this change |
| A returned send that then arrives late | Exactly the items that send restored are removed; items quoted since stay | `apps/web/e2e/chief-selection-quote.spec.ts` (not written) | later: accepted, removal is by the object list recorded under that outbox key, the same late-arrival path the main text uses |
| Quote again after sending, before the send settles | The new item survives the earlier send | `apps/web/e2e/chief-selection-quote.spec.ts` (not written) | later: accepted, `onSend` resolves on the synchronous enqueue, so no user input fits between send and the removal |
| Thread switch, reload, other tab | No items carried over (page-local, as the quote box) | `apps/web/e2e/chief-reply-quote.spec.ts` (not written) | later: accepted, persisting staged items is out of scope |
| Quoted message row virtualised away and back | Mark not repainted on the new nodes; item and send unaffected | `apps/web/e2e/chief-selection-quote.spec.ts` (not written) | later: accepted, marks are a reading aid |
| Composer shadow | Top edge carries the same soft shadow as the sides, on every `--composer-drop` surface | `apps/web/test/composer-drop-wrap.test.ts` › "C-composer: the composer shadow wraps all four sides in light" | this change |

States: `items: []` → `[a]` → `[a, b]` (quote-box Enter); `[a, b]` → `[b]` (×); → `[]` (Escape on an empty input, or a send of all); → `[…, restored]` (withdraw / outbox return / capsule remove); restored → removed (that outbox entry's late arrival). Transitions on send: enqueue success removes the sent objects; a refusal before enqueue (machine not named) leaves them; an outbox failure later returns them through restore.

## Red on the parent

Measured 2026-11-27: every proving test above was run with this change's test files on the parent source `9fb5ad089` (the queue row on `0e1e81c03`, the rebased parent; Mac mini, `--retries=0`), and every one failed; with this change all pass. Each proving file imports only API the parent also exports (`replyQuoteText`, `renderReplyText`, `quoteSegments`, `renderTaskText`, the server dispatch path, the shadow token, the e2e page), so each red is an assertion failing on the parent's behaviour, not a missing import. `packages/shared/test/reply-quote.test.ts` covers the new encoder and parser API and the CRLF byte guard; it proves no row.

| Proving test | Parent `9fb5ad089` | This change |
|---|---|---|
| reply-quote-wire › owner words of a two-quote message | × `replyQuoteText` returned the raw marker text | ✓ |
| reply-quote-wire › task brief from a two-quote message | × `renderReplyText` returned the raw marker text | ✓ |
| reply-quote-wire › marker-looking lines … never become another quote | × `replyQuoteText` returned the raw marker text | ✓ |
| reply-quote-wire › one quote with its own reply and a main text shows both | × `replyQuoteText` returned the raw marker text | ✓ |
| task-request › inherits a quoted message context only while the quote keeps every one of its sources | × context and image inherited from a counted message were not read | ✓ |
| coordinator-reply-context › a message quoting two replies inherits the context of both | × | ✓ |
| coordinator-reply-context › a missing source adds nothing and a source quoted twice is gathered once | × | ✓ |
| composer-drop-wrap › light / dark | × no centred layer | ✓ |
| chief-selection-quote › R opens the quote box and Enter stages the quote with its own reply | × | ✓ |
| chief-selection-quote › two quotes … go out as one message | × | ✓ |
| chief-selection-quote › two staged quotes go out with an empty main input | × | ✓ |
| chief-selection-quote › removing one of two staged quotes | × | ✓ |
| chief-selection-quote › the same passage quoted twice | × | ✓ |
| chief-selection-quote › Send now … leaves the staged ones | × | ✓ |
| chief-selection-quote › a send that fails brings every quote back | × | ✓ |
| chief-home-busy › a queued message of quotes alone is listed by its quoted words | × the row showed the raw marker text | ✓ |
| chief-reply-quote › withdrawing a held quoted message restores the quote | × reply text landed in the main input | ✓ |
| chief-reply-quote › at 1440px / at 390px … ten quotes | × | ✓ |
| chief-home-busy › queued messages sit above the composer and can be removed | × text dropped when a draft existed | ✓ |
| chief-home-busy › withdrawing an unread quoted steer while a draft exists | × | ✓ |

## Out of scope

- Editing an item's reply after staging (drop it and quote again).
- Persisting staged items across reload, threads or tabs.
- Changing the quote box, its copy, or Send now.
- Per-reply attachments: attachments belong to the message, as today.
- Where sources come from: a quote's source id is read from the owner's own message text, as it is for today's single quote; the server only accepts sources in the same thread and marks anything else incomplete. Moving source identity out of the text is a separate wire change for every quote, not this feature.
- A depth or count limit on following nested sources: the `visiting`/`visited` sets already make the walk finite and each source is read once; today's single quote has the same walk.

## Review

- Verdict: PASS
- Plan-SHA256: a14fd456ec35d28c4bc1afe1063816bfd27b2eeff9777a9858d8e07e90b786db
- Author-Model: claude-opus-5-5
- Reviewer: pi --no-session, fresh context; full review then confirm-only re-checks of its findings
- Reviewer-Model: openai-codex/gpt-6.2-sol
- Findings: 0 blocking; findings 1-6 of the full review fixed or scoped out with reasons, confirmed
