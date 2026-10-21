# #1442 evidence: axe-core gate over the main pages, and the violations it found

Environment: cloud session image, Chromium 141.0.7390.37, fixture build (`vite build --mode fixture`), `@axe-core/playwright` 4.13.0 / `axe-core` 4.13.0, tags `wcag2a wcag2aa wcag21a wcag21aa`. CI uses Chrome for Testing 153.

| file | what it shows |
|---|---|
| `axe-before.txt` | the gate on the code before the fixes (19 pages x 2 themes): 4 failed, 34 passed. `color-contrast` on `.composer-placeholder` (detail confirm, light) and `.composer-placeholder` + `.diff-hunk-head` (detail review, light); `button-name` (critical) on the agent detail selects, both themes |
| `axe-after.txt` | the same 38 tests after the fixes: 38 passed |
| `axe-after-x4.txt` | the same, `--repeat-each=4`: 152 passed |
| `review-pages-before.txt` | the two pages added during review, on the final spec, with their fixes undone (tool pill back on `ink-3`, evacuate select without `aria-label`): `detail tool calls` light fails `color-contrast` on `.chat-tool-pill > .truncate` (dark passes); `machine detail` fails `button-name` (critical) in both themes. 3 failed, 1 passed |
| `final-x3.txt` | the final gate (22 pages x 2 themes, parallel mode) with the specs sharing the changed helpers or pages (`agent-detail`, `hotkeys`, `registry-focus-ring`, `segmented-controls`, `machine-detail`, `accent-typo`, `dialog-ring-room`), `--repeat-each=3`: 501 passed |
| `e2e-affected-full.txt` | `pnpm e2e:affected` before the second code-review round, run on main `94fdb4c` plus this PR's first two commits (full-suite fallback: `package.json` and the lockfile changed): 1159 passed, 0 failed. The round after it narrowed the change (`settleTransitions` back to main's body); `final-x3.txt` covers the touched specs |

Contrast, WCAG 2.x relative luminance from the token values in `src/styles/shadcn.css`:

```
light  ink-3 --text-tertiary  #746a5f on --secondary #ebe4d8: 4.19:1   (under 4.5)
light  ink-2 --text-secondary #5e564d on --secondary #ebe4d8: 5.70:1
dark   ink-3 --text-tertiary  #aca7a0 on --secondary #3c3732: 4.92:1
dark   ink-2 --text-secondary #c5c0b9 on --secondary #3c3732: 6.51:1
```

axe does not check `::placeholder` contrast, so the native placeholders (detail composer, chief composer) moved to `ink-2` on the DESIGN.md rule, not on a scan result.
