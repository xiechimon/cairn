# Release workflow invariant evidence

Measured: `gap.log` runs the unchanged assertions from main commit `ecbb5e8878cee303ee9504385551f41ccddd4b2b` against the real workflow and all 22 single-edit, in-memory fixtures. The unchanged workflow passes all 14 main tests. Main accepts 21 fixtures, rejects the unpinned cache action, and reports no errors. Every fixture replacement must match exactly once.

The reproducible runner is [`gap-runner.mjs`](gap-runner.mjs). It takes the main test file path and the workflow path, reads the fixture definitions from the current release tests, and executes main's assertions against each candidate without changing the workflow:

```sh
git show ecbb5e8878cee303ee9504385551f41ccddd4b2b:scripts/release-config.test.mjs > /tmp/2179-main-release-config.test.mjs
node docs/verify/2179/gap-runner.mjs /tmp/2179-main-release-config.test.mjs .github/workflows/release.yml > docs/verify/2179/gap.log
node --test scripts/release-config.test.mjs > docs/verify/2179/green.log 2>&1
```

Importing the branch test file would execute its top-level tests. The runner therefore extracts the exported `workflowFixtures` binding with a regex and asserts that extraction returns exactly 22 fixtures. It awaits async test bodies, distinguishes assertion failures (`REJECT`) from other exceptions (`ERROR`), and exits unsuccessfully when any candidate has an error.

Measured: `green.log` shows all 27 final tests passing: the changeset ignore-list and manifest checks, the whole-file baseline, CRLF normalization, the publish-only token declaration, and all 22 fixture rejections. Every fixture returns exactly `['release workflow must match the pinned text']`. The baseline compares the entire workflow literal after normalizing CRLF to LF, so any other text change fails with a line diff. Absolute local paths in evidence logs are replaced with `<worktree>`.

| Fixture | Main assertions |
| --- | --- |
| 1. Top-level OIDC permission | Accepted |
| 2. Publish rebuild | Accepted |
| 3. Publish recursive build | Accepted |
| 4. Renamed plan output | Accepted |
| 5. Publish filtered build | Accepted |
| 6. Publish pack command | Accepted |
| 7. Publish cache action | Rejected: unpinned action |
| 8. Comment before appended publish command | Accepted |
| 9. Flow-style build step | Accepted |
| 10. Extra spaces before run key | Accepted |
| 11. Quoted run key | Accepted |
| 12. Space before uses colon | Accepted |
| 13. Unquoted install continuation | Accepted |
| 14. Fourth job with OIDC permission | Accepted |
| 15. Publish step shell | Accepted |
| 16. Publish step environment injection | Accepted |
| 17. Publish checkout ref input | Accepted |
| 18. Different publish checkout SHA | Accepted |
| 19. Publish job container | Accepted |
| 20. Top-level OIDC permission after comment | Accepted |
| 21. Top-level env between pack and publish | Accepted |
| 22. Escaped pack OIDC permission keys | Accepted |

Measured: fixture 22 failed against the previous partial checker before the whole-file pin was applied. It inserts YAML double-quoted `"\x70ermissions"` and `"id-\x74oken"` keys after the pack job's `needs: config` line. The whole-file comparison rejects these bytes without needing to decode YAML.

`red.log` preserves the earlier negative control for the original seven fixtures: 22 tests, 15 passing and seven failing. It is historical evidence, separate from the current 27-test suite.

Retro: partial comparisons left undecoded encodings outside the security check. The whole-file pin removes that gap, while fixture 22 preserves the reproduced bypass as a negative control. The runner's fixture-count assertion and separate error outcome prevent incomplete extraction or execution errors from appearing as successful rejection evidence.
