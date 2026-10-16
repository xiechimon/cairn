# Paper light-theme color tokens (PR 1 of apps/web/docs/paper-redesign-plan.md)

Light theme only. Viewport 1440x900, `localStorage['pacman-theme'] = 'light'`.

| file | what |
|---|---|
| `fixture/{before,after}-{board,detail,resources}.png` | fixture build (`vite build --mode fixture` + `vite preview`), scenarios 01 / 16 / 06 |
| `live/{before,after}-{board,detail,resources}.png` | verify-pacman live stack (server 8791, vite dev 5273, fresh library); task created through the sidebar New task button, detail opened by clicking its card |
| `*/{before,after}-focus-ring.png` | first keyboard-focused control after Tab, 2px `--focus-ring` outline |
| `*/{before,after}-probe.json` | runtime-resolved token values and the painted background of sidebar / board-main / board-column / todo-card / body |
| `contrast.txt` | WCAG 2.x ratios for the light pairs (`node contrast.mjs`) |
| `e2e-affected.log` | `pnpm --filter @pacman/web e2e:affected` (full-suite fallback, 976 passed) |

Re-run: `node docs/verify/paper-tokens/shoot.mjs <fixture|live> <origin> <before|after>`.
