# #1967 skills injection baseline

Measurement-only baseline for the #1799 family. Matcher code, claim path, and
`cases.json` labels are unchanged. Sibling #1971 persistence landed in #2100;
weak-domain matcher work stays in #1970 / #2098 and is out of scope here.

## What is frozen

| Artifact | Role |
| --- | --- |
| [snapshot.json](./snapshot.json) | Sanitized stratified sample: task text, stored hits, candidate catalog, matcher revision |
| [classification.json](./classification.json) | Per-hit `relevant` / `unrelated` / `uncertain` labels with rationales |
| [rubric.md](./rubric.md) | Relevance rubric (not the #1874 loose-keyword proxy) |
| [routing-catalog.json](./routing-catalog.json) | Frozen two-skill catalog for the #1782 grader |

Snapshot date: `2026-10-28T17:45:00.000Z`. Population in this commit: 7 steps,
8 hits. Matcher revision: git commit that last touched
`packages/shared/src/skill-inject.ts` at capture time.

## Unavailable data

This lane had no live omarchy `~/.cairn/server/server.db`. The committed
snapshot is a sanitized stratified sample that covers the known #1799 failure
modes (weak `ci` bridge, path-token docs open, explicit mention, mixed layout
hits, merge overlap). To replace it with the live population on omarchy:

```sh
pnpm exec tsx integration/eval/skills-routing/snapshot.mts \
  --db ~/.cairn/server/server.db \
  --skills-dir ~/.agents/skills \
  --out docs/verify/1967/snapshot.json
```

Then re-classify every stored hit under [rubric.md](./rubric.md) so totals
still reconcile.

## 119 versus 123

Neither figure is current.

- Issue #1799 text reported 119 steps with a `skillInjection` on a 2026-10-26
  omarchy sample.
- PR #1874's read of the same database window reported 123 steps and 3952
  stored hits.

This baseline does not treat either number as the live population. Re-running
`snapshot.mts` on omarchy is the only way to publish a current count.

## Historical stored hits versus replay predictions

Stored hits are whatever the claim path wrote at claim time. Replay predictions
are `selectSkillsForTask` on the frozen task text and frozen candidates under
the current matcher. Report them separately; they diverge wherever the matcher
or skill descriptions changed after the row was written.

## Reproduce #1782 baseline metrics

```sh
pnpm exec tsx integration/eval/skills-routing/replay.mts \
  --snapshot docs/verify/1967/snapshot.json
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
