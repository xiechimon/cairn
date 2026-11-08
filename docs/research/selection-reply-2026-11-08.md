# Select text, then Reply or Start a side chat (2026-11-08)

Question: how does Claude behave after a user selects text inside a message, and what should cairn copy? Labels: 实测 (read or run first-hand), 推断 (derived from 实测), 猜测 (the rest).

## How this was studied

| Source | Status |
|---|---|
| claude.ai in the built-in browser, 2026-11-08 | Signed out: `/new` redirects to `/login`. Not operated. 实测 |
| `scripts/design-capture` profile (`<scratch-cache>/cairn-design-capture/profile`) | Headless launch stops at a Cloudflare "Verify you are human" page; a headed launch timed out. Not operated, and the check was not touched. 实测 |
| Existing captures in `<scratch-cache>/cairn-design-capture/final/` and `docs/research/` | No capture contains a text selection. 实测 |
| claude.ai's shipped client bundle, fetched from the public asset host the login page loads (`assets-proxy.anthropic.com/claude-ai/v2/assets/v1/`, 2315 chunks crawled from the login page's module graph on 2026-11-08) | Read. This is the primary source for every behaviour below. Chunk names are content hashes and change on every deploy. 实测 |
| claude.ai stylesheet `c6a992d55-CIgJ-QZZ.css` from the same host | Read for token values. 实测 |
| GitHub issues anthropics/claude-code #55772, #70628, #48099, #58691, #59228, #70556 | Read as user reports, never as evidence of behaviour. |
| Claude desktop app, Code tab | Not reachable from this machine (Linux). Its session view ships in the same bundle (the `epitaxy` code) and was read there. 实测 |
| t3code, Cursor, Amp (SOURCES.md, chat UX row) | Not checked in this pass: the brief asked for Claude's behaviour one-to-one. Skipped by scope, not blocked. |

Because nothing was operated, no frame was screen-recorded and no computed style was read from a live element. Sizes below come from the shipped class names resolved against the shipped stylesheet. Which density a given window uses is 猜测.

## What Claude ships: two different bars

| | claude.ai chat (`SelectionTooltip`, chunk `c79f7d2ef`) | Claude Code session view (`epitaxy`, chunk `cf74bc599`, components `zk` and `Vk`) |
|---|---|---|
| Actions | `Reply` with a reply-arrow icon after the label. A product may register one leading action through a store (`accepts({range,text})`); none was found registered in the crawled chunks. 实测 | `Start a side chat` (`Send to side chat` once one exists for the session), then `Reply`. Either can be absent: side chat needs the session idle and side chat supported; Reply needs a composer and a selection inside one transcript entry. 实测 |
| Surface | `bg-always-black/80`, `rounded-lg` (8px), `border` white at 10%, `backdrop-blur` (8px), `shadow-lg`, `text-gray-0`, `select-none`. 实测 | Popover surface `rounded-card bg-surface-3 shadow-panel` with `!rounded`, so the radius is `--cds-radius`: 6px at default density, 8px at comfortable. `--cds-surface-3` is gray-0 (white) in light and gray-800 in dark; `shadow-panel` is a 1px inner ring in `--cds-border` plus `--cds-shadow-popover` (`0 8px 24px #0000001f, 0 2px 6px #00000014` light; `0 8px 24px #00000052, 0 2px 6px #0003` dark). 实测 |
| Buttons | `px-3 py-1.5 text-sm font-medium`: 12px by 6px padding, 14px text, weight 500; hover `bg-always-white/10` with `transition-colors`; `rounded-lg`. 实测 | Ghost `Button`s at control height: 24px default, 32px comfortable; label `text-body` 13px/19px default, 14px/20px comfortable; padding `--cds-pad-md` 8px default, 12px comfortable. 实测 (tokens); which density applies is 猜测 |
| Divider | 1px `bg-always-white/10`, full height. 实测 | 1px `bg-alpha-2` (neutral at 10%), 7px top and bottom margin; it fades out while the bar is hovered or focused. 实测 |
| Position | Centred on the whole selection rectangle; bottom edge 8px above the selection top. No flip. 实测 | Centred on the first line of the selection, clamped to stay 12px inside the transcript's left and right edges; 8px above that line, or 8px below it when it would come within 12px of the transcript's top. `position: fixed`, moved with `transform`, z-layer 55. 实测 |
| Shown when | Selection is at least 2 characters after trimming; 250ms after the last `selectionchange`, or at once on mouse release after a drag. 实测 | Same selection hook (`lX`), same rules. 实测 |
| Hidden when | Selection collapses or drops below 2 characters; the selection's top moves more than 100px on scroll (150ms fade, then dismissed). 实测 | Selection collapses; the first line moves more than 100px on scroll; the last pointer-down was touch or pen; an inline reply is open. 实测 |
| Mouse down on a button | `preventDefault`, so the selection survives the click. 实测 | Same. 实测 |
| Keyboard | No shortcut on the bar; Escape or Tab closes the right-click menu variant. 实测 | Enter triggers Reply while the bar is up and focus is not in an editable field or a menu (`aria-keyshortcuts="Enter"`). 实测 |
| Touch | Nothing touch-specific; 推断: it shows on touch selections too. | Suppressed on touch and pen: the native selection menu shows instead. 实测 (`Lk`) |

## What Reply does

claude.ai chat: Reply adds the selected passage (CRLF normalised, trimmed, at most 10,000 characters) to the composer as an attachment that records the source message's uuid. A variant opens a small reply form first and adds the attachment with the reply text. The normal upload limit applies. 实测 (`VK(passage, {reply, messageUuid})`, `validateMaxUploadLimit`).

Claude Code session view, two variants:

- Composer variant: the selection goes to the composer through `onReply(text)`. 实测
- Inline variant: a form opens above the selection with the quote shown, placeholder `Reply to Claude`, Enter to submit. Sending writes this wire text, and nothing else carries the source: 实测

```
<!-- reply -->
> first line of the selection
> second line

your reply
```

Several replies in one message become `<!-- reply N -->` followed by up to 99 quote blocks. The transcript parses the marker back into quote blocks above the text. The quote is cut at 1,500 characters with an ellipsis, without splitting a surrogate pair. 实测 (`Me`, `Ie`, `na=1500`, `ra`).

Which messages: in claude.ai chat the overlay wraps each message row with no sender check at the call site, so user messages are selectable too (推断). In the Code view, Reply needs the selection to start and end in one transcript entry (`data-entry-key`); a selection across entries gets only the side chat action (实测).

## What Start a side chat does

It belongs to Claude Code's `/btw` feature, not to claude.ai chat. 实测 (strings `btw` and "`/btw` or [[cmd+;]] opens a side chat with Claude without interrupting your main session").

- It starts a child session (`startBtwChild`, `spawnedFrom`) and opens it in the side pane next to the main session; a floating-window variant also exists. 实测
- The selection, cut to 1,500 characters, is staged as context in the side chat; the user still types the question. 实测 (`openWithContext`, `stagedContextBySession`)
- Its description: "Ask on the side without touching the main chat. Claude sees the full context, and nothing here is added to it." The header shows "Sees N messages from main chat". 实测
- It is unavailable until the main session has started, and while it is thinking or starting. 实测

## Comparison

| Source | How it does it | Trade-offs | Link |
|---|---|---|---|
| claude.ai chat | One action, Reply. The quote becomes a composer attachment that remembers the source message | One path; dark pill with blur | `assets-proxy.anthropic.com/claude-ai/v2/assets/v1/c79f7d2ef-DjYiyF2u.js` |
| Claude Code session view | Side chat plus Reply; Reply writes `<!-- reply -->` and a `>` quote into the message text | Plain-text wire format any model reads; side chat needs a child session that sees the parent | `.../cf74bc599-BOFYeHJW.js`, `.../c4d199b75-YvvP0oF1.js`, `.../c390f938b-BqbAR9Hk.js`, `.../shared-39-Bv2uTh_d.js`, `.../c03935b01-S4UmerBN.js` |
| Issue #55772 | Describes claude.ai Reply as inserting a `> ` quoted block into the prompt | Second-hand; the shipped code now uses an attachment | https://github.com/anthropics/claude-code/issues/55772 |
| Issue #48099 | Asks for a read-only side chat from a selection in the CLI | Request only | https://github.com/anthropics/claude-code/issues/48099 |
| Issue #70556 | Dismissing a selection overlay also lost the selection | The failure to avoid: dismissing must keep the selection | https://github.com/anthropics/claude-code/issues/70556 |

## The pattern that fits cairn, and why

1. Reply as Claude Code writes it: the quote travels inside the message text as a marked `>` block. The Coordinator and every agent harness already take plain text, so the quote and the source message id reach the model with no schema, migration or prompt-assembly change, and the queue, withdraw, rewind and draft paths carry it unchanged. cairn adds the source message id to the marker (`<!-- reply source=<id> -->`), which Claude Code leaves out and claude.ai keeps on its attachment.
2. The bar uses the Code view's surface, not the claude.ai pill: cairn rule V3 forbids blur panels, and cairn's popover tokens match the Code bar's surface and ring.
3. Start a side chat does not map onto cairn's side chat. cairn's side chat (`apps/web/src/board/side-chat.tsx`) is a task thread: another agent with its own context, created by the Coordinator. Claude's side chat is a branch of the same agent that sees the main conversation and writes nothing back. Opening a task thread from a selection would start real work under a different agent; a Coordinator branch in the side panel would be a second side-chat system. Neither fits without an owner decision, so this change ships Reply and the design doc records the side-chat options.

## Recommendation

Ship Reply on the Coordinator conversation: the bar, the staged quote above the composer, the marked wire text and the quote block in the sent bubble. Code areas: `packages/shared/src/records/reply-quote.ts` (codec), `apps/web/src/chief/selection-reply.tsx`, `apps/web/src/chief/chief-conversation.tsx`, `apps/web/src/chief/chief-message-rows.tsx`. Design and failure modes: `docs/design/selection-reply-2026-11-08.md`.
