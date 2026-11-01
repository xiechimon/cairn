# Empty-state hint icon (#2422)

The hint now uses centered inline text flow. Its icon has a 4px right margin and aligns to the text bottom. The paragraph uses the shared `max-w-sm` width token, matching the existing content primitive.

## Regression contract

`apps/web/e2e/accent-typo.spec.ts` measures the first non-whitespace text character with a DOM Range after fonts finish loading. It checks a 0–8px horizontal gap and positive vertical overlap with the icon, the width cap, and no horizontal page overflow. The 390px cases must wrap. All four cases use the schedules fixture (`/app/schedules?scenario=11`), at 1440×900 and 390×900, in light and dark themes.

Failure modes considered before implementation: detached icon, icon on a different line, excessive hint width, phone overflow, and changed layout in other consumers. Schedules and secrets share the same component; the shared empty primitive is unchanged.

## Reproduce

From the repository root, run the targeted fixture build through the heavy slot runner:

```sh
HINT_EVIDENCE_DIR="$PWD/docs/verify/2422/after" \
  flock /tmp/cairn-heavy.lock node scripts/heavy-slots.mjs run -- \
  node docs/verify/2422/run.mjs
```

To reproduce the audit baseline, extract `git archive 64770927` into an isolated directory, reuse the installed dependency links, and copy the updated spec into its `apps/web/e2e/` directory. Set `HINT_BASELINE_ROOT` to that directory and `HINT_EVIDENCE_DIR` to the absolute `before/` evidence directory when running the same command. The runner uses the leased port and a slot-specific build directory; Playwright owns server cleanup.

## Evidence

The initial test-first run on lane base `3aea99f2` failed all four cases. Its `EmptyState` source was byte-identical to audit base `64770927`. The measured desktop gap was 90.828125px; the phone gap was 54.921875px, reproducing the reported approximately 56px negative control. Both themes produced the same measurements.

A second run built the complete audit source extracted from `64770927` in an isolated directory, with the new test copied in and installed dependencies reused. All four cases failed the gap assertion again (desktop 90.828125px, phone 54.921875px). The fixed fixture build passed all four: gap 4px, vertical overlap 12px, two text lines, and no horizontal overflow at both viewport sizes.

Matching screenshots are stored in `before/` and `after/`, named by theme and viewport width. Measurements and red/green command results are preserved alongside them.

## Overlap and limits

The required open-PR query and the last 30 merged PRs contained no changes to `apps/web/src/components/empty-state.tsx` or `apps/web/e2e/accent-typo.spec.ts`. No recently merged lines are intentionally reverted.

`scripts/single-use-helper-gate.mjs` does not exist at lane base; invoking the requested command fails with `MODULE_NOT_FOUND`. No new named helper function was added.

## Final checks

- Targeted negative control on `64770927`: 4 expected failures, each at the ≤8px assertion.
- Targeted fixed fixture build: 4 passed.
- `flock /tmp/cairn-heavy.lock pnpm --filter @cairn/web e2e:affected`: 540 passed across 72 spec files (2.8 minutes), including schedules, secrets and consumers without hints.
- `flock /tmp/cairn-heavy.lock node scripts/prepush-vitest.mjs`: 45 passed across 3 files.
- `pnpm lint`: passed (two existing informational diagnostics).
- `flock /tmp/cairn-heavy.lock pnpm typecheck`: passed for all workspace packages.
- `pnpm spec:parse`: passed, 1446 web tests in 211 files collected and 67 integration spec files parsed.
- `node scripts/english-only-gate.mjs`: 0; the new evidence README and commit message also passed the text-mode check.
- `node scripts/comment-discipline-gate.mjs`: 0 new comment lines.
- `node --check docs/verify/2422/run.mjs` and `git diff --check`: passed.
- Requested single-use helper gate: unavailable (`MODULE_NOT_FOUND`), as recorded above.

The audit checkout was removed after its expected failures. Playwright completed all fixture-server lifecycles. No manually managed server was started. No push or PR creation was performed. Per the sandbox instruction, the commit message is in `COMMIT_MSG.txt`; staging and committing are left to the outer runner.

## CI repair on PR #2447

The branch-specific `check-core` failure was reproduced before editing with
`UI_DEBT_BASE_SHA=origin/main node scripts/ui-debt-gate.mjs`: D5 spacing debt
increased from 11 to 12 because of `max-w-[34em]`. Replacing it with
`max-w-sm` makes the same gate pass with 11 spacing values. The parent already
caps content at 384px, so the measured rendered widths remain unchanged.

All heavy commands below ran through `flock /tmp/cairn-heavy.lock`:

- `pnpm prepush --ci`: passed all 15 checks, including lint, typecheck and spec parsing.
- `node scripts/heavy-slots.mjs run -- node docs/verify/2422/run.mjs`: four passed; gap 4px, overlap 12px, widths 384px and 310px, no overflow.
- `pnpm exec vitest run --changed origin/main`: 53 tests passed in four files.
- `pnpm --filter @cairn/web e2e:affected`: 540 passed across 72 specs.
- `pnpm --filter @cairn/web e2e e2e/sidebar-visual.spec.ts --grep "active team brand" --workers=1`: all four cases reproduce the CI timeout at line 145 waiting for English `Projects`; the fixture navigation uses a localized label. This spec is unchanged from `origin/main`.

Both failed `pr-evidence` runs (41278474031 and 41279285503) stop at
`autonomy-paused: autonomous merging is paused`, before the body gates.
The current PR body passes `pnpm pr:check`; required legacy sections and checked
acceptance items are present. No body or brake changes were made. The `check`
and `e2e-gate` failures are aggregates of `check-core` and the sidebar failures.

Remote main and local `origin/main` both resolve to `7324930ad60328ea6bd29a75b8158162041e8611`,
which is already this branch's merge base. No rebase changes are needed.
`docs/lessons.md` is absent from both trees; no lesson rows were removed.

An isolated `git archive origin/main` reproduction also fails the light/1440px
sidebar case at the same `Projects` locator after 30 seconds. This establishes
an upstream failure rather than a branch regression. Output is preserved in
`ci-main-sidebar-red.log`; the repaired hint output is in `ci-hint-green.log`.
The archive reused installed dependencies and invoked Playwright and Vite
through their Node entry points because pnpm rejects symlinked task-state
paths. Its temporary config kept the fixture build, locale, viewport, theme,
and no retries, used port 8499 with server reuse disabled, and omitted the
Git-checkout port guard because an archive has no Git metadata. Playwright
owned and stopped the preview. The original sidebar test source was unchanged.

Review of the repair diff found no additional findings: the token matches the
parent cap, original geometry assertions pass, and no gate baseline, dependency,
sidebar code or test assertion was changed.
