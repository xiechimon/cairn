# Host control scripts

Copies of the scripts that drive the lanes on the omarchy host. `tools/` mirrors `~/.cairn/tools/`, `lanes/` mirrors `~/lanes/`, `bin/` mirrors `~/.local/bin/` and `units/` mirrors `~/.config/systemd/user/`. The first commit that added this directory is the host state as it was measured, with only host-specific values in `tools/backup/db-backup.sh` parameterised (`CAIRN_REPO`, `CAIRN_BACKUP_REMOTE`).

**Deploy.** `scripts/ops/deploy-self.sh` installs `tools/**` into `~/.cairn/tools` and `lanes/**` into `~/lanes` from the commit it just deployed, writes the installed SHA to `~/.cairn/tools/.installed-sha`, and keeps a host file that differs from both the previous and the new revision (reported through one `Host tools differ from main` issue). A host edit does not appear here until someone copies it back. A deploy that writes a unit file runs `systemctl --user daemon-reload` and enables a timer only when its file did not exist before; an existing timer keeps its enablement.

**Drift.** `scripts/ops/host-tools-verify.sh` (read-only, exit 1 on any difference, like `chezmoi verify`) prints `ok`, `DIFF`, `MISSING` or `EXTRA` for every managed file and for every host file under `~/.cairn/tools` that the repo does not own (`app-token/package*.json`, `node_modules`, `agent-desktop/`, `.bak` files and logs are ignored). `host-tools-verify.sh --adopt <host path>...` moves a named DIFF file to `<file>.drift-<sha>-<UTC timestamp>` (refused if that name exists) and installs the repo copy, so a reviewed decision to take main's version needs one command. Run it from `~/Code/AgentProjects/cairn-exec` after a deploy; the deploy itself only reports files it kept.

Not copied: `~/.cairn/tools/app-token/package.json`, its lockfile and `node_modules` (the host installs `@octokit/auth-app` there), `agent-desktop/` (a versioned binary of a separate product, not a cairn host script), `review-gate/` (retired; the host unit `cairn-review-gate.service` is disabled and the directory was deleted 2026-11-06, superseded by the Codex gate in `scripts/ops/review-gate/`), `backup/record-backup-status.sh` (identical to `scripts/ops/record-backup-status.sh`), `.bak` files, logs and state. `tools/eval-env.sh` reads the relay settings from the host's pi config and holds no value itself.

Host inventory (measured 2026-11-06): the managed roots are current (`.installed-sha` matches `main`), `~/lanes` mirrors `lanes/**` exactly, and `~/lanes/cairn` plus `~/.cairn/tools/cairn` are product checkouts, not host tools. The only host files outside `tools/**` and `lanes/**` are the exclusions above; the retired `review-gate/` directory and its disabled unit were deleted.

Units are the host's `cairn-<name>.service` user units. "Called by" lists scripts that invoke the script directly; `main-watch.sh` is itself run by `cairn-main-watch.service`.

| Script | Run by | Purpose |
|---|---|---|
| `tools/backup/db-backup.sh` | `cairn-db-backup.service` | Wraps `scripts/ops/backup-server-db.sh`, syncs attachments, pushes both to the rsync remote |
| `tools/eval-env.sh` | sourced by `cairn-eval-weekly`, `cairn-learn-eval`, `cairn-memory-regression`, `cairn-review-eval` | Exports the eval relay URL and key without printing them |
| `tools/app-token/as-bot.sh` | every bot caller below, and agent sessions | Runs one `gh` or `git` command with a 1h App installation token in that process only, after `as-bot-policy.mjs` approves it (see below). Git runs as `cairnwright[bot]` for author and committer, and `git commit` adds the `CAIRN_COAUTHOR` trailer |
| `tools/app-token/bot-identity.mjs` | `as-bot.sh`, `lanes/sign-commits.sh` | Prints the bot name, its noreply email and the owner co-author trailer from `commit-identity.json`, which deploy installs from `packages/shared/` |
| `tools/app-token/token.mjs` | `as-bot.sh` | Mints the installation token from `~/.cairn/cairn-bot.json`; holds no secret and reads the key from the path in that file |
| `tools/merge-pr.sh` | called by `overnight/driver.sh`, `rearm-automerge.sh` | Leaves a routed PR to Mergify; squash-merges a `lane/*` PR with the human login, pinned to the head it read; refuses a head whose `merge-route` check failed. It reads no review verdict and no hold label |
| `tools/rearm-automerge.sh` | called by `overnight/driver.sh` | Disarms and re-arms auto-merge on bot PRs whose merge state changed |
| `tools/overnight/driver.sh` | `cairn-overnight.service` | Per-lane loop: rebase, sign, push, open PRs, fix red CI, merge |
| `tools/overnight/surface-stuck-rebase.sh` | called by `overnight/driver.sh` | When a lane's rebase worker has failed 3 times on one head, labels the PR `stale-pr` and comments the files `git merge-tree` reports as conflicting with main (the issue when there is no PR), once per head, instead of the driver skipping the lane silently |
| `tools/overnight/lane-replaced.sh` | called by `overnight/driver.sh` | Exits 0 when the lane's issue is closed (prints `closed`) or another open PR closes it (prints that PR, a coordinator-prepared replacement), so the driver skips the lane instead of pushing a duplicate PR or surfacing a finished lane; an unreadable issue also skips |
| `tools/plan/plan-issues.sh` | `cairn-plan-issues.service` (under `flock`), called by `lanes/run-worker.sh` | Writes an implementation plan into issues that lack one |
| `tools/reminders/resume-1727.sh` | `cairn-resume-1727.service` | One-off reminder that releases the held Web Push ticket |
| `tools/schedule/issue-schedule.mjs` | `cairn-issue-schedule.service` | Rewrites the scheduling issue from `batch:*` labels |
| `tools/review-gate-sweep.sh`, `units/review-gate-sweep.{service,timer}` | the timer, every 10 min | Re-dispatches the `review-gate` workflow for open PRs whose `review-gate` check is not `success` 15+ min after the head commit (the GitHub schedule trigger is unreliable) |
| `tools/ci-speed.sh` | by hand, coordinator check-ins | One line of PR and push CI wall time (median, p90, max over the last 60 completed `ci.yml` runs) |
| `bin/cairn-heavy` | every lane, before a whole-repo check | Delegates to the current checkout's shared heavy-slot CLI (default 2, `CAIRN_HEAVY_SLOTS` override); defaults `CAIRN_TEST_TEMP_ROOT` to disk at `~/.cache/cairn-test-tmp` |
| `tools/worktree-reaper.mjs`, `units/worktree-reaper.{service,timer}` | the timer, every 15 min | Runs `git worktree remove` (never `--force`) on each linked worktree of `CAIRN_REPO` (default `~/Code/AgentProjects/cairn`), at any path, that has a clean `git status`, no process whose cwd is inside it, no other worktree inside it, and either a merged or closed PR naming the tree's exact head, closed 30+ min ago, or a HEAD contained in a remote-tracking branch with `HEAD`, `index` and `logs/HEAD` untouched for 3 days (detached baselines, `pr-assets/<name>` trees, branches without a PR). Keeps trees under `~/.t3` (T3 Code manages them) and any tree with an open PR; logs `kept <path>: <reason>` for every other tree and removes nothing when `gh pr list` or `git fetch --prune origin` fails. Open PRs are listed on their own, apart from the 1000 most recent PRs of any state, so an old open PR still keeps its tree. Each run first fast-forwards the main checkout to `origin/main` when it is on `main` with no tracked changes and no local commits (`--no-overwrite-ignore`, so an ignored local file is never replaced), so project skills and hooks loaded from it stay current; otherwise it logs `main checkout: <n> commits behind origin/main, kept: <reason>` and leaves it alone. `--dry-run` prints the plan. Branches stay |
| `tools/test-temp-guard.mjs`, `tools/test-temp-policy.json`, `units/test-temp-guard.{service,timer}` | every 15 min, also started by `main-watch/tmp-clean.sh` | Removes idle stale test entries from `/tmp`, `~/.cache/cairn-test-tmp` and `~/.cache/lane-tmp`; caps lane temp at 5 GiB and warns about pressure |
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
| `lanes/{sign-commits,rebase-main,finish-branch,regen-migration}.sh` | `driver.sh`, `aged-prs.sh`, by hand | Rewrite every lane commit since main to `cairnwright[bot]` with the co-author trailer, rebase, push and regenerate migrations for a lane branch |
| `lanes/{deploy-omarchy,wait-rr}.sh` | by hand | Deploy and wait helpers |

## Documented behavior covered by tests

`node --test scripts/ops/host/*.test.mjs` drives the scripts with stub `gh`, `git`, `flock`, `setsid` and `nohup` on `PATH` and a scratch `HOME`.

- `dispatch-issue.sh` exits 3 for a non-OPEN or unreadable issue state (a `main-red` note bypasses that check) and for an issue on the `never` list, before it reads the state. It does not look at `batch:*` labels today; a test pins that, and a later change that adds the refusal should replace it.
- `aged-prs.sh` treats `codex/`, `claude/` and `cursor/` branches as foreign (a `stale-pr` issue, no worker), re-dispatches `lane/N` unless `N` is on `hold` or `never`, and handles each PR head once. Any other prefix is not foreign: it gets a worktree worker.
- The `never` list wins over `pending`: `lanes-retry.sh` hands a pending ticket to `dispatch-issue.sh`, which refuses it, and the ticket stays pending.

## as-bot allowlist (#2379)

**The host still runs its own `as-bot.sh`, which has no allowlist.** The repo copy adds `tools/app-token/as-bot-policy.mjs`; `as-bot.sh` runs it before minting a token and exits 126 with `as-bot: refused: <reason>` on a denied command, so a refused command never gets a token. A later deploy must copy `as-bot.sh`, `as-bot-policy.mjs` and `token.mjs` together. `scripts/ops/secret-reach/broker.mjs` (#2189) scopes the token's permissions and has no command allowlist, so nothing there was reusable; the two layers stack.

Allowed: `gh pr view|list|comment|create|close|update-branch`, `gh pr edit` with only `--add-label`/`--remove-label`, `gh pr merge <pr> --disable-auto` (nothing else; the bot never merges), `gh issue view|list|comment|create|edit|pin`, `gh api` reads with one endpoint and only `--method GET`, `--paginate`, `--jq`, `--template`, `--include`, `--silent`, `--slurp`, `--cache` (fields only with an explicit GET), `git fetch origin` with `-q`, `-f`/`--force`, `--prune`, `--no-tags`, `git commit`, `git rebase <upstream>` with `-q` and `-X theirs|ours`, or `git rebase --continue|--abort|--skip`, `git -C <dir> ...`, and `git push origin <src>:<branch>` where the branch is not `main`/`master`, optionally with `--force-with-lease`, `--no-verify`, `-u`, `-q`.

Deploy-lag recovery also permits `gh issue close <positive number> -R xiechimon/cairn -c "Caught up: omarchy runs <40 lowercase hex SHA>."`, with `--repo` and `--comment` as equivalent separate flags. No global or duplicate repository flags, URL/zero issue IDs, other messages or extra flags are accepted. `deploy-watch.sh` identifies the issue through the bot author and lag title; failure to close it fails the recovery tick.

Added beyond the first list because current callers need them: `gh pr close`, `gh pr update-branch`, `gh issue pin`, `gh pr merge --disable-auto` (it only disarms), `git commit`, `git rebase`, `git -C`, and `git push --force-with-lease` (lane branches are rewritten by rebase; a lease never overwrites commits the pusher has not seen).

Flags are matched by an allowlist after splitting `--name=value`, so inline values (`--input=-`, `--field=k=v`, `--exec=cmd`) and git's abbreviated long options (`--exe`, `--upload-p`) are refused like their full spellings.

Denied: any other `gh` group (`variable`, `secret`, `repo`, `label`, `ruleset`, `auth`, `alias`, ...), every other `gh pr merge` form (any merge, `--auto`, `--admin`, extra flags or more than one PR), `gh pr edit` of anything but labels, `gh api` with a method other than GET, `--input`, `-H`, `--hostname`, fields without an explicit GET, or `graphql`, `git push` with `--force`, `-f`, `--delete`, `-d`, `--mirror`, `--all`, `--tags`, `-o`, a `+` or empty-source refspec, a non-`origin` remote, no explicit refspec, a ref outside `refs/heads/`, or `main`/`master` as the destination, `git rebase` with `--exec`/`-x`, `-i`, `-s`/`--strategy` or any other flag, `git -c`, `git fetch` with any other flag, any other `git` subcommand, and any program other than `gh` and `git` (so `bash -c` cannot wrap a denied command).

### Callers on the host

Measured with `grep -rn as-bot` over `~/.cairn/tools`, `~/lanes/*.sh` and `~/.config/systemd/user` (no unit references it), plus this repo. Commands each caller passes:

| Caller | Commands | Under the policy |
|---|---|---|
| `tools/overnight/driver.sh` | `git push -q --no-verify --force-with-lease origin HEAD:lane/N`, `gh pr create` | allowed |
| `lanes/finish-branch.sh` | `git push -q --no-verify --force-with-lease origin HEAD:<branch>` | allowed |
| `lanes/rebase-main.sh` | `git rebase -q origin/main`, `git rebase --continue` | allowed |
| `lanes/regen-migration.sh` | `git rebase -q -X theirs origin/main`, `git commit -qm ... --no-verify` (both commits) | allowed |
| `tools/governor/split-issue.sh` | `gh issue create`, `gh issue comment` | allowed |
| `tools/governor/block-governor.sh` | `gh issue comment`, `gh pr close` | allowed |
| `tools/plan/plan-issues.sh` | `gh issue edit --body-file -` | allowed |
| `tools/merge-order/queue.sh` | `gh pr update-branch` for every armed PR that is behind | allowed |
| `tools/reminders/resume-1727.sh` | `gh issue create`, `gh issue edit --remove-label`, `gh issue comment` | allowed |
| `~/.cairn/tools/review-gate/retro-review.sh` (not mirrored) | `gh issue create` | allowed |
| `tools/schedule/issue-schedule.mjs` | `gh issue create|edit|comment|pin` | allowed |
| `tools/rearm-automerge.sh` | `gh pr merge --disable-auto` | allowed |
| `tools/weekly/evidence-prune.sh` | `git fetch`, `git commit`, `git push -u origin <branch>`, `gh pr create`, `gh pr comment` (it arms `gh pr merge --squash --auto --match-head-commit <sha>` as the human login, not through `as-bot.sh`) | allowed |
| `tools/merge-pr.sh` | none: it squash-merges `lane/*` PRs with `gh pr merge <n> --squash --match-head-commit <sha>` as the human login | not through `as-bot.sh` |

Merge decision (C1 session, after the review gate found that a PASS comment can be forged through `gh pr comment`, which the bot may run): the bot never merges. Merge authorization uses the human login (`docs/ops/agent-bot-identity.md`): `merge-pr.sh` squash-merges `lane/*` PRs with plain `gh`, pinned to the head it read, and reads no review verdict (ian, 2026-11-12), and `evidence-prune.sh` arms its auto-merge with plain `gh`. `as-bot-callers.test.mjs` runs both scripts through the real `as-bot.sh` and policy. The policy has no override switch.

## Test temp storage (#1954)

`cairn-heavy` creates and exports `CAIRN_TEST_TEMP_ROOT=$HOME/.cache/cairn-test-tmp` unless the variable is already set. It creates an explicit override too, fails before running the command if creation fails, and leaves `TMPDIR` untouched. `scripts/test-tmpdir.mjs` uses this root; raw `mkdtemp(tmpdir())` allocations still use the system temporary directory until their callers migrate to that helper.

The deployed `test-temp-guard.timer` starts after five minutes and repeats every 15 minutes. `main-watch/tmp-clean.sh` starts the same oneshot service, so systemd serializes both callers. The old broad `cairn-*`, `vitest-*`, `playwright-*` and `/mnt/fast/tmp` sweep is replaced by this policy. New timers are enabled by `deploy-self.sh`; `host-tools-verify.sh` checks the tool, JSON, wrapper and both units through its normal tracked-file inventory.

`tools/test-temp-policy.json` holds the 120-minute age cutoff, 80-percent warning threshold, 60-minute alert cooldown and literal name prefixes. Prefixes come from actual raw allocation sites in `scripts/test-tmp-baseline.json`, including dynamic `escape-trace.test.mjs` fixture names, the host fixture helper and Vitest report directories, plus the task's historical prefixes and the shared helper's `ct-` prefix. Subsumed prefixes are omitted. There is no blanket `cairn-`, `orb-`, `vitest-` or `playwright-` rule.

The guard examines top-level entries in `/tmp`, `~/.cache/cairn-test-tmp` and `~/.cache/lane-tmp`. Known prefixes retain the 120-minute cutoff. Vitest's 21-character nanoid directories require a real, non-symlink `ssr` child and a strictly older-than-six-hour mtime. Symlinks and foreign-owned entries are never removed. Before each deletion, the Linux guard checks same-user processes' cwd, open descriptors and memory maps; an unreadable inspection retains the candidate. It does not traverse symlinks. The scan cannot atomically prevent a new reference after inspection.

`maxDiskBytes` in the policy defaults to 5368709120 (5 GiB). Once logical file bytes under `~/.cache/lane-tmp` exceed that budget, the guard removes oldest owned non-live entries in the dedicated disk root regardless of name or age, until under budget. Live, symlinked and foreign-owned entries still count but remain; an unrecoverable excess is logged. File-system metadata is not part of the logical-byte budget. Explicit test-root overrides are not automatically swept.

The lane launcher, daemon step environment and `scripts/test-temp-run.mjs` share `createTempEnvironment` from `@cairn/shared/temp-environment`. It creates a private `ct-*` directory under `~/.cache/lane-tmp` (or an explicit `CAIRN_TEST_TEMP_ROOT`), exports `CAIRN_TEST_TEMP_ROOT` to it and `TMPDIR` to its owned `tmp` child, and pins `CAIRN_HEAVY_SLOTS_DIR` to the shared lock directory before spawning. It holds a private regular lease file open inside `tmp` until cleanup, protecting idle runs from the guard. Cleanup closes the file before removing the tree for Windows compatibility. Lane and step exit reclaim the root; the supervisor reclaims runtime caches and reports tracked helper survivors or unknown entries beside `tmp` as failures. Nested runtime roots stay inside their parent runtime subtree. SIGKILL leftovers are reclaimed by the guard. Darwin uses `getconf DARWIN_USER_TEMP_DIR` for the shared locks; Linux uses `/tmp/cairn-heavy-slots`. Existing explicit shared-lock overrides remain.

This does not rewire test admission or change `cairn-heavy` while #3601 is open. Host environment.d, tmpfiles and daemon drop-in changes are proposals only; see the #3630 design.

Before cleanup, the job measures `/tmp` block and inode use with `statfs`. Either value strictly above 80 percent emits a journal warning and attempts `notify-send --urgency=critical`. A timestamp in `${XDG_STATE_HOME:-$HOME/.local/state}/cairn-test-temp-guard/last-warning` limits both to once per hour across service runs, including when desktop notification delivery fails. `journalctl --user -u test-temp-guard.service` shows warnings and cleanup counts; `systemctl --user list-timers test-temp-guard.timer` shows scheduling. The service uses the host's `/usr/bin/node` and needs `notify-send` for desktop delivery.

Run `node --test scripts/ops/host/test-temp-guard.test.mjs` for selection boundaries, real filesystem deletion in isolated roots, link safety, warning cooldown and wrapper environment behavior.
