# Claude.ai design spec for Cairn

Owner decision (2026-11-07): Cairn's web UI follows claude.ai's design language one to one. This file is the measured reference. Phase 2 turns it into theme tokens, `ui-drift-gate` rules and gallery specimens; phase 3 brings the Coordinator, the thread panel and settings to it.

Brand boundary: copy layout, spacing, type scale, color logic and interaction feel. Do not copy Anthropic's logo, spark mark, illustrations or fonts. Cairn keeps its own accent (ochre, rule V5 in `apps/web/DESIGN-RULES.md`) where claude.ai uses clay.

Cairn exceptions (owner decisions; these override the measured claude.ai value):

| Element | Cairn keeps | claude.ai value it replaces | Decision |
|---|---|---|---|
| User message bubble | The gradient bubble from #2390: a soft green, blue and violet wash with a matching gradient rim, radius `--cds-radius-xl`. It was flattened to `--bubble-base` by #3186 and is restored. | white 5% flat fill, radius 12 (section 2) | Owner, 2026-11-07: keep our own bubble, the gradient one. Restoring it means amending rule V3 in `apps/web/DESIGN-RULES.md` and the `bubble-gradient` assertions in `apps/web/test/anti-slop-foundations.test.ts`. |

## How the values were taken

- Operated claude.ai in the owner's signed-in Chrome on 2026-11-07 and read computed styles with page scripts (`getComputedStyle`, `getBoundingClientRect`, `document.getAnimations()`, scroll and interval logs). Values are CSS px.
- Viewport: 1840x884 CSS px (the Chrome window is tiled by Hyprland at 2024 logical px with 110% zoom, so 1440 could not be set). Fixed sizes do not depend on the viewport; layout widths below are the product's max widths.
- Dark is claude.ai's `System` theme on this machine. Light was set in claude.ai Settings for the light pass and set back to `System` afterwards.
- One test chat was created for measurement (`Binary search explanation`). The account replies in Chinese, so the transcript text is CJK; the computed type values are the same for Latin text (`lang` is `en-US`).
- Screenshots and GIFs are in [`claude-ai-spec/`](claude-ai-spec/). The chat history list and the account footer are painted over with the sidebar color; a browser-extension bubble at the right edge is painted over with the page color. Screenshot pixels are 0.852 of CSS px.

Not measured in this pass (second pass needed): the 375px layout (Hyprland ignores window resize for this tab and the in-app browser pane is not signed in to claude.ai; use the 454px shots in `docs/design/references/coordinator-chat/` until then), an artifact panel with content, tool-use blocks (web search, file tools), the `Search` palette, a project detail page, toasts, and tooltip delay.

## 1. Page mapping

| Cairn surface (code) | Claude.ai counterpart | Evidence |
|---|---|---|
| App shell and sidebar (`board/sidebar.tsx`, `board/app-sidebar.tsx`, `board/sidebar-thread-groups.tsx`) | Left sidebar: nav rows, `Pinned` and `Ungrouped` sections, account footer | `dark-new-chat-empty-1440.jpg`, `dark-sidebar-hover-and-collapse.gif` |
| Coordinator home, empty (`board/home-c.tsx`, `chief/chief-root.tsx`) | New chat: greeting, one composer, model line, `Recent artifacts` strip | `dark-new-chat-empty-1440.jpg`, `dark-new-chat-tooltip-recent-artifacts.jpg` |
| Coordinator conversation (`chief/chief-conversation.tsx`, `chief/chief-message-rows.tsx`) | Chat transcript: user bubble, reply prose, code block, table, action row | `dark-chat-reply-done-jump-to-latest.jpg`, `dark-chat-table-list-actions.jpg`, `dark-chat-code-block-hover-copy.jpg` |
| Composer (`chief/composer-surface.tsx`, `chief/answer-composer.tsx`) | Composer card with `+`, voice, model and effort under it | `dark-new-chat-empty-1440.jpg`, `dark-model-menu-open.jpg` |
| Jump to latest (`chief/chief-conversation.tsx`) | `Scroll to bottom` round button above the composer | `dark-send-stream-jump-to-latest.gif` |
| Thread side panel (`board/side-chat.tsx`, `board/work-panel.tsx`, `chief/chief-drawer.tsx`) | Chat side panel (`aside`, 320px, files and tools) | `dark-chat-side-panel-open.jpg`, `dark-side-panel-open-close.gif` |
| Settings pages (`settings/`, `routes/account-page.tsx`, `routes/api-keys-page.tsx`, `routes/team-page.tsx`, `routes/remote-access-page.tsx`, `pages/project-settings-page.tsx`) | Settings dialog: left nav, rows with label left and control right | `dark-settings-general.jpg`, `light-settings-general.jpg`, `dark-settings-loading-skeleton.jpg` |
| Project list and project home (`pages/project-page.tsx`, `board/project-home.tsx`) | `Projects` page: serif title, `New project`, two-column cards | `dark-projects-list.jpg` |
| Menus (`board/sidebar-project-menu.tsx`, `board/thread-actions.tsx`, `chief/project-menu.tsx`, model pickers) | Model menu, row `More options` menu | `dark-model-menu-open.jpg`, `dark-model-menu-open-close.gif` |
| Dialogs (`DialogShell`, `chief/edit-charter-dialog.tsx`, `board/reset-confirm-dialog.tsx`) | Settings dialog chrome | `dark-settings-general.jpg` |
| Hover card on a sidebar row | Row hover card (title and age) | `light-chat-hover-card.jpg` |
| Tooltips (rule C4) | Composer `+` tooltip with shortcut | `dark-new-chat-tooltip-recent-artifacts.jpg` |
| Schedules (`pages/schedules-page.tsx`) | `Scheduled` page (not opened in this pass) | none yet |
| Search (`search/`) | `Search` palette, Ctrl+K (not opened in this pass) | none yet |
| No counterpart: needs-you tray and question card (`board/needs-you-tray.tsx`, `chief/chief-question-card.tsx`), board and activity (`routes/board-page.tsx`, `routes/activity-page.tsx`), machines and computer feed (`board/machines-panel.tsx`, `board/computer-feed.tsx`), diff and review | Apply the component rules below (card, row, menu, panel); keep the t3code and Amp references in `docs/design/references/` for structure | none |

## 2. Color

claude.ai uses neutrals only. Every surface is a gray or a white or black alpha; the only hues on a page are the brand mark, the send button, a project's chosen icon color, links and diff colors.

Measured on the dark new-chat page: 5 distinct text colors (3 white alphas, 1 gray, 1 green project icon), 9 distinct backgrounds, all neutral but one. Light chat page: 5 text colors (3 black alphas, 1 gray, 1 near-duplicate), all neutral.

| Role | Dark | Light | Where measured |
|---|---|---|---|
| Page | `#191919` | `#ffffff` | `main` background; `dark-chat-reply-done-jump-to-latest.jpg`, `light-chat-hover-card.jpg` |
| Sidebar | `#1f1f1f` | `#fafafa` | `aside` 288px |
| Raised: composer, menu, popover, hover card | `#303030` | `#ffffff` | composer box, `[role=menu]`, hover card |
| Dialog | `#1f1f1f` | `#ffffff` | settings `[role=dialog]` |
| Code block fill | `#303030` at 50% | (not measured) | wrapper of `pre` |
| User bubble | white 5% | (not measured; light shot shows a faint gray) | bubble `div` |
| Inline code fill | white 7.5% | black 5% | `code` outside `pre` |
| Hover fill (rows, icon buttons) | white 7.5% | black 5% | hovered sidebar row and composer `+` |
| Selected or active fill | white 15% | black 10% | open chat row, active settings nav |
| Segmented control track | white 5% | (not measured) | Theme switch |
| Text primary | white 93% | black 90% | body text |
| Text secondary | white 57% | black 60% | meta, help lines, action icons, thinking line |
| Text muted | white 40% | black 47% | placeholders, disclaimers |
| Hairline | white 10% | black 10% | sidebar edge, side panel edge, table rows, menu separator |
| Faint hairline | white 4% to 5% | black 5% | settings row dividers, dialog edge, code block edge |
| Primary button | `#efefef` fill, `#191919` text | (not measured) | `New project` |
| Overlay behind dialogs | black 50% | black 40% | dialog backdrop |

Hairlines are one device pixel (`0.727px` at DPR 1.375), not 1 CSS px.

Cairn translation (phase 2): replace the green-tinted neutral ladder (`--background #1b1f1c`, `--card #222723`, `--border #353b36` and their light pairs) with the pure gray values above; keep ochre as the one accent and the green 6px dot (V5). Sidebar, page and raised surfaces become three steps: sidebar, page, raised.

## 3. Type

claude.ai: `anthropic-sans` for UI, `anthropic-serif` for reply prose, greeting and page titles, `anthropic-mono` for code. All variable fonts with in-between weights.

Cairn keeps its open fonts, which already sit in the same roles: Instrument Sans (UI), Source Serif 4 (reply prose, greeting, page titles), JetBrains Mono (code). No proprietary font is copied.

| Role | Size / line height | Weight | Family | Where measured |
|---|---|---|---|---|
| Greeting (new chat) | 32 / 38.4 | 360 | serif | `Hello, ...` heading |
| Page title (`Projects`) | 24 / 32 | 500 | serif | `h1` |
| Reply prose | 15 / 21 | 400 | serif | `p` in reply |
| Reply heading (h2, h3) | 15 / 21, 22.5px space above | 600 | serif | headings in reply: same size as body, weight only |
| Reply bold | inherits | 600 | serif | `strong` |
| User message | 15 / 21 | 400 | sans | user bubble |
| Thinking summary line | 15 / 21 | 400 | sans, text secondary | first line of reply |
| Code block | 14 / 22.75 | 400 | mono | `pre` |
| Inline code | 13.5 | 400 | mono | `code` |
| Composer input | 15 / 21 | 400 | sans | contenteditable |
| UI: sidebar chat row, settings label, menu item | 14 / 20 or 21 | 400 (rows), 435 (nav, menu items, buttons) | sans | rows, menu |
| Dialog title, settings section title | 15 / 20 | 520 | sans | `Settings`, `General` |
| Sidebar section label (`Pinned`, `Ungrouped`) | 12 / 20 | 520 | sans | section buttons |
| Meta, help line, hover-card age | 13 / 17 to 14 / 20 | 400 | sans, text secondary | settings help, hover card |
| Code block language label | 12 / 17 | 400 | sans, text secondary | `python` label |

Distinct sizes on one page: 12, 13, 14, 15, 24 or 32 (one display size per page). Weights in use: 400, 435, 520, 600 (580 for semibold controls).

Cairn translation: drop the 17/16 `--type-scale` multiplier; map weights to Instrument Sans as 400 body, 450 controls, 500 titles, 600 bold. Reply headings stop growing in size and use weight only.

## 4. Spacing, size and radius

Spacing sits on a 4px grid with 2px half steps (2, 4, 6, 8, 10, 12, 14, 16, 24). Most common paddings on the new-chat page: 8 (39 elements), 2 (23), 4 (16); most common gaps: 4 (62), 6 (37), 8.

| Element | Size | Radius | Padding and spacing | Where measured |
|---|---|---|---|---|
| Sidebar | 288 wide | none | rows inset 8px from the left edge | `aside` |
| Sidebar row (nav and chat) | 32 tall, full width of the list | 8 | text inset 10px | chat row, `Projects` row |
| Sidebar row more button | 24 x 24, shown on hover | 6 | right end of the row | `More options for ...` |
| Section header (`Pinned`) | 28 tall | 8 | 4px | section button |
| Header bar | 45 tall | none | title left, panel toggle and `Share` right | chat header |
| Transcript column | max 768 (`--transcript-measure`) | n/a | reply text has 4px left and 56px right inset | reply `p` |
| User bubble | max about 600, right-aligned | 12 | 12px x 16px | bubble |
| User bubble to reply | 36px gap | n/a | n/a | measured from bubble bottom to first reply line |
| Code block | column width | 12 | 14px; language label above the code | `pre` wrapper |
| Table | column width | none | cells 7.5px vertical, no outer border, hairline between rows | `th`, `td` |
| List | 30px left indent | n/a | 7.5px between marker and text | `ul`, `li` |
| Blockquote | n/a | none | 15px left, 3.6px left rule | `blockquote` |
| Composer (new chat) | 656 wide | 14 | 8px; icon buttons 28 x 28 radius 8 | composer box |
| Message action row | 24 x 24 buttons, no gap | 6 | under the reply | `Copy`, `Retry` |
| Jump to latest | 36 x 36 | full | 4px | `Scroll to bottom` |
| Menu | 304 wide | 14 | 6px inset; items 28 tall, radius 8, 4px x 10px; separator inset 10px | model menu |
| Hover card | 240 wide | 12 | 12px | sidebar row hover card |
| Dialog | 1024 x 800 | 12 | nav column about 200 wide; content column 779 | settings |
| Settings nav item | 32 tall | 8 | 0 6px 0 8px | `Appearance` |
| Settings row | 53 tall | none | 12px vertical, label left, control right, faint hairline on top | `Interface font` |
| Input | 28 tall | 8 | 0 12px | `Code font` |
| Segmented control | 80 x 28 track, 26 x 26 thumbs | 8 track, 6 thumb | 1px | `Theme` |
| Button (secondary and primary) | 28 tall | 8 | 0 9px | `Share`, `New project` |
| Project card | 474 x 64, two columns | 12 | 3% white fill, no border | `Projects` |

Radii in use: 4 (inline code), 6 (small icon buttons), 8 (rows, buttons, inputs; 82 elements on the new-chat page), 12 (cards, code blocks, bubbles, popovers, dialogs), 14 (composer, menus), full (jump button).

## 5. Elevation

Shadows exist only on layers that float above the page. Rows, cards, buttons and inline blocks have none, in any state.

| Layer | Shadow | Where measured |
|---|---|---|
| Menu, popover, hover card | inset 1px ring at 4% white, `0 8px 24px` black 32%, `0 2px 6px` black 20% | model menu, hover card |
| Composer | `0 4px 20px` black 7.5%, inset 1px ring at 8% white | composer box |
| Dialog | inset ring at 4% white, `0 1px 2px` 6%, `0 2px 8px` black 24%; light: 1px ring at 8% black | settings dialog |
| Jump button | `0 2px 4px` 7%, `0 6px 16px` black 24% | `Scroll to bottom` |
| Side panel | none; a hairline on its left edge | `aside` |

## 6. Icons

claude.ai draws icons with an icon font in a 20px box (sidebar nav, composer) and about 16px inside the 24px message-action buttons. Cairn keeps lucide (V9, V14) at 16px default and 18px in the sidebar nav and composer, stroke 1.75.

## 7. Interaction

| Behavior | Measured value | Evidence |
|---|---|---|
| Row hover (sidebar, menu item, settings nav) | Background fill appears instantly: the row's `transition` is `all 0s`. Fill covers the whole row at its radius, never a partial band. | `dark-sidebar-hover-and-collapse.gif` |
| Icon button hover | Inner fill white 7.5% appears instantly; only `box-shadow` and `color` transition, in 60ms with `cubic-bezier(.165,.84,.44,1)` | composer `+` |
| Press | Inner element scales to 0.975 (`--cds-btn-press-sx`); release springs back over 450ms with a slight overshoot (`linear()` spring peaking at 1.09) | composer buttons |
| Hover reveals | Row `More options` button and message timestamp appear on hover and take no layout | `light-chat-hover-card.jpg` |
| Menu open and close | No animation: the menu is at full opacity and final position on the first sampled frame (under 10ms) and is removed on close | `dark-model-menu-open-close.gif` |
| Dialog open | Opacity 0 to 1 and scale 0.98 to 1 over 200ms, `cubic-bezier(.165,.84,.44,1)`; backdrop black 50% (dark), 40% (light) | settings dialog |
| Section collapse | Rows are removed at once; only the chevron rotates, in 60ms | `dark-sidebar-hover-and-collapse.gif` |
| Side panel | Opens with no slide and no scrim; it pushes the transcript left instead of covering it | `dark-side-panel-open-close.gif` |
| After send | The user message moves to the top of the transcript and the reply streams below it; streaming text fades in at the tail | `dark-chat-streaming-first-tokens.jpg` |
| Long reply | The view does not follow the stream; a `Scroll to bottom` button appears above the composer | `dark-chat-reply-done-jump-to-latest.jpg` |
| Jump to latest | One scroll event straight to the bottom (no smooth scroll); the button then fades out over 200ms | `dark-send-stream-jump-to-latest.gif` |
| Loading | Settings content shows skeleton blocks in the final row shapes; the nav is usable at once | `dark-settings-loading-skeleton.jpg` |
| Tooltip | Label plus shortcut in a small dark chip under the control | `dark-new-chat-tooltip-recent-artifacts.jpg` |

## 8. Component rules for Cairn

These are the rules phase 2 makes checkable.

1. Neutral surfaces only: page, sidebar and raised are three grays; every other fill is a white (dark) or black (light) alpha from the table in section 2.
2. Hover and selection are fills (7.5% and 15% dark, 5% and 10% light) that cover the whole row or control at its radius. No hover shadow, no hover border, no partial band, no transition on the fill.
3. Press feedback is a scale of the inner element to 0.975 with a spring release; nothing else moves.
4. Menus and popovers appear and disappear with no animation. Dialogs fade and scale from 0.98 in 200ms. Panels open without sliding.
5. Shadows only on floating layers (menu, popover, composer, dialog, jump button), from the values in section 5.
6. Hairlines are one device pixel at 10% (structure) or 5% (settings rows, dialog edge).
7. Radii: 4, 6, 8, 12, 14, full. Rows, buttons and inputs 8; cards, bubbles, code blocks, popovers and dialogs 12; composer and menus 14.
8. Type sizes: 12, 13, 14, 15 for everything but one display size per page (24 page title or 32 greeting). Reply headings grow in weight, not size.
9. Rows and controls are 28 or 32 tall; icon buttons 24 or 28; the jump button 36.
10. Settings are rows (label left, control right, faint hairline between), grouped under a 15px section title, never one card per setting.
11. Scrolling: no auto-follow of a stream; jump to latest is instant.

## 9. Files

| File | What it shows |
|---|---|
| `claude-ai-spec/dark-new-chat-empty-1440.jpg` | New chat, sidebar, greeting, composer |
| `claude-ai-spec/dark-new-chat-tooltip-recent-artifacts.jpg` | Composer tooltip, model line, recent artifacts strip |
| `claude-ai-spec/dark-chat-streaming-first-tokens.jpg` | User message at the top, reply starting below it |
| `claude-ai-spec/dark-chat-reply-done-jump-to-latest.jpg` | Inline code, list, code block, jump button |
| `claude-ai-spec/dark-chat-code-block-hover-copy.jpg` | Code block with the copy button on hover |
| `claude-ai-spec/dark-chat-code-block-cjk.jpg` | Code block with language label, action row |
| `claude-ai-spec/dark-chat-table-list-actions.jpg` | Table, list, message action row |
| `claude-ai-spec/dark-model-menu-open.jpg` | Model menu |
| `claude-ai-spec/dark-chat-side-panel-open.jpg` | Side panel open, transcript pushed left |
| `claude-ai-spec/dark-settings-general.jpg` | Settings dialog, dark |
| `claude-ai-spec/light-settings-general.jpg` | Settings dialog, light |
| `claude-ai-spec/dark-settings-loading-skeleton.jpg` | Settings loading skeleton |
| `claude-ai-spec/dark-projects-list.jpg` | Projects page |
| `claude-ai-spec/light-chat-hover-card.jpg` | Light chat page, row hover fill and hover card |
| `claude-ai-spec/dark-send-stream-jump-to-latest.gif` | Send, stream, scroll up, jump to latest |
| `claude-ai-spec/dark-model-menu-open-close.gif` | Menu open and close |
| `claude-ai-spec/dark-sidebar-hover-and-collapse.gif` | Row hover across rows, section collapse and expand |
| `claude-ai-spec/dark-side-panel-open-close.gif` | Side panel open and close |
