# Claude.ai design spec for Cairn

Owner decision (2026-11-07): Cairn's web UI follows claude.ai's design language one to one. This file is the measured reference. Phase 2 turns it into theme tokens, `ui-drift-gate` rules and gallery specimens; phase 3 brings the Coordinator, the thread panel and settings to it.

Brand boundary: copy layout, spacing, type scale, color logic and interaction feel. Do not copy Anthropic's logo, spark mark, illustrations or fonts. Cairn keeps its own accent (ochre, rule V5 in `apps/web/DESIGN-RULES.md`) where claude.ai uses clay or blue.

Cairn exceptions (owner decisions; these override the measured claude.ai value):

| Element | Cairn keeps | claude.ai value it replaces | Decision |
|---|---|---|---|
| User message bubble | The gradient bubble from #2390: a soft green, blue and violet wash with a matching gradient rim. It was flattened to `--bubble-base` by #3186 and is restored. | white 5% flat fill, radius 12 | Owner, 2026-11-07: keep our own bubble, the gradient one. Restoring it means amending rule V3 in `apps/web/DESIGN-RULES.md` and the `bubble-gradient` assertions in `apps/web/test/anti-slop-foundations.test.ts`. |

## How the values were taken

Recordings are the primary evidence; every number below comes from a probe log or a style dump, not from looking at a screenshot.

- Harness: `scripts/design-capture/`. `capture.mjs` drives system Chrome through Playwright with its own profile, an exact viewport (1440x900, or 375x812 with mobile emulation) and `prefers-color-scheme` set per run. The same journeys (`journeys/claude-ai.mjs`, `journeys/cairn.mjs`) run on both products: hover rows and buttons, press, type in the composer, menus, sidebar collapse, dialogs, long-chat scroll, jump to latest, send and stream, artifact panel, web-search tool block, search palette, keyboard focus, settings, projects.
- Frames: a CDP screencast saves every composited frame; `capture.mjs` encodes them at their real timestamps into a 60 fps video.
- Probe (`probe.js`): a `requestAnimationFrame` loop logs, on every frame, the changed computed opacity, transform, scale, background, color, shadow, outline, clip-path and rect of the elements involved (hovered chain, active, focused, newly mounted, and per-journey watch lists), plus scroll positions and streamed text length; every input event and a MutationObserver log carry timestamps. Probe frames on the claude.ai runs came every 5.6 ms (a 180 Hz display); cairn runs headless at 16.7 ms.
- Timings: `analyze.mjs` windows each step from 100 ms before its input to the settle point, and reports per element and property the delay from the input that caused it, the duration, the number of frames and the value curve. `compare-motion.mjs` puts claude.ai and cairn side by side per step.
- Style dump: before the journey and at marked states (menu open, dialog open, hover, focus), `probe.js` dumps every visible element's computed font, size, weight, line-height, letter-spacing, color, background, border per side, radius, shadow, outline, padding, margin, gap, size, transition and animation, plus every CSS custom property on the theme roots. Elements carry role tags (`roles` in the journey files), and `style-diff.mjs` diffs the two products by role and lists the value sets on each page as a catch-all.
- Privacy: `redact.mjs` pixelates the claude.ai sidebar from the Pinned section down in every desktop frame, the 375 drawer while it is open and the search palette's recent list; it removes visible text and chat ids from the claude.ai logs. `audit.mjs` fails on a capture without a redaction sidecar, on a readable region, on a capture nobody marked as reviewed, and on any visible text left in claude.ai JSON. The test chats used: one long reply about binary search, and short design-test prompts (stream, artifact, web search) at each width.
- Evidence: the raw probe logs, style dumps, analyses, videos, frame strips and the side-by-side videos are on the evidence branch named in the PR that adds this file, under `<product>-<width>-<theme>/<journey>/`, `compare/<width>-<theme>/` and `pairs/<width>-<theme>/`. A citation `1440-dark/chat-long#jump-to-latest` means that step's row in `claude-ai-1440-dark/chat-long/claude-ai-analysis.md` and the matching cairn file.

Not captured: toasts and a failed send (no reliable trigger without breaking the account), a project detail page, the 768 breakpoint, drag or resize (claude.ai has none in the mapped pages), the 375 settings select (claude.ai shows no select there), and streaming, the artifact panel and the tool block at 375 (Enter in the mobile composer inserts a line break, so the journey never sent; those 375 videos show only the new-chat page). Cairn's streaming capture uses a static fixture because the capture stack has no live agent.

## 1. Page mapping

| Cairn surface (code) | Claude.ai counterpart | Journeys |
|---|---|---|
| App shell and sidebar (`board/sidebar.tsx`, `board/app-sidebar.tsx`, `board/sidebar-thread-groups.tsx`) | Left sidebar: nav rows, Pinned and recents sections, account footer; a drawer at 375 | `shell` |
| Coordinator home, empty (`board/home-c.tsx`, `chief/chief-root.tsx`) | New chat: greeting, one composer, model line, Recent artifacts strip | `shell` |
| Coordinator conversation (`chief/chief-conversation.tsx`, `chief/chief-message-rows.tsx`) | Chat transcript: user bubble, reply prose, code block, table, list, action row | `chat-long`, `send-stream` |
| Composer (`chief/composer-surface.tsx`, `chief/answer-composer.tsx`) | Composer card with `+`, voice, model and effort under it | `shell`, `send-stream` |
| Jump to latest (`chief/chief-conversation.tsx`) | `Scroll to bottom` round button above the composer | `chat-long`, `send-stream` |
| Thread side panel (`board/side-chat.tsx`, `board/work-panel.tsx`, `chief/chief-drawer.tsx`) | Chat side panel (files and tools) and the artifact panel | `chat-long`, `artifact` |
| Tool and thinking rows in a thread | Web-search tool block (`Searching the web`, then `Searched the web`, expandable) | `tool-search` |
| Settings pages (`settings/`, `routes/account-page.tsx`, `routes/api-keys-page.tsx`, `routes/team-page.tsx`, `routes/remote-access-page.tsx`, `pages/project-settings-page.tsx`) | Settings dialog: left nav, rows with label left and control right; an inset sheet at 375 | `settings` |
| Project list and project home (`pages/project-page.tsx`, `board/project-home.tsx`) | Projects page: serif title, New project, two-column cards | `projects` |
| Search (`search/`) | Search palette, Ctrl+K | `search-palette` |
| Menus (`board/sidebar-project-menu.tsx`, `board/thread-actions.tsx`, `chief/project-menu.tsx`, model pickers) | Composer `+` menu, model menu; a bottom sheet at 375 | `shell` |
| Dialogs (`DialogShell`, `chief/edit-charter-dialog.tsx`, `board/reset-confirm-dialog.tsx`) | Settings dialog chrome | `shell`, `settings` |
| Tooltips (rule C4) | Composer and action-row tooltips | `shell`, `chat-long`, `focus` |
| No counterpart: needs-you tray and question card, board and activity, machines and computer feed, diff and review | Apply the component rules in section 8; keep the t3code and Amp references in `docs/design/references/` for structure | none |

## 2. Typesetting (checklist 1)

| Item | claude.ai (measured) | cairn now | Rule |
|---|---|---|---|
| Families | UI `anthropic-sans`; reading (reply prose, greeting, page titles) `anthropic-serif`; code `anthropic-mono`; CJK falls back to PingFang SC, Microsoft YaHei or Noto Sans CJK SC inside the same stacks (`--font-cjk-serif-fallback`) | Instrument Sans, Source Serif 4, JetBrains Mono; reply prose is sans | Keep the open fonts in the same roles: Instrument Sans UI, Source Serif 4 for reply prose, greeting and page titles, JetBrains Mono for code. Reply prose moves to serif. |
| Weights in use | 400 (90 text nodes), 435 (97, controls), 600 (12, bold and reply headings), 520 (10, section labels and dialog titles), 500 (3), 360 (greeting) | 450, 500, 600, 650, 700 | Four weights: 400 body, 450 controls, 500 titles and labels, 600 bold. No 650 or 700. |
| Size and line-height pairs in use (1440 dark, shell, chat and settings) | 14/21 (78), 14/20 (47), 15/21 (35), 12/20, 12/18, 13/19, 13/17, 15/20, 32/38.4 | 14/20, 14/24, 12/16, 13/18, 15/22.5, 20/26, 17/24, 16/22, 26/32 | UI 14/20; rows 14/21; reading and user text 15/21; meta 13/18; caption 12/18; sidebar section label 12/20; one display size per page. |
| Page title | serif 24/32, 500 (`Projects`) | 20/26 sans | serif 24/32, 500 |
| Greeting | serif 32/38.4, weight 360 | Source Serif 26/32, 600, letter-spacing -0.26px | serif 32/38, 400 (lightest open weight), letter-spacing 0 |
| Section title (settings, dialog) | sans 15/20, 520 | 17/24 | 15/20, 500 |
| Sidebar section label | sans 12/20, 520 | 12/16 | 12/20, 500 |
| Body text in reply | serif 15/21, 400 | sans 15/22.5, 450 | serif 15/21, 400 |
| Reply headings | same 15px as body, 600, 22.5px (1.5em) space above | 17/24 h2 | headings grow by weight only: 15px, 600, 1.5em above |
| Secondary text | 13/17 to 14/20, text secondary | 13/18 | 13/18 secondary |
| Code block | mono 14/22.75 (1.625) | 13/20 | mono 14/22.75 |
| Inline code | mono 13.5, fill white 7.5% (dark) or black 5% (light), radius 4, padding 1px 4px | 13px, fill `#2a302b`, radius 4 | mono 0.9em, alpha fill, radius 4, padding 1px 4px |
| Numbers | proportional, same family as surrounding text | same | no tabular figures except in tables of numbers |
| Letter-spacing | `normal` on every text node (214 of 214 in 1440 dark) | normal except -0.26px greeting and -0.35px one title | `normal` everywhere |
| Paragraph spacing | paragraphs carry no margin and are separated by about 0.75em (11 to 13px measured) | 6.5px and 14.5px | 0.75em between paragraphs |
| Lists | `ul` padding-left 30px, margin-top 11.25px (0.75em), `li` padding-left 7.5px, disc bullets, no extra item margin | different indent per renderer | 30px indent, 0.5em text gap, disc, 0.75em before the list |
| Reading measure | column 768px (`--transcript-measure`), reply paragraphs 736px wide with a 56px right inset, so about 680px of text | 728px column, no inset | 768px column, 680px of text |
| CJK next to Latin | the same 15/21 metrics for CJK and Latin in one paragraph; `lang` is `en-US` and the CJK fallback fonts render the Chinese; no extra letter-spacing | `text-autospace: normal` on body | one line-height for mixed text; keep `text-autospace` (a cairn addition, absent in claude.ai) |
| Truncation and wrapping | sidebar rows truncate on one line with an ellipsis; header titles truncate; prose wraps with `overflow-wrap` | same for rows | rows one line with ellipsis; prose wraps |

## 3. Lines and separators (checklist 2)

| Item | claude.ai (measured) | cairn now | Rule |
|---|---|---|---|
| Hairline thickness | 0.8px CSS on a 1.25 DPR screen: one device pixel | 1px CSS | one device pixel (`--hairline` already does this on high-DPR screens) |
| Sidebar edge | right hairline, white 10% (dark), black 8% (light) | none | right hairline 10% |
| Side panel edge | left hairline 10% | border in a theme color | left hairline 10% |
| Code block | outline hairline white 4% plus fill `#303030` at 50% | fill only | hairline 4% plus fill |
| Table | header bottom hairline 10%, no outer border, no column lines, cells 7.5px vertical and 0 horizontal padding | n/a | same |
| Menu separator | 1px, white 10%, inset 10px, 4px below | none | same |
| Dialog edge | hairline white 5% (dark), ring black 8% (light) | none | same |
| Settings rows | a faint hairline on top of each row, white 5% | card borders | rows with a 5% top hairline, no card |
| Divider rhythm in lists | sidebar and menu lists have no dividers; separation is spacing | thread groups use headers | no dividers between rows |
| Surfaces with outlines | code blocks, dialogs, jump button, composer (inset 1px ring 8%), popovers (inset 1px ring 4%) | inputs and selects (1px solid gray) | outlines only there; inputs and selects use a fill, not a border |
| Focus ring | 2.4px solid blue `rgb(81,156,237)`, offset 0, on keyboard focus; the control's tooltip also opens (`1440-light/focus#tab-2`) | 2px solid green `rgb(156,199,139)`, offset 2px | 2.4px ring in `--focus-ring`, offset 0, tooltip opens on focus |

## 4. Layout (checklist 3)

| Item | claude.ai (measured) | cairn now | Rule |
|---|---|---|---|
| Sidebar width | 288px; rows inset 8px, 32px tall, radius 8 | 248px, padding 12, rows 28px | 288px, 8px inset, 32px rows |
| Conversation column | 768px | 728px | 768px |
| Side panel | 320px, pushes the transcript left | overlay drawer | 320px, pushes |
| Header | 45px tall, title left, panel toggle and Share right | 48px | 45px |
| Outer margins | composer 16px from the edges at 375; desktop column centered | 16px at 375 | same |
| Vertical rhythm | user bubble to the first reply line 36px; the action row sits directly under the reply | 16 to 24px | 36px between a user turn and the reply |
| Alignment | user bubble right-aligned to the column edge; reply text starts 4px inside the column; composer edges align with the column | bubble right-aligned | same |
| Composer | 656px wide on new chat, centered under the greeting; in a chat it sits at the bottom of the column | 728px, bottom | 656px on the empty page, column width in a chat |
| Empty space | new chat is a greeting, one composer and a quiet artifact strip; nothing else | greeting, date line, starters, banners | one greeting, one composer, at most one quiet strip |

## 5. Surfaces (checklist 4)

| Item | claude.ai dark | claude.ai light | cairn dark now | Rule |
|---|---|---|---|---|
| Layers | page `#191919`, sidebar `#1f1f1f`, raised `#303030` | page `#ffffff`, sidebar `#fafafa`, raised `#ffffff` | 16 backgrounds in use, green-tinted (`#141715`, `#222723`, `#262c27`, `#2a302b`) | three neutral layers |
| Dialog | `#1f1f1f`, radius 12, 1024x800 | `#ffffff` | `#1b1f1c`, radius 14, 1216x852 | sidebar color, radius 12, 1024 max |
| Menu | `#303030`, radius 14, 250 to 320 wide, items 28px radius 8 padding 4px 10px | white | `#262b27`, radius 12, padding 4, items up to 48px | as claude.ai |
| Cards | project cards: 3% white fill, radius 12, padding 16, no border, no shadow | black 3% | radius 14, filled `#222723` | alpha fill, radius 12, no border |
| Radii in use | 4 (inline code), 6 (24px icon buttons), 8 (rows, buttons, inputs), 12 (cards, bubbles, code, dialogs), 14 (composer, menus), 20 (search palette), full (jump button, switch) | same | 8, 12, 14, 18, full | the claude.ai set |
| Shadows | floating layers only: menu and popover (inset ring 4%, `0 8px 24px` black 32%, `0 2px 6px` black 20%); composer (`0 4px 20px` black 7.5%, inset ring 8%); dialog (`0 1px 2px` 6%, `0 2px 8px` black 24%); jump button (`0 2px 4px` 7%, `0 6px 16px` black 24%) | same at lower alpha | none on most layers | shadows on those layers only; never on hover |

## 6. Color (checklist 5)

| Item | claude.ai (measured) | cairn now | Rule |
|---|---|---|---|
| Palette count, 1440 dark (shell, chat, settings) | 5 text colors, 14 backgrounds; all neutral except the blue switch and focus ring and the clay send button | 6 text colors, 16 backgrounds, green-tinted neutrals plus ochre | neutrals plus ochre and the green dot |
| Text levels, dark | white 93% primary, 57% secondary, 40% muted | `#e6e8e2`, `#b4bab3`, `#a3aaa4` | white 93 / 57%; muted text clamps to `#999999`, the lowest value with 4.5:1 on the raised layer (rule A3); 40% only for placeholders and decorative icons |
| Text levels, light | black 90 / 60 / 47% | `#1d231f`, `#4b534d`, `#5f665f` | black 90 / 60%; muted text clamps to `#6b6b6b` (4.5:1 on `#f2f2f2`); 47% only for placeholders and decorative icons |
| Hover and selection | hover white 7.5% (dark) or black 5% (light); selected row white 15% or black 10%; segmented track 5% | `rgba(230,232,226,.05)` hover, `.09` active | the claude.ai alphas |
| Accent | clay `#d97757` on the send button and brand mark only; blue for the switch-on state and focus | ochre for needs-you, green dot for running | ochre stays the one accent (V5); switch-on uses it; no blue |
| Status | not visible in the mapped pages except a project icon color | ochre, green, rust | keep V5 |
| Light and dark | every fill is an alpha of white (dark) or black (light) over three neutral layers | separate hex values per theme | alphas over three layers |

## 7. Iconography (checklist 6)

| Item | claude.ai (measured) | cairn now | Rule |
|---|---|---|---|
| Set | an icon font (`Anthropicons`) at 20px in nav, composer and actions, plus a few inline SVGs | lucide SVG | keep lucide (V9) |
| Sizes | 20px glyphs in a 28 or 32px target; 16px inside 24px action buttons; SVGs 20x20, 16x16, 32x32 | 16 (34 icons), 13, 14, 18 | 20px in nav and composer, 16px in 24px action buttons |
| Stroke | SVG stroke 1.25px | 1.75px | 1.5px for 20px lucide icons, the closest open match; one value per size (V14) |
| Color | the text color of the control; 57% secondary in action rows | ink ladder | same |
| Baseline | icons centered in a square target, label 4 to 8px after the icon | same | same |

## 8. Components (checklist 7)

| Component | claude.ai (measured) | cairn now | Rule |
|---|---|---|---|
| Sidebar row | 32px, radius 8, 14/21 400, full-row hover fill, `More options` 24px button on hover | 28px, 450, 150ms transitions | claude.ai |
| Composer | `#303030`, radius 14, padding 8, inset ring, 15/21 input, 28px icon buttons radius 8, model and effort as text under it | `#222723`, padding 12/14, 15/22.5 | claude.ai |
| Button, primary | 28px, radius 8, `#efefef` fill and `#191919` text (dark), padding 0 9px | 32px, filled, 500 | 28px, radius 8, padding 0 9px |
| Button, ghost and icon | 28px, radius 8 (24px, radius 6 in action rows), no fill until hover | 32px | claude.ai |
| Input | 28px, radius 8, white 5% fill with an inset ring 4% (dark), white 50% with ring 8% (light) | 32px, 1px gray border, 30% fill | claude.ai |
| Select | ghost in settings rows: value text plus chevron, no box; filled variant 28px | bordered 32px | ghost in settings rows |
| Switch | 36x20, full radius, accent fill when on | 36x20, gray | accent when on |
| Segmented control | track white 5%, 80x28, thumbs 26px radius 6 | tabs | claude.ai |
| Tabs | none in the mapped pages; segmented controls and nav lists cover them | SegmentedTabs | segmented control |
| Chips | the model and effort line is plain text buttons, not chips | chips on the composer line | text buttons |
| Menu | section 5; items 28px; descriptions 12 to 13px secondary; at 375 a full-width bottom sheet with 15/22 items | 320px popover at 375 | claude.ai, bottom sheet at 375 |
| Dialog | section 5; at 375 inset 16px with radius 12 | full screen, radius 0 | claude.ai |
| Tooltip | small dark chip; about 300ms after hover, at once on keyboard focus; label plus shortcut | about the same | 300ms delay, at once on focus |
| Code block | language label 12/17 secondary above the code; copy button appears on hover at the top right | different chrome | claude.ai |
| Tool and thinking block | one quiet row: `Searching the web` (status role) while running, then `Searched the web` with the query; expands on click | progress rows and cards | one quiet row per tool call, expandable |
| Avatars | none in the transcript; the account avatar only in the sidebar footer | none | none |
| Badges | none in the mapped pages | needs-you count | only the needs-you count (V15) |
| Jump button | 36px round, `#303030` at 80%, hairline 4%, shadow, fades in and out over 200ms | 32px, no border | claude.ai |
| Empty state | side panel: an illustration (not copied), `Nothing here yet`, one line `Files Claude makes and tools it uses will show up here.` | EmptyState | one title and one sentence, no illustration (C12) |
| Loading | settings content shows skeleton blocks in the final row shapes while the nav is already usable | skeletons | same (A4) |
| Error | not triggered in this pass | C5 mapping | keep C5 |

## 9. Interaction and motion (checklist 8)

All times come from the probe logs (`analysis.json` per step), measured from the input that caused the change.

| Interaction | claude.ai | cairn now | Rule | Source |
|---|---|---|---|---|
| Row hover (sidebar, menu item) | the fill changes within one frame (under 6ms); no transition on the fill | 133 to 150ms color and background transitions | instant fill | `1440-dark/shell#hover-sidebar-rows`, `#hover-model-menu` |
| Icon button hover | inner fill instant; color and box-shadow 60ms | 150ms | instant fill, 60ms color | `1440-dark/shell#hover-composer-plus` |
| Press | inner element scales to 0.975; release springs back over 450ms; the trigger's ring eases out over about 220ms | none | claude.ai | `1440-dark/shell#press-composer-plus` |
| Tooltip | appears about 300ms after hover and fades in over about 50ms | similar | 300ms delay, 50ms fade | `1440-dark/shell#hover-composer-plus` |
| Hover reveals | message timestamp fades in over 56ms, the action row over about 120ms, no layout shift | instant | fade under 120ms, no layout | `1440-dark/chat-long#hover-reply-actions` |
| Menu open | no animation: full opacity in the first frame | 67 to 83ms fade plus scale 0.99 and blur | no animation | `1440-dark/shell#open-model-menu` |
| Menu close | removed at once; focus returns to the trigger | 133ms | at once | `1440-dark/shell#close-model-menu` |
| Dialog open | opacity and scale ease in over 250 to 330ms with a fast start (55% at 95ms) | 200ms side slide | opacity and scale from 0.98, 250ms, ease-out | `1440-dark/shell#open-settings-dialog` |
| Dialog close | about 200ms, same curve | 200ms | 200ms | `1440-dark/shell#close-settings-dialog` |
| Search palette | opens at once; closes with a 150 to 220ms fade | 117ms fade and scale both ways | open at once, close 150ms fade | `1440-dark/search-palette` |
| Side panel and artifact panel | open and close within one frame, pushing the transcript | 150ms | instant | `1440-dark/chat-long#open-side-panel`, `1440-dark/artifact` |
| Sidebar collapse | instant layout change; only the composer placeholder re-fades | instant | instant | `1440-dark/shell#collapse-sidebar` |
| Wheel scroll | browser smooth scrolling, about 350 to 500ms per wheel burst | same | browser default | `1440-dark/chat-long#scroll-up` |
| Jump to latest | one scroll event straight to the bottom about 130ms after the click; the button fades out over 200ms | smooth scroll from 164 to 898ms | one jump, no smooth scroll | `1440-dark/chat-long#jump-to-latest` |
| Streaming | the reply grows in chunks; each chunk fades in over about 330ms; the view does not follow the stream, and a jump button appears | static fixture (no live agent in the capture stack) | chunk fade about 300ms, no auto-follow | `1440-dark/send-stream#stream` |
| Typing in the composer | no animation; the placeholder hides with the first character | same | same | `1440-dark/shell#type-composer` |
| Tool block | the status row updates in place; expand and collapse are instant | n/a | instant | `1440-dark/tool-search` |
| Focus | the ring transitions in about 60 to 95ms; the tooltip opens | instant ring | ring under 100ms | `1440-light/focus` |
| Drag and resize | none | panel resize | n/a | none |

## 10. Responsive (checklist 9)

| Item | 375 | 1440 |
|---|---|---|
| Sidebar | a drawer behind a top-left button; rows 44px tall (touch); the drawer covers the page | fixed 288px |
| Composer | 16px from the edges, same card and radius | 656px on new chat, column width in a chat |
| User bubble | max 85% of the column | max about 600px |
| Menus | full-width bottom sheet, 15/22 items | popover |
| Settings | inset sheet 16px from the edges, radius 12 | 1024 dialog |
| Jump button | 36px | 36px |

768 was not captured; it is the next capture to add.

## 11. Copy and tone (checklist 10)

| Item | claude.ai | Rule |
|---|---|---|
| Case | sentence case for every label and button (`New project`, `Scroll to bottom`, `Searched the web`) | sentence case |
| Length | labels are one to three words; descriptions one short sentence | same |
| Empty states | a title plus one sentence that says what will appear (`Nothing here yet` / `Files Claude makes and tools it uses will show up here.`) | title plus one sentence |
| Status | present participle while running (`Searching the web`), past tense when done (`Searched the web`) | the same pattern in `t()` strings |
| Tooltips | the action plus its shortcut (`Add files, connectors, and more /`) | same |

## 12. Differences to fix (phase 3 work queue)

From the style diff (`compare/<width>-<theme>/style-diff.md`), the motion comparison (`compare/<width>-<theme>/motion-compare.md`) and the side-by-side videos. Each line is fixed in phase 2 or 3 or kept with the reason given.

| Area | Difference | Plan |
|---|---|---|
| Color | green-tinted neutrals and 16 backgrounds versus three neutral layers and alphas | phase 2 tokens |
| Type | 9 size pairs, weights up to 700, sans reply prose, 17px headings | phase 2 type scale, phase 3 conversation |
| Sidebar | 248px, 28px rows, 150ms hover transitions, no edge hairline | phase 3 shell |
| Composer | padding 12/14, 22.5 line-height, no inset ring | phase 3 conversation |
| Menus | enter animation, items up to 48px, no separators | phase 2 component rules |
| Dialogs | 1216 wide, radius 14, side slide, full screen at 375 | phase 3 settings |
| Settings controls | bordered 32px inputs and selects, a card per group | phase 3 settings |
| Jump to latest | 734ms smooth scroll | phase 3 conversation (an in-flight lane PR already targets an instant jump) |
| Search palette | 117ms open animation | phase 2 component rules |
| Focus ring | green 2px with an offset | phase 2 tokens |
| Code block, tables, lists | different chrome and spacing | phase 3 conversation |
| User bubble | kept as the cairn gradient bubble | owner exception |
| Ochre accent, green dot | kept | V5 |

## 13. Blind review additions

A fresh sub-agent that had not seen this file watched only the side-by-side videos (`pairs/`) and listed every visible difference (`blind-review-findings.md` on the evidence branch). It confirmed the measured items above (colors and layer order, sans reply prose, focus ring, jump-to-latest, palette and dialog motion) and found these, which the role diff did not name; each joins the work queue.

| Area | Difference seen | Rule | Plan |
|---|---|---|---|
| Shell | cairn's main column is an inset rounded card on a darker canvas; claude.ai is one flat plane with the sidebar lighter than the page | one flat plane; sidebar one step lighter than the page in dark, one step darker in light | phase 3 shell |
| Sidebar collapse | cairn keeps a 40px icon rail; claude.ai removes the sidebar and recentres | no rail; a single toggle in the header | phase 3 shell |
| Message rhythm | about 60px between cairn messages | 36px between turns, 0.75em between paragraphs | phase 3 conversation |
| Tooltips | cairn's are cream with a caret, above the trigger, without shortcuts; claude.ai's are dark, below, with the shortcut | dark chip, below the trigger, label plus shortcut, no caret | phase 2 component rules |
| Search palette | claude.ai has filter chips, a close button, bold matched text, recents when empty, and refreshes results once typing pauses; cairn has a keycap footer and refreshes on every key | filter chips, close button, bold match, recents when empty, debounced results | phase 3 search |
| Jump button | cairn's is near-invisible and overlaps message text | raised fill, hairline, shadow; sits above the composer clear of text | phase 3 conversation |
| Row hover label | cairn's trailing hover label is drawn over the row title | trailing items fade the title under a mask or reserve no space when hidden (C3) | phase 3 shell |
| Reply actions | claude.ai: copy, read aloud, rate, retry under the latest reply; cairn: copy only, and at 375 under every message | the action row under the latest reply only; on touch the latest only (C11) | phase 3 conversation |
| Composer line | claude.ai shows project, model and mode as text under the composer and a one-line disclaimer in chats; cairn shows a setup chip inside and no model | model and mode as text under the composer; no disclaimer (cairn states connection per C8) | phase 3 conversation |
| Send button | claude.ai fills the send button with the accent; cairn shows a grey ghost arrow | send uses the one accent when enabled | phase 2 tokens |
| 375 | claude.ai drawer covers about 96% of the width, menus become bottom sheets, one composer; cairn drawer about 73%, popovers, two stacked composers plus Needs-you | 96% drawer, bottom-sheet menus, one composer | phase 3 shell and conversation |
| 375 settings | claude.ai inset sheet with pill tabs; cairn full page without section nav | inset sheet with pill tabs | phase 3 settings |
| Backdrops, light | settings backdrop about 40% (claude.ai) vs 60%; palette about 40% vs 25% | 40% black in light, 50% in dark | phase 2 tokens |
| Menus | claude.ai items carry icons and submenu chevrons and use separators | icons optional; separators between groups | phase 2 component rules |
| First scroll to top | claude.ai eases over about 450ms; cairn scrolls at a constant speed for about 850ms then snaps | browser default scrolling, no custom scroll animation | phase 3 conversation |
| Copy | claude.ai placeholders are short (`How can I help you today?`, `Reply`); greetings are warm and vary; empty states are friendly | short placeholders; empty states say what will appear, not system status (`Usage unavailable` becomes one plain sentence) | phase 3, copy pass |

Not counted: claude.ai-only steps (Projects page, model submenus, voice buttons, recent artifacts) and cairn-only features (Needs-you inline reply, Send-to target picker, thread side panel). The fixture badge over cairn's header and the static `Working · 1:12` timer are fixture artefacts of the capture stack, not product behavior.
