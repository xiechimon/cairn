# #1210 acceptance evidence · local-shape execution face fails loud (the C fallback)

probe = `.claude/skills/verify-pacman/scripts/drive-1210-local-unreachable.mjs` (enters the repo with this PR).
Two-leg evidence: `after/` = this branch's stack (8804/5284), `before/` = a throwaway origin/main worktree stack (8805/5285, with `--expect=old` inverting the assertions).
Result: after **17/17 PASS**, before **14/14 PASS** (checks itemized in `*/result.json`).

## Rerun recipe

```sh
# 1. after stack (the delivery branch's worktree, must have corepack pnpm install done)
VERIFY_PORT=8804 VERIFY_WEB_PORT=5284 node .claude/skills/verify-pacman/scripts/launch.mjs
node .claude/skills/verify-pacman/scripts/drive-1210-local-unreachable.mjs --expect=new

# 2. before stack (a throwaway origin/main worktree; the probe uses the delivery branch's copy, the #1035 recipe)
git worktree add --detach /tmp/pacman-before-1210 origin/main
cd /tmp/pacman-before-1210 && corepack pnpm install
VERIFY_PORT=8805 VERIFY_WEB_PORT=5285 VERIFY_REPO_ROOT=/tmp/pacman-before-1210 \
  node /tmp/pacman-before-1210/.claude/skills/verify-pacman/scripts/launch.mjs
cd <delivery branch worktree>
VERIFY_REPO_ROOT=/tmp/pacman-before-1210 \
  VERIFY_RUN_DIR=/tmp/pacman-before-1210/.claude/verify-run \
  node .claude/skills/verify-pacman/scripts/drive-1210-local-unreachable.mjs --expect=old

# 3. close out: run cleanup.mjs on both stacks (the before stack carries the same VERIFY_REPO_ROOT/VERIFY_RUN_DIR prefix)
```

All loopback commands take the `env -u http_proxy -u https_proxy -u all_proxy NO_PROXY='*'` prefix (the local proxy intercepts loopback).

## Reading

| criterion | after (this branch) | before (origin/main) |
|---|---|---|
| step terminal state | failed (not hung) | failed (same) |
| build.errorMessage | synthesized copy: names the machine `verify-1210` + the repo path + "path does not exist" + the remedy ① switch the pinning back / ② the GitHub shape | `git clone failed (128): fatal: repository '<path>' does not exist` |
| is a clone attempted | no: zero `Cloning` lines in daemon.log, fail-fast elapsed≈1.0s | yes: the `Cloning` line is on record, elapsed≈7.0s (the withGitNetRetries 1s+5s backoff is burned through) |
| workspace materialization | none (the base directory does not exist) | none (the clone-failure leftover directory self-cleans) |
| detail page | the failed card renders the full synthesized copy (`after/leg-a-detail-failed.png`) | renders the bare git error (`before/leg-a-detail-failed.png`) |
| leg B (the machine where the repo lives, regression) | `Cloning <path>` + `Worktree added` + the conv worktree README content matches; the terminal state is failed only because the stub's zero-change artifact gate (`构建零改动`), and the copy carries no unreachable string | same (zero behavior drift) |
| credential face | the local shape's credential is always null; zero token/password wording in errorMessage/logs (the unit test L5 asserts the same) | same |

## Files

- `*/result.json` — the checks itemized ok/label (the pass counts quoted in the PR body follow this file and agree with result.json)
- `*/leg-a-error-message.txt` — the step's errorMessage in full (after = the synthesized copy, before = the bare git error)
- `*/leg-a-build-row.json` / `leg-b-build-row.json` — the SQLite build/step row projection (the #920 gotcha: errorMessage lives on the build row, the terminal state on the step row)
- `*/leg-a-todo-record.json` — the REST `GET /api/todos/:id` ground truth (phase=failed)
- `*/leg-a-detail-failed.png` / `leg-b-detail-after.png` — detail page screenshots (1440x732)
- `*/daemon-console.log` — the probe-side daemon stdout/stderr; the `<daemon home>/daemon.log` excerpts are in result.json's checks detail
- `*/leg-b-workspace-state.json` — the base origin / conv HEAD git artifacts
- `*/leg-a-elapsed-ms.txt` — the step's claim → terminal wall clock (the fail-fast vs backoff-exhausted contrast; an informational position — the deterministic criterion is the presence of the `Cloning` line)
