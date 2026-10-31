# Host control scripts

Copies of the scripts that drive the lanes on the omarchy host. `tools/` mirrors `~/.cairn/tools/` and `lanes/` mirrors `~/lanes/`. The first commit that added this directory is the host state as it was measured, with only host-specific values in `tools/backup/db-backup.sh` parameterised (`CAIRN_REPO`, `CAIRN_BACKUP_REMOTE`).

**The host still runs its own copies.** Nothing here is wired to a unit yet. A follow-up will point the units at a checkout and add a deploy-from-main step like `~/.cairn/tools/review-gate/deploy-from-main.sh` (fetch `origin/main`, skip when the tree hash is unchanged, run the copy's tests, then install it and record the deployed tree). Until then a change here does not change host behavior, and a host edit does not appear here.

Not copied: `~/.cairn/tools/app-token/package.json`, its lockfile and `node_modules` (the host installs `@octokit/auth-app` there), `review-gate/` (already in `scripts/ops/review-gate/`), `backup/record-backup-status.sh` (identical to `scripts/ops/record-backup-status.sh`), `.bak` files, logs and state. `tools/eval-env.sh` reads the relay settings from the host's pi config and holds no value itself.

Units are the host's `cairn-<name>.service` user units. "Called by" lists scripts that invoke the script directly; `main-watch.sh` is itself run by `cairn-main-watch.service`.

| Script | Run by | Purpose |
|---|---|---|
| `tools/backup/db-backup.sh` | `cairn-db-backup.service` | Wraps `scripts/ops/backup-server-db.sh`, syncs attachments, pushes both to the rsync remote |
| `tools/eval-env.sh` | sourced by `cairn-eval-weekly`, `cairn-learn-eval`, `cairn-memory-regression`, `cairn-review-eval` | Exports the eval relay URL and key without printing them |
| `tools/app-token/as-bot.sh` | every bot caller below | Runs one `gh` or `git` command with a 1h App installation token in that process only, after `as-bot-policy.mjs` approves it (see below) |
| `tools/app-token/as-bot-author.sh` | by hand | Sets the bot as git author and committer; no network, no token |
| `tools/app-token/token.mjs` | `as-bot.sh` | Mints the installation token from `~/.cairn/cairn-bot.json`; holds no secret and reads the key from the path in that file |
| `tools/merge-pr.sh` | called by `overnight/driver.sh`, `rearm-automerge.sh` | Rebase-merges a PR as the bot after dependency and commit-author checks |
| `tools/rearm-automerge.sh` | called by `overnight/driver.sh` | Disarms and re-arms auto-merge on bot PRs whose merge state changed |
| `tools/overnight/driver.sh` | `cairn-overnight.service` | Per-lane loop: rebase, sign, push, open PRs, fix red CI, merge |
| `tools/plan/plan-issues.sh` | `cairn-plan-issues.service` (under `flock`), called by `lanes/run-worker.sh` | Writes an implementation plan into issues that lack one |
| `tools/reminders/resume-1727.sh` | `cairn-resume-1727.service` | One-off reminder that releases the held Web Push ticket |
| `tools/schedule/issue-schedule.mjs` | `cairn-issue-schedule.service` | Rewrites the scheduling issue from `batch:*` labels |
| `tools/main-watch/main-watch.sh` | `cairn-main-watch.service` | Opens `main-red` issues for failing main checks and runs the scripts below each tick |
| `tools/main-watch/{codex-watch,gh-health,model-health,tmp-clean}.sh` | `main-watch.sh` | Quota, GitHub API, model and temp-directory health |
| `tools/governor/aged-prs.sh` | `main-watch.sh` | Pushes PRs open over 48h: lane PRs re-dispatch, `codex/`, `claude/` and `cursor/` branches get a `stale-pr` issue, other branches get a worktree worker |
| `tools/governor/{block-governor,brake,lane-health,lane-sentinel}.sh` | `main-watch.sh` | Close blocked PRs after fix rounds, pause dispatch, report failing workers and red main |
| `tools/governor/{selfcheck,split-issue,tier}.sh` | `driver.sh`, `block-governor.sh`, `dispatch-issue.sh` | Pre-push self-check, ticket splitting, ticket tier lookup |
| `tools/governor/weekly-blocks.sh` | `cairn-weekly-blocks.service` | Weekly summary of review-gate block reasons |
| `tools/governor/orchestration-report.sh` | by hand | Orchestration report |
| `tools/merge-order/{lanes-retry,queue,stale-prs}.sh` | `main-watch.sh` | Retry lanes with no commit, update queued PR branches, flag stale PRs; `lanes-retry.sh` also dispatches the `pending` list |
| `tools/merge-order/deps-open.mjs` | called by `dispatch-issue.sh`, `lanes-retry.sh`, `merge-pr.sh` | Exits non-zero and names open dependencies of an issue |
| `tools/weekly/evidence-prune.sh` | `cairn-evidence-prune.service` | Weekly evidence prune PR (ADR 0022) |
| `tools/weekly/{eval-weekly,learn-eval,memory-regression}.sh`, `baseline-record.mts` | `cairn-eval-weekly`, `cairn-learn-eval`, `cairn-memory-regression` | Weekly evals; `eval-weekly.sh` here is the older host copy of `scripts/ops/eval-weekly.sh` |
| `lanes/dispatch-issue.sh` | called by the governor, `main-watch` and `merge-order` scripts | Starts a lane worker for an issue after the gates below |
| `lanes/{build-prompt,run-worker,test-build-prompt}.sh` | `dispatch-issue.sh` | Render the worker prompt, run the worker, test the prompt renderer |
| `lanes/{sign-commits,rebase-main,finish-branch,regen-migration}.sh` | `driver.sh`, `aged-prs.sh`, by hand | Re-sign, rebase, push and regenerate migrations for a lane branch |
| `lanes/{deploy-omarchy,wait-rr}.sh` | by hand | Deploy and wait helpers |

## Documented behavior covered by tests

`node --test scripts/ops/host/*.test.mjs` drives the scripts with stub `gh`, `git`, `flock`, `setsid` and `nohup` on `PATH` and a scratch `HOME`.

- `dispatch-issue.sh` exits 3 for a non-OPEN or unreadable issue state (a `main-red` note bypasses that check) and for an issue on the `never` list, before it reads the state. It does not look at `by:batch` or `batch:B*`/`batch:C*` labels today; a test pins that, and a later change that adds the refusal should replace it.
- `aged-prs.sh` treats `codex/`, `claude/` and `cursor/` branches as foreign (a `stale-pr` issue, no worker), re-dispatches `lane/N` unless `N` is on `hold` or `never`, and handles each PR head once. Any other prefix is not foreign: it gets a worktree worker.
- The `never` list wins over `pending`: `lanes-retry.sh` hands a pending ticket to `dispatch-issue.sh`, which refuses it, and the ticket stays pending.

## as-bot allowlist (#2379)

**The host still runs its own `as-bot.sh`, which has no allowlist.** The repo copy adds `tools/app-token/as-bot-policy.mjs`; `as-bot.sh` runs it before minting a token and exits 126 with `as-bot: refused: <reason>` on a denied command, so a refused command never gets a token. A later deploy must copy `as-bot.sh`, `as-bot-policy.mjs` and `token.mjs` together. `scripts/ops/secret-reach/broker.mjs` (#2189) scopes the token's permissions and has no command allowlist, so nothing there was reusable; the two layers stack.

Allowed: `gh pr view|list|comment|create|close|update-branch`, `gh pr edit` with only `--add-label`/`--remove-label`, `gh pr merge --disable-auto`, `gh pr merge <pr> --rebase|--squash [--auto] --match-head-commit <40-hex sha>`, `gh issue view|list|comment|create|edit|pin`, `gh api` with method GET and no body fields, `git fetch` of `origin`, `git commit`, `git rebase` (no `--exec`, no `-i`), `git -C <dir> ...`, and `git push origin <src>:<branch>` where the branch is not `main`/`master`, optionally with `--force-with-lease`, `--no-verify`, `-u`, `-q`.

Added beyond the first list because current callers need them: `gh pr close`, `gh pr update-branch`, `gh issue pin`, `gh pr merge --disable-auto` (it only disarms), `git commit`, `git rebase`, `git -C`, and `git push --force-with-lease` (lane branches are rewritten by rebase; a lease never overwrites commits the pusher has not seen).

Denied: any other `gh` group (`variable`, `secret`, `repo`, `label`, `ruleset`, `auth`, `alias`, ...), `gh pr merge` in any other form (no `--match-head-commit`, a malformed sha, both or neither of `--rebase`/`--squash`, `--merge`, `--admin`, `--delete-branch`, `--body`/`--subject` or any other flag, `--disable-auto` combined with anything), `gh pr edit` of anything but labels, `gh api` with `-X`/`--method` other than GET, with `-f`/`-F`/`--input` (implicit POST) or `graphql`, `git push` with `--force`, `-f`, `--delete`, `-d`, `--mirror`, `--all`, `--tags`, `-o`, a `+` or empty-source refspec, a non-`origin` remote, no explicit refspec, a ref outside `refs/heads/`, or `main`/`master` as the destination, `git -c`, `git fetch --upload-pack`, any other `git` subcommand, and any program other than `gh` and `git` (so `bash -c` cannot wrap a denied command).

### Callers on the host

Measured with `grep -rn as-bot` over `~/.cairn/tools`, `~/lanes/*.sh` and `~/.config/systemd/user` (no unit references it), plus this repo. Commands each caller passes:

| Caller | Commands | Under the policy |
|---|---|---|
| `tools/overnight/driver.sh` | `git push -q --no-verify --force-with-lease origin HEAD:lane/N`, `gh pr create` | allowed |
| `lanes/finish-branch.sh` | `git push -q --no-verify --force-with-lease origin HEAD:<branch>` | allowed |
| `lanes/rebase-main.sh` | `git rebase -q origin/main`, `git rebase --continue` | allowed |
| `lanes/regen-migration.sh` | `git rebase -q -X theirs origin/main`, `git commit -qm ... --no-verify` | allowed |
| `lanes/sign-commits.sh` | `git commit -q --no-verify --allow-empty -m` | allowed |
| `tools/governor/split-issue.sh` | `gh issue create`, `gh issue comment` | allowed |
| `tools/governor/block-governor.sh` | `gh issue comment`, `gh pr close` | allowed |
| `tools/plan/plan-issues.sh` | `gh issue edit --body-file -` | allowed |
| `tools/merge-order/queue.sh` | `gh pr update-branch --rebase` | allowed |
| `tools/reminders/resume-1727.sh` | `gh issue create`, `gh issue edit --remove-label`, `gh issue comment` | allowed |
| `~/.cairn/tools/review-gate/retro-review.sh` (not mirrored) | `gh issue create` | allowed |
| `tools/schedule/issue-schedule.mjs` | `gh issue create|edit|comment|pin` | allowed |
| `scripts/ops/review-gate/review-gate.mjs` | `git fetch -q origin main pull/N/head:review-gate-N --force`, `gh pr comment --body-file -`, `gh pr merge --disable-auto` | allowed |
| `tools/rearm-automerge.sh` | `gh pr merge --disable-auto` | allowed |
| `tools/weekly/evidence-prune.sh` | `git fetch`, `git commit`, `git push -u origin <branch>`, `gh pr create`, `gh pr merge --squash --auto --match-head-commit <sha>`, `gh pr comment` | allowed |
| `tools/merge-pr.sh` | `gh pr merge <n> --rebase --match-head-commit <sha> [--auto]` for bot-opened PRs | allowed |

Merge decision (C1 session, recorded in the PR): bot merges are narrowed, not removed. `gh pr merge` passes only when pinned with `--match-head-commit` to the head the caller checked, with exactly one of `--rebase`/`--squash` and optionally `--auto`; `merge-pr.sh` pins the head it read before its gate checks, and `evidence-prune.sh` pins the branch head it pushed and commits with a direct `git commit` instead of `bash -c`. `as-bot-callers.test.mjs` runs both scripts through the real `as-bot.sh` and policy. The policy has no override switch.
