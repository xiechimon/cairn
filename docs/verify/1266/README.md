# #1266 verify evidence — chief ⌘J close flash

Repro and verification recipe (all numbers in `luminance-timeline.md`):

1. Stack: fixture preview (`pnpm exec vite build --mode fixture && pnpm exec
   vite preview --port <P>`) or the isolated live verify stack
   (`.claude/skills/verify-pacman/scripts/launch.mjs`).
2. Drive 10 ⌘J open/close cycles at 700ms cadence while recording a CDP
   screencast (`Page.startScreencast`, everyNthFrame 1) and passive
   `transitionrun` / `animationstart` / `animationend` listeners on
   `.chief-drawer`. Do not read computed styles between a press and its
   assertion window: forced synchronous recalculation masks the flash.
3. Read the drawer-region mean luminance per painted frame. Broken build:
   every close shows a single-frame jump back to the open-state level
   (+12.04 dark fixture / +9.53 dark live) and one opacity `transitionrun`;
   fixed build and the pre-#1234 baseline show neither.
4. The CI gate for this is `apps/web/e2e/chief-toggle-flash.spec.ts`
   (passive listeners only; red on main, green on the fix).

Artifacts: `before-close-dark.gif`, `after-close-dark.gif`,
`spike-compare-dark.png`, `luminance-timeline.md`, `e2e-red-on-main.log`.
