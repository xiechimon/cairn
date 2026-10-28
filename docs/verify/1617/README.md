# Spec and ADR drift delivery

This delivery follows the owner-approved item (b) of #1617 and repairs #2023 at `eb54a7582f57dd4a54ec2249b0d4d919798eb111`. It reports committed documentation references whose files or identifiers disappeared. The weekly gardener receives the report through `--drift` and writes a JSON companion. Baselines, allowlists and candidate-pattern logic are unchanged. The operational dispatch part of the parent issue remains separate.

## Repairs and source identity

Historical lookup accepts both a literal repository path and the same directory suffix that HEAD lookup accepts. A deleted `apps/web/src/api/mode.ts` is therefore reported when documentation names `api/mode.ts`. A historical `not-api/mode.ts` does not establish that the requested suffix existed. Identifier checks use the acceptance checklist's `apps/`, `packages/` and `scripts/` scope, so a leftover name in integration fixtures cannot conceal a missing application identifier.

The main snapshot examined is `68c09db2b8ccc368c1a4ac59fe040924d1c76f2a`. `observation.json` records the original PR head and SHA-256 values of all six code and workflow files. The weekly workflow retains current main's safeguard collection, publication and permissions. The report retains the lessons ledger section.

## Executable evidence

- `relative-history-red.log`: the original PR implementation, copied unchanged to an isolated temporary directory, runs the new CLI regressions. Eleven pass and the two relative-path assertions fail with an empty drift list. Both failures are assertion failures, with no fixture `ENOENT`.
- `identifier-scope-red.log`: the relative-path repair still misses an identifier left only in integration fixtures. Thirteen tests pass and that assertion fails before the scope change.
- `targeted-green.log`: 48 tests pass across drift, gardener, baseline enforcement, CI step placement and weekly safeguard collection.
- `lint-green.log`, `typecheck-green.log`, `spec-parse-green.log`: the required local checks pass.
- `weekly-drift.log` and `drift-main.json`: a real invocation against committed main reports 121 missing path references across 58 documents. The full weekly artifact contains the lessons ledger and drift sections.
- `first-ten-review.json`: each of the first ten rows is absent at HEAD, has a matching deletion commit, and exists in that deletion's first parent. Their documentation lines were inspected directly. Zero of those ten are false missing-path reports. This sample does not establish that every reported reference still describes intended current behavior.

The first restoration fixture attempted to write a file after Git removed its empty parent directory. Its `ENOENT` was not a valid product negative control. `discarded-fixture-red.log` preserves that attempt. The fixture now creates its parent before restoring the uncommitted file; only the corrected assertion failures in `relative-history-red.log` support acceptance.

## Reproduce

```sh
TMPDIR=/private/tmp node --test scripts/doc-drift.test.mjs scripts/gardener-weekly.test.mjs scripts/baseline-ratchet-gate.test.mjs scripts/ci-job-structure-gate.test.mjs scripts/lessons-weekly.test.mjs
node scripts/gardener-weekly.mjs --drift --out /tmp/cairn-drift-review
pnpm lint
pnpm typecheck
pnpm spec:parse
```

A corrected product negative control must fail through its expected assertion:

```python
from pathlib import Path
text = Path('docs/verify/1617/relative-history-red.log').read_text()
assert 'ENOENT' not in text
assert "code: 'ERR_ASSERTION'" in text
assert 'actual: []' in text
assert 'fail 2' in text
```

The CI run and its explicit drift-test log line must be checked on the published delivery before merging. Local execution and workflow text alone do not establish that GitHub ran the added self-test.

## Line-suffix follow-up

The independent review of `fd2d2167` found that a relative path with a line suffix was rejected before normalization. `relative-range-red.log` records 14 passing tests and the new deletion case failing through its expected assertion. The scanner now normalizes each token before either path classifier or filename lookup.

`relative-range-green.log` records 49 passing related tests. The corresponding lint, typecheck and spec-parse logs pass. `relative-range-weekly.log` and `relative-range-drift.json` report 122 missing paths from the same 58-document corpus at the observed head. The extra report is `resources/shell.tsx`, previously written with a line suffix. `relative-range-first-ten.json` rechecks the current first ten against deletion history; `relative-range-observation.json` binds the new source files to their hashes. The earlier 121-row observation remains the evidence for the earlier source version.

The added-row explanation is checked against the actual artifact difference:

```python
from pathlib import Path
import json
root = Path('docs/verify/1617')
key = lambda row: (row['doc'], row['line'], row['kind'], row['name'])
before = {key(row) for row in json.loads((root / 'drift-main.json').read_text())}
added = [row for row in json.loads((root / 'relative-range-drift.json').read_text()) if key(row) not in before]
assert added == json.loads((root / 'relative-range-observation.json').read_text())['addedRows']
assert f"The extra report is `{added[0]['name']}`, previously written with a line suffix." in (root / 'README.md').read_text()
```
