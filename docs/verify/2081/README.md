# Operator review preflight

The operator merged #2081 after a separate Codex session reviewed a Codex-authored fix. ADR 0026 requires a different model. A later different-model audit passed, but it happened after the merge and cannot satisfy the pre-merge timing requirement. That record also called a raw diff hash the patch digest, rather than using the repository's `pd2` tuple format. This archive preserves the actual record as a negative control.

`review-preflight.py` is a local operator check for this delivery workflow. It does not change GitHub branch protection, the running omarchy timer, product merge policy or CI. It accepts only a completed approved different-model review of a Codex/GPT patch, with the expected head and a digest derived from captured raw GitHub PR/file facts, nonzero usage, a successful process, at least 1000000 configured context tokens, PASS, and explicit negative answers about gate weakening and eval measurement changes. A justified weakening needs its own further review path; this helper conservatively refuses it.

The command also verifies the review input hash and compares every changed UTF-8 file in that input with `git show` at the judged head. Binary artifacts remain bound through the canonical patch digest. This does not establish review quality or independently rerun acceptance tests.

## Controls

- `post-merge-review-negative.json` is the actual #2081 post-merge audit. Its timing and noncanonical digest are rejected. It must never be presented as pre-merge approval.
- `pre-merge-review-positive.json` is the actual qualified review of #2082's earlier source head `500969a9d1afc6bf948108163ad1fa0cce36a3fb`, before its archive-only follow-up. It is a fixture, not approval of this correction branch or a later #2082 head.
- `negative-control.log` and `positive-control.log` record actual CLI exits 1 and 0 for those records.
- `source-mutation-negative.log` replays a real input-production mistake: global replacement of a reviewer model name also changed source literals. Even recomputing the input hash does not make that input pass the independent source-byte comparison. The failed provider calls had zero token usage and were not approvals.
- `review-preflight.test.py` has fifteen focused controls for qualification, binding, completion and source integrity. Tests were added before the checker and source-integrity mechanism.

Run the focused checks:

```sh
python3 docs/verify/2081/review-preflight.test.py
```

Immediately before calling the preflight, the caller must capture raw GitHub facts. This command aggregates every file-list page into one raw array:

```sh
gh api repos/xiechimon/cairn/pulls/PR_NUMBER > /tmp/current-pr.json
gh api --paginate --slurp 'repos/xiechimon/cairn/pulls/PR_NUMBER/files?per_page=100' | jq 'add' > /tmp/current-files.json
python3 docs/verify/2081/review-preflight.py /tmp/completed-review.json \
  --head CURRENT_HEAD --digest EXPECTED_GITHUB_PD2 --writer-family GPT \
  --github-pr /tmp/current-pr.json --github-files /tmp/current-files.json \
  --bundle /tmp/exact-reviewed-input.txt --source-root /absolute/repository
```

Both captures are mandatory. The helper performs no network access or automatic fetch and cannot guarantee that a capture is current. The caller must obtain them immediately before the invocation, and still check native CI, merge state and the exact current head before merging. An open draft capture can establish digest binding but does not establish merge readiness. A stale capture does not become current because this script passes.

The helper reproduces `compareFilesFromResponse` and `computePatchDigest` in `apps/server/src/services/merge-gate/digest.ts`: hash each raw nonempty `patch`, preserve an omitted opaque patch as null, sort the pd2 tuples, and exclude entries wholly under `docs/verify/`. It refuses local `CompareFile` fields such as `patchSha` and `previousFilename`, checks the captured head/base and total file count, and verifies the complete file path set and Git blob IDs against local Git. The expected argument and both review digest fields must equal the derived GitHub digest. Caller-supplied pd2 text alone is never sufficient.

The #2084 counterexample uses head `60aaf07a741186378cf027d635462157ee9ad755`: all 84 blob IDs match, but the local-representation digest `pd2:9666f694a30ef17f2e6051df8ab0c95b4a97a62b29ea91384faeb0ec52ef3763` differs from GitHub's `pd2:cf55062632e67915d21d1d9848543ce603966234994037855835a58b7ec88b41`. GitHub omits the opaque snapshot patch and segments three file patches differently. `github-files-extract.json` keeps three small real entries for deterministic digest tests, not the complete PR file list. The two reduced review records retain qualification and binding facts from the actual reviews. Full-capture CLI proof is archived separately without committing the large patches.

The review packet must retain each complete changed text file under `FULL FILE path` without changing its bytes. Reviewer selection belongs in the packet header, never in a global transformation of the source. The operator must still verify the public verdict, identity, required checks, current head, evidence links, merge state and merge commit identity. This helper does not replace those checks.
