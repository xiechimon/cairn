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

The current main ledger has 165 rows. They map to 154 entry files, with every text field preserved and counters summed for merged categories. The orchestration recurrence adds one to the existing context-check entry. One additional entry records the absent remote-tracking reference encountered when creating this worktree.

Run `node --test docs/verify/1656/migration.test.mjs` to check every migrated field and counter against `migration.json`. This is a migration acceptance artifact, separate from the lasting gate tests so later ledger edits and evidence pruning remain possible.

`node --test scripts/lessons-ledger-gate.test.mjs` covers the temporary-repository parallel merge and its old-table conflict control, validation negatives, and table generation. `red.log` and `render-red.log` contain actual failing assertions before the fixes. `green.log` contains the passing run, including migration acceptance.

`selftests.log` records 57 passing tests from the CI prepush self-test group. `lint.log`, `typecheck.log`, and `spec.log` record the required checks. Spec parsing collects 1292 web tests and parses 38 integration files.

The summary is generated only to stdout by `pnpm lessons:table`; no generated summary file is tracked. The merge-gate source and protected-path lists match main.
