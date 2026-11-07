# All machines settings scope

## UI brief

Surface: settings, shared by Model services and Model routing. Tested base HEAD: `ebedb1947d96f6fbe2dae1c6e9f3eefe4ef3ce6a`, with this lane's uncommitted changes.
Goal: name the shared scope `所有机器` / All machines and identify every choice with an icon, preserving scope URL values.
Rules checked: P1, P2 (existing-setting fix, draft exempt), C1, V9, V14, T1, T2, R1.
Reference: [t3code scope](../../design/references/settings/t3code-providers-scope.jpg). Borrow the leading monitor glyph and inline scope sentence; the owner explicitly excluded a project axis.

The scope component has an all-machines state, selected-machine state, offline machine, and duplicate names. Fixture fleet data covers ordinary and offline machines; the gallery covers duplicate names. An isolated server with a fresh SQLite database covers both actual settings pages with seeded machines. Empty lists and failed/slow API responses are covered by the existing settings query tests. Pending questions do not apply to this selector.

## Evidence

| State | Before | After | Provenance |
| --- | --- | --- | --- |
| Providers, light, 1440 x 900, menu open | [Before](before-light-1440.png) | [After](after-light-1440.png) | Fixture fleet |
| Providers, dark, 1440 x 900, menu open | [Before](before-dark-1440.png) | [After](after-dark-1440.png) | Fixture fleet |
| Providers, light, 390 x 900 | Unchanged baseline unavailable | [After](after-light-390.png) | Fixture fleet |
| Providers, dark, 390 x 900 | Unchanged baseline unavailable | [After](after-dark-390.png) | Fixture fleet |
| Gallery, light | [Before](gallery-before-light.png) | [After](gallery-after-light.png) | English gallery specimen |
| Gallery, dark | [Before](gallery-before-dark.png) | [After](gallery-after-dark.png) | English gallery specimen |
| Live providers, light / dark | Not captured on base | [Light](live-providers-light.png), [dark](live-providers-dark.png) | Real server and fresh seeded database; no scenario query |
| Live routing, light / dark | Not captured on base | [Light](live-routing-light.png), [dark](live-routing-dark.png) | Real server and fresh seeded database; no scenario query |

Reference comparisons: fixture [light](reference-light.png), [dark](reference-dark.png); live [light](reference-live-light.png), [dark](reference-live-dark.png). The selector follows the reference's inline machine scope and monitor glyph. The reference also has a project axis; its omission is intentional. The fixture comparison has a populated provider list; the live stack verifies the empty provider state.

The added icons initially exposed existing menu clipping at the trigger width. The scope menu now sizes to its content, retaining full names and status markers. [Measurements](measurements.json) show 16px icons with 1.75px strokes, no clipped options, and no document overflow at 1440px and 390px in either theme.

## Verification

- `pnpm lint`
- `pnpm typecheck`
- `pnpm spec:parse`
- `pnpm exec vitest run --changed`: 33 files, 283 tests passed.
- `E2E_PORT=8468 pnpm --filter @cairn/web e2e:affected apps/web/e2e/providers-scope.spec.ts apps/web/e2e/settings-scope-sentence.spec.ts apps/web/e2e/settings-window.spec.ts apps/web/e2e/settings-query-states.spec.ts apps/web/e2e/gallery-snapshots.spec.ts`
- Final affected e2e result: 54 passed, 2 failed (the broad gallery light/dark baseline checks). The new scope baselines matched; mismatches included untouched specimens such as ink-on-the-card and provider-panel. Other baselines were left unchanged.
- [Live results](live-results.json): real server, auth off, fresh database seeded with three sample machines plus the server's automatically registered local machine. Both settings sections in both themes preserved machine IDs and removed the scope query when returning to All machines. No external provider was called.

The affected runner was given the five relevant spec paths for this copy/icon change; the default i18n path mapping would select the full suite, which remains a CI check. No full local suite or real provider execution is claimed.

## Handoff

Changes remain uncommitted in this worktree. Only the two settings-scope gallery baselines changed. Their new label, icon, and explanatory caption are intentional. The orchestrator must upload evidence and replace the PR body's relative image links with reachable asset commit SHA links before publication. This lane cannot create an asset commit or upload branch because its git directory is read-only.
