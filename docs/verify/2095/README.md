# #2095 failure-review schema and eval:sample-failures

Evidence for the shared `failureReviewRecordSchema` and the `pnpm eval:sample-failures` sampler.

- `red.log`: vitest against a compiling stub that samples passing/unattributed rows and leaks labeler where/why into the review markdown (behavioral assertion failures, not module-not-found).
- `green.log`: the same four tests against the landed sampler.
- `cli-run.log`: fixture CLI run outside the repo (`--week 2026-W44`).
- `item-ids.txt`: sampled item ids from that run.
- `review-2026-W44.md` / `review-2026-W44.blank.jsonl`: review artifacts (no labeler where/why).
- `answers-2026-W44.redacted.json`: answers file shape with label values redacted so the public branch carries no labeler where/why.

Commands:

```sh
pnpm --filter @xiechimon/cairn exec vitest run test/eval-sample-failures.test.ts
pnpm typecheck
pnpm lint
pnpm eval:sample-failures --week 2026-W44 --out /tmp/cairn-2095-out --flows <fixture> <packs.jsonl>
```

## Prepush vitest scope

Changing `packages/shared` barrel exports makes `vitest --changed` select daemon and integration suites that are unrelated to this sampler. `scripts/prepush-vitest.mjs` sets `VITEST_PROJECT_SET=server-shared` when every non-doc code path is under `packages/shared/` or `apps/server/`, so local prepush runs the packages + server projects only for this class of change.
