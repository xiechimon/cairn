# Sidebar compatibility brief

Surface: thread list and sidebar.
Goal: fix the failing e2e gate without changing the existing 20px sidebar wordmark contract.
Rules: `apps/web/DESIGN-RULES.md` V1, V2, V13 and C4; `apps/web/DESIGN.md` brand role.

References opened before coding:

- `docs/design/references/coordinator-chat/claude-ai-empty-composer.jpg`: compact serif identity beside the sidebar toggle.
- `docs/design/references/thread-list-sidebar/t3code-empty-sidebar-new-thread.jpg`: quiet, narrow navigation shell rather than a page-heading-sized brand.

Draft: exempt, existing-screen compatibility fix rather than a new feature.

## Diagnosis and decision

Main merged #3420's serif wordmark using `text-page` and #3400's change of the page-title token to 24px. The existing light/dark header tests still require 20px, matching the documented brand role. On the integrated source, both fail at 24px; the other 22 accent tests pass. Preserve both PRs' intended changes: give the wordmark its own brand-size token, leaving page titles at 24px, typography, toggle position, logo removal and all test assertions unchanged. Do not rewrite snapshots.

Overlap was checked before editing. Open #3426 owns broader serif application and #3428 owns logo design; neither is replaced by this token-only compatibility fix.

## Component x state coverage

| Component | Empty | Loading | Error | Offline | Long content | Pending question | 390px | Dark |
|---|---|---|---|---|---|---|---|---|
| Existing sidebar wordmark | [Real empty stack](sidebar-compat/1440-light.png) | No independent loading state; same static label | No independent error state; same static label | [Scratch offline machine](sidebar-compat/1440-dark.png), generic name seeded before capture | Fixed brand text, unchanged truncation | No question-dependent variant | [Open navigation](sidebar-compat/390-light.png); rail toggle covered by e2e | [Phone dark](sidebar-compat/390-dark.png) and dark header regression |

## Reference comparison and acceptance

[Desktop light](sidebar-reference/1440-light.png), [desktop dark](sidebar-reference/1440-dark.png), [phone light](sidebar-reference/390-light.png) and [phone dark](sidebar-reference/390-dark.png) place the reference sidebar on the left and our corresponding real-stack sidebar on the right. Crops exclude unrelated reference-product content.

| State | Reference | Ours | Difference |
|---|---|---|---|
| Desktop light | Claude.ai empty composer, listed above | [1440px light](sidebar-compat/1440-light.png) | Compact serif wordmark; our sidebar remains roomier and less dense. |
| Desktop dark | Same identity reference; no dark variant supplied | [1440px dark](sidebar-compat/1440-dark.png) | Same neutral identity in dark; reference density remains better. |
| Phone light | t3code empty sidebar, listed above | [390px light](sidebar-compat/390-light.png) | Existing overlay navigation, compact wordmark; our empty project area is less informative. |
| Phone dark | Same sidebar reference; no phone/dark variant supplied | [390px dark](sidebar-compat/390-dark.png) | Same readable identity; overlay retains the existing large empty area. |

The unchanged four focused sidebar/header specs pass all 50 tests. Both header regressions first failed at 24px before the brand token fix. Runtime measurements in `sidebar-compat/result.json` show 20px Source Serif 4 and no horizontal overflow in all four captures; the 24px page-title token is unchanged. V1/V2 checked by tokens and computed font, C4 by existing toggle checks. V13's role size is measured, but the whole-screen type-budget audit is not claimed.

A broader five-file run passed 55 tests and failed both gallery baseline tests, including numerous specimens that do not render the sidebar. Those local rendering differences remain unclassified. No snapshot or assertion was changed; the latest CI result remains authoritative. `vitest --changed` passed 8 tests; lint, typecheck, spec parsing and all 23 prepush checks passed. Evidence came from an isolated real stack, not fixture URLs; its machine name was changed to a generic value only inside that scratch database. The stack was cleaned up after capture.
