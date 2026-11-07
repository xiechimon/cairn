# Flat hover feedback

UI brief: settings lists and shared row/card controls. Remove partial background bands and hover elevation; preserve keyboard outlines and instant feedback. Reference: [t3code Environments](../../design/references/settings/t3code-environments.jpg). Rules: V7, V21, A2, R1. Existing behavior correction; no new page draft.

## Evidence

The pointer was positioned over the omarchy name toggle for every machine screenshot. Playwright screenshots omit the cursor itself.

| State | Before | After | Source |
| --- | --- | --- | --- |
| 1440 light | [Before](before-light-1440.png) | [After](after-light-1440.png) | Shipped components, fixture scenario `machines-master-detail` |
| 1440 dark | [Before](before-dark-1440.png) | [After](after-dark-1440.png) | Same fixture; the old dark ghost variant paints only the name line |
| 1440 light, isolated server | [Before](live-before-light-1440.png) | [After](live-after-light-1440.png) | Live API and SQLite, seeded local omarchy with a Coordinator route |
| 1440 dark, isolated server | [Before](live-before-dark-1440.png) | [After](live-after-dark-1440.png) | Same isolated server |
| 390 light | Not captured | [Fixture](after-light-390.png), [live](live-after-light-390.png) | No document horizontal overflow |
| 390 dark | Not captured | [Fixture](after-dark-390.png), [live](live-after-dark-390.png) | No document horizontal overflow |

The live before captures load the original `HEAD` machine-row module through a temporary Vite module, with the same isolated API and database as the after captures. The temporary file was removed immediately afterward. Shared Button pressed-state cleanup is present in both live captures; it does not affect hover backgrounds.

The isolated server uses disposable data and auth off; no daemon or model turn is started. The machine and Coordinator routing rule were seeded in its SQLite database. Fixture evidence includes online, offline and expired-login rows. Empty/loading/error transitions and expanded machine bodies are outside this visual change.

## Regression signal

Before the fix, `paper-hover-bands.spec.ts` failed on the actual machine toggle in dark mode: its changed background occupied `[392,154,808,22]`, only the first line. It also caught the machine menu's partial fill in light mode. The browser guard compares every row descendant's computed background before and after hovering each row and each nested control, requiring changed boxes to equal the full row. Machines, providers, MCP, skills, secrets and API keys run in both themes. A separate keyboard assertion checks the machine toggle's outline and unchanged background, rejecting visible shadows.

G8 in `ui-drift-gate.mjs` scans all web TS, TSX and CSS. It rejects hover/active shadow utilities, hover drop shadows, explicit box-shadow transition utilities, CSS transition declarations and inline transition declarations. A `deliberate-shadow: reason` annotation on the immediately preceding line permits an intentional exception. Its self-tests run with the existing UI page gate tests in CI. Static resting elevation and selected-tab shadows remain permitted.

## Validation

The targeted affected suite covers settings rows, provider choices, question cards, project cards, segmented controls, button presses, pressed contrast and immediate chat feedback. Gallery image baselines are left to CI; no baseline was rewritten. Results: `pnpm lint`, `pnpm typecheck`, `pnpm spec:parse` passed through `pnpm prepush` (24 checks). `pnpm exec vitest run --changed`: 17 files, 148 tests passed. `node --test scripts/ui-page-style-gate.test.mjs`: 10 tests passed. The affected runner on free port 19399 passed 119 tests in 11 specs, including all 14 new hover/focus checks. Its equivalent command is:

```sh
E2E_PORT=19399 pnpm --filter @cairn/web e2e:affected apps/web/e2e/paper-hover-bands.spec.ts apps/web/e2e/settings-master-detail.spec.ts apps/web/e2e/provider-add-dialog.spec.ts apps/web/e2e/providers-account-rows.spec.ts apps/web/e2e/button-press.spec.ts apps/web/e2e/button-press-contrast.spec.ts apps/web/e2e/chief-home-questions.spec.ts apps/web/e2e/segmented-controls.spec.ts apps/web/e2e/pr-card.spec.ts apps/web/e2e/chat-instant-feel.spec.ts apps/web/e2e/paper-resource-pages.spec.ts
```

The runner was invoked directly with Node after the package-runner wrapper queued behind stale PID tickets in this sandbox; it acquired the shared slot normally. No lock was removed manually and no other process was stopped. Local `origin/main` was used because the read-only git directory prevents prepush from fetching. CI and cloud review await the orchestrator's push.
