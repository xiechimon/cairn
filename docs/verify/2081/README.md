# Operator review preflight

The operator merged #2081 after a separate Codex session reviewed a Codex-authored fix. ADR 0026 requires a different model. A later different-model audit passed, but it happened after the merge and cannot satisfy the pre-merge timing requirement. That record also called a raw diff hash the patch digest, rather than using the repository's `pd2` tuple format. This archive preserves the actual record as a negative control.

`review-preflight.py` is a local operator check for this delivery workflow. It does not change GitHub branch protection, the running omarchy timer, product merge policy or CI. It accepts only a completed approved different-model review of a Codex/GPT patch, with the expected current head and canonical digest, nonzero usage, a successful process, at least 1000000 configured context tokens, PASS, and explicit negative answers about gate weakening and eval measurement changes. A justified weakening needs its own further review path; this helper conservatively refuses it.

The command also verifies the review input hash and compares every changed UTF-8 file in that input with `git show` at the judged head. Binary artifacts remain bound through the canonical patch digest. This does not establish review quality or independently rerun acceptance tests.

## Controls

- `post-merge-review-negative.json` is the actual #2081 post-merge audit. Its timing and noncanonical digest are rejected. It must never be presented as pre-merge approval.
- `pre-merge-review-positive.json` is the actual qualified review of #2082's earlier source head `500969a9d1afc6bf948108163ad1fa0cce36a3fb`, before its archive-only follow-up. It is a fixture, not approval of this correction branch or a later #2082 head.
- `negative-control.log` and `positive-control.log` record actual CLI exits 1 and 0 for those records.
- `source-mutation-negative.log` replays a real input-production mistake: global replacement of a reviewer model name also changed source literals. Even recomputing the input hash does not make that input pass the independent source-byte comparison. The failed provider calls had zero token usage and were not approvals.
- `review-preflight.test.py` has nine focused controls for qualification, binding, completion and source integrity. Tests were added before the checker and source-integrity mechanism.

Run the focused checks:

```sh
python3 docs/verify/2081/review-preflight.test.py
```

Before enabling a merge, obtain the current PR head and canonical `pd2` digest from current repository/GitHub facts, not from the review being tested. Then run:

```sh
python3 docs/verify/2081/review-preflight.py /tmp/completed-review.json \
  --head CURRENT_HEAD --digest CANONICAL_PD2 --writer-family GPT \
  --bundle /tmp/exact-reviewed-input.txt --source-root /absolute/repository
```

The review packet must retain each complete changed text file under `FULL FILE path` without changing its bytes. Reviewer selection belongs in the packet header, never in a global transformation of the source. The operator must still verify the public verdict, identity, required checks, current head, evidence links, merge state and merge commit identity. This helper does not replace those checks.
