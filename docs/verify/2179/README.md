# Release workflow invariant evidence

Measured: `gap.log` runs the unchanged assertions from `origin/main` (`ecbb5e8878cee303ee9504385551f41ccddd4b2b`) against the real workflow and all 20 single-edit, in-memory fixtures. Main accepts 19 fixtures and rejects the unpinned cache action. Every fixture replacement must match exactly once.

The reproducible runner is [`gap-runner.mjs`](gap-runner.mjs). It takes the main test file path and the workflow path, reads the fixture definitions from the current release tests, and executes main's assertions against each candidate without changing the workflow:

```sh
git show ecbb5e8878cee303ee9504385551f41ccddd4b2b:scripts/release-config.test.mjs > /tmp/2179-main-release-config.test.mjs
node docs/verify/2179/gap-runner.mjs /tmp/2179-main-release-config.test.mjs .github/workflows/release.yml > docs/verify/2179/gap.log
node --test scripts/release-config.test.mjs > docs/verify/2179/green.log 2>&1
```

Measured: the final invariant suite rejects every fixture with the rule shown below. Header and publish checks compare exact literal text, including action SHAs and version notes. The job set, token scope and pack output checks remain explicit.

| Fixture | Main assertions | Exact invariant check |
| --- | --- | --- |
| 1. Top-level OIDC permission | Accepted | Rejected: release workflow header must match the pinned text |
| 2. Publish rebuild | Accepted | Rejected: publish job must match the pinned text |
| 3. Publish recursive build | Accepted | Rejected: publish job must match the pinned text |
| 4. Renamed plan output | Accepted | Rejected: pack plan output key |
| 5. Publish filtered build | Accepted | Rejected: publish job must match the pinned text |
| 6. Publish pack command | Accepted | Rejected: publish job must match the pinned text |
| 7. Publish cache action | Rejected: unpinned action | Rejected: publish job must match the pinned text |
| 8. Comment before appended publish command | Accepted | Rejected: publish job must match the pinned text |
| 9. Flow-style build step | Accepted | Rejected: publish job must match the pinned text |
| 10. Extra spaces before run key | Accepted | Rejected: publish job must match the pinned text |
| 11. Quoted run key | Accepted | Rejected: publish job must match the pinned text |
| 12. Space before uses colon | Accepted | Rejected: publish job must match the pinned text |
| 13. Unquoted install continuation | Accepted | Rejected: publish job must match the pinned text |
| 14. Fourth job with OIDC permission | Accepted | Rejected: jobs must be exactly config, pack and publish |
| 15. Publish step shell | Accepted | Rejected: publish job must match the pinned text |
| 16. Publish step environment injection | Accepted | Rejected: publish job must match the pinned text |
| 17. Publish checkout ref input | Accepted | Rejected: publish job must match the pinned text |
| 18. Different publish checkout SHA | Accepted | Rejected: publish job must match the pinned text |
| 19. Publish job container | Accepted | Rejected: publish job must match the pinned text |
| 20. Top-level OIDC permission after comment | Accepted | Rejected: release workflow header must match the pinned text |
| 21. Top-level env between pack and publish | Accepted | Rejected: jobs must be exactly config, pack and publish |

Measured: `green.log` shows all 33 final tests passing: the unchanged workflow, all 21 fixture rejections, missing boundary lines returning violations, and the remaining pin-format, changeset-config, manifest, pending-changeset and ordering checks. Assertions duplicated by the pinned header and publish text were removed. Absolute local paths in evidence logs are replaced with `<worktree>`.

`red.log` preserves the earlier negative control for the original seven fixtures before the first invariant implementation. The follow-up regression run against the indentation parser passed the original 21 tests and failed all 13 new fixture tests plus the missing-boundary test; the final suite in `green.log` closes that gap.
