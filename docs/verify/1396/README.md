# Dark Paper round (#1396): evidence

The dark theme (`:root`) on the Paper ladder from `apps/web/DESIGN.md`
`colors-dark`. Light values are untouched; `fixture/*-light-*` and the probe
JSON show the same light colours before and after.

| file | what |
| --- | --- |
| `palette.mjs` | the palette in OKLCH (hue 70 neutrals, lifted accent and greens), converted to sRGB; prints every text / non-text pair with its WCAG 2.x ratio and gate |
| `contrast.txt` | `node palette.mjs` output; all gated pairs pass, white-on-accent listed as the rejected option (2.32) |
| `mockup-*.png` | the six views of `apps/web/docs/board-paper-dark.html` (`shoot-mockup.mjs`), approved 2026-10-21 before any token change |
| `fixture/{before,after}-{dark,light}-*.png` | vite dev with `?scenario=` (no dist), 1440x900: board (board-overflow), detail (26), account (13), resources (06), new-task dialog (01, opened by click), user menu (27d), more menu (27, opened by click). before = main faed603d, after = this branch |
| `fixture/*-probe.json` | runtime token values plus the painted background of sidebar / sheet / card / body |
| `live/{dark,light}-*.png` | verify-pacman stack (server 8791, vite dev 5273, fresh library): task created through the sidebar button, detail opened from its card, user menu opened from the user row, account page; `dark-flip-*` are the real 外观 clicks (浅色 then 深色) inside the menu |
| `live/live-probe.json` | painted colours per theme and across the flip |
| `e2e-affected.log` | `pnpm --filter @pacman/web e2e:affected` (shared styles changed, so the full web suite ran: 1085 passed) |
| `verified-before.txt` / `verified-after.txt` | the four re-pinned specs (color-freeze, accent-typo, segmented-controls, spec-brief-card) run with main's `shadcn.css` / `tokens.css` in place (failing) and with this branch's (passing), `E2E_PORT=8398` |

Re-run:

    node docs/verify/1396/capture.mjs <before|after> http://localhost:5300
    node docs/verify/1396/live.mjs http://127.0.0.1:5273
    node docs/verify/1396/shoot-mockup.mjs

Painted layers, dark (`fixture/after-probe.json`): sidebar rgb(26, 22, 18) =
canvas, sheet rgb(36, 32, 27), card rgb(47, 42, 38). Before: sidebar
oklab(0.24 ...) lighter than the sheet rgb(31, 27, 24), card rgb(38, 34, 31).
