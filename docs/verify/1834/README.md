# Issue 1834 verification

## Context and overlaps

The live lookup on 2026-10-26 is recorded in `overlaps.json`. Issue #1834 is the same request and this lane extends that work. Issues #1773 and #1717 concern memory evaluation and scheduling, respectively. Keyword candidates #1776 and #1828 concern button sizes and work traces, not duplicate-work protection.

Open same-file PRs are #1839 (`lane/1838`, chief and worker prompts), #1812 (`cairn/conv-01a17648-7bfb-7f06-8281-9ad845d03e30`, worker prompts), and #1658 (`lane/1656`, agent rules). The dispatcher also supplied #1658's lessons-ledger overlap. Proceed independently because this change adds overlap instructions and scripts, preserving their existing functionality. Recheck these paths before opening a PR. Recently merged candidates #1646, #1664, #1566, #1638, #1461, #1414, and #1420 are related infrastructure or unrelated product changes; none implements this request.

## Failure modes and checks

The implementation covers missed alternative wording, missing same-file PRs, failed or incomplete lookups, duplicate creation instead of extension, missing merged-line attribution, accidental acceptance of a different PR number, rename-only false positives, dash-prefixed deleted content, and historical worker-note compatibility.

The inherited implementation recorded initial missing-module and worker-prompt failures, followed by rename, dash-content, and historical-note negative controls. During this continuation, an empty planned path silently bypassed file overlap detection. `empty-path-red.log` records the failing test before the validation change; `scripts-green.log` records all 10 script cases passing afterward.

The silent-revert cases use real temporary Git histories. The duplicate-ask case uses an injected GitHub transport to assert extension of issue #1786 with no issue-creation request. It is a deterministic workflow regression, not a live-model semantic evaluation.

## Verification

- `node --test scripts/github-overlap.test.mjs scripts/silent-revert-gate.test.mjs`: 10 passed.
- `pnpm lint`: passed, with two existing informational findings outside this change.
- `flock /tmp/cairn-heavy.lock node scripts/prepush-vitest.mjs`: 332 files and 4443 tests passed in 189.70 seconds.
- `flock /tmp/cairn-heavy.lock pnpm typecheck`: all five workspace packages passed.
- `flock /tmp/cairn-heavy.lock pnpm spec:parse`: 1298 web cases in 184 files collected; 36 integration test files parsed; PASS.
- `node scripts/english-only-gate.mjs`, `node scripts/single-use-helper-gate.mjs`, and `node scripts/comment-discipline-gate.mjs`: each reported 0. The normal diff gates inspect tracked changes; an additional direct English check covered all untracked files and reported 0.
- Heavy checks run sequentially through `flock /tmp/cairn-heavy.lock`, with output captured using `tee`.

The sandbox handoff uses `COMMIT_MSG.txt` instead of staging or committing. No push, remote issue, comment, or PR was created.
