# Transfer an issue to Cairn intake

Preview with the local CLI, then omit `--dry-run` to apply:

```sh
node scripts/ops/transfer-to-cairn.mjs 17 --dry-run
node scripts/ops/transfer-to-cairn.mjs 17 --agent orb-builder
```

Options: `--repo owner/repo` (default `xiechimon/cairn`), `--state-dir`
(default `~/.local/state/overnight`), `--lanes-dir` (default `~/lanes`),
`--agent name`, and `--lock-timeout seconds` (default 900). Requires `gh`
with `pr view --json closingIssuesReferences,commits`, and Python 3 for
`fcntl.flock` on `lock2`.

The transfer refuses closed issues, an existing lane directory or process,
a `lane/N` branch, or an open PR claiming the issue. PR ownership checks
cover lane branches, closing keywords in titles, bodies and commit messages,
and GitHub's `closingIssuesReferences`. Refusals identify the PR and whether
its commit or closing reference claims the issue. All open PRs are enumerated
through the paginated API; each PR's commits and closing references are read
with `gh pr view`.

The apply path takes `lock2` and repeats the ownership, label and list reads.
It appends exactly `N\n` to `never` with one O_APPEND write if absent, then
PATCHes the labels. It never truncates, replaces or removes any list, and
leaves every byte of `pending`, `mine` and `hold` untouched. Existing dispatch
paths honor `never`, including retries from `pending` and `mine` through
`dispatch-issue.sh`. A nonempty `never` file without a final newline refuses
an absent issue with `never-missing-newline`; repair that file before retrying.

The JSON plan retains `lists`: `pending`, `mine` and `hold` report the issue's
observed membership as booleans; `never` is `appended` or `already`. The CLI
prints this plan before acquiring the lock, so `appended` describes the planned
action in a dry run or a run that fails before applying. The returned result
from `transferToCairn` reflects the reads repeated under the lock.

Labels retain unrelated values, remove other `by:*` and the supported batch
labels, and add `by:cairn`, `ready-for-agent` and the optional `agent:name`.
A repeated successful run makes no changes.

If the label PATCH fails, the error reports `never: appended` or `never: already`
and tells the operator to rerun the transfer. The safety entry remains in
`never`, including an entry appended by this run. The documented redo is to
rerun the same command after resolving the GitHub error; the retry reuses the
entry and retries the labels. There is no list rollback. A lock timeout leaves
all lists and labels unchanged.

Run the offline CLI and filesystem regression tests with:

```sh
node --test scripts/ops/transfer-to-cairn.test.mjs
```
