# 2096 eval:review-score evidence

## Red then green

`red.log` is vitest against a compiling stub that kept the #2048 bugs: trust used the raw where point estimate, and same-vendor readers were skipped instead of rejected. Named failures:

- trusted stays false at 30 labels with 24/30 where agreement
- a record whose reader vendor equals the labeler's vendor is rejected
- labeler-trust.json shape uses Wilson lower bound

`green.log` is the same suite after the Wilson lower-bound gate and vendor rejection.

## CLI fixture boundaries

`cli-fixtures.log` and `trust/*.json` show:

| fixture | labels | where agreement | where Wilson lower | trusted |
| --- | --- | --- | --- | --- |
| labels-29 | 29 | 1.0 | ~0.883 | false |
| agree-24-of-30 | 30 | 0.8 | ~0.627 | false |
| agree-30-of-30 | 30 | 1.0 | ~0.886 | true |

Fixture inputs live under `fixtures/`. The committed score artifact under `.claude/hillclimb/attribution/reviews/score-2026-W44.json` holds ids and labels only.

## Gates

`lint.log`, `typecheck.log`, `english-only.log`, `comment-discipline.log`.
