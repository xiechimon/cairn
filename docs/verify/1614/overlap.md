# Overlap lookup for #1614

Checked at 2026-10-29T01:34:46Z via `scripts/github-overlap.mjs`.

Terms: `1614`, `harness-eval`, `harness regression auto-dispatch`.
Paths: `packages/shared/src/records/merge-gate.ts`, `.claude/workflows/pr-gate.js`,
`apps/server/test/merge-gate-paths.test.ts`, `scripts/pr-gate-selfcheck.mjs`,
`docs/verify/1614/README.md`.

## Same ask

- #1614 (this ticket). Proceed.
- Recent merges that already shipped the dispatch stack: #2125 (#1977+#1979),
  #2118 (#1979), #2077 (#1975), #2104 (#2078/#1973). This PR extends them by
  protecting server-side `harness-eval-*.ts` and closes the parent.

## Related, not same ask

- #2079 / #2080: remaining #1975 worker/docs follow-ups on omarchy evidence.
- #1777 / #1831: eval baselines and ablations.
- Open #2116 touches unrelated eval plan-rejection work; no shared paths in
  `filePulls` (empty).

## Disposition

No open PR owns this ask. Build a new branch from `origin/main`.
