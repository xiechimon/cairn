# #1448 evidence: e2e specs share pressUntil

Environment: cloud session image, Chromium 141.0.7390.37, fixture build. CI uses Chrome for Testing 153.

| file | what it shows |
|---|---|
| `press-until-probe.spec.ts.txt` | a throwaway spec (not committed under `e2e/`) driving `pressUntil` on the board |
| `press-until-probe.txt` | its run: a key that opens nothing throws `F9 never made getByRole('dialog', { name: '搜索' }) visible`; the `hidden` direction throws the same way while the panel stays up; Escape closes the panel through `state: 'hidden'`; a strict-mode wait error (`[data-testid]`, 21 elements) is rethrown after 1 press instead of being retried 6 times. 4 passed |
| `press-until-main-before.spec.ts.txt` / `press-until-main-before.txt` | the same strict-mode case against `pressUntil` as it stands on main `38dacbf`: `F9 never brought up locator('[data-testid]') \| presses: 6`. The real cause is swallowed and the key is pressed six times |
| `specs-x3.txt` | the eleven specs that call `pressUntil` (search-focus, search-result-rows, search-live-project-name, phase-chip-words, search-close-flash, cds-dialogs, avatar-dicebear, escape-wiring, overlay-focus, hotkeys, a11y-axe), `--repeat-each=3`: 345 passed |
| `e2e-affected-full.txt` | `pnpm e2e:affected` before the second review round, main `38dacbf` plus the first commit (full-suite fallback: `e2e/helpers.ts` is an unmapped web path): 1173 passed, 0 failed. The second round touched only `overlay-focus`, `hotkeys` and the `helpers.ts` docstring; `specs-x3.txt` is rerun on the final head |

Loops left as they are: `detail-esc.spec.ts` waits for a URL, not a locator. In `hotkeys.spec.ts`, `pressesStayClosed`, `pressesStayHidden` and the three ⌘↵ loops are negative checks: six presses must leave the surface closed.
