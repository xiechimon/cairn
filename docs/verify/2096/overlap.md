# Overlap for #2096

Lookup: `node scripts/github-overlap.mjs --repo xiechimon/cairn --term review-score --term labeler-trust --term eval:review-score --file apps/server/src/eval-review-score.ts --file apps/server/src/eval-review-score-cli.ts --file apps/server/test/eval-review-score.test.ts --file .claude/hillclimb/attribution/labeler-trust.json`

Checked at 2026-10-29T03:22:30.590Z (see `overlap.json`).

1. #2096 — this ticket. Proceed.
2. #2095 — sampler / shared `failure-review` schema. Same ask family, earlier segment. No open PR on origin yet. This PR types the filled-record + answers shapes locally for scoring and does not add `packages/shared` failure-review exports.
3. #2097 / open PR #2105 — weekly wire. Related later segment. Not touched (never-arm).
4. Merged #2048 — predecessor scoring that used the raw point estimate. This PR is the replacement scoring half after that review failed twice.
5. #1717, #1667 — open-issue term noise. Unrelated.
