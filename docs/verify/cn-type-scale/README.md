# cn keeps Paper type-scale keys: evidence

Claim: with the bare `cn` specifier aliased to `apps/web/src/lib/cn.ts`, a
components/ui `Button` given `text-meta text-(--card-button)` keeps `text-meta`
and drops its `text-xs` size variant, so the label size follows the Paper
scale (including density) with the label directly in the Button.

## Setup

PR #1371 (branch `claude/paper-card-4f1043`, head `f3109f30`) is the first
consumer: it puts `text-meta` on an inner `<span>` inside each card action
`Button` because `cn` dropped it on the Button itself. A scratch worktree of that
head had this PR's diff applied, then three fixture builds were probed with
`probe.mjs` (Chromium, `/app?scenario=board-drag-matrix`, the `重试` action on
`dm-failed`), in comfortable and compact density.

Compact density is the discriminating case: `text-meta` is
`0.75rem * --type-scale` = 11.9531px there, `text-xs` stays 12px. In
comfortable density both are 12px.

| variant | Button has `text-meta` | Button has `text-xs` | label px (comfortable / compact) |
| --- | --- | --- | --- |
| A: #1371 as is (label on an inner span) + cn fix | no | yes | 12 / 11.9531 (span) |
| B: `text-meta` moved onto Button (`todo-card-move.diff`) + cn fix | yes | no | 12 / 11.9531 |
| C: same move, cn fix reverted | no | yes | 12 / 12 |

C is the bug: the Button silently keeps `text-xs`, and the density scale no
longer reaches the label. B renders 12px and matches the inner-span version in
both densities, so #1371 can drop the span once this lands.

`scratch-e2e-1371.txt`: #1371's `paper-card`, `board-filter` and `cds-board`
specs pass on variant B (27 passed).

Raw results: `result-A-inner-span-with-fix.json`,
`result-B-on-button-with-fix.json`, `result-C-on-button-without-fix.json`.

Bundle check: the fixture build of this branch contains
`{extend:{classGroups:{"font-size":[{text:[page,heading,card-title,ui,meta,caption]}]}}}`
immediately before `buttonVariants`, so production code gets the configured
instance, not the package default.
