#!/usr/bin/env bash
# Cleanup (#938): sweep away the residue of branches whose PR was squash-merged on
# GitHub — local branches, remote branches, and the lane worktrees bound to them.
#
# Why ancestry is never guessed: this repo merges PRs with squash, so branch commits
# are never ancestors of main; `git branch -d` / `merge-base --is-ancestor` would judge
# merged branches as unmerged (observed with herdr's sweep and thread resolve, t-0193).
# The only trustworthy criterion is GitHub's merged-PR list:
# `gh pr list --state merged --json headRefName`, intersected with local branches,
# `git ls-remote --heads origin`, and `git worktree list`. Only hits are deleted.
# Matching is by branch name (every PR in this repo ships from a branch on origin).
#
# Failure-mode enumeration (each guard maps to one; acceptance runs in docs/verify/938/):
#   1. gh missing / not authenticated / merged-list fetch fails → exit 2; never degrade
#      "list unavailable" into "no merged branches", never fall back to ancestry guessing.
#   2. Branch name reused (merged in the past + an open PR uses it now) → KEEP: deleting
#      the remote ref would break the open PR.
#   3. Default branch / current branch of this worktree / the main checkout worktree
#      itself → always KEEP.
#   4. Merged branch's worktree has uncommitted changes → skip by default (uncommitted
#      work is unrecoverable; one round of resolution was lost this way in M7); only
#      --force-dirty discards changes with the worktree.
#   5. Worktree locked via `git worktree lock` → KEEP (a lock is an explicit protection
#      intent).
#   6. Ghost worktree registration (directory deleted by hand) → pruned at entry; still
#      registered but missing on disk is treated as prunable without crashing.
#   7. Remote branch deletion fails (protected branch / network down) → report that row,
#      continue with the rest, exit 1 at the end.
#   8. Merged list hits --limit → only misses, never wrong deletes; warn to raise
#      MERGED_LIMIT.
#   9. Same-branch rerun after merge (this repo works "prototype/build on one branch";
#      after the PR merges the branch grows new commits and a second PR is not open
#      yet) → the branch tip must match some merged PR's headRefOid for this branch;
#      a tip past the merge point is KEEPed (new commits are not on GitHub yet; deleting
#      would lose them).
#
# Known trap for agents running the equivalent commands by hand: the dangerous-command
# gate does not expand shell variables in its landing check — `git -C $R branch -D …`
# is rejected as "repo path not resolvable"; manual cleanup must use absolute literal
# paths. This script resolves REPO_ROOT to an absolute path once at entry, passes
# -C "$REPO_ROOT" on every git call, and prints absolute paths.
#
# Division of labor with the herdr-layer sweeper (~/.herdr-projects/cairn/scratch/sweep-lanes.sh):
# this script only handles the git+GitHub layer (criterion = merged PR); herdr workspace
# teardown and probe branches that never had a PR belong to sweep-lanes (criterion =
# thread resolved). Close the herdr workspace / resolve the thread before removing a
# lane worktree, or that session is left with a ghost anchor (worktree gone while the
# session anchor remains → all Bash calls refuse until ExitWorktree(keep)).
#
# Usage:
#   scripts/cleanup-merged-branches.sh                       # dry-run, whole repo plan
#   scripts/cleanup-merged-branches.sh <branch> [<branch>…]  # dry-run, given branches only (exact match)
#   scripts/cleanup-merged-branches.sh --yes [<branch>…]     # actually delete
#   --force-dirty    also discard uncommitted changes in merged-branch worktrees (dirty worktrees are skipped by default)
#   MERGED_LIMIT=<n> raise the merged-PR fetch limit (default 1000; this repo has 466)
#
# Exit codes: 0 = success or no residue; 1 = an operation failed during execution;
# 2 = preconditions not met.
set -euo pipefail

MERGED_LIMIT=${MERGED_LIMIT:-1000}
OPEN_LIMIT=${OPEN_LIMIT:-500}

die() { printf 'error: %s\n' "$*" >&2; exit 2; }
say() { printf '%s\n' "$*"; }

n_plan=0; n_clean=0; n_keep=0; n_fail=0
keep() { say "KEEP        $1 ($2)"; n_keep=$((n_keep+1)); }

# TSV single-value lookup: lookup <file> <key-col> <key> <print-col> (empty on no hit).
lookup() { awk -F'\t' -v kc="$2" -v k="$3" -v pc="$4" '$kc==k {print $pc; exit}' "$1" || true; }

usage() {
  cat <<'EOF'
usage: cleanup-merged-branches.sh [--yes] [--force-dirty] [<branch> ...]

Removes local branches, remote branches and lane worktrees whose PR was
merged on GitHub (squash merges defeat every ancestry-based check, so the
merged-PR list is the only criterion). Dry-run by default; --yes executes.
Positional arguments restrict the run to exactly those branch names.
EOF
}

# ---- args ----------------------------------------------------------------
MODE=dry
FORCE_DIRTY=0
TMPD=$(mktemp -d "${TMPDIR:-/tmp}/cairn-cleanup-merged.XXXXXX")
trap 'rm -rf "$TMPD"' EXIT
SCOPE_FILE="$TMPD/scope"; : > "$SCOPE_FILE"
MERGED_FILE="$TMPD/merged"; OPEN_FILE="$TMPD/open"
REMOTE_FILE="$TMPD/remote"; LOCAL_FILE="$TMPD/local"
WT_FILE="$TMPD/worktrees"; CAND_FILE="$TMPD/candidates"
RUN_LOG="$TMPD/git-output.log"

while [ $# -gt 0 ]; do
  case "$1" in
    --yes) MODE=yes ;;
    --force-dirty) FORCE_DIRTY=1 ;;
    -h|--help) usage; exit 0 ;;
    --) shift; while [ $# -gt 0 ]; do printf '%s\n' "$1" >> "$SCOPE_FILE"; shift; done; break ;;
    -*) die "unknown option: $1 (see --help)" ;;
    *) printf '%s\n' "$1" >> "$SCOPE_FILE" ;;
  esac
  shift
done

# ---- preconditions (failure mode 1) --------------------------------------
command -v gh >/dev/null 2>&1 || die "gh CLI not found; the merged-PR list is the only criterion"
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || die "not inside a git repository"
cd "$REPO_ROOT"
gh auth status >/dev/null 2>&1 || die "gh auth status failed (network down, proxy flaking, or not authenticated)"

say "repo:        $REPO_ROOT"
say "mode:        $MODE$([ "$FORCE_DIRTY" = 1 ] && echo ' (force-dirty)')"

# fetch only refreshes local tracking refs; the authoritative remote list comes from
# ls-remote (live query), so a fetch failure is not fatal.
git -C "$REPO_ROOT" fetch --prune origin >/dev/null 2>&1 \
  || say "warn: git fetch --prune failed (continuing; remote truth comes from ls-remote)"

# Remote table stores name<TAB>sha; the sha feeds the post-merge same-branch-rerun
# guard (failure mode 9).
git -C "$REPO_ROOT" ls-remote --heads origin 2>"$RUN_LOG" \
  | awk '{sha=$1; sub(/^refs\/heads\//,"",$2); print $2 "\t" sha}' | sort -u > "$REMOTE_FILE" \
  || die "git ls-remote --heads origin failed (network/auth); refusing to proceed without live remote refs"
[ -s "$REMOTE_FILE" ] || die "ls-remote returned no branches; unexpected — refusing to proceed"

git -C "$REPO_ROOT" for-each-ref refs/heads --format='%(refname:short)' | sort -u > "$LOCAL_FILE"

# Worktree table: path<TAB>branch<TAB>flag (flag ∈ locked|bare|""). Entry prunes ghost
# registrations first (failure mode 6).
git -C "$REPO_ROOT" worktree prune
git -C "$REPO_ROOT" worktree list --porcelain | awk '
  /^worktree /{path=substr($0,10)}
  /^branch /{br=substr($0,8); sub(/^refs\/heads\//,"",br)}
  /^locked/{flag="locked"}
  /^bare/{flag="bare"}
  /^$/{if(path!=""&&br!="")printf "%s\t%s\t%s\n",path,br,flag; path="";br="";flag=""}
  END{if(path!=""&&br!="")printf "%s\t%s\t%s\n",path,br,flag}
' > "$WT_FILE"
MAIN_WT=$(git -C "$REPO_ROOT" worktree list --porcelain | awk '/^worktree /{print substr($0,10); exit}')

DEFAULT_BRANCH=$(gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name' 2>/dev/null || true)
if [ -z "$DEFAULT_BRANCH" ]; then
  DEFAULT_BRANCH=$(git -C "$REPO_ROOT" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||' || true)
fi
[ -n "$DEFAULT_BRANCH" ] || die "cannot determine the default branch (gh repo view and origin/HEAD both failed)"

CURRENT_BRANCH=$(git -C "$REPO_ROOT" branch --show-current || true)

# merged / open tables (the criterion itself + the reuse guard). gh failure = abort,
# no degradation (failure mode 1).
gh pr list --state merged --limit "$MERGED_LIMIT" --json number,headRefName,headRefOid \
     --jq '.[] | [.headRefName, (.number|tostring), .headRefOid] | @tsv' > "$MERGED_FILE" 2>"$RUN_LOG" \
  || die "gh pr list --state merged failed; refusing to guess mergedness without GitHub"
gh pr list --state open --limit "$OPEN_LIMIT" --json number,headRefName \
     --jq '.[] | [.headRefName, (.number|tostring)] | @tsv' > "$OPEN_FILE" 2>"$RUN_LOG" \
  || die "gh pr list --state open failed; cannot guard reused branch names without it"
MERGED_COUNT=$(wc -l < "$MERGED_FILE" | tr -d ' ')
if [ "$MERGED_COUNT" -ge "$MERGED_LIMIT" ]; then
  say "warn: merged-PR list hit MERGED_LIMIT=$MERGED_LIMIT; older merged branches may be missed (raise MERGED_LIMIT). Misses are safe: they only KEEP, never delete."
fi

say "criterion:   $MERGED_COUNT merged PRs from GitHub (default branch: $DEFAULT_BRANCH)"
say ""

# ---- candidate set = local branches ∪ remote branches ∪ worktree-bound branches ----
{ cat "$LOCAL_FILE"; cut -f1 "$REMOTE_FILE"; awk -F'\t' '{print $2}' "$WT_FILE"; } | sort -u > "$CAND_FILE"

while IFS= read -r br; do
  [ -n "$br" ] || continue
  if [ -s "$SCOPE_FILE" ] && ! grep -qxF "$br" "$SCOPE_FILE"; then continue; fi

  # guard 3: default branch / current branch
  if [ "$br" = "$DEFAULT_BRANCH" ]; then keep "$br" "default branch"; continue; fi
  if [ -n "$CURRENT_BRANCH" ] && [ "$br" = "$CURRENT_BRANCH" ]; then
    keep "$br" "current branch of this worktree: $REPO_ROOT"; continue
  fi

  # guard 2: reused branch name — an open PR wins over a historic merge
  open_pr=$(lookup "$OPEN_FILE" 1 "$br" 2)
  if [ -n "$open_pr" ]; then
    keep "$br" "open PR #$open_pr still uses this branch name"; continue
  fi

  # the criterion itself: GitHub's merged list
  prnum=$(lookup "$MERGED_FILE" 1 "$br" 2)
  if [ -z "$prnum" ]; then
    keep "$br" "not in the GitHub merged-PR list"; continue
  fi

  has_local=no;  if grep -qxF "$br" "$LOCAL_FILE";  then has_local=yes; fi
  has_remote=no; remote_sha=""
  remote_sha=$(lookup "$REMOTE_FILE" 1 "$br" 2)
  if [ -n "$remote_sha" ]; then has_remote=yes; fi

  # guard 9: post-merge same-branch rerun — the tip must still be some merged PR's
  # head for this branch. A tip past the merge point means new commits not yet on
  # GitHub (second PR not open); deleting would lose them.
  merged_oids=$(awk -F'\t' -v b="$br" '$1==b {print $3}' "$MERGED_FILE")
  tip_moved=""
  if [ "$has_local" = yes ]; then
    local_sha=$(git -C "$REPO_ROOT" rev-parse --quiet --verify "refs/heads/$br" </dev/null || true)
    if [ -n "$local_sha" ] && ! printf '%s\n' "$merged_oids" | grep -qxF "$local_sha"; then
      tip_moved="local tip $local_sha"
    fi
  fi
  if [ -z "$tip_moved" ] && [ "$has_remote" = yes ]; then
    if ! printf '%s\n' "$merged_oids" | grep -qxF "$remote_sha"; then
      tip_moved="remote tip $remote_sha"
    fi
  fi
  if [ -n "$tip_moved" ]; then
    keep "$br" "PR #$prnum merged, but $tip_moved has commits past the merged head; open a PR for the new work first"
    continue
  fi

  wt_path=""; wt_flag=""
  wt_line=$(lookup "$WT_FILE" 2 "$br" 1)
  if [ -n "$wt_line" ]; then
    wt_path="$wt_line"
    wt_flag=$(lookup "$WT_FILE" 2 "$br" 3)
  fi

  # guard 3b: the main checkout worktree (a user may check out any branch there)
  if [ -n "$wt_path" ] && [ "$wt_path" = "$MAIN_WT" ]; then
    keep "$br" "PR #$prnum merged, but the branch is checked out in the main worktree $MAIN_WT"; continue
  fi
  # guard 3c: the worktree this script runs from (defensive; normally already blocked
  # by CURRENT_BRANCH)
  if [ -n "$wt_path" ] && [ "$wt_path" = "$REPO_ROOT" ]; then
    keep "$br" "PR #$prnum merged, but it is checked out in the worktree this script runs from"; continue
  fi
  # guard 5: locked worktree
  if [ "$wt_flag" = "locked" ]; then
    keep "$br" "PR #$prnum merged, but worktree $wt_path is locked; git worktree unlock it first"; continue
  fi

  # guard 4: dirty worktree (uncommitted changes are unrecoverable)
  wt_action=none
  if [ -n "$wt_path" ]; then
    if [ -d "$wt_path" ]; then
      if [ -n "$(git -C "$wt_path" status --porcelain </dev/null 2>/dev/null)" ] && [ "$FORCE_DIRTY" != 1 ]; then
        keep "$br" "PR #$prnum merged, but worktree $wt_path has uncommitted changes; pass --force-dirty to discard"
        continue
      fi
      if [ "$FORCE_DIRTY" = 1 ]; then wt_action=remove-force; else wt_action=remove; fi
    else
      wt_action=prune  # failure mode 6: directory no longer on disk where registered
    fi
  fi

  acts=""
  case "$wt_action" in
    remove)       acts="$acts worktree:$wt_path" ;;
    remove-force) acts="$acts worktree(--force):$wt_path" ;;
    prune)        acts="$acts worktree-prune:$wt_path" ;;
  esac
  if [ "$has_local" = yes ];  then acts="$acts local-branch"; fi
  if [ "$has_remote" = yes ]; then acts="$acts remote-branch"; fi

  if [ "$MODE" = dry ]; then
    say "WOULD-CLEAN $br (PR #$prnum merged) ->$acts"
    n_plan=$((n_plan+1)); continue
  fi

  # ---- execution (order: worktree → local branch → remote branch) --------
  # All three mutating git calls take </dev/null: the outer while reads the candidate
  # list from stdin, and a credential/askpass prompt swallowing one line would eat
  # subsequent candidates. RUN_LOG is truncated before each op so the FAIL summary
  # contains only the latest output.
  ok=1
  if [ "$wt_action" = remove ] || [ "$wt_action" = remove-force ]; then
    force_flag=""
    [ "$wt_action" = remove-force ] && force_flag="--force"
    : > "$RUN_LOG"
    if ! git -C "$REPO_ROOT" worktree remove $force_flag "$wt_path" </dev/null >>"$RUN_LOG" 2>&1; then
      ok=0; say "FAIL        $br: git worktree remove failed ($wt_path); see below"
      sed 's/^/            | /' "$RUN_LOG" | tail -5
    fi
  fi
  if [ "$wt_action" = prune ]; then
    git -C "$REPO_ROOT" worktree prune </dev/null >>"$RUN_LOG" 2>&1 || true
  fi
  if [ "$ok" = 1 ] && [ "$has_local" = yes ]; then
    # squash merge ⇒ the branch is not an ancestor of main ⇒ `-d` always refuses;
    # mergedness is pinned by the merged list, so -D is safe here.
    : > "$RUN_LOG"
    if ! git -C "$REPO_ROOT" branch -D "$br" </dev/null >>"$RUN_LOG" 2>&1; then
      ok=0; say "FAIL        $br: git branch -D failed"
      sed 's/^/            | /' "$RUN_LOG" | tail -5
    fi
  fi
  if [ "$has_remote" = yes ]; then
    : > "$RUN_LOG"
    if ! git -C "$REPO_ROOT" push origin --delete "$br" </dev/null >>"$RUN_LOG" 2>&1; then
      ok=0; say "FAIL        $br: git push origin --delete failed (protected branch or network?)"
      sed 's/^/            | /' "$RUN_LOG" | tail -5
    fi
  fi
  if [ "$ok" = 1 ]; then
    say "CLEANED     $br (PR #$prnum) ->$acts"
    n_clean=$((n_clean+1))
  else
    n_fail=$((n_fail+1))
  fi
done < "$CAND_FILE"

git -C "$REPO_ROOT" worktree prune >/dev/null 2>&1 || true
say ""
say "---"
if [ "$MODE" = dry ]; then
  if [ "$n_plan" -eq 0 ]; then
    say "nothing to clean (no merged-PR residue in scope); kept=$n_keep"
  else
    say "plan: would-clean=$n_plan kept=$n_keep — re-run with --yes to execute"
  fi
else
  if [ "$n_clean" -eq 0 ] && [ "$n_fail" -eq 0 ]; then
    say "nothing to clean (no merged-PR residue in scope); kept=$n_keep"
  else
    say "cleaned=$n_clean kept=$n_keep failed=$n_fail"
  fi
fi

if [ "$n_fail" -gt 0 ]; then exit 1; fi
exit 0
