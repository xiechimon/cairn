# Per-team attribution settings

## Plan and decisions

| Decision | Choice | Reason |
|---|---|---|
| Persistence | Two boolean columns on `team`, migration 0123 | Existing team toggles already use team columns; no parallel settings store |
| Defaults | Trailer enabled, reviewer request disabled | SQL defaults cover existing/new teams; reader fallback covers absent settings |
| Identity | Keep identity resolution independent of preferences | Review opt-in must still work with trailer opt-out |
| Daemon | Preserve existing null-identity handling | Real Git test already proves no trailer is added without an identity |
| UI | Existing account settings team card | This card already contains the first-PR team toggle; reuse its rows, switches, mutation and error handling |

Failure modes: ignored opt-out, automatic review spam, repeated review requests, unwanted missing-trailer notices, missing defaults, nonboolean settings, and preferences lost after reload.

## Overlap

1. #3415 mirrors this task. Reused; no closing keyword.
2. No matching open PR. #2289 concerns bot commit-author compatibility, not these preferences.
3. #3413 is the prior attribution implementation intentionally made configurable: trailers stay on by default; instructor review becomes opt-in. Other broad attribution matches concern unrelated UI/ops work.
4. Open file overlaps: #3181 (`web/d109-s2-pr-panel`) touches schema/journal and translations for the PR panel; #3101 (`server/provider-test-connection`) touches translations for provider testing. Proceed independently: different tables/keys and no matching attribution-setting intent. Recheck before opening the PR.

## Tests and evidence

Initial focused run, before behavior changes: 6 failed, 25 passed. Token opt-out returned a human identity instead of null; default API fields were absent; attribution scenarios still requested reviews. The daemon null-identity case already passed. Boolean-only invalid patches were already rejected because the old API required at least one recognized setting. The stronger mixed-valid/invalid-patch regression was subsequently checked against the old validation shape: both flags failed with HTTP 200 instead of 400. A separate negative control removing only the missing-trailer guard produced one notice instead of zero with review still enabled. Absent-settings and migration cases were added after the initial red run.

Commands:

```sh
pnpm exec vitest run apps/server/test/team-attribution-settings.test.ts apps/server/test/team-attribution-migration.test.ts apps/server/test/github-work-attribution.test.ts apps/server/test/m3b-machine-git.test.ts apps/daemon/test/step-attribution.test.ts packages/shared/test/snapshot.test.ts
E2E_PORT=18439 pnpm --filter @cairn/web e2e team-attribution-settings.spec.ts
pnpm lint
pnpm typecheck
pnpm spec:parse
pnpm prepush
```

The shared schema snapshot was updated only for the two boolean fields and their defaults. Focused Playwright tests use mocked API responses; the separate live browser probe uses the real server and database.

The requested `e2e:affected` selector expanded to all 215 specs and then refused an occupied heavy-slot port before running tests. Its holder was left untouched; only the focused spec was run. `vitest run --changed` expanded broadly through shared imports and timed out; it is not a passing check or a substitute for the focused result.

## Live verification

Isolated stack: API 18941, web 15341, fresh scratch database, no provider/daemon started. Browser clicks changed trailer true to false and review false to true; both persisted on reload and matched HTTP rereads. Captures cover 1440px and 390px, light/dark, with no horizontal overflow. SQL values and six real HTTP calls are in the API card directory. Its Before call is read-only against a pre-existing baseline stack at commit `5505ffa311caa889cc5787feafec134592f86fb5`; no settings were changed on that stack.

UI reference: `docs/design/references/settings/t3code-general.jpg`. Existing label/description-left and switch-right composition retained. Rules checked: V1, V4, V10, T1, R1. Reference comparisons and live screenshots are under `../team-attribution-ui/`. Descriptions wrap more than the reference at narrow widths but controls remain visible. Loading/error/offline screenshots and axe are not covered. The browser tests cover persistence; GitHub reviewer calls use a mocked boundary, not live GitHub writes.

Evidence images remain on the task branch because the task explicitly disallows creating another branch or worktree.
