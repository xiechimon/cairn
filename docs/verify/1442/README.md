# #1442 evidence: axe-core gate over the main pages, and the violations it found

Environment: cloud session image, Chromium 141.0.7390.37, fixture build (`vite build --mode fixture`), `@axe-core/playwright` 4.13.0 / `axe-core` 4.13.0, tags `wcag2a wcag2aa wcag21a wcag21aa`. CI uses Chrome for Testing 153.

| file | what it shows |
|---|---|
| `axe-before.txt` | the gate on the code before the fixes (19 pages x 2 themes): 4 failed, 34 passed. `color-contrast` on `.composer-placeholder` (detail confirm, light) and `.composer-placeholder` + `.diff-hunk-head` (detail review, light); `button-name` (critical) on the agent detail selects, both themes |
| `axe-after.txt` | the same 38 tests after the fixes: 38 passed |
| `axe-after-x4.txt` | the same, `--repeat-each=4`: 152 passed |
| `tool-pill-before.txt` | the `detail tool calls` page added after code review, with the tool pill put back to `ink-3`: light fails `color-contrast` on `.chat-tool-pill > .truncate`, dark passes |
| `machine-detail-before.txt` | the `machine detail` page added after simplify review, with the evacuate select's `aria-label` removed: `button-name` (critical), 2 failed |
| `final-x3.txt` | the final gate (22 pages x 2 themes, parallel mode) with `agent-detail`, `hotkeys`, `registry-focus-ring` and `segmented-controls` (the specs sharing the changed helpers), `--repeat-each=3`: 423 passed |
| `e2e-affected-full.txt` | `pnpm e2e:affected` on the final tree, run on main `94fdb4c` plus this PR's two commits (full-suite fallback: `package.json` and the lockfile changed): 1159 passed, 0 failed |

Contrast, WCAG 2.x relative luminance from the token values in `src/styles/shadcn.css`:

```
light  ink-3 --text-tertiary  #746a5f on --secondary #ebe4d8: 4.19:1   (under 4.5)
light  ink-2 --text-secondary #5e564d on --secondary #ebe4d8: 5.70:1
dark   ink-3 --text-tertiary  #aca7a0 on --secondary #3c3732: 4.92:1
dark   ink-2 --text-secondary #c5c0b9 on --secondary #3c3732: 6.51:1
```

axe does not check `::placeholder` contrast, so the native placeholders (detail composer, chief composer) moved to `ink-2` on the DESIGN.md rule, not on a scan result.
