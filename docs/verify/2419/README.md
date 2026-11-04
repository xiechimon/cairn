# Issue 2419: narrow detail header

Measured on branch `lane/2419`, starting at `8a514d4fe2fc9b8d7f8d727a39366c87cbe68fe6`.

At 390px the review title grows from 82px to 184px. All four header controls are 32px tall, with 9.5px above and 10.5px below inside the header; the outermost controls have 12px horizontal clearance. The desktop geometry remains unchanged. Status and primary-action accessible names remain available, and both the assignment popover and completion dialog open.

## Negative control

The test was added before implementation. Scenario 26 has no primary action, so the new gate uses the existing review fixture, scenario 27, while N1-N5 keep scenario 26.

The recorded negative-control run temporarily restored both `apps/web/src/detail/dhead.tsx` and `apps/web/src/styles/app.css` from `64770927`. The rest of the checkout remained at the starting revision. Both 390px cases failed, with the title at 82px and controls extending 0.5px above the header; both desktop cases passed. The fixed files were restored after the run. This is an audit-base header-source negative control, not a full checkout of the audit revision.

See [red output](red.log), [red geometry](red-geometry.json), [green output](green.log), and [green geometry](green-geometry.json).

## Screenshots

- Phone, light: [before](before-390-light.png), [after](after-390-light.png).
- Phone, dark: [before](before-390-dark.png), [after](after-390-dark.png).
- Desktop, light: [before](before-1440-light.png), [after](after-1440-light.png).
- Desktop, dark: [before](before-1440-dark.png), [after](after-1440-dark.png).

## Validation

The focused Playwright run passed 13 tests: all nine detail-narrow cases, plus mobile M3 and M7 at 360px and 390px. M3 now asserts the explicitly requested 32px header controls while retaining its 44px composer assertion. Screenshots and runtime geometry come from the compiled fixture build. All E2E runs used `flock /tmp/cairn-heavy.lock node scripts/heavy-slots.mjs run -- pnpm --filter @cairn/web exec playwright test ...`.

`pnpm lint`, `pnpm typecheck`, and `pnpm spec:parse` passed. `node scripts/prepush-vitest.mjs` exited zero with no related unit tests selected. The English-only and comment-discipline gates reported zero. The requested `scripts/single-use-helper-gate.mjs` does not exist in this checkout, so that command could not run. No helper was introduced. Full E2E and CI have not been run; no PR was opened or pushed.

Open PR #2398 also changes `app.css`; its typography lines were preserved. Recently merged PR #2390 adds unrelated styles, all preserved. The existing lockfile modification was left untouched. No servers remain from these runs.
