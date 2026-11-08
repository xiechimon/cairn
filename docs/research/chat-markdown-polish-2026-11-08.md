# Research: claude.ai list bullets, code blocks, copy button and status lines, measured for cairn's chat transcript (2026-11-08)

Question. ian flagged four transcript rendering defects: thin list bullets, a copy button he was not sure should always show, a code block whose font he dislikes and whose one-line box stretches across the message, and the centered status dividers between two full-width rules (`<user> started the merge`, `forwarded to task #9` with a chip between rules, and every other centered event), plus a reply footer (`done 17s`) colliding with the line under it. Each fix follows claude.ai and the Claude Code web tab, from measurement.

Labels: measured = read or run first-hand this round, with the capture path; inferred = derived from measured, checkable; guess = the rest. `<cache>` is the capture directory `~/.cache/chat-polish/measured/` on the machine that ran the work.

## Sources

| Source | What it gave | Status |
|---|---|---|
| claude.ai chat in ian's signed-in Chrome (macOS, 1470 × 668 viewport, device pixel ratio 2), a new conversation whose reply holds a sentence, a three-item bullet list with two nested bullets and inline code, a three-item ordered list, a one-line `bash` block (`pnpm install`) and a 25-line Python block with a 160-character line | Computed styles through the extension's JavaScript tool, and 2× crops in `<cache>/claude/` | measured |
| Claude Code web tab (`claude.ai/code`), an existing session in the same browser | Status rows (`Ran 5 commands`, `Checked pull request`) and the PR reference link; crops `<cache>/claude/status-code-tab-{light,dark}.png` | measured |
| Claude desktop app Code tab | Not opened: the session has no desktop control. The web Code tab above is the same product surface (inferred) | not covered |

Theme: ian's appearance setting flipped between light and dark during the run, so each capture records the mode it was taken in. Dark captures of the bullets and status rows were taken by setting `data-mode` on the page's theme roots; the code-block highlighter picks its palette in script, so the dark code crops come from the period the account itself was dark.

## 1. List bullets

| Property | claude.ai (measured, computed styles) |
|---|---|
| `ul` / `ol` | `list-style-type: disc` / `decimal`, `padding-inline-start: 30px` (2em of 15px), font 15px / 21px serif |
| `li` | `padding-inline-start: 7.5px` (0.5em), first item margin 0 |
| block gaps | the first `ul` after a paragraph has `margin-top: 11.25px` (0.75em) and `margin-bottom: 0`; an `ol` right after a `ul` has `margin-top: 22.5px` (1.5em) |
| nested `ul` under `ul` | `circle`, `padding-inline-start: 30px`, `margin-top: 3.746px` (0.25em) |
| `li::marker` colour | `rgba(0, 0, 0, 0.9)` light and `rgba(255, 255, 255, 0.93)` dark: the text colour, not a muted one |
| marker font | the reply's serif at 15px, so the disc is the font's own glyph |

Crops: `<cache>/claude/bullets-{light,dark}.png` (measured).

Cairn before (main): a `•` text character in a fixed span, coloured `--text-tertiary`, 18px per depth, 8px flex gap. Crop `<cache>/before/bullets-{light,dark}.png` (measured).

Cairn after: real nested `ul`/`ol` (`nestLists` in `apps/web/src/detail/chat-markdown.tsx`) with `ps-[2em]`, `li` `ps-[0.5em] mt-[0.25em] first:mt-0`, `marker:text-(--foreground)`, claude.ai's nested types, and the measured block gaps (0.75em after a paragraph, 1.5em between two adjacent lists). Coordinator legacy `bullets` rows use the same classes. `apps/web/e2e/chat-markdown-claude-parity.spec.ts` checks marker colour, list and item padding.

## 2. Code-block copy button

| Property | claude.ai (measured) |
|---|---|
| Element | `button[data-testid=code-block-copy]`, `aria-label` "Copy to clipboard", 28 × 28, radius 8px, colour the text colour |
| Position | top right of the block: 8.5px from the right edge, 10.5px from the top edge, on the language-label row |
| At rest | the button box exists but holds no icon; nothing is drawn (`<cache>/claude/code-short-rest-{light,dark}.png`) |
| Block hovered | the copy icon appears (`<cache>/claude/copy-blockhover-light.png`, `code-short-blockhover-dark.png`) |
| Button hovered | an inner 28 × 28 layer fills with `rgba(255, 255, 255, 0.075)` dark (the inline-code fill); no shadow (`box-shadow: none`); the fill has no transition (the layer transitions only `box-shadow, color` for 60ms) (`<cache>/claude/copy-buttonhover-{light,dark}.png`) |

So the answer to ask 2 is no: claude.ai hides the code-block copy until the pointer is over the block.

Cairn after: an `icon-sm` ghost button at `top-2 right-0 px-2` (8px right, 10px top), radius `--cds-radius-lg` (8px), `opacity-0` at rest and `opacity-100` on block hover, keyboard focus inside the block and coarse pointers, no transition, hover fill `--prose-code-fill` (the measured `rgba(0,0,0,.05)` / `rgba(255,255,255,.075)`), no shadow. The parity spec checks all of these.

## 3. Code blocks and inline code

| Property | claude.ai (measured) | Cairn after |
|---|---|---|
| Code font | `anthropic-mono, ui-monospace, monospace`; `anthropic-mono` is a loaded web font (`document.fonts`), proprietary | `ui-monospace, "SF Mono", Menlo, Consolas, monospace`, the same chain without the proprietary face (SF Mono on macOS) instead of JetBrains Mono |
| Size / line height | 14px / 22.75px | 0.875rem / 1.625 |
| `pre` padding | 14px, radius 12px | 14px |
| Wrapper | 0.5px border `rgba(0,0,0,.08)` light / `rgba(255,255,255,.04)` dark; background white at 50% light, `oklab(0.239 …/ .5)` dark | `--prose-code-line`, `--prose-code-surface` with those values |
| Language label | 12px / 17px sans, `rgba(0,0,0,.6)` light / `rgba(255,255,255,.57)` dark, 31px row | same |
| Width of a one-line block | wrapper 736px = the full reply column; height 83px (label row 31 + `pre` 51) | full column, same heights |
| Long lines | `pre` scrollWidth 1249 in a 735px `overflow-x: auto` wrapper; no max height | `overflow-x-auto` wrapper, no height cap |
| Inline code | 13.5px (0.9em) mono, line-height 1, padding 1px 4px, radius 4px, fill `rgba(0,0,0,.05)` light / `rgba(255,255,255,.075)` dark, no border, `pre-wrap` | `text-[0.9em] leading-none px-1 py-px`, `--prose-code-fill` |

Ask 3, width: claude.ai keeps a one-line command in a full-width block (measured: 736px wide for `pnpm install`). What reads as a long empty tail in cairn before was a grey `--muted` slab with a 1px border and no label row; claude.ai's block is a near-transparent card with a hairline border and a label row, so the space reads as part of the card. Cairn follows claude.ai's width. Crops: `<cache>/claude/code-short-rest-*.png`, `code-long-*.png`.

## 4. Status events

| Property | claude.ai chat (measured) | Claude Code web tab (measured) |
|---|---|---|
| Row | 28px tall flex row, 8px gap, at the reply's text column | 28px tall, 8px gap, text at the column edge |
| Text | 15px / 21px `anthropic-sans`, `rgba(255,255,255,.57)` dark / `rgba(0,0,0,.6)` light | 15px / 21px `anthropic-sans`, `rgba(0,0,0,.6)` light |
| Alignment | left | left |
| Rules, icon | none; a trailing `›` when the row expands | none; a trailing `›` |
| References | n/a | PR `#3424` is an underlined link: underline at 40% of the text colour, offset 3px, no chip background |

Neither surface centres an event between rules. Crops: `<cache>/claude/status-chat-{light,dark}.png`, `status-code-tab-{light,dark}.png`.

Cairn after: one `StatusLine` (`apps/web/src/components/chat/status-line.tsx`): left-aligned, `min-h-7`, 8px gap, sans 15px / 21px, `--text-secondary`, no rules, no icon. References inside it (`#9`, task titles) are links that keep the line colour with a 40% underline at 3px offset (`STATUS_REF_CLS`); the colour is inferred, since claude.ai has no link inside a status row. It replaces every centered divider:

| Event | Where |
|---|---|
| merge note (`<user> started the merge`), `started by Coordinator`, `worked N minutes`, skills summary | task transcript, `apps/web/src/detail/transcript.tsx` |
| `forwarded to task #9` (was a chip between rules), `stopped`, time and machine notes | Coordinator stream, `apps/web/src/chief/chief-message-rows.tsx` |
| digest toggle | `apps/web/src/chief/chief-digest-row.tsx`; the toggle is the status line with a chevron, colour change on hover, no fill |
| gallery specimens | `apps/web/src/design/components-more.tsx`, `components-content.tsx` |

Footer overlap: in the task transcript the reply text and its footer were siblings in one `flex` row, so a 68ch line ran under the footer; agent rows are now `flex-col`, so the footer always sits below (the parity spec checks it). In the Coordinator stream the reply footer is absolutely placed under the reply and the user and event rows clear it with `mt-6`; the old marker rows had only `my-2.5`, so a footer painted over them. Status lines there now take the same `mt-6`.

## Blur

`backdrop-filter` and `filter` read on the code block's `pre` and four ancestors, every layer of the copy button, and the status row with four ancestors: all `none` (measured). None of these surfaces uses blur. DESIGN-RULES V3 needs no change.

## Evidence

Side-by-side comparisons, each `claude.ai | cairn before | cairn after`, light and dark: `<cache>/compare-{bullets,code-short,code-long,copy,merge,handoff}-{light,dark}.png`.
