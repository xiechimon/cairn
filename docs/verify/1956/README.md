# Issue 1956 verification

## Command reference

`node scripts/review-escapes.mjs --traces traces.json` consumes the resolved trace array from issue #1955. It prints JSON by default. `--format text` prints the same weekly counts and evidence links as readable text.

The command calls GitHub REST through `gh api` using GET requests only. It retrieves each originating PR once and paginates its formal reviews and issue comments. It does not collect candidates, resolve attribution, modify GitHub, or export reviewer-bank cases.

Each UTC week starts on Monday. Each path counts distinct originating PRs in that week. Follow-up event counts use distinct originating PR and follow-up commit pairs. An event qualifies when the resolver identifies an originating PR and the follow-up occurs between merge and exactly 14 days after merge, inclusive. Outside-window records remain in `excluded`. Unresolved attribution remains in `events` and has separate totals.

The paths are `ai-only`, `human-only`, `mixed`, and `unknown`. Formal reviews must precede merge and identify a valid reviewed commit. Human reviews on earlier commits returned by the originating PR's review endpoint qualify as review activity; each formal record discloses whether it matches the merged head, which is also retained in the report. Formal AI reviews require APPROVED state. Pending and dismissed records do not qualify. Known AI bot accounts are listed in `AI_REVIEWERS`; GitHub accounts typed `User` establish human review. This describes the account identity, not whether a person used AI tools.

Gate evidence must come from the recorded Cairnwright app and match the published header, full head SHA, and patch marker. Both comment creation and its latest edit must precede merge. A carried-over PASS also requires a preceding direct PASS with the referenced head prefix and matching patch marker. The report links both comments. A BLOCK records AI review activity without implying approval.

Missing, stale gate, post-merge, or unrecognized evidence yields `unknown`. An unavailable endpoint or incomplete pagination also yields `unknown`, while retaining any evidence already retrieved. Reports disclose unresolved attribution and unavailable review data separately. They do not compute an escape rate because no reviewed-PR denominator is available.

## Evidence

- `red.log`: the first CLI test fails before the command exists.
- `coverage-red.log`: gate recognition, aggregation, API failure handling, and CI registration fail before implementation.
- `block-red.log`: the captured BLOCK layout exposes an overly strict verdict position check.
- `outside-window-red.log`: the upstream outside-window status exposes incorrect unresolved totals.
- `green.log`: 10 CLI tests pass against recorded gate evidence and controlled REST response fixtures.
- `lint.log`, `typecheck.log`, and `spec-parse.log`: repository checks pass.
- `prepush-tests.log`: all 16 prepush plan tests pass.
- `vitest.log`: `flock /tmp/cairn-heavy.lock node scripts/prepush-vitest.mjs` passes with no affected Vitest files.

The CLI tests replace only the external `gh` executable. The replacement rejects every invocation except a two-argument `gh api <endpoint>` GET. The tests execute the real CLI, assert the requested originating PR review pages, and inspect JSON and text outputs.

The open and recently merged PR lists were inspected before editing. No open PR overlaps the changed code files. Recently merged #2060 and #2120 also changed `scripts/prepush.mjs`. This change adds one test command and removes no existing checks. Their trace collection, resolution, and case export implementations remain untouched.

No server was started. No GitHub writes, dependency changes, git staging, commits, or pushes were performed. `COMMIT_MSG.txt` supplies the commit message for the sandbox handoff.

## Continuation verification

The existing implementation was continued on `lane/1956`. The new failing CLI test reproduced a null-record crash in a GitHub review response. Both formal-review pages and gate-comment pages now reject malformed records and disclose unavailable data as `unknown`, preserving weekly reporting.

Failure modes checked before the change: malformed review records, malformed gate comments, partial pagination, API failures, and accidental definitive classification from incomplete evidence. The regression drives the real CLI and asserts its exit status, review path, unavailable event total, and failed evidence URL.

- `malformed-page-red.log`: the test fails before implementation with a null state dereference.
- `malformed-page-green.log`: all 11 CLI tests pass after response-page validation.
- `continuation-tests.log`: CLI and prepush-plan regressions.
- `continuation-typecheck.log`, `continuation-lint.log`, `continuation-spec-parse.log`, and `continuation-vitest.log`: checks repeated in this continuation.

Read-only overlap lookup on 2026-10-28 used terms `1956` and `review escapes` and both report code paths. It identified this issue and related merged #2110, with no open file overlaps. The separately requested open and last-30-merged PR lists also identified #2120 as related tracing/export work. Those implementations remain unchanged. Live PR #2120 comments were re-read and confirmed the recorded production gate header, App identity, and patch marker formats.

## Review self-check corrections

The multiweek fixture has six qualifying events, including the event exactly 14 days after merge. Five occur strictly before that boundary. The documentation now identifies the boundary event, and the CLI regression compares its documented count with the actual output. The separate unresolved, duplicate, and two outside-window events remain excluded from the qualifying total.

The no-rate assertion now checks the complete readable report against the expected count-and-evidence output, rejects numeric percentages and count ratios, and restricts JSON summary fields. `rate-negative-control.log` demonstrates that injecting `Escape rate: 1/2 (50%)` makes this assertion fail even with the denominator disclaimer intact.

Formal AI reviews in CHANGES_REQUESTED or COMMENTED state no longer establish coverage. Formal human reviews on earlier commits of the originating PR remain evidence of review activity; `matchesMergedHead` and `mergedHeadSha` disclose their scope. Production gate recognition still requires the merged head and retains explicit PASS or BLOCK verdicts.

- `review-fixes-red.log`: the documentation boundary assertion and the two classification regressions fail before the fixes.
- `review-fixes-green.log`: the CLI and prepush-plan tests pass after the fixes.
- `review-fixes-typecheck.log`, `review-fixes-spec-parse.log`, `review-fixes-vitest.log`, and `review-fixes-lint.log`: repository verification for this round.

The requested open and last-30-merged PR queries found no overlaps with these four implementation, test, and documentation files. No recently merged PR lines were removed. No server was started and no GitHub writes were performed.
