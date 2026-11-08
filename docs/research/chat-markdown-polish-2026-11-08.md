# Research: claude.ai list bullets, code blocks, copy button and status lines, measured for cairn's chat transcript (2026-11-08)

Question. ian flagged four transcript rendering defects: thin list bullets, an always-visible copy button under a code block, a code block whose font he dislikes and whose one-line box stretches across the message, and the centered `<user> started the merge` divider (a Chinese UI string) with the reply footer below it colliding with its text. Each fix must follow claude.ai one-to-one, from measurement.

Labels: measured = read or run first-hand this round; inferred = derived from measured, checkable; guess = the rest.

## Sources

| Source | What it gave | Status |
|---|---|---|
| claude.ai in the built-in browser, 2026-11-08 | Signed out: `/new` redirects to `/logout?involuntary=1` then `/login`. Not signed in, per the brief. The login page still loads the app stylesheet `assets-proxy.anthropic.com/claude-ai/v2/assets/v1/c6a992d55-CIgJ-QZZ.css` (2.1 MB), which holds the `.prose` rules | measured |
| Computed-style dumps and frames, `<scratch-cache>/cairn-design-capture/final/claude-ai-1440-{light,dark}/chat-long/` (2026-11-07, ian's account, a Python binary-search reply with lists, inline code and a fenced block) | Every element's computed style per step: `initial`, `scroll-up`, `hover-reply-actions`, `hover-code-block`; frames at 1.25 device px per CSS px | measured |
| `<scratch-cache>/cairn-design-capture/runs/2026-11-07T08-55-37-claude-ai-1440-dark/tool-search/` | The "Searched the web" status row, dark only | measured |
| Claude desktop app Code tab | Not measured: no computer-use tool in this session, and the brief forbids ian's own Chrome | not covered |

## 1. List bullets

claude.ai stylesheet, `@scope(.prose)` (measured, verbatim values):

| Rule | Value |
|---|---|
| `ul, ol` | `padding-inline-start: 2em` |
| `ul` / `ol` | `list-style-type: disc` / `decimal` |
| `li` | `margin-block-start: calc(var(--_prose-flow) * var(--_prose-x-li-child))` = `.75em × .333` = 0.25em; first child 0; `padding-inline-start: .5em` |
| `li::marker` | `color: var(--cds-prose-marker-color, var(--cds-text-secondary, …))` |
| marker colour override on the reply container | `stacks:[&_li…::marker]:[--cds-text-secondary:var(--cds-text-primary)]`, active under `[data-cds-fizzy-lake~=color]` |
| `ul>li>ul` / `ul>li>ul>li>ul` | `circle` / `square` |
| `ol>li>ol` / `ol>li>ol>li>ol` | `lower-alpha` / `lower-roman` |
| `ol>li>ul` | no rule, so `disc` |

Computed on the reply (measured, chat-long light): `ul` 15px / 21px serif, padding-left 30px; `li` padding-left 7.5px, margin-top 3.746px. Text starts 37.5px from the list edge.

Frame pixels (measured, frame 0 of the light run): the marker is a solid disc about 6 device px = 4.8 CSS px across, darkest pixel 15/255. That matches `text-primary` (`#000000e6`) and rules out `text-secondary` (`#0009`). The marker is the font's own `disc` glyph, so its size follows the body font size.

Cairn before: a `•` text character in a 14px-min span, coloured `--text-tertiary`, with an 18px-per-depth `margin-left` and an 8px flex gap. Ordered numbers were a `--text-tertiary` span.

Cairn after: list runs become real nested `ul`/`ol` (`nestLists` in `apps/web/src/detail/chat-markdown.tsx`) with `ps-[2em]`, `li` `ps-[0.5em] mt-[0.25em] first:mt-0`, `marker:text-(--foreground)`, `start`/`value` from the source numbers, and claude.ai's nested types. Coordinator legacy `bullets` rows use the same classes.

## 2. Copy button

| Element | claude.ai (measured) |
|---|---|
| Code-block copy, `button[data-testid=code-block-copy]` | 28 × 28, radius 8px, icon box 20 × 20 (glyph ink about 13.6 CSS px), colour `text-primary`, in `absolute right-0 h-8 px-2 inline-flex items-center z-10` at the block's top right, on the language-label row |
| Visibility | Not in the frame at rest (frame 253: header row empty) and present when the pointer is over the block (frame 235). The dumps record the button's rect appearing on `pointerover`, so it mounts on hover. The block wrapper carries `focus-visible:ring-2`, so keyboard users reach it through the block (inferred) |
| Hover feedback | `transition-property: box-shadow`, 60ms, on the button; no visible shadow in frames |
| Message action bar under the latest reply (copy, read aloud, thumbs, retry) | 24 × 24 buttons, 16px icon box, `text-secondary`, turning `text-primary` on hover. On the latest reply it stays visible without hover; only the timestamp fades in (`time` opacity 0 → 1 on `pointerover`) |

The copy ian saw "under the code block" is cairn's message copy for the latest Coordinator reply. Its always-visible state matches claude.ai's latest-reply action bar (measured), so it stays. What cairn lacked was claude.ai's own code-block copy, which made the reply copy read as belonging to the block.

Cairn after: a 28px `icon-sm` ghost button at the code block's top right (`absolute top-0 right-0 h-8 px-2`), 16px Copy icon (13.3 px ink, against claude.ai's 13.6), `opacity-0` at rest, `opacity-100` on `group-hover`, `group-focus-within` and coarse pointers, `transition-none`, background-only hover, no shadow. It is in the tab order, so Tab reveals it. It writes the block text and shows a check for 1.5s.

## 3. Code blocks and inline code

| Property | claude.ai (measured) | Cairn before | Cairn after |
|---|---|---|---|
| Font | `"anthropic-mono", ui-monospace, monospace, "SF Mono", ui-monospace, Menlo, Consolas, monospace` | JetBrains Mono | `ui-monospace, "SF Mono", Menlo, Consolas, monospace`: claude.ai's chain without its proprietary first face (SF Mono on macOS) |
| Block size / line height | 14px / 22.75px (`!text-sm !leading-relaxed`) | 13px / 20px | 0.875rem / 1.625 |
| Block padding | 14px (`p-3.5`) | 8px 10px | 14px |
| Radius | 12px (`--msg-block-radius`) | 12px | 12px |
| Wrapper background | `bg-bg-000/50`: `rgb(255 255 255 / .5)` light, `hsl(0 0% 12.5% / .5)` dark | `--muted` | `--prose-code-surface` with those values |
| Border | 0.5px, `rgba(0,0,0,.08)` light, `rgba(255,255,255,.04)` dark | 1px `--border` | 0.5px `--prose-code-line` with those values |
| Header | language label row, 12px / 17px sans, `text-secondary`, `p-3.5 pb-0` | none | same |
| Code colour | `rgb(20,24,31)` / `rgb(234,236,240)` (highlighter base) | `--foreground` | `--foreground` (cairn has no highlighter) |
| Width | wrapper is `display:block`, 736px = the full reply column; the `pre` is 734.4px. A one-line block is the same component, so it spans the column too (inferred) | full column, `max-w-full` | full column, `max-w-full`, never wider |
| Long lines | `overflow-x-auto` wrapper around a `white-space: pre` `pre` | `overflow-auto` on the `pre` plus `max-h-80` | `overflow-x-auto` wrapper; the 320px height cap is gone, as claude.ai has none (its 21-line block renders at 483px) |
| Inline code | `.9em` (13.5px in 15px prose), line-height 1, padding 1px 4px, radius 4px, background `fill-ghost-hover` = `rgba(0,0,0,.05)` / `rgba(255,255,255,.075)`, no border, `white-space: pre-wrap`, mono chain above | 13px JetBrains Mono, `--muted`, 2px side margins | `text-[0.9em] leading-none px-1 py-px`, `--prose-code-fill`, no side margins, `whitespace-pre-wrap`, same mono chain |

Width: claude.ai does not shrink a short block to its content (inferred above). A one-line command therefore still spans the column. The right-hand space is where the hover copy button sits, and the label row and hairline border make it read as a card instead of a long grey bar. If ian still wants short blocks to hug their content, that would depart from claude.ai and is his call.

## 4. Status events in the transcript

claude.ai has no full-width rule for events inside a turn. Its "Searched the web · query ›" status row (measured, tool-search dark) is left-aligned at the text column, `anthropic-sans` 15px / 21px, `text-secondary`, 8px gap between label and detail, in a 28px row (`h-control`). It has no rules and no leading icon. Of the other claude.ai chat surfaces captured, none centres an event between rules.

Claude desktop Code tab: not measured this round (see Sources).

Cairn before: `TurnRule`, a centered `text-meta` label between two 1px `--border` rules, used for the merge note, `由 Coordinator 发起` ("started by Coordinator") and `已工作 N 分钟` ("worked N minutes"). The skills summary was also centered.

Cairn after: `StatusLine`, a left-aligned `min-h-7` row at `text-card-title` (15 / 21) in `--text-secondary` with an 8px gap and no rules. The skills summary is left-aligned too. No icon, because claude.ai's status row has none.

Footer overlap: the agent row was `flex items-start` with the reply text and its footer (`完成 17s` and copy) as siblings. When the text reached its 68ch cap, the footer had no room and painted over the last line. claude.ai puts the action bar under the reply (measured, the action-bar buttons sit below the last block). Agent rows are now `flex-col items-start`, so the footer always sits below the text.

## Evidence

Comparison images in `<scratch-cache>/chat-polish/`: `compare-1-lists-{light,dark}.png`, `compare-2-3-code-{light,dark}.png`, `compare-2-copy-states-{light,dark}.png`, `compare-4-status-{light,dark}.png`. claude.ai crops are rescaled ×1.6 to match cairn's 2× captures. The light status row has no claude.ai crop because only dark tool-search runs exist.
