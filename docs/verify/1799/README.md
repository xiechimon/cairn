# #1799 / #1967 skills injection baseline

Measurement-only baseline for the #1799 family (ticket #1967). Matcher code,
claim path, and `cases.json` labels are unchanged. Sibling #1971 persistence
landed in #2100; weak-domain matcher work landed in #2098 / #1970.

## What is frozen

| Artifact | Role |
| --- | --- |
| [snapshot.json](./snapshot.json) | Sanitized capture from `~/.cairn/server/server.db`: task text, stored hits, candidate catalog, matcher revision, live population counts, and sampling metadata |
| [classification.json](./classification.json) | Per-hit `relevant` / `unrelated` / `uncertain` labels with rationales for every hit in the captured population |
| [rubric.md](./rubric.md) | Relevance rubric (not the #1874 loose-keyword proxy) |
| [routing-catalog.json](./routing-catalog.json) | Frozen two-skill catalog for the #1782 grader |

`snapshot.livePopulation` is the full join of `step`/`build`/`todo` rows with a
non-null `skillInjection`. `snapshot.population` is the captured set that
`classification.json` must reconcile with. When the live hit count is too large
for a full hand pass, capture uses stratified sampling
(`--stratify-hits`, default proposal 300) across `rule` × skill id, with the
method and seed recorded in `snapshot.sampling`.

## Capture command (omarchy)

```sh
pnpm exec tsx integration/eval/skills-routing/snapshot.mts \
  --db ~/.cairn/server/server.db \
  --skills-dir ~/.agents/skills \
  --stratify-hits 300 \
  --sample-seed 1799-omarchy \
  --out docs/verify/1799/snapshot.json
```

Candidates come from the claim-time loader (`parseSkillFrontmatter`, frontmatter
`name` as id, `realpathSync` dedupe so symlink directories match
`scanLocalSkills`). Then classify every captured hit under [rubric.md](./rubric.md)
so totals reconcile.

## 119 versus 123

Neither figure is current.

- Issue #1799 text reported 119 steps with a `skillInjection` on a 2026-10-26
  omarchy sample.
- PR #1874's read of the same database window reported 123 steps and 3952
  stored hits.
- The independent review gate later read 151 steps and 4772 hits on the live
  database. Treat that as a later observation, not as the frozen baseline
  until `snapshot.mts` records it in `livePopulation`.

This baseline does not present 119 or 123 as the live population.
`snapshot.livePopulation` is the only current count for a given capture.

## Historical stored hits versus replay predictions

Stored hits are whatever the claim path wrote at claim time. Replay predictions
are `selectSkillsForTask` on the frozen task text and frozen candidates under
the current matcher. Report them separately; they diverge wherever the matcher
or skill descriptions changed after the row was written.

## Reproduce #1782 baseline metrics

```sh
pnpm exec tsx integration/eval/skills-routing/replay.mts \
  --snapshot docs/verify/1799/snapshot.json
```

Expected routing totals on the frozen catalog (unchanged by this ticket):

```json
{ "precision": 0.8666666666666667, "recall": 0.7647058823529411, "forbiddenHits": 2 }
```

Acceptance tests:

```sh
pnpm --filter @cairn/integration exec vitest run \
  test/skills-routing-replay.test.ts \
  test/skills-routing-grade.test.ts
```
