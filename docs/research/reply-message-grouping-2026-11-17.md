# One assistant message, one visual unit: how dusk bot and the chat references group reply text (2026-11-17)

Labels: **measured** = read first-hand this round (cairn files in this checkout, dusk bot files through `gh api`, the local coordinator SQLite). **inferred** = follows from measured facts. **guessed** = the rest.

Why this note: ian reported that the Coordinator's replies arrive as several separate boxes instead of one message and pointed at `https://github.com/DuskBotAI/duskbot` as a personal-agent product to compare against. The product-level dusk-vs-cairn comparison lives in `duskbot-vs-cairn-2026-11-17.md`; this note covers only the reply-presentation seam.

## What cairn does today (measured)

- `apps/web/src/api/mappers.ts` maps one assistant `MessageRow` to one `robot` `ChiefStreamItem`. A three-paragraph assistant message is a single item. (measured: `collectChiefStream`, and the real journal row for the session in question — one `chief_message` row whose text contains two `\n\n` breaks.)
- `apps/web/src/lib/markdown.ts` `chatBubbleGroups` splits a reply's top-level markdown blocks into bubble groups. A block starts a new group when it is `spaced` (blank-line-separated) from the previous one; unspaced siblings and list-runs join. Code, tables, rules and attachments never bubble.
- Result: a plain-text reply of N paragraphs renders as N grey boxes 4px apart (`gap-1` between groups). In the shipped desktop build the gap measured ~16-18px, so the boxes read as separate messages. (measured: pixel measurement on the screenshot; the 4px value is current main, the packaged build is older.)
- `apps/web/src/chief/bubble-runs.ts` already clusters *separate* robot items: a robot row right after another robot row joins it (4px) unless a time divider or a tool row stands between.

## What dusk bot does (measured, `main` read 2026-11-17)

- `server/reply-bubbles.ts`: one assistant text item becomes **one** chat message. The model can opt into multiple bubbles only by emitting a line that is exactly `---` outside fenced code blocks; the splitter tracks fence state and drops empty parts. Without the separator the original text stays one message.
- `src/components/chat-bubble.ts`: iMessage-style grouping between *separate* messages. Rows space 16px apart; a row in the same author group pulls up 12px to 4px (`SIMPLE_STACKED`); `bubbleJoins` welds consecutive same-group rows and `joinedCorners` tightens the group's last corner to a tail. Emoji-only messages render large with no bubble.
- The grouping rule keys on the message's *role/group* (`bot` vs `user`), never on paragraph boundaries inside a message.

## Other references

- Claude.ai (cairn's designated chat reference per `apps/web/DESIGN-RULES.md`): assistant replies render as one continuous markdown surface — paragraphs, lists and headings flow inside a single message unit; prose is not boxed per block. (inferred: observed behavior of the product; not re-measured this round.)
- iMessage: one send = one bubble; consecutive sends by the same author weld into a group with tightened corners. dusk copies this directly. (inferred: product behavior.)

## The gap

cairn fragments at a layer the others do not have: the paragraph. Every reference treats "one assistant text" as the atomic message unit and only ever welds or splits *between* messages. cairn splits *inside* the message at every blank line.

A second fragmenter exists on the same surface: a `task-card` stream item that cannot fold into the reply interrupts the run, so a single logical turn can paint as card + bubbles + card (fixed separately in the same worktree — `archivedTodoIdsOf` drops a card whose task is archived later in the same stream, and `foldTaskCards` no longer loses the fold target).

## Options for closing it

| Option | Shape | Cost | Reverse |
|---|---|---|---|
| A. One reply item = one bubble | `chatBubbleGroups` joins all bubble-eligible blocks of one item into a single group; code/tables still break out as white surfaces (they are already unbubbled). dusk's shape. | Long replies become one tall grey slab; per-paragraph hover affordances move to the whole bubble | Small: revert the join rule |
| B. Keep per-paragraph boxes, weld them | Same groups as today but joined corners + ~2px gaps so a reply reads as one cluster (iMessage run) | Still N boxes; mixed content still alternates grey/white | Small |
| C. Flat prose, no bubbles for text | Paragraphs render unboxed; bubbles only for cards/notices — Claude.ai's literal form | Largest departure from the 2026-11-11 owner decision to box reply blocks | Medium: re-styles the main surface |

Recommendation: **A**. It restores the atomic-message rule every reference shares, keeps cairn's bubble identity for the reply, needs no model/protocol change (unlike dusk's `---` opt-in, which cairn could adopt later as an escape hatch if long replies need deliberate splits), and composes with `bubbleRuns` welding across items. Option C is the strongest alternative if the owner wants the Claude look verbatim; B is the weakest — it keeps the thing the user disliked and only makes it look deliberate.

This reverses an owner-approved design (per-block bubbles, `DESIGN.md` owner 2026-11-11), so the direction goes to ian as an options prototype, not a unilateral change.

## Not checked

- dusk bot's running product (source read only; the app was not operated — `duskbot-vs-cairn-2026-11-17.md` §6 same caveat).
- Whether cairn's Coordinator prompts ever rely on `\n\n` to mean "separate beats" that should stay separate; the chief prompt asks for `todo:` mention syntax but says nothing about paragraph cadence (measured: `apps/server/src/services/chief.ts` instructions).
