#!/usr/bin/env bash
# Replays the git argv of sync.ts runSyncGit (#1329) against the git on PATH.
#   MODE=old : the checkout argv before this fix. runGit resolves on a non-zero
#              exit, so a failed checkout is never seen and never retried.
#   MODE=new : checkout target picked with hasRemoteBranch, then
#              `checkout --force <full ref> --`.
#   RESET_FORM=argv : `reset --hard --end-of-options <commit>` (current resetHard).
#   RESET_FORM=oid  : rev-parse the commit first, then `reset --hard <oid>`
#                     (the form PR #1330 uses for resetHard).
# Usage: PATH=<git dir>:$PATH GIT_TRACE=1 MODE=old|new RESET_FORM=argv|oid bash repro.sh
set -u
MODE=${MODE:-old}
RESET_FORM=${RESET_FORM:-argv}
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
ROOT=$(mktemp -d /tmp/repro1329-XXXX)
LAST=0

echo "mode=$MODE reset_form=$RESET_FORM"
echo "git on PATH: $(command -v git) -> $(git --version)"
echo "/usr/bin/git: $(/usr/bin/git --version)"
echo

step() {
  local out
  echo "\$ $*"
  out=$("$@" 2>&1)
  LAST=$?
  [ -n "$out" ] && printf '%s\n' "$out" | sed 's/^/    | /'
  echo "    exit=$LAST"
}

state() {
  echo "    state: HEAD=$(git rev-parse --short HEAD) branch=$(git symbolic-ref --short -q HEAD || echo '(detached)') refs/heads/main=$(git rev-parse --short refs/heads/main) README.md=$(cat README.md)"
}

# origin.git: main@A, feat@B (B = origin/feat). work/: clone, checked out on main@A.
make_repo() {
  local d=$ROOT/$1
  mkdir -p "$d"
  git init -q --bare -b main "$d/origin.git"
  git -C "$d/origin.git" config receive.autogc false
  git init -q -b main "$d/seed"
  (
    cd "$d/seed" || exit 1
    echo base > README.md && git add README.md && git commit -qm A
    git checkout -q -b feat && echo feat > README.md && echo x > feature.txt
    git add -A && git commit -qm B
    git push -q "$d/origin.git" main feat
  )
  git clone -q "$d/origin.git" "$d/work"
  git -C "$d/work" checkout -q main
}

scenario() { # scenario <label> <ref> <dirty 0|1>
  local label=$1 ref=$2 dirty=$3 commit co oid rs
  make_repo "$label"
  cd "$ROOT/$label/work" || return 1
  commit=$(git rev-parse origin/feat)
  [ "$dirty" = 1 ] && echo dirty > README.md
  echo "== $label: ref=$ref commit=$commit dirty=$dirty"
  state

  if [ "$MODE" = old ]; then
    step git checkout --end-of-options "origin/$ref"
    co=$LAST
  else
    local target=refs/heads/$ref
    if git rev-parse --verify -q "refs/remotes/origin/$ref" >/dev/null; then
      target=refs/remotes/origin/$ref
    fi
    step git checkout --force "$target" --
    co=$LAST
    if [ "$co" -ne 0 ]; then
      echo "    => sync failed at checkout (exit $co)"
      state
      echo
      return 0
    fi
  fi

  if [ "$RESET_FORM" = oid ]; then
    step git rev-parse --verify --end-of-options "$commit^{commit}"
    oid=$(git rev-parse --verify --end-of-options "$commit^{commit}" 2>/dev/null)
    step git reset --hard "$oid"
  else
    step git reset --hard --end-of-options "$commit"
  fi
  rs=$LAST

  if [ "$rs" -ne 0 ]; then
    echo "    => sync failed at reset (exit $rs); checkout exit was $co"
  else
    echo "    => sync reports synced; checkout exit was $co"
  fi
  state
  echo
}

scenario reuse-existing-ref feat 0
scenario unknown-ref nosuch 0
scenario dirty-overlap feat 1
