# #1810 evidence: not-evidence checklist and its machine checks

## What the issue asked for

A short "not evidence" checklist in the implementer prompt and the
verify-cairn skill, and a merge-gate rule for each machine-checkable item.
Three cases are machine-checkable; the fourth (reading source instead of the
compiled artifact) is prose only, because a gate cannot see the difference
between a claim and its artifact.

## Artifacts

- `gate-negative-controls.txt`: `scripts/pr-evidence-gate.test.mjs` run, one
  test per rule and per form, with `PR_EVIDENCE_HTTP_CODE=200` so the network
  never decides the result. Each rule has a red case and a green control.
- `review-gate-probe-cases.txt`: the eight evidence strings the review gate
  measured on the previous head, replayed through the fixed gate. Seven now
  exit 1 (the forms that passed before), the archived control still exits 0.

## Reproduce

```sh
node --test scripts/pr-evidence-gate.test.mjs
node scripts/pr-evidence-gate.py <path-to-pr-body.md>   # PR_REPO / PR_TICKET set
```
