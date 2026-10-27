# Ledger migration verification

Issue #1656, continuing PR #1658.

## Failure modes

- The old shared table remains and makes every ledger gate fail.
- Main adds rows while the split branch is open, losing rows or counts during reconciliation.
- Documentation-only changes bypass validation, including a restored old table.
- Table generation crashes on malformed entries or double-escapes an existing pipe.
- Checkout paths containing spaces fail URL-to-path conversion.
- The translated upgrade marker fails to preserve the original gate rule.
- Prepush conflicts discard the document-reader checks or CI self-test entries.

## Results

The recorded main ledger has 167 rows. They map to 154 entry files, with every text field preserved and counters summed for merged categories. The orchestration recurrence adds one to the existing context-check entry. The #1671 lane adds one recurrence to the existing dependency-directory reuse entry. The #1847 lane records one more required-fixture-field interception and recurrence. Additional entries record the absent remote-tracking reference encountered when creating this worktree and the shared completion-fixture network failure diagnosed by the #1847 lane, plus the recorded-free-cost backfill failure whose regression implementation belongs to PR #1873.

Run `node --test docs/verify/1656/migration.test.mjs` to check every migrated field and counter against `migration.json`. The test reads the source ledger from its recorded main commit through Git and compares every source row with the manifest, so an omitted manifest row cannot pass. `migration-source-red.log` records that omission control. This is a migration acceptance artifact, separate from the lasting gate tests so later ledger edits and evidence pruning remain possible.

`node --test scripts/lessons-ledger-gate.test.mjs` covers the temporary-repository parallel merge and its old-table conflict control, validation negatives, and table generation. `red.log` and `render-red.log` contain actual failing assertions before the fixes. `green.log` contains the passing run, including migration acceptance.

`selftests.log` records 57 passing tests from the CI prepush self-test group. `lint.log`, `typecheck.log`, and `spec.log` record the required checks. Spec parsing collects 1292 web tests and parses 38 integration files.

The summary is generated only to stdout by `pnpm lessons:table`; no generated summary file is tracked. The merge-gate source and protected-path lists match main.

## Final targeted checks and review

`green.log` records 15 passing tests, including the migration acceptance. `integration.log` records the final prepush-plan, document-reader, and CI-job integration tests. `migration-red.log` runs the same migration assertion against the prior PR head's extracted ledger and fails on a missing source entry.

Review checked the complete gate, parser tests, prepush integration, and migration mapping against main. No blocking findings remain in this change. Simplification keeps documentation-only checks in one list and preserves the existing document-reader runner. No merge-gate source, protected-path list, dependency, or lockfile changes appear relative to main.

`prepush-blocked.log` records the actual complete prepush attempt. It passed the static gates and Node self-tests, then failed on eight Vitest files: six integration browser suites lacked the installed Playwright browser revision, and delivery-surface / step-claim-report hit public-network timeouts. The shared browser revision is installed and the fixture correction below passes its focused checks. Normal push still runs the complete prepush plan. No hook was bypassed.

## Shared fixture correction

The existing `githubFetch` port now supplies empty branch lists in the delivery and claim-report fixtures. Tests with their own concurrent-claim GitHub probe keep that probe. `network-fixtures.log` records both affected fixture files passing all 12 assertions after the same cases timed out in `prepush-blocked.log`. No timeout or production behavior changes.

## Moving-main reconciliation

Main advanced to the recorded source in `migration.json` while the push was queued. The queued push was stopped before remote updates. Both new source rows are preserved: shared scratch-path overwrites join the existing shared-output category, and leading-hyphen record IDs join the existing candidate-ID category. The source-row check now reconciles all 167 rows and retains 154 migrated categories.
