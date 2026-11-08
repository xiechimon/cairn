# Research: where claude.ai uses its serif, and where cairn should use Source Serif 4 (2026-11-08)

Question. ian likes the Source Serif 4 wordmark from PR #3420 and asked for the face across the web app "wherever it fits". Cairn follows claude.ai one-to-one, so the question is exactly where claude.ai uses its serif (`anthropic-serif`) versus its sans, with computed size, weight, line height and letter spacing, what it does with Chinese under the serif, and what the Source Serif 4 build that cairn ships can do.

Labels: 实测 = read or run first-hand this round; 推断 = derived from 实测, checkable; 猜测 = the rest.

Sources. claude.ai computed-style dumps and frames captured on 2026-11-07 under `~/.cache/cairn-design-capture/runs/*claude-ai-*/<scene>/dumps.json` (1440 and 375 px, light and dark; scenes shell, chat-long, send-stream, artifact, projects, settings, search-palette, focus, tool-search). The dumps hold every element's computed `fontFamily`, `fontSize`, `fontWeight`, `lineHeight`, `letterSpacing` and the page's CSS custom properties. claude.ai in the built-in browser on 2026-11-08: signed out (redirected to `/login`), so only the logged-out page was read and nothing was signed in. The cairn font files in `apps/web/public/fonts/` read with fontTools 4.x. t3code source at `pingdotgg/t3code@8e6a73230`. Linear's `linear.app/now` CSS.

## Summary

1. claude.ai has one serif token family (`--font-serif`, `--font-ui-serif`, `--font-voice`, `--font-claude-response`, all the same `anthropic-serif` chain) and uses it in exactly four places: the sidebar wordmark, the home greeting, full-page titles (the Projects page `h1`), and assistant response prose including its headings, bold, lists, tables and blockquotes (实测, dumps). Everything else is `anthropic-sans` or `anthropic-sans-display`: user messages, the composer, dialog titles, settings section and row titles, sidebar rows, menus, buttons and meta (实测). Code is `anthropic-mono` (实测).
2. The response face is a user setting. Settings → Appearance shows "Interface font: Default · Anthropic Sans" and "Response font: Anthropic Serif" (实测, settings frame 5 of the 1440 light run). The missing "Default ·" prefix on the response row means serif responses are the captured account's own choice, not necessarily the product default (推断). ian's own claude.ai reads replies in serif, so cairn follows that (推断: the capture is of ian's account).
3. Chinese under the serif is set in the sans CJK faces. The serif chain is `anthropic-serif, … Georgia, … "Times New Roman", Times, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", …` (实测, `--font-serif` value), and the response crop shows Latin and digits in serif with Chinese in a sans (实测, `~/.cache/serif-typography/claude/response-prose-light.png`). claude.ai also defines `--font-cjk-serif-sc` (`"Songti SC", "Noto Serif CJK SC", …`) but no captured element resolves to it (实测 for the captured scenes).
4. Cairn ships Source Serif 4 as a two-file latin and latin-ext subset with a single `wght` axis, 200 to 900, default 400; the `opsz` axis of the upstream variable font is not in the build, and it has no CJK glyphs (实测, fontTools). claude.ai's serif does use an `opsz` axis on its marketing headings (`"opsz" 48`, 实测 on the logged-out page), so cairn cannot copy optical sizing; it can copy weights.

## claude.ai serif versus sans, computed

| Surface | claude.ai family | Size / line height | Weight | Letter spacing | Evidence |
|---|---|---|---|---|---|
| Sidebar wordmark "Claude" (`font-voice`) | serif | 20px / 20px | 500 | normal | 实测, every scene, light and dark |
| Home greeting (`font-ui-serif font-[360] dark:[font-variation-settings:'wght'_320]`) | serif | 32px / 38.4px at 1440, 24px / 28.8px at 375 | 360 light; the class sets `wght` 320 in dark | normal | 实测, shell, focus, search-palette, settings scenes |
| Full-page title, Projects `h1` (`font-voice font-medium`, `--cds-page-header-title-size` 1.5rem) | serif | 24px / 32px | 500 | normal | 实测, projects scene, light and dark |
| Assistant response prose (`prose`, `p`, `li`, `ul`, `blockquote`, `table`, `td`) | serif | 15px / 21px | 400 | normal | 实测, chat-long, send-stream, artifact, tool-search |
| Headings and bold inside a response (`h3`, `strong`, `th`) | serif | 15px / 21px | 600 (`--cds-prose-weight-heading-serif` is 520) | normal | 实测 |
| Inline and block code inside a response | mono | 13.5px inline, 14px / 22.75px block | 400 | normal | 实测 |
| User message bubble | sans | 15px / 21px | 400 | normal | 实测 |
| Composer | sans | 15–16px | 400 | normal | 实测 |
| Settings dialog title (`font-header text-title`) | sans-display | 22px / 28px | 520 | normal | 实测 |
| Settings section heading and row title | sans | 15px / 20px | 520 | normal | 实测 |
| Artifact or side-panel title, chat header title | sans | 14–15px | 400–435 | normal | 实测 |
| Sidebar rows, menus, buttons, captions | sans | 11–14px | 400–435 | normal | 实测 |
| Logged-out marketing headings ("Meet Claude", "Explore plans") | serif | 20–38px | 300–400 with `opsz` 48 | normal | 实测, built-in browser, signed out |

## Prior art compared

| Source | How it uses a serif | Trade-off | Link |
|---|---|---|---|
| claude.ai | Serif for brand, greeting, page titles and (as a setting) response prose; sans for all chrome; CJK under the serif falls to sans CJK | Prose reads as "Claude's voice" apart from the UI; a setting lets readers opt out | 实测 dumps above; https://claude.ai |
| t3code | No serif in the product UI: `--font-sans` (Inter) and `--font-mono` only; `appearanceFonts.ts` lets the user override the sans and code stacks | Plain, but no distinct reading voice | 实测, https://github.com/pingdotgg/t3code/blob/8e6a73230/apps/web/src/index.css and apps/web/src/appearanceFonts.ts |
| Linear | `linear.app/now` CSS defines `--font-serif-display: "Tiempos Headline", ui-serif, Georgia, …` next to `--font-regular: "Inter Variable", …`, and no fetched rule references it | Serif kept to marketing display, the app is sans; the signed-in app was not opened because the built-in browser's Linear tab belongs to another session (blocked) | 实测 CSS, https://linear.app/now |
| Cairn before this change | Serif for the greeting and page titles at 600 with -0.01em, wordmark at 500 (#3420); Chinese under the serif falls to Songti SC / Noto Serif CJK SC; agent replies in Instrument Sans | Heavier than claude.ai's serif, and Chinese titles in Songti mix two serif designs | 实测, `apps/web/src/styles/fonts.css`, `apps/web/DESIGN.md` |

## Source Serif 4 as shipped

| File | Axes | Glyphs | CJK | GSUB features |
|---|---|---|---|---|
| `source-serif-4-latin-wght.woff2` | `wght` 200–400–900 | 331 | none | ccmp, dnom, frac, liga, locl, numr, pnum, tnum |
| `source-serif-4-latin-ext-wght.woff2` | `wght` 200–400–900 | 373 | none | ccmp, locl |

All 实测 with fontTools. `tnum` exists, so tabular digits stay available under the serif (实测).

## Decision for cairn

Follow claude.ai's split, keep cairn's own size scale (DESIGN.md's seven sizes were measured against Claude Code and are not part of this question), and take claude.ai's weights and tracking.

| Cairn surface | Role | Face | Size / line height | Weight | Tracking |
|---|---|---|---|---|---|
| Sidebar wordmark "Cairn" | `voice-title` | Source Serif 4 | 20px / 20px | 500 | normal |
| Coordinator greeting | `voice-greeting` | Source Serif 4 | 26px / 32px | 360 light, 320 dark | normal |
| Page titles: page shell `h1`, settings headers, Coordinator settings, project title menu | `voice-title` | Source Serif 4 | 20px / 26px | 500 | normal |
| Agent replies: Coordinator reply bubble, thread agent text and reports, with their headings, bold, lists and tables | `voice-response` | Source Serif 4 | 15px / 22.5px | 400 (headings and bold 600) | normal |
| Code, inline code, task cards, attachment and mention chips inside replies | unchanged | JetBrains Mono / Instrument Sans | unchanged | unchanged | unchanged |
| User messages, thinking, composer, dialog and pane titles, section headings, rows, meta | unchanged | Instrument Sans | unchanged | unchanged | unchanged |
| Chinese under the serif | font chain | PingFang SC → Hiragino Sans GB → Microsoft YaHei → Noto Sans CJK SC | inherits | inherits | inherits |

Why these weights. They are claude.ai's numbers: greeting 360 light and 320 dark, titles and wordmark 500, prose 400, prose headings and bold 600 (实测). Source Serif 4 was rendered at 320, 360, 400 and 450 in both themes next to claude.ai's greeting (`~/.cache/serif-typography/compare/greeting-weights-{light,dark}.png`); 360 and 320 keep the light, open stroke of claude.ai's greeting, while 400 and above read as a heavier display than claude.ai's (推断 from those crops; the crops differ in size, so stroke comparison is approximate).

Why sans CJK. claude.ai does it (实测), and the before/after crops show Songti beside Instrument Sans meta lines reading as two unrelated typefaces, while PingFang / Noto Sans CJK under Source Serif 4 matches claude.ai's response crop (推断 from `~/.cache/serif-typography/compare/*-zh.png`).

Code areas. `apps/web/src/styles/fonts.css` (serif chain), `apps/web/src/styles/shadcn.css` (`--voice-*-weight` tokens, light override), `apps/web/src/styles/app.css` (`voice-greeting`, `voice-title`, `voice-response` utilities), the components that carry each role (`components/stream/greeting.tsx`, `components/title-menu-trigger.tsx`, `components/settings-list.tsx`, `pages/shell.tsx`, `chief/chief-settings.tsx`, `board/sidebar.tsx`, `chief/chief-message-rows.tsx`, `detail/transcript.tsx`, `detail/chat-markdown.tsx`), the gallery specimens in `design/`, `apps/web/DESIGN.md` Typography, and `apps/web/test/serif-titles.test.ts`, which now fails when a component reaches the serif without a voice role or when the serif chain falls back to a CJK serif.

Open point for ian. The response serif follows his claude.ai setting, which claude.ai offers as a choice. Cairn has no reader font setting; if he wants sans replies back, removing `voice-response` from the two reply containers restores them.
