# Screenshot archive provenance

Screenshot evidence must use `https://raw.githubusercontent.com/<repository>/<ref>/docs/verify/<issue>/<file>` where `<ref>` is a full commit SHA (40 hex for SHA-1, 64 hex for SHA-256). Branch and tag refs are mutable and are rejected; a regression rejects them with an archive verdict. The repository is the fresh PR API response's `base.repo.full_name`. All pages of the PR commits API supply commit messages; closing keywords associate issues in that repository. Short issue numbers, qualified repository references, and full GitHub issue URLs are supported. PR body closing keywords are not required or trusted as association context.

Any associated issue archive is accepted when multiple issues are associated. Screenshots fail with an archive verdict when repository or issue context is absent. A PR without an associated issue can still contain ordinary references and decorative badges, but cannot submit screenshot evidence without associating an issue in a commit message.

Decorative exemptions are restricted to Cursor's four `open-in-{web,cursor}-{dark,light}.png` assets and Shields' `/badge/<badge>` paths. Neither host is exempt in general. Embedding and HTTP checks still apply to badges. Ordinary issue, document, JSON, and log references are outside image checks.

## Verification

Before implementation, two additional tests failed against the inherited partial implementation: a valid archive URL with an HTML-escaped fixture query incorrectly passed, and a commit using a full GitHub issue URL failed association. The implementation preserves the image extraction and fixture checks from merged PR #1992 and fixes association parsing.

`sha-red.log` records the review-gate finding red run: the full-SHA regression rejects branch (`main`, `dev`), tag (`v1.0.0`) and short-SHA (`abc1234`) refs, each of which the inherited gate accepted as `archived`. `regression.log` records the same archive/workflow tests, extraction tests, prepush tests, and the required-check workflow shape gate passing after the ref check was pinned. HTTP is fixed at 200 in archive tests, so reachability cannot hide provenance failures. The workflow test executes the actual context-fetch shell step against a fake paginated GitHub API and inspects the resulting context file.

`replay.log` runs the gate over the ten most recently merged PR bodies with the real context the workflow would build (fresh `base.repo.full_name` and all pages of each PR's commits API, including branch commits whose messages carry the closing keywords). Eight pass. PR #2022 and #2016 fail with an archive verdict because their evidence links use abbreviated SHAs (`3ca26c99`, `c50e55a5`) in the raw ref segment; both merged under the old gate before the full-SHA requirement. Their associated issues (1786, 2009) are correctly extracted from branch commit messages, so the failures come from the ref segment, not from association. PR #2020 and #2013 carry no closing keyword in their branch commits (their keyword lives in the squash commit that landed on main) but are green with zero image links; the replay therefore does not show an association-less body being silently excused from provenance checking.

The archive regression suite is in both local and CI prepush plans. No product servers are needed for this script-only change.
