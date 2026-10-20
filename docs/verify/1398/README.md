# Paper Chief area (#1398): evidence

The chief window, 总管设置 and the question card on the Paper values from
`apps/web/DESIGN.md`. Shots are 1440x900 at DPR 2, light and dark, from a
`vite build --mode fixture` bundle served by `vite preview` (before =
origin/main 89cc029, after = this branch). Window shots are clipped to the
floating window.

    node docs/verify/1398/capture.mjs <before|after> http://127.0.0.1:<port>

| shot | what it shows |
| --- | --- |
| `*-window-gated.png` | scenario 100: no agent bound, gate banner, hero, draft |
| `*-window-ready.png` | scenario 111: bound, hero |
| `*-window-thread.png` | scenario 114: report thread, 展开过程 opened |
| `*-window-switcher.png` | scenario 116: thread switcher open |
| `*-window-markdown.png` | scenario chief-md: markdown reply + typing row |
| `*-window-question.png` | scenario chief-question (new, after only): answered card + pending two-step card |
| `*-settings-agent.png` | scenario 101 |
| `*-settings-charter.png` | scenario 102 |
| `*-settings-memory.png` | scenario 103 |
| `*-settings-watches.png` | scenario 104 |

`before-metrics.json` / `after-metrics.json` hold the measured boxes. Light
theme, after vs before:

- window title: 16px 500 heading face (was 15px 600), 16px from the window edge (was 17).
- gate banner: 56px white card with a 1px ring and `--radius-card` 10px (was a 54px beige block, 14px corners); 设置 is the 32px primary button (was 50x26 at 12px).
- hero: 16px 500 heading (was 15px 600); example cards white with a 1px ring (was beige); icons bare in ink-3 (was a 24px tinted tile).
- thread switcher: Paper menu, 264 wide, 32px rows at 13.5px, current row on `menu-hover` (was 262 wide, 30px rows at 13px).
- stream: tool rows 11.5px (was 11px); notes and foot stay 12px on `text-meta`; message body 14px on `text-card-title`.
- composer: 13.5px (was 14px: the Textarea's `md:text-sm` overrode `text-[13px]`).
- 总管设置: the Paper top bar, 56px with a hairline, back link and an 18px serif title on the left (was a centered 15px title in a 57px header); body in the 768px column (was 766).
- Agent tab: one settings card of two 52px rows with a divider (was two beige blocks).
- 章程: the empty note sits in the settings card; 编辑 is the 32px primary button (was a 28px outline button).
- question card: white `--radius-card` card; status is icon + color + word (等你回答 in the accent, 已回答 / 已取消 in ink-3) instead of a pill; question 14px 500, options 13.5px, step header 11.5px.
- `apps/web/src/chief/` carries no arbitrary text or spacing values; the debt baseline drops from 43 text / 69 spacing to 16 / 15.

Dark shots keep the current dark palette; the dark pass is #1396.

Gate output: `gates.txt`. e2e: `e2e.txt`.
