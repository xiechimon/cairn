# Completion footer alignment

Baseline: 3aea99f2208896d6e2b26ac7427d6d7ce393d090 on lane/2423.
The after images use that revision plus this issue's working-tree changes.

Eight PNGs compare before/after at 1440 x 900 desktop (mouse) and 390 x 844
phone (hasTouch enabled), in light and dark themes. They show the compiled
fixture build at scenario=28, task 7ve0iOkQ-JBpSL98zSiGc, scrolled to the plan
completion footer. These are fixture screenshots, not live daemon evidence.

The original browser regression failed in all four configurations: desktop
completion text was offset 27px, the copy control preceded it, and the label
had a 1px left border and 8px left padding. Phone also retained the copy
control's 44px touch target before the label.

Reproduce with the repository heavy-slot runner:

```sh
FOOTER_SCREENSHOT_PHASE=after flock /tmp/cairn-heavy.lock node scripts/heavy-slots.mjs run -- pnpm --filter @cairn/web e2e footer-copy.spec.ts
```

The regression checks left alignment within 1px, copy ordering, computed
border/padding, desktop idle/hover visibility, touch visibility, keyboard
focus, and label stability. Existing clipboard checks cover robot, plan and
work-block copies. Copy-only robot rows remain covered by scenario=28.

## Results

- Before: four new layout cases failed; four existing cases passed.
- After: all eight browser cases passed against rebuilt fixture assets.
- `pnpm lint`, `pnpm typecheck`, and `pnpm spec:parse` passed.
- English-only and comment-discipline gates both reported zero.
- `scripts/single-use-helper-gate.mjs` is absent in this checkout; invoking
  the requested command failed with MODULE_NOT_FOUND.

The code review checked all ActionRow consumers: stamps still precede copies,
copy-only rows retain their contents, and timed/bare/elapsed-only labels all
share the same border-free first position. Browser coverage here exercises
the timed plan and copy-only robot paths; no isolated live stack was started.
- `flock /tmp/cairn-heavy.lock node scripts/prepush-vitest.mjs` exited 0;
  changed-file selection found no Vitest test files. The eight Playwright
  cases above supply the runtime regression coverage.
- All eight screenshots were visually inspected. Playwright-managed preview
  servers ended with their runs; no separate live or development server was
  started.
