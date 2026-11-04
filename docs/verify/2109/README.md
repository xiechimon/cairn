# Site deployment root regression

## Problem and evidence

Issue #2109 records Vercel CLI 65.5.0 rejecting the nonexistent
`site/site` directory. The deployment command supplied `site/`, while
#1674 records the project's Root Directory as `site`. The CLI deployment
source validates the project root relative to the supplied directory:
https://github.com/vercel/vercel/blob/main/packages/cli/src/commands/deploy/index.ts
This source link tracks main, not the exact CLI release from the failed run.

#1921 records an earlier repository-wide upload failure. Removing the
positional directory therefore needs an upload filter as well. The workflow
now writes a temporary `.vercelignore` that includes only `site/`, then
deploys from the checkout root. Keeping the filter inside the workflow avoids
changing other Vercel projects that consume this repository.

## Regression

Failure modes covered before the fix: doubled project root, repository-wide
uploads, missing site configuration, unintended pull request deployment, and
widening the deployment trigger beyond site content. Workflow-only changes
are deployed through `workflow_dispatch` by a maintainer instead of a
self-trigger on the workflow's own path.

Run `node --test scripts/ci-job-structure-gate.test.mjs`.

- `red.log`: both new cases fail against the original workflow.
- `green.log`: all ten cases pass after the fix.
- The command runs against a recording npx stub without credentials or network.
  The test models the recorded project Root Directory and reads the actual
  site page and configuration from the resulting directory.
- The upload-filter command executes in a temporary directory; its generated
  file is checked alongside the main-only site-content trigger, deployment guard,
  production/archive flags, and concurrency protection.

These tests establish workflow structure and shell output, not Vercel's
actual uploaded file list or production behavior. A later production deploy
must succeed without `site/site`, upload only site content, serve the site
and its assets, and retain the `X-Content-Type-Options: nosniff` header.
No production deployment was attempted in this task.

## Overlap

The required open and latest 30 merged PR lists were read before editing.
The repository overlap lookup completed at 2026-10-28T17:27:02.758Z with
terms `2109`, `site deploy`, and `vercel`, covering the workflow and test
paths; no open PR touches either changed implementation file.

Open #1995 (`lane/1667`) and recently merged #2094 touch `site/index.html`;
that file is only an acceptance input and remains unchanged. Related #1907
introduced the workflow and #1914 narrowed the upload target. The issue
requires replacing #1914's positional `site/` argument; the temporary
upload filter preserves its intended site-only scope.

## Local validation

- Node regression: 10 passed; original workflow: 2 new cases failed.
- Full prepush: PASS (30 checks), including lint and the deployment regression.
- Typecheck and spec parse: passed; 1,387 web cases collected and 51 integration files parsed.
- Direct prepush-vitest: passed; no affected Vitest cases were selected.
- English-only, single-use-helper and comment-discipline gates: 0 findings.
- Lessons ledger and git diff whitespace checks: passed.
- Affected E2E: no web surface touched; skipped by the prepush path selector.
- Heavy commands ran serially under /tmp/cairn-heavy.lock.
- No server was started. No push, deployment, staging, or commit was performed.
  COMMIT_MSG.txt contains the handoff commit message, ending in Closes #2109.

The existing formatting gate also caught a test formatting change after an
edit; formatting was applied and the full prepush rerun passed. No new
formatting rule was added.

## Review round 1 (PR #2122)

The independent review gate blocked the first head (`be4f3214`) on one
finding: the push trigger had gained `.github/workflows/site-deploy.yml`,
so a merged edit of this workflow would run its own deployment. The ticket
plan asked for that entry and also required keeping the deployment guard;
the guard wins, and the entry is dropped. The trigger assertion now pins
`paths: ['site/**']` exactly. Workflow-only fixes deploy through
`workflow_dispatch` by a maintainer.

- Finding: `.github/workflows/site-deploy.yml:1` (`on.push.paths`).
- `review-red.log`: the tightened assertion fails on the round-1 head
  (9 pass, 1 fail).
- `review-green.log`: all ten cases pass after restoring the site-only
  filter.

The gate's remaining findings are non-blocking suggestions and stay out of
this round: production upload scope and the `nosniff` header are the issue's
own post-deploy acceptance items, and `vercel@latest` pinning was deferred
by the ticket plan as a separate reproducibility decision.

Round 2 validation, after the fix:

- `review-red.log` / `review-green.log`: the tightened trigger assertion
  went red on the round-1 head and green after the fix (10 of 10).
- `review-prepush.log`: full prepush PASS (30 checks), including lint,
  typecheck, spec parse, the lessons ledger, and the deployment regression.
- `review-prepush-vitest.log`: `node scripts/prepush-vitest.mjs` passed;
  no affected Vitest case was selected.
- English-only, single-use-helper, comment-discipline, and lessons-ledger
  gates: 0 findings. Heavy commands ran serially under
  `/tmp/cairn-heavy.lock`.
- Affected E2E: no web surface touched; skipped by the prepush path
  selector. No server was started. No push or deployment was performed.

## Handoff self-check

The follow-up request supplied no additional self-check findings. The existing
`d100fa66` commit already addresses PR #2122's blocking trigger finding, with
its test-first negative control preserved in `review-red.log`.

The handoff rerun passed all ten deployment regression tests, the direct
`prepush-vitest` command (no affected tests selected), and full prepush
(30 checks), including lint, typecheck and spec parse. The English-only,
single-use-helper and comment-discipline gates each reported zero findings.
Heavy checks ran serially under `/tmp/cairn-heavy.lock`. Prepush could not
fetch `origin/main` in the sandbox and used the existing local ref, so this
rerun does not establish compatibility with a newer remote main.

The open PR lists still identify #2122 as this branch's implementation and
#1995 as a separate page change; the latest 30 merged PRs include #2094's
demo work. No implementation lines from those PRs were removed in this round.
No new implementation or test was needed, and no server, deployment or push
was started. The existing root-composition and workflow-trigger lesson entries
already record the two corrected error kinds; no new recurrence was observed.
