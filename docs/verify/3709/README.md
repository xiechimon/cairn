# #3709 cold-resume slim — idle → miss → slim

Synthetic projection proof (no provider call). Fat residual with 40 tour/tool/image turns collapses under TTL + `cacheRead==0` to summary hint + ≤8 conversational user turns; wake filtered; tool/image eviction applied.

```text
pnpm exec vitest run test/coordinator/cold-slim.test.ts
```

Log: `idle-miss-slim-vitest.log`.

Cold path also folds lagging `chief_summary` via `seedSummary` (`catchUpColdSummary` in coordinator index) before slim projection.
