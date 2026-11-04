# PR #1873 CI diagnosis

Measured on 2026-10-26 in `lane/1847`.

## Finding

The roster failure is inherited from main, and main is red on the same check today. The installed pi catalog contains 162 vendor entries; origin/main's committed snapshot contains 157, and the branch head before this fix contained 158 (a partial reconciliation edit committed in 18a8e54f). This is deterministic catalog/snapshot drift, not a timing flake.

Root cause chain:

1. `241205d7` (daemon(1808), an ancestor of main) upgraded `@earendil-works/pi-ai` from 1.0.4 to 1.4.0. The 1.4.0 catalog derives 162 vendors; the 1.0.4 catalog derives 157.
2. `0117480a` (server(1774), main HEAD) introduced `model-roster-data.ts` with a 157-vendor snapshot, exactly the pi-ai 1.0.4 derivation, while main's lockfile already pinned 1.4.0. The implementing environment generated the snapshot against the pre-upgrade catalog.
3. Main's `check` went red the moment `0117480a` landed: GitHub run `40351380688` fails the same assertion with `expected { vendors: { …(162) }, …(1) } to deeply equal { vendors: { …(157) }, …(1) }`.

The lockfile pins `@earendil-works/pi-ai@1.4.0` with integrity `sha512-hQM/C4+1w8rHYACzDDf+0vQMnEnpzIop1tptIERVgR3ZeT/hHSzBNG8PaWPgxWQjqSeKCyBZSyp8uTT6eKK1pQ==`; the tarball served by the registry today hashes to exactly that value and its `dist/providers/data` is byte-identical to the installed one, so branch and main install the identical catalog. The latest completed `pr-evidence` check on PR #1873 succeeds; the only red check is `check`.

## Fix on this branch

The branch already carried a partial reconciliation (157 to 158 vendors). Completed it by adding the four remaining catalog entries to `MODEL_VENDORS`:

- `claude-haiku-5-5`: Anthropic
- `codestral-2508`: Mistral
- `gemini-4-argon`: Google
- `gemini-pro-latest`: Google

The roster snapshot now equals the roster derived from the installed `@earendil-works/pi-ai@1.4.0` catalog: 162 vendors and 3 aliases, zero key or value differences. See [final-roster-green.log](final-roster-green.log) for the green runs, including the CI-parity `VITEST_PROJECT_SET=light pnpm test` step (362 files, 5131 tests). Since the same drift is what makes main red, merging this branch repairs main's roster as well.

## Reproduction (pre-fix baselines)

The roster test was run with the committed HEAD roster snapshot and again with the snapshot read directly from `origin/main`, both under `flock /tmp/cairn-heavy.lock`:

```sh
flock /tmp/cairn-heavy.lock pnpm exec vitest run apps/server/test/merge-gate-model-roster.test.ts
```

Both runs exit 1, reporting 162 received vendors versus 158 (HEAD) and 157 (origin/main) expected vendors. See [HEAD baseline](ci-roster-baseline.log) and [main baseline](main-roster-baseline.log). The four token-cost tests pass; see [worktree results](worktree-tests.log).
