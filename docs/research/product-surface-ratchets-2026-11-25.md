# Product-surface and clutter ratchets (2026-11-25)

Question: how should Cairn mechanically stop owner-specific preferences, unregistered settings, helper-text growth and permanently disabled controls from re-entering the product? Trigger: workflow-distill C1/C2/C4, owner approval 2026-11-25 22:00. Labels: Observed = read first-hand this session, Inferred = derived from observed facts, Unverified = not verified.

## Comparison

| Source | Mechanism | Trade-off for Cairn | Link |
|---|---|---|---|
| Betterer | Observed: "Track the current status and prevent creating new issues"; tests can use a numeric `smaller` constraint and keep a checked-in results file. | Direct precedent for count-may-only-shrink ratchets. Cairn already has `ui-debt-baseline.json`, so extending that scanner is cheaper and more deterministic than adding a dependency. | https://phenomnomnominal.github.io/betterer/ |
| ESLint `no-restricted-syntax` | Observed: projects can disallow user-defined syntax and use AST selectors with custom messages. | Strong for fixed syntax bans, weak for "new key compared with merge-base" and cross-file schema inventories. A repo gate can use simpler text scanning plus explicit fixtures. | https://eslint.org/docs/latest/rules/no-restricted-syntax |
| dependency-cruiser | Observed: forbidden/allowed rules carry names, comments and severities, and errors stop the build. | Confirms the value of named rule rows and actionable messages, but dependency analysis does not model product surfaces. | https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md |
| Cairn settings-copy research | Observed: Apple/Primer/NN/g keep essential explanations visible; t3code/Amp omit section prose when rows say enough; row-level noise is a density problem. | The gate should count helper-text nodes rather than judge prose quality; taste remains with design review, while the ratchet prevents recurrence. | docs/research/settings-section-explanations-2026-11-20.md |
| Own design: registry + ratchet | Inferred: new product-surface keys are diff events, not syntax errors; helper text and dead controls are inventory counts. | Fits the existing prepush/check-core pattern, runs fast, and preserves one explicit escape (`Prompt-growth:`) for prompt growth. | this file |

## Pattern that fits Cairn

Use two complementary gates:

1. `product-surface-gate` is diff-aware. A newly introduced `CAIRN_*` environment variable, user-writable settings key, runner/device field, or prompt-file byte growth is a product-surface decision. New keys must exist in a checked-in registry with a one-line user scenario; prompt growth needs an explicit commit trailer because a registry row cannot explain prose growth.
2. `ui-debt-gate` remains an inventory ratchet. It counts helper-text nodes and permanently disabled controls in `apps/web/src` and allows the totals only to move down, exactly as Betterer models incremental cleanup.

Inferred: this is the highest feasible rung short of making product judgement impossible to write. It cannot decide whether a registered scenario is a good product decision, but it makes the decision visible, reviewable and reversible.

## Concrete recommendation

Implement `scripts/product-surface-gate.mjs` plus `scripts/product-surface-registry.json`; scan merge-base-to-head snapshots in the existing `pnpm prepush --ci` step inside `check-core`. Extend `scripts/ui-debt-gate.mjs` and `scripts/ui-debt-baseline.json` with `helperText` and `disabledControls` totals. Negative controls: unregistered `CAIRN_HEAVY_SLOTS` introduced by `d5e8a9962` and the runner `autoDispatch`/`maxConcurrency` surface introduced by `6048e1dca` and later removed by `670315c31`. No new required CI job.
