# GitHub digest source binding evidence

The operator preflight was extended after a normal merge of main `c84862b23660af9802c3ef5b39889a89b9f3f479` into the correction branch. This evidence tests the actual #2084 pre-merge capture at head `60aaf07a741186378cf027d635462157ee9ad755`; it is a historical replay, not a current merge authorization or approval of this correction branch.

Failure modes were enumerated before implementation: a same-head local digest can differ from GitHub; local CompareFile fields can masquerade as raw files; partial or duplicated captures can omit content; stale head/base or mismatched blobs can bind the wrong source; opaque patches and evidence exclusion can produce a different tuple digest. Five new tests failed before the mechanism existed (`red.log`). All fifteen focused controls pass (`focused-green.log`), including the existing post-merge and source-mutation rejection controls.

The CLI requires captured raw PR and file JSON, derives pd2 from raw GitHub patches, verifies captured head/base/file count and every local path/blob, and compares the derived digest with both the expected argument and the completed review. It does not fetch GitHub facts or establish their freshness. Native CI, current merge state and exact head matching remain separate operator checks. Draft-open captures establish binding only.

Actual full-capture CLI outcomes:

- `local-digest-block.log`: local-representation review and its own supplied digest fail with exit 1 despite identical head and all 84 matching blobs.
- `github-digest-pass.log`: the completed GitHub-bound review passes with exit 0, including reviewed input hash and all changed UTF-8 source bytes.
- `partial-files-block.log`: an 83-entry capture fails count, complete-path and digest checks with exit 1.
- `source-mutation-block.log`: changing a reviewer literal in the complete input, even after recomputing its binding hash, still fails source-byte comparison with exit 1.
- `production-parity.log`: the actual production `compareFilesFromResponse` and `computePatchDigest` produce the same full-capture and minimal-extract pd2 values as the Python preflight. Recording-required flags do not enter digest tuples.

`counterexample-facts.json` records only the four differing patch hashes and the captured count/digests. The raw 84-file patch payload is intentionally not committed. The three-entry fixture and reduced review fixtures in the parent directory retain only the fields needed for these controls. The original post-merge/source-mutation artifacts remain unchanged.

Verification commands: `python3 docs/verify/2081/review-preflight.test.py`, `pnpm lint`, `pnpm typecheck`, and `pnpm spec:parse`. These checks ran sequentially under `TMPDIR=/private/tmp CAIRN_HEAVY_SLOTS=1 node scripts/heavy-slots.mjs run -- sh /tmp/2081-final-checks.sh`, on Node 24.14.0. All passed. No E2E or provider call is relevant to this local Python operator tool; no provider call, push or PR creation was performed. The existing lesson was updated; the ledger script deduplicated the existing same-branch/week/gate intercept event, so counters were not edited manually.
