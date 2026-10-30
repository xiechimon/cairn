# Release workflow invariant evidence

`gap.log` runs the unchanged assertions from `origin/main` (`ecbb5e8878cee303ee9504385551f41ccddd4b2b`) against the real workflow and seven single-edit, in-memory fixtures. Each replacement must match once. The throwaway runner is `/tmp/2179-release-gap.mjs`.

| Fixture | Main assertions | Exact invariant check |
| --- | --- | --- |
| 1. Top-level OIDC permission | Accepted | Rejected: top-level permissions |
| 2. Publish rebuild | Accepted | Rejected: publish run commands |
| 3. Publish recursive build | Accepted | Rejected: publish run commands |
| 4. Renamed plan output | Accepted | Rejected: pack plan output key |
| 5. Publish filtered build | Accepted | Rejected: publish run commands |
| 6. Publish pack command | Accepted | Rejected: publish run commands |
| 7. Publish cache action | Already rejected: unpinned action | Rejected: publish uses actions |

`red.log` shows all seven fixture tests failing before the invariant implementation; local absolute paths are replaced with `<worktree>`. `green.log` shows all 21 final tests passing, including acceptance of the unchanged workflow and rejection of every fixture by its named rule. The exact checks replace the weaker permission, install/build and count-output assertions; the remaining tests retain independent coverage.
