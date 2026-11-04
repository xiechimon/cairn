#!/usr/bin/env bash
# Final-script (v3) acceptance battery for #938.
# Covers: abort paths (R1-R3), organic KEEP on an active lane, and on one merged
# residue (impl/105-react-router-8, PR #118): dry WOULD-CLEAN -> dirty KEEP (guard 4)
# -> clean CLEANED three faces (execute path) -> verify gone -> idempotent rerun.
# Guard 9 is re-proven organically by the full dry-run's "commits past the merged head" KEEPs.
cd /Users/xmon/.herdr/worktrees/pacman/hp-pacman-t-0222-938-github-merged || exit 1
S=scripts/cleanup-merged-branches.sh
BR=impl/105-react-router-8

wait_window() {
  local i
  for i in $(seq 1 60); do
    if git ls-remote --heads origin main >/dev/null 2>&1 && gh pr list --state merged --limit 1 --json number >/dev/null 2>&1; then
      return 0
    fi
    sleep 5
  done
  return 1
}
run_retry() {
  local out="$1"; shift
  local rc=0 i=0
  for i in 1 2 3 4 5 6 7 8 9 10; do
    bash "$S" "$@" > "$out" 2>&1
    rc=$?
    [ "$rc" -ne 2 ] && break
    echo "(attempt $i aborted on network, retrying)" >> "$out"
    sleep 5
  done
  echo "exit=$rc (attempts=$i)" >> "$out"
}

# ---- abort paths (deterministic)
env PATH=/usr/bin:/bin:/usr/sbin:/sbin bash "$S" > /tmp/938-v3-r1-nogh.txt 2>&1
echo "exit=$?" >> /tmp/938-v3-r1-nogh.txt
env HTTPS_PROXY=http://127.0.0.1:1 HTTP_PROXY=http://127.0.0.1:1 bash "$S" > /tmp/938-v3-r2-ghdead.txt 2>&1
echo "exit=$?" >> /tmp/938-v3-r2-ghdead.txt
wait_window
env GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.proxy GIT_CONFIG_VALUE_0=http://127.0.0.1:1 bash "$S" > /tmp/938-v3-r3-gitdead.txt 2>&1
echo "exit=$?" >> /tmp/938-v3-r3-gitdead.txt

# ---- organic KEEP: active lane branch, dry-run only (never touches anything)
run_retry /tmp/938-v3-keep-active-lane.txt hp/pacman/t-0220-926

# ---- impl/105 four-face sequence
if wait_window; then
  git fetch --prune origin >/dev/null 2>&1 || true
  {
    echo "fixture: worktree on merged residue $BR; tip at creation:"
    git worktree add /tmp/pacman-938-pf5 "$BR" 2>&1 | tail -1
    git rev-parse "$BR"
    git worktree list | grep pacman-938-pf5
    echo '--- 1. dry (expect WOULD-CLEAN worktree+local+remote):'
  } > /tmp/938-v3-positive-impl105.txt 2>&1
  run_retry /tmp/938-v3-p5a.tmp "$BR"
  cat /tmp/938-v3-p5a.tmp >> /tmp/938-v3-positive-impl105.txt
  {
    echo '--- 2. dirty the worktree, yes WITHOUT --force-dirty (expect KEEP guard 4):'
    touch /tmp/pacman-938-pf5/dirty-938.txt
    git -C /tmp/pacman-938-pf5 status --porcelain
  } >> /tmp/938-v3-positive-impl105.txt 2>&1
  run_retry /tmp/938-v3-p5b.tmp --yes "$BR"
  cat /tmp/938-v3-p5b.tmp >> /tmp/938-v3-positive-impl105.txt
  {
    echo '--- 3. remove the dirty file, yes (expect CLEANED three faces):'
    rm /tmp/pacman-938-pf5/dirty-938.txt
    git -C /tmp/pacman-938-pf5 status --porcelain
    echo '(empty status above = clean)'
  } >> /tmp/938-v3-positive-impl105.txt 2>&1
  run_retry /tmp/938-v3-p5c.tmp --yes "$BR"
  cat /tmp/938-v3-p5c.tmp >> /tmp/938-v3-positive-impl105.txt
  {
    echo '--- verify gone:'
    git worktree list | grep pacman-938-pf5 && echo 'WORKTREE STILL THERE' || echo 'worktree: gone'
    echo "local branch matches: $(git branch --list "$BR" | wc -l | tr -d ' ') (0 = gone)"
    ls -d /tmp/pacman-938-pf5 2>/dev/null && echo 'DIR STILL THERE' || echo 'directory: gone'
    git ls-remote --heads origin "$BR" 2>&1 | grep -q . && echo 'REMOTE STILL THERE' || echo 'remote branch: gone'
    echo '--- 4. idempotent rerun (expect nothing to clean):'
  } >> /tmp/938-v3-positive-impl105.txt 2>&1
  run_retry /tmp/938-v3-p5d.tmp --yes "$BR"
  cat /tmp/938-v3-p5d.tmp >> /tmp/938-v3-positive-impl105.txt
else
  echo 'network never recovered; impl/105 sequence skipped' > /tmp/938-v3-positive-impl105.txt
fi

# ---- full dry-run with the final script (guard-9 organic KEEPs + decision regression)
run_retry /tmp/938-v3-full-dry.txt
{
  echo "--- summary: WOULD-CLEAN=$(grep -c '^WOULD-CLEAN' /tmp/938-v3-full-dry.txt) KEEP=$(grep -c '^KEEP' /tmp/938-v3-full-dry.txt) guard9-KEEP=$(grep -c 'commits past the merged head' /tmp/938-v3-full-dry.txt)"
} >> /tmp/938-v3-full-dry.txt

echo battery4-done >> /tmp/938-battery-status.txt
