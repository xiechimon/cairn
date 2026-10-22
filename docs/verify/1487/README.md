# #1487 evidence: a merge that finishes after its card was cancelled does not land

Base = `29e60bb7` (origin/main). Decision on the ticket: option a.

`apps/server/src/services/machines.ts` `finishStep`: a merge step's success report on a card that is `closed` or `todo` skips `applyMergeLanding`, and `applyMergeLanding` checks the card again synchronously right before `updateBranchRef`, so a close during its git checks is caught too. The hosted repo's default branch stays put, and a system row `MERGE_NOT_LANDED_NOTE` goes on the build's timeline. A card marked done during the merge still lands, as before. `apps/server/src/services/builds.ts` `requestMerge` answers 409 when the build already has a merge step pending, waiting for quota or claimed; the check runs first, before `restoreFailedReview` and the GitHub probe.

Tests in `apps/server/test/m3b-machine-git.test.ts` run against a real hosted bare repo:

| file | machines.ts, builds.ts | result |
|---|---|---|
| `old-leg.txt` | origin/main | 4 failed. After a close, after a close during the landing's git checks (1b, via a `listBranches` spy), and after close + reopen, `main` was fast-forwarded to the conv commit; a second merge request answered 202. The two existing landing tests (lands in review; non-fast-forward fails) pass |
| `new-leg.txt` | this branch | 6 passed |

`integration.txt`: four integration tests that request merges or move cards to todo (real server + daemon), 14 passed.
