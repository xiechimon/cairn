# Host control scripts

Current development authentication uses the owner's user gh login and ordinary git/gh. The legacy `as-bot.sh` path is a command-policy compatibility entry, not an App-token wrapper. See `docs/ops/agent-bot-identity.md` for the identity agents use today.

**Historical host, nothing to install (2026-11-26).** The omarchy deployment these scripts served was torn down on 2026-11-18 (`docs/ops/control-plane-omarchy.md`). What this page says about that host, its units, timers, deploys and callers describes it as it was; do not look for a live installation. Still in use from this directory: the `*.test.mjs` files that CI runs and the code they test. The temp-environment helper described under Test temp storage is product and repo code, and it is still used.

Copies of the scripts that drove the lanes on the omarchy host. `tools/` mirrored `~/.cairn/tools/`, `lanes/` mirrored `~/lanes/`, `bin/` mirrored `~/.local/bin/` and `units/` mirrored `~/.config/systemd/user/`. The first commit that added this directory is the host state as it was measured, with only host-specific values in `tools/backup/db-backup.sh` parameterised (`CAIRN_REPO`, `CAIRN_BACKUP_REMOTE`).

**Deploy.** On that host, `scripts/ops/deploy-self.sh` installed `tools/**` into `~/.cairn/tools` and `lanes/**` into `~/lanes` from the commit it had just deployed, wrote the installed SHA to `~/.cairn/tools/.installed-sha`, and kept a host file that differed from both the previous and the new revision (reported through one `Host tools differ from main` issue). A host edit did not appear here until someone copied it back. A deploy that wrote a unit file ran `systemctl --user daemon-reload` and enabled a timer only when its file had not existed before; an existing timer kept its enablement.

**Drift.** `scripts/ops/host-tools-verify.sh` (read-only, exit 1 on any difference, like `chezmoi verify`) compares an installed host with this tree. It prints `ok`, `DIFF`, `MISSING` or `EXTRA` for every managed file and for every host file under `~/.cairn/tools` that the repo does not own (`app-token/package*.json`, `node_modules`, `agent-desktop/`, `.bak` files and logs are ignored). `host-tools-verify.sh --adopt <host path>...` moves a named DIFF file to `<file>.drift-<sha>-<UTC timestamp>` (refused if that name exists) and installs the repo copy, so a reviewed decision to take main's version needs one command. On that host it ran from `~/Code/AgentProjects/cairn-exec` after a deploy; the deploy itself only reported files it kept.

Not copied: `~/.cairn/tools/app-token/package.json`, its lockfile and `node_modules` (the host installed `@octokit/auth-app` there), `agent-desktop/` (a versioned binary of a separate product, not a cairn host script), `review-gate/` (retired; the host unit `cairn-review-gate.service` is disabled and the directory was deleted 2026-11-06, and the Codex gate that replaced it was removed 2026-11-12), `backup/record-backup-status.sh` (identical to `scripts/ops/record-backup-status.sh`), `.bak` files, logs and state.

Last host inventory (measured 2026-11-06, before the teardown): the managed roots were current (`.installed-sha` matched `main`), `~/lanes` mirrored `lanes/**` exactly, and `~/lanes/cairn` plus `~/.cairn/tools/cairn` were product checkouts, not host tools. The only host files outside `tools/**` and `lanes/**` were the exclusions above; the retired `review-gate/` directory and its disabled unit were deleted.

Units were the host's `cairn-<name>.service` user units. "Called by" lists scripts that invoke the script directly; `main-watch.sh` was itself run by `cairn-main-watch.service`.

| Script | Was run by | Purpose |
|---|---|---|
| `tools/backup/db-backup.sh` | `cairn-db-backup.service` | Wraps `scripts/ops/backup-server-db.sh`, syncs attachments, pushes both to the rsync remote |
| `tools/app-token/as-bot.sh` | legacy callers below | Runs an approved command with the owner's identity and user gh credential helper; never mints a token. New agent work uses ordinary git/gh |
| `tools/app-token/bot-identity.mjs` | legacy `as-bot.sh` | Prints the owner's name, noreply email and optional co-author trailer from `commit-identity.json` |
| `tools/overnight/surface-stuck-rebase.sh` | by hand | When a lane's rebase worker has failed 3 times on one head, labels the PR `stale-pr` and comments the files `git merge-tree` reports as conflicting with main (the issue when there is no PR), once per head, instead of the driver skipping the lane silently |
| `tools/overnight/lane-replaced.sh` | by hand | Exits 0 when the lane's issue is closed (prints `closed`) or another open PR closes it (prints that PR, a coordinator-prepared replacement), so the driver skips the lane instead of pushing a duplicate PR or surfacing a finished lane; an unreadable issue also skips |
| `tools/plan/plan-issues.sh` | `cairn-plan-issues.service` (under `flock`), called by `lanes/run-worker.sh` | Writes an implementation plan into issues that lack one |
| `tools/schedule/issue-schedule.mjs` | `cairn-issue-schedule.service` | Rewrites the scheduling issue from `batch:*` labels |
| `tools/ci-speed.sh` | by hand, coordinator check-ins | One line of PR and push CI wall time (median, p90, max over the last 60 completed `ci.yml` runs) |
| `bin/cairn-heavy` | every lane, before a whole-repo check | Delegates to the current checkout's shared heavy-slot CLI (`max(1, floor(cores/4))` slots, no override); defaults `CAIRN_TEST_TEMP_ROOT` to disk at `~/.cache/cairn-test-tmp` |
| `tools/test-temp-guard.mjs`, `tools/test-temp-policy.json`, `units/test-temp-guard.{service,timer}` | every 15 min, also started by `main-watch/tmp-clean.sh` | Removes idle stale test entries from `/tmp`, `~/.cache/cairn-test-tmp` and `~/.cache/lane-tmp`; caps lane temp at 5 GiB and warns about pressure |
| `tools/main-watch/main-watch.sh` | `cairn-main-watch.service` | Opens `main-red` issues for failing main checks and runs the scripts below each tick |
| `tools/main-watch/{codex-watch,gh-health,model-health,tmp-clean}.sh` | `main-watch.sh` | Quota, GitHub API, model and temp-directory health |
| `tools/governor/{brake,lane-health,lane-sentinel}.sh` | `main-watch.sh` | Pause dispatch, report failing workers and red main |
| `tools/governor/{selfcheck,split-issue,tier}.sh` | `dispatch-issue.sh` | Pre-push self-check, ticket splitting, ticket tier lookup |
| `tools/governor/orchestration-report.sh` | by hand | Orchestration report |
| `lanes/dispatch-issue.sh` | called by `main-watch` and the governor scripts | Starts a lane worker for an issue after the gates below |
| `lanes/{build-prompt,run-worker,test-build-prompt}.sh` | `dispatch-issue.sh` | Render the worker prompt, run the worker, test the prompt renderer |
| `lanes/{rebase-main,regen-migration}.sh` | by hand | Lane helpers rebase and regenerate migrations |
| `lanes/{deploy-omarchy,wait-rr}.sh` | by hand | Deploy and wait helpers |

## Documented behavior covered by tests

`node --test scripts/ops/host/*.test.mjs` drives the scripts with stub `gh`, `git`, `flock`, `setsid` and `nohup` on `PATH` and a scratch `HOME`.

- `dispatch-issue.sh` exits 3 for a non-OPEN or unreadable issue state (a `main-red` note bypasses that check) and for an issue on the `never` list, before it reads the state. It does not look at `batch:*` labels today; a test pins that, and a later change that adds the refusal should replace it.

## as-bot allowlist (#2379)

`as-bot.sh` runs `tools/app-token/as-bot-policy.mjs` before executing a user-authenticated command and exits 126 with `as-bot: refused: <reason>` on refusal. It never calls a minter. The host installed the wrapper and owner-identity helper together. The policy permits ordinary main pushes and rejects force, force-with-lease and deletion; the tests and policy source are authoritative.

The following command inventory predates the direct-main ship change and is retained as a record of the former callers, not as permission to restore their old force, deletion or hook-bypass commands.

Allowed: `gh pr view|list|comment|create|close|update-branch`, `gh pr edit` with only `--add-label`/`--remove-label`, `gh pr merge <pr> --disable-auto` (nothing else; the bot never merges), `gh issue view|list|comment|create|edit|pin`, `gh api` reads with one endpoint and only `--method GET`, `--paginate`, `--jq`, `--template`, `--include`, `--silent`, `--slurp`, `--cache` (fields only with an explicit GET), `git fetch origin` with `-q`, `-f`/`--force`, `--prune`, `--no-tags`, `git commit`, `git rebase <upstream>` with `-q` and `-X theirs|ours`, or `git rebase --continue|--abort|--skip`, `git -C <dir> ...`, `git push origin <src>:<branch>` where the branch is not `main`/`master`, optionally with `--force-with-lease`, `--no-verify`, `-u`, `-q`, and `git push origin --delete <branch>` for one branch that is not `main`/`master` or `pr-assets/*` (those hold the images merged PR bodies link), optionally with `-q`.

The policy's deploy-lag recovery rule also permits `gh issue close <positive number> -R xiechimon/cairn -c "Caught up: omarchy runs <40 lowercase hex SHA>."`, with `--repo` and `--comment` as equivalent separate flags. No global or duplicate repository flags, URL/zero issue IDs, other messages or extra flags are accepted. `deploy-watch.sh` identified the issue through the bot author and lag title; failure to close it failed the recovery tick.

Added beyond the first list because the callers of that time needed them: `gh pr close`, `gh pr update-branch`, `gh issue pin`, `gh pr merge --disable-auto` (it only disarms), `git commit`, `git rebase`, `git -C`, `git push --force-with-lease` (lane branches are rewritten by rebase; a lease never overwrites commits the pusher has not seen), and `git push origin --delete <branch>` (agents clean up scratch branches they pushed, such as a `prototype/*` branch pushed for a CI render; owner 2026-11-13).

Flags are matched by an allowlist after splitting `--name=value`, so inline values (`--input=-`, `--field=k=v`, `--exec=cmd`) and git's abbreviated long options (`--exe`, `--upload-p`) are refused like their full spellings.

Denied: any other `gh` group (`variable`, `secret`, `repo`, `label`, `ruleset`, `auth`, `alias`, ...), every other `gh pr merge` form (any merge, `--auto`, `--admin`, extra flags or more than one PR), `gh pr edit` of anything but labels, `gh api` with a method other than GET, `--input`, `-H`, `--hostname`, fields without an explicit GET, or `graphql`, `git push` with `--force`, `-f`, `-d`, `--delete` beyond one named branch, `--mirror`, `--all`, `--tags`, `-o`, a `+` or empty-source refspec, a non-`origin` remote, no explicit refspec, a ref outside `refs/heads/`, or `main`/`master` as the destination, `git rebase` with `--exec`/`-x`, `-i`, `-s`/`--strategy` or any other flag, `git -c`, `git fetch` with any other flag, any other `git` subcommand, and any program other than `gh` and `git` (so `bash -c` cannot wrap a denied command).

### Callers on the former host

Measured with `grep -rn as-bot` over `~/.cairn/tools`, `~/lanes/*.sh` and `~/.config/systemd/user` (no unit referenced it), plus this repo. Commands each caller passed:

| Caller | Commands | Under the policy |
|---|---|---|
| `lanes/rebase-main.sh` | `git rebase -q origin/main`, `git rebase --continue` | allowed |
| `lanes/regen-migration.sh` | `git rebase -q -X theirs origin/main`, `git commit -qm ... --no-verify` (both commits) | allowed |
| `tools/governor/split-issue.sh` | `gh issue create`, `gh issue comment` | allowed |
| `tools/plan/plan-issues.sh` | `gh issue edit --body-file -` | allowed |
| `~/.cairn/tools/review-gate/retro-review.sh` (not mirrored) | `gh issue create` | allowed |
| `tools/schedule/issue-schedule.mjs` | `gh issue create|edit|comment|pin` | allowed |

Merge decision (C1 session, after the review gate found that a PASS comment can be forged through `gh pr comment`, which the bot may run): the bot never merges. Merge authorization uses the human login (`docs/ops/agent-bot-identity.md`; ian, 2026-11-12). The policy has no override switch.

## Test temp storage (#1954)

`cairn-heavy` creates and exports `CAIRN_TEST_TEMP_ROOT=$HOME/.cache/cairn-test-tmp` unless the variable is already set. It creates an explicit override too, fails before running the command if creation fails, and leaves `TMPDIR` untouched. `scripts/test-tmpdir.mjs` uses this root; raw `mkdtemp(tmpdir())` allocations still use the system temporary directory until their callers migrate to that helper.

On that host, `test-temp-guard.timer` started after five minutes and repeated every 15 minutes. `main-watch/tmp-clean.sh` started the same oneshot service, so systemd serialized both callers. The old broad `cairn-*`, `vitest-*`, `playwright-*` and `/mnt/fast/tmp` sweep is replaced by this policy. `deploy-self.sh` enabled new timers; `host-tools-verify.sh` checks the tool, JSON, wrapper and both units through its normal tracked-file inventory.

`tools/test-temp-policy.json` holds the 120-minute age cutoff, 80-percent warning threshold, 60-minute alert cooldown and literal name prefixes. Prefixes come from actual raw allocation sites in `scripts/test-tmp-baseline.json`, including dynamic `escape-trace.test.mjs` fixture names, the host fixture helper and Vitest report directories, plus the task's historical prefixes and the shared helper's `ct-` prefix. Subsumed prefixes are omitted. There is no blanket `cairn-`, `orb-`, `vitest-` or `playwright-` rule.

The guard examines top-level entries in `/tmp`, `~/.cache/cairn-test-tmp` and `~/.cache/lane-tmp`. Known prefixes retain the 120-minute cutoff. Vitest's 21-character nanoid directories require a real, non-symlink `ssr` child and a strictly older-than-six-hour mtime. Symlinks and foreign-owned entries are never removed. Before each deletion, the Linux guard checks same-user processes' cwd, open descriptors and memory maps; an unreadable inspection retains the candidate. It does not traverse symlinks. The scan cannot atomically prevent a new reference after inspection.

`maxDiskBytes` in the policy defaults to 5368709120 (5 GiB). Once logical file bytes under `~/.cache/lane-tmp` exceed that budget, the guard removes oldest owned non-live entries in the dedicated disk root regardless of name or age, until under budget. Live, symlinked and foreign-owned entries still count but remain; an unrecoverable excess is logged. File-system metadata is not part of the logical-byte budget. Explicit test-root overrides are not automatically swept.

The lane launcher, daemon step environment and `scripts/test-temp-run.mjs` share `createTempEnvironment` from `@cairn/shared/temp-environment`. It creates a private `ct-*` directory under `~/.cache/lane-tmp` (or an explicit `CAIRN_TEST_TEMP_ROOT`), exports `CAIRN_TEST_TEMP_ROOT` to it and `TMPDIR` to its owned `tmp` child, and pins `CAIRN_HEAVY_SLOTS_DIR` to the shared lock directory before spawning. It holds a private regular lease file open inside `tmp` until cleanup, which protected idle runs from the guard. Cleanup closes the file before removing the tree for Windows compatibility. Lane and step exit reclaim the root; the supervisor reclaims runtime caches and reports tracked helper survivors or unknown entries beside `tmp` as failures. Nested runtime roots stay inside their parent runtime subtree. On the former host the guard reclaimed SIGKILL leftovers; that guard runs on no current host, and the repo has no other sweep of this directory for them. Darwin uses `getconf DARWIN_USER_TEMP_DIR` for the shared locks; Linux uses `/tmp/cairn-heavy-slots`. Existing explicit shared-lock overrides remain.

This does not rewire test admission or change `cairn-heavy` while #3601 is open. Host environment.d, tmpfiles and daemon drop-in changes are proposals only; see the #3630 design.

Before cleanup, the job measures `/tmp` block and inode use with `statfs`. Either value strictly above 80 percent emits a journal warning and attempts `notify-send --urgency=critical`. A timestamp in `${XDG_STATE_HOME:-$HOME/.local/state}/cairn-test-temp-guard/last-warning` limits both to once per hour across service runs, including when desktop notification delivery fails. `journalctl --user -u test-temp-guard.service` shows warnings and cleanup counts; `systemctl --user list-timers test-temp-guard.timer` shows scheduling. The service used the host's `/usr/bin/node` and needed `notify-send` for desktop delivery.

Run `node --test scripts/ops/host/test-temp-guard.test.mjs` for selection boundaries, real filesystem deletion in isolated roots, link safety, warning cooldown and wrapper environment behavior.
