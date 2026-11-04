# Composer bottom spacing (#2421)

The Home and detail composers now consume `--composer-bottom-gap: 24px`.
Both margins use `max(var(--composer-bottom-gap), env(safe-area-inset-bottom))`.
The drawer variant retains its existing margin; horizontal insets and in-flow
transcript layout are unchanged.

## Failure modes and test-first evidence

The regression test was written and run before changing production code. It
measures viewport-bottom minus `getBoundingClientRect().bottom` on both routes,
requires each gap to be at least 20px and approximately 24px, and requires the
gaps to match within 1px. The matrix is 1440x732 / 390x844, light / dark.

Observed results for every matrix entry:

- Worktree baseline `3aea99f2208896d6e2b26ac7427d6d7ce393d090`: Home 12px,
  detail 16px; four failing cases (`red.log`, `before/`).
- Audit base `647709279396143fd087b4c06dd33a740e5d72eb`: Home 12px,
  detail 16px; four failing cases (`audit-base-red.log`, `audit-base/`).
- Explicit negative control: the audit base with only detail's `mb-4` changed
  to `mb-6`, producing Home 12px / detail 24px; all four cases fail
  (`negative-control.log`). This is an injected control, not an assertion that
  the audit base actually had a 24px detail gap.
- Fixed worktree: Home 24px / detail 24px; four passing cases (`green.log`,
  `after/`). Chromium's safe-area inset is zero for these viewport tests.

The audit base was extracted with `git archive 64770927` into a temporary
subdirectory of this worktree, reusing installed dependencies through symlinks.
Only the new board-shell test was copied in. The isolated source was removed
after the baseline and injected-control runs.

## Reproduction

All browser runs use the repository fixture configuration, which starts and
stops its own server. Each run is serialized with the shared heavy-work lock.

```sh
flock /tmp/cairn-heavy.lock node scripts/heavy-slots.mjs run -- pnpm --filter @cairn/web exec playwright test board-shell.spec.ts --grep 'share a 24px' --workers 1 --reporter=list
flock /tmp/cairn-heavy.lock node scripts/heavy-slots.mjs run -- pnpm --filter @cairn/web exec playwright test board-shell.spec.ts detail-3pane.spec.ts chief-home-chat.spec.ts --workers 1 --reporter=list
```

The second command passed all 41 cases, including Home last-row scrolling,
Home chat transitions, detail horizontal insets and transcript clearance.
Screenshots cover both routes, both viewport sizes and both themes before and
after. The screenshot filenames identify route, viewport width and theme.

## Scope preservation

The open-PR file scan found no overlaps. Recently merged #2398 typography,
#2390 composer controls and shadows, and #2363 detail pane changes remain.
The changed bottom margins implement this issue's intended behavior. Obsolete
comments in the edited detail geometry test were removed without dropping its
horizontal-inset or transcript assertions.

## Final checks

- `pnpm --filter @cairn/web e2e:affected`: all 1,446 cases in 211 specs passed
  in 2.9 minutes (`affected.log`). The shared stylesheet selects the full suite.
- `pnpm typecheck`: passed (`typecheck.log`).
- `pnpm lint`: passed with two informational diagnostics (`lint.log`).
- `pnpm spec:parse`: passed, 1,446 tests collected (`spec-parse.log`).
- `node scripts/prepush-vitest.mjs`: exit 0; no affected unit tests selected
  (`vitest.log`).
- `node scripts/english-only-gate.mjs`: 0 lines with Chinese text.
- `node scripts/comment-discipline-gate.mjs`: 0 new comment lines.
- `git diff --check`: passed.
- `node scripts/single-use-helper-gate.mjs`: unavailable; the script is absent
  from this revision (`MODULE_NOT_FOUND`). No helpers were added by this patch.

An initial lint attempt encountered the temporary audit extraction's nested
configuration. Removing that extraction resolved it; the final lint run passed.
No independent server was started; Playwright managed fixture server cleanup.
The final diff was reviewed for margin scope, retained geometry assertions,
theme initialization and screenshot coverage, with no outstanding code finding.

The initial status contained an existing `pnpm-lock.yaml` modification. During
pnpm commands the package runner automatically performed dependency setup and
`prepare`; the lockfile subsequently matched HEAD. No dependency or lockfile
change is included in the final patch. The initial lockfile diff was not saved.

Per the task's sandbox instruction, `COMMIT_MSG.txt` supplies the complete commit
message, ending in `Closes #2421`; no staging, commit or push was performed.

A redundant `pnpm exec vitest run --changed` invocation was cancelled while
waiting for the shared lock, before it started. The completed
`prepush-vitest.mjs` run above already executes Vitest's changed-test selection.
Final listener inspection returned no listeners on fixture ports 8398 or 8399.
