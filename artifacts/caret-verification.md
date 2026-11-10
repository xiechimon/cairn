# Composer numeric-caret repair

Commit: 5a49b9ee792da171f2d10dedb4620e9c4e709a0c
PR: https://github.com/xiechimon/cairn/pull/3812

Changed production code: apps/web/src/overlay/mention-highlight.tsx copies fontVariantNumeric from the textarea to the visible mention mirror. Previously the textarea had tabular-nums but the visible mirror used normal numeral shaping.

## Tests-first evidence

Command: pnpm --filter @cairn/web exec playwright test e2e/composer-inline-mention.spec.ts --grep 'caret alignment' --workers=1

After correcting an initial expected middle-insertion string in the test itself, all four new browser tests failed before production code changed. Measured glyph-boundary drift was 31px at desktop and 34px at mobile, in both themes. Computed numeric features: mirror normal, textarea tabular-nums.

Command after repair: pnpm --filter @cairn/web exec playwright test e2e/composer-inline-mention.spec.ts --grep 'caret alignment|highlight:' --workers=1

Result: 8 passed. New tests type digits, move left, insert into the middle, compare every rendered glyph boundary to an otherwise identical probe with the textarea's numeric shaping, then check mixed CJK/Latin, explicit newline and wrapped long numeric content. Four viewport/theme combinations: 1440 and 390, light and dark. Each boundary must remain within 0.5px and computed numeric shaping must match. Existing mention insertion/deletion/highlight tests also pass.

## Checks

- pnpm lint: passed, 2227 files.
- pnpm typecheck: passed, all six workspace projects.
- pnpm spec:parse: passed, 1614 browser tests collected and 71 integration test files parsed.
- pnpm exec vitest run --changed: passed, 22 tests in two files.
- pnpm --filter @cairn/web e2e:affected: completed run, 225 passed, two gallery snapshot tests failed (light/dark, multiple specimens). Not claimed green and no baselines changed. Earlier invocation was interrupted by the command execution deadline before completion.
- pnpm prepush: passed, 23 checks. Actual pre-commit and push hooks also passed, no bypass.
- PR evidence/tasks/language body checks: passed.

## Evidence boundaries

Screenshots are real Chromium captures of compiled Cairn with stubbed API data, not a live backend. Before captures show short typed numbers; after captures show long mixed-content wrapping, so they are not an identical-content visual comparison. Both use the actual shipped textarea/mention components. No message was sent to a real agent. The Coordinator-specific route and live stack were not exercised. CI and cloud review remain pending at handoff.

Public evidence publication is blocked: the cairnwright App permissions query for xiechimon/cairn-evidence returns push=false. No personal credentials were substituted. The PR has coordinator-hold pending publication access and review of remaining validation gaps.
