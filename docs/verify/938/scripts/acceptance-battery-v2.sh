#!/usr/bin/env bash
# Final acceptance battery for #938, all runs against the final script (with the post-merge-commits guard).
cd /Users/xmon/.herdr/worktrees/pacman/hp-pacman-t-0222-938-github-merged || exit 1
S=scripts/cleanup-merged-branches.sh

wait_window() { # wait for github (git+gh) health, bounded
  local i
  for i in $(seq 1 60); do
    if git ls-remote --heads origin main >/dev/null 2>&1 && gh pr list --state merged --limit 1 --json number >/dev/null 2>&1; then
      return 0
    fi
    sleep 5
  done
  return 1
}
run_retry() { # run_retry <outfile> <script args...> ; retries only exit-2 aborts
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

# ---- 1. OID audit already captured interactively via mea REST (see /tmp/938-f-oid-audit.txt):
#      PR 936 head=3523d218… == deleted t-0194 tip; PR 764 head=e6c5a846… == deleted ci-e2e tip;
#      PR 117 head=1ae41741… == deleted impl/104 local tip; PR 119 head=651df883… == live impl/106 remote tip.

# ---- 2. T1 rerun (negative: unmerged branch + worktree)
run_retry /tmp/938-f-t1-dry.txt hp/pacman/t-0222-938-negfixture
run_retry /tmp/938-f-t1-yes.txt --yes hp/pacman/t-0222-938-negfixture
{
  echo '--- fixture still intact:'
  git worktree list | grep pacman-938-neg || echo 'WORKTREE MISSING'
  git branch --list 'hp/pacman/t-0222-938-negfixture'
  ls /tmp/pacman-938-neg/package.json >/dev/null 2>&1 && echo 'worktree content OK'
} >> /tmp/938-f-t1-yes.txt 2>&1

# ---- 3. abort-path reruns (deterministic, no healthy network needed)
env PATH=/usr/bin:/bin:/usr/sbin:/sbin bash "$S" > /tmp/938-f-r1-nogh.txt 2>&1
echo "exit=$?" >> /tmp/938-f-r1-nogh.txt
env HTTPS_PROXY=http://127.0.0.1:1 HTTP_PROXY=http://127.0.0.1:1 bash "$S" > /tmp/938-f-r2-ghdead.txt 2>&1
echo "exit=$?" >> /tmp/938-f-r2-ghdead.txt
wait_window
env GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.proxy GIT_CONFIG_VALUE_0=http://127.0.0.1:1 bash "$S" > /tmp/938-f-r3-gitdead.txt 2>&1
echo "exit=$?" >> /tmp/938-f-r3-gitdead.txt

# ---- 4/5. T5 rerun on impl/104-ts-upgrade (remote residue; local+worktree rebuild, dirty, force-dirty)
if wait_window; then
  git fetch --prune origin >/dev/null 2>&1 || true
  {
    echo 'fixture: rebuild worktree on remote-residue impl/104-ts-upgrade, dirty it'
    git worktree add --track -b impl/104-ts-upgrade /tmp/pacman-938-fd origin/impl/104-ts-upgrade 2>&1 | tail -1
    touch /tmp/pacman-938-fd/dirty-938.txt
    git -C /tmp/pacman-938-fd status --porcelain
  } > /tmp/938-f-t5-forcedirty.txt 2>&1
  echo '--- yes WITHOUT --force-dirty (expect KEEP: uncommitted changes):' >> /tmp/938-f-t5-forcedirty.txt
  run_retry /tmp/938-f-t5a.tmp --yes impl/104-ts-upgrade
  cat /tmp/938-f-t5a.tmp >> /tmp/938-f-t5-forcedirty.txt
  echo '--- yes WITH --force-dirty (expect CLEANED: worktree+local+remote):' >> /tmp/938-f-t5-forcedirty.txt
  run_retry /tmp/938-f-t5b.tmp --yes --force-dirty impl/104-ts-upgrade
  cat /tmp/938-f-t5b.tmp >> /tmp/938-f-t5-forcedirty.txt
  {
    echo '--- verify gone (empty = gone):'
    git worktree list | grep pacman-938-fd || true
    git branch --list impl/104-ts-upgrade
    ls -d /tmp/pacman-938-fd 2>&1 || true
    git ls-remote --heads origin impl/104-ts-upgrade 2>&1 || true
    echo '--- idempotent rerun (expect nothing to clean):'
  } >> /tmp/938-f-t5-forcedirty.txt 2>&1
  run_retry /tmp/938-f-t5c.tmp --yes impl/104-ts-upgrade
  cat /tmp/938-f-t5c.tmp >> /tmp/938-f-t5-forcedirty.txt
else
  echo 'network never recovered; T5 skipped' > /tmp/938-f-t5-forcedirty.txt
fi

# ---- 6. OID guard red/green on impl/106-tailwind-4 (merged residue, tip == merged head)
if wait_window; then
  {
    echo 'fixture: impl/106-tailwind-4 worktree + one empty post-merge commit (local only)'
    git worktree add /tmp/pacman-938-oid impl/106-tailwind-4 2>&1 | tail -1
    git -C /tmp/pacman-938-oid commit --allow-empty -m 'post-merge fixture commit (938 acceptance, discarded after the run)' 2>&1 | tail -1
    echo '--- dry-run (expect KEEP: local tip has commits past the merged head):'
  } > /tmp/938-f-oid-guard.txt 2>&1
  run_retry /tmp/938-f-oid-a.tmp impl/106-tailwind-4
  cat /tmp/938-f-oid-a.tmp >> /tmp/938-f-oid-guard.txt
  {
    echo '--- restore tip to the merged head (discard the fixture commit), remove fixture worktree:'
    git worktree remove /tmp/pacman-938-oid 2>&1 || true
    OID106=$(git ls-remote --heads origin impl/106-tailwind-4 | awk '{print $1}')
    echo "origin tip: $OID106"
    git update-ref refs/heads/impl/106-tailwind-4 "$OID106"
    git rev-parse impl/106-tailwind-4
    echo '--- dry-run (expect WOULD-CLEAN):'
  } >> /tmp/938-f-oid-guard.txt 2>&1
  run_retry /tmp/938-f-oid-b.tmp impl/106-tailwind-4
  cat /tmp/938-f-oid-b.tmp >> /tmp/938-f-oid-guard.txt
  echo '--- yes (expect CLEANED):' >> /tmp/938-f-oid-guard.txt
  run_retry /tmp/938-f-oid-c.tmp --yes impl/106-tailwind-4
  cat /tmp/938-f-oid-c.tmp >> /tmp/938-f-oid-guard.txt
  {
    echo '--- verify gone (empty = gone):'
    git branch --list impl/106-tailwind-4
    git ls-remote --heads origin impl/106-tailwind-4 2>&1 || true
  } >> /tmp/938-f-oid-guard.txt 2>&1
else
  echo 'network never recovered; OID guard test skipped' > /tmp/938-f-oid-guard.txt
fi

# ---- 7. full dry-run with the final script
run_retry /tmp/938-f-full-dry.txt

echo battery3-done >> /tmp/938-battery-status.txt
