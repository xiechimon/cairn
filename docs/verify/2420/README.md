# Issue 2420: English count grammar

The English dictionary now uses the existing `{count#one|other}` syntax for count-dependent nouns. `translate()` selects the English cardinal category through a shared `Intl.PluralRules('en')` instance. Only numbers enter plural selection; numeric strings continue to use the other branch. Missing variables, Chinese source rendering and fallback lookup retain their existing behavior.

## Red and green evidence

- [Initial red run](red.log): tests were added before production changes; the dictionary gate and real member rendering fail, as does the negative-one cardinal boundary.
- [Audit-base red run](audit-base-red.log): the plural coverage tests ran with `apps/web/src/i18n/en.ts` temporarily replaced by `git show 64770927:apps/web/src/i18n/en.ts`. Both audit defects appear in the failures. The rest of the checkout stayed current, so this is a dictionary negative control, not a full checkout test of the audit commit.
- [Green unit run](green.log): both i18n test files pass after the fix.

The gate checks every unbranched `{var} words` occurrence independently, so a singular branch elsewhere cannot hide a missing one. The English verbs `is`, `has` and `expires` are excluded from the noun suffix check. Explicit negative controls pin the original members and running-tasks values.

## Browser screenshots

The before captures use the audit-base English dictionary and assert the original `1 members` / `1 tasks running` text. The dictionary was restored after capture. The after captures use the fixed dictionary and assert `1 member` / `1 task running`. Home uses the existing API mock with one running task and zero merged tasks; Team uses the existing single-member fixture. These are rendered application surfaces with controlled data, not live account evidence.

- Home, 1440px, light: [before](before-home-1440-light.png), [after](after-home-1440-light.png).
- Team, 1440px, light: [before](before-team-1440-light.png), [after](after-team-1440-light.png).
- Home, 1440px, dark: [before](before-home-1440-dark.png), [after](after-home-1440-dark.png).
- Team, 1440px, dark: [before](before-team-1440-dark.png), [after](after-team-1440-dark.png).
- Home, 390px, light: [before](before-home-390-light.png), [after](after-home-390-light.png).
- Team, 390px, light: [before](before-team-390-light.png), [after](after-team-390-light.png).
- Home, 390px, dark: [before](before-home-390-dark.png), [after](after-home-390-dark.png).
- Team, 390px, dark: [before](before-team-390-dark.png), [after](after-team-390-dark.png).

## Verification boundaries

The targeted locale browser spec covers one-member and one-running-task states at both widths in both themes, plural members and tasks, and retained Chinese rendering. The unit tests also cover zero, negative one, decimals, nonnumeric values, independent counts and missing interpolation variables.

Open PR #2357 overlaps in `apps/web/src/i18n/en.ts`; its archive and rename entries are untouched. This issue intentionally replaces the `value === 1` selector introduced by merged PR #2390 with `Intl.PluralRules`, retaining its template syntax and interpolation behavior.

The requested `scripts/single-use-helper-gate.mjs` does not exist in this checkout; invoking it reports `MODULE_NOT_FOUND`. No replacement gate or unrelated infrastructure was added.

## Final results

- `pnpm --filter @cairn/web exec vitest run test/i18n.test.ts test/i18n-coverage.test.ts`: 35 passed.
- `flock /tmp/cairn-heavy.lock node scripts/prepush-vitest.mjs`: [42 files, 338 tests passed](changed-vitest.log).
- The locale browser spec: [10 passed after the fix](browser-after.log); the before capture run: [4 passed while asserting the known defects](browser-before.log).
- `pnpm --filter @cairn/web e2e:affected` selected the full 211-spec suite, but the unsharded process ended with exit 143 before a completion summary. All 1,448 tests then passed in four sequential heavy-slot runs using the slot-generated Playwright config and its `E2E_DIST_DIR`: [373](e2e-shard-1.log), [369](e2e-shard-2.log), [345](e2e-shard-3.log), [361](e2e-shard-4.log). Each run was guarded by `flock /tmp/cairn-heavy.lock`.
- [Lint](lint.log), [typecheck](typecheck.log) and spec parsing passed. Typecheck ran under the heavy lock.
- `PREPUSH_BASE_SHA=HEAD flock /tmp/cairn-heavy.lock pnpm prepush`: [20 checks passed](prepush.log), including spec parsing, English-only and comment-discipline checks. The explicit base avoids fetching into the read-only Git directory.
- `node scripts/english-only-gate.mjs`: 0 lines with Chinese text.
- `node scripts/comment-discipline-gate.mjs`: 0 new comment lines.
- `git diff --check`: passed.

The Playwright-owned servers stopped when their runs completed. The requested single-use-helper check remains unavailable because its script is absent. No push was performed; the sandbox commit handoff is `COMMIT_MSG.txt` in the worktree root.
