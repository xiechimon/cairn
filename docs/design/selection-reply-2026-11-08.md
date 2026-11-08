# Selection reply: design (2026-11-08)

Research: `docs/research/selection-reply-2026-11-08.md`. Rule ids checked: P3, C3, C4, V3, V7, V8, V21, A1, A2, R1, T1.

## Scope

Select text in one Coordinator message (assistant or user), press Reply, and the selection is staged as a quote above the Coordinator composer. The sent message carries the quote and the id of the message it came from. "Start a side chat" is not built here; the options are at the end.

## Frontend

### Components

| Piece | File | Built from |
|---|---|---|
| Selection bar | `apps/web/src/chief/selection-reply.tsx` | `Button` (ghost), popover tokens, a portal on `document.body` |
| Geometry and limits | `apps/web/src/chief/selection-reply-model.ts` | pure functions, unit-tested |
| Quote block (composer and bubble) | `apps/web/src/chief/reply-quote-block.tsx` | `IconTooltip`, `Button`, `X` icon |
| Wire format | `packages/shared/src/reply-quote.ts` | shared by web and any server reader |

Messages opt in with `data-reply-source="<message id>"` on the assistant `BubbleContent` (not while it is still typing) and on the user bubble, in `chief-message-rows.tsx`.

### Bar

- Surface: the measured claude.ai pill. `--selection-bar-bg` (black at 80%), `backdrop-blur-sm` (8px), 1px border `--selection-bar-ring` (white at 10%), radius 8px, `--shadow-selection-bar` (the measured two layers per theme). V3 allows blur on this surface only.
- One button `回复` with the reply arrow after it: 32px high, padding 6px 12px, `text-ui` (14px/20px), gap 4px, white. Hover fills the whole button with white at 10%, with `transition-none` (claude.ai fades over 150ms; cairn's hover rule forbids delayed feedback).
- Position: centred on the selection rectangle, 8px above it (measured); clamped 12px inside the conversation viewport; below the line when there is less than 12px above. Fixed, moved with `transform` only (A2).
- Appears 250ms after the selection settles, or on mouse release after a drag. Needs at least 2 characters after trimming, and a selection that starts and ends in the same message.
- Hidden when: the selection collapses (click elsewhere, typing in the composer); the selection moved more than 100px on scroll; Escape, which also clears the selection, as measured on claude.ai; the last pointer-down was touch or pen (the native selection menu wins, as in Claude Code); the composer is replaced or the drawer is closed.
- Mouse down on the button does not clear the selection.
- Keyboard: Enter replies while the bar is up and focus is outside any editable field; the button carries `aria-keyshortcuts="Enter"`; the bar is a `toolbar` named `选中文字的操作`.

### Staged quote and sent bubble

- Reply puts the quote above the composer input (inside the composer card, above queued capsules) and focuses the input. A second Reply replaces the quote: one quote per message, one path.
- The quote block is a left rule (`border-l-2 border-border`), `text-meta`, `text-content-secondary`, clamped to 3 lines. The remove control is an icon button with tooltip `移除引用` (C4).
- On send the composer text is wrapped (see Backend). The quote clears only after the send succeeds; a failed send keeps it for the retry.
- The user bubble renders the same quote block above the reply text; the marker is never shown.
- Withdrawing a queued quoted message puts the quote back above the composer and the reply text back into the input. Queued capsules show the reply text only.

### States

Screenshots from `apps/web/e2e/chief-selection-reply.spec.ts` with `CAIRN_E2E_EVIDENCE` set (mocked live API, fixture data):

| State | Light | Dark |
|---|---|---|
| Bar visible, 1440 | `bar-light-1440.png` | `bar-dark-1440.png`, `bar-visible.png` |
| Replying with quote, 1440 | `quote-light-1440.png` | `quote-dark-1440.png`, `replying-with-quote.png` |
| Sent with quote | | `sent-with-quote.png` |
| Phone width 390 (mouse) | `bar-light-390.png`, `quote-light-390.png` | `bar-dark-390.png`, `quote-dark-390.png` |
| Phone width 390 (touch) | no bar; native selection menu | same |

Claude reference captures were taken on the owner's Mac Chrome (research doc, Measured). Still different from claude.ai: the staged quote is a block above the input, where claude.ai shows a 120x120 attachment tile; the sent message carries the quote in its text with a source id, where claude.ai sends it as a separate attachment without one.

## Backend

No API, schema or migration change. The quote rides in the message `content`, which every send path already accepts (`POST /api/teams/:id/chief/threads`, `POST /api/conversations/:id/messages`, the coordinator page send):

```
<!-- reply source=<message id> -->
> quoted line
>
> next quoted line

the user's reply
```

- The Coordinator sees the quote as a Markdown blockquote and the source id in the marker; it can read the source with its history tools. Agents receive the same text if the Coordinator forwards it.
- Queue, withdraw, steer, rewind and server drafts store and replay `content` unchanged, so the quote survives them.
- The format is Claude Code's `<!-- reply -->` marker plus `source=`. `parseReplyQuote` also reads Claude Code's marker without a source.

### Failure modes and how each is handled

| Failure | Handling | Test |
|---|---|---|
| Selection spans two messages | No bar | e2e "stays away" |
| Selection under 2 characters | No bar | e2e "stays away"; unit `replyableText` |
| Selection on touch | No bar | e2e "touch" |
| Quote longer than 1,500 characters | Cut with `…`, never inside a surrogate pair | unit `encodeReplyQuote` |
| A message id that could close the HTML comment | Dropped; the marker is written without a source | unit |
| CRLF or blank lines in the quote | Normalised; blank lines stay inside the block as `>` | unit |
| User removes the quote before sending | Plain message sent | e2e "removed quote" |
| Send fails | Quote stays staged | code path in `sendFromComposer` |
| Bar near the top or the side edges | Flips below, clamps inside | unit `barPosition`; e2e 390px |
| Page scrolls while the bar is up | Follows the line; hides after 100px | unit `scrolledAway` |
| Escape | Hides the bar, keeps the selection | e2e "keyboard" |
| Draft reload | The staged quote is local state and is lost; the typed text survives through the server draft | not covered; accepted |
| A user types the marker by hand | It renders as a quote; harmless | not covered; accepted |

## Start a side chat: open decision

cairn's side chat (`apps/web/src/board/side-chat.tsx`) is a task thread: another agent with its own context. Claude's side chat is a branch of the same agent that reads the main conversation and writes nothing back (research doc). Options:

1. Coordinator branch thread in the side panel: a new Coordinator conversation created with `parentThreadId` and `sourceMessageId`, its turns assembled with the parent's recent messages, shown in `SidePanel`. Faithful; needs a thread schema change, prompt assembly in `apps/server/src/services/coordinator-context.ts`, and hiding branches from the thread list.
2. Open the task thread a message is about, with the quote staged in its composer. Small; but the agent there has not seen the Coordinator conversation, so it is not what Claude's button means.
3. Leave it out, as claude.ai's own chat does.

Recommendation: 1, as its own change after ian's visual OK on Reply.
