#!/usr/bin/env bash
# 清场（#938）：把「GitHub 上 PR 已 squash 合并」的分支残留一次收干净 ——
# 本地分支、远端分支、以及绑定这些分支的 lane worktree。
#
# 为什么不猜祖先关系：本仓 PR 走 squash 合并，分支提交永远不是 main 的祖先，
# `git branch -d` / `merge-base --is-ancestor` 这类判定会把已合分支判成未合
# （实例：herdr 的 sweep 对已合车道报 "nothing to clean"、thread resolve 报
# "branch kept: its pull request is not merged"，t-0193）。唯一可信判据 =
# GitHub 的 merged PR 列表：`gh pr list --state merged --json headRefName`，
# 拿它与 本地分支 / `git ls-remote --heads origin` / `git worktree list` 求交集，
# 命中的才删。判据按分支名匹配（本仓所有 PR 都从 origin 自身分支开出）。
#
# 失败方式枚举（守卫逐条对应；验收实跑记录 = docs/verify/938/）：
#   1. gh 未装 / 未登录 / merged 列表拉取失败 → exit 2 中止；绝不把「列表没拉到」
#      降级成「没有已合分支」，也不回退去猜祖先关系。
#   2. 分支名被复用（历史已合 + 现在又挂着 open PR）→ KEEP：删远端 ref 会砸开着的 PR。
#   3. 默认分支 / 当前 worktree 的当前分支 / 主检出 worktree 本体 → 永远 KEEP。
#   4. 已合分支的 worktree 里有未提交改动 → 默认跳过（未 commit 的活不可恢复，
#      05 册 M7 实测丢过一轮解法）；--force-dirty 才允许连改动一起丢弃。
#   5. worktree 被 `git worktree lock` 锁住 → KEEP（锁 = 明确的保护意图）。
#   6. worktree 幽灵注册（目录已被手工删）→ 入口先 prune；仍在册但目录缺失的
#      按 prune 处理，不崩。
#   7. 远端分支删除失败（保护分支 / 网络断）→ 该行报错、其余继续，最终 exit 1。
#   8. merged 列表条数顶到 --limit → 只会漏删不会错删；打警告提示调大 MERGED_LIMIT。
#   9. 合并后同分支续跑（本仓有「原型/施工同分支续跑」工作法，PR 合并后分支又长
#      新提交、第二个 PR 还没开）→ 分支 tip 必须命中该分支某个 merged PR 的
#      headRefOid 才清；tip 已越过合并点的 KEEP（新提交还没进 GitHub，删了就丢）。
#
# 票面已知坑（针对 agent 手敲同类命令的形态，写死在这）：危险命令闸对
# `git branch -D` 的落地判定不展开 shell 变量 —— `git -C $R branch -D …` 会被判成
# 「仓路径取不到」而拒绝，手工清场必须写绝对字面路径。脚本内部 REPO_ROOT 在入口
# 一次性解析成绝对路径，全部 git 调用带 -C "$REPO_ROOT"，打印的路径也都是绝对路径。
#
# 与 herdr 层清场工具（~/.herdr-projects/cairn/scratch/sweep-lanes.sh）的分工：
# 本脚本只管 git+GitHub 层，判据 = merged PR；herdr workspace 关闭、以及「没开过
# PR 的探针分支」的回收归 sweep-lanes（判据 = 线程 resolved）。清 lane worktree 前
# 先关掉对应 herdr workspace / resolve 线程，否则那个会话会留下幽灵锚（worktree
# 被删而会话锚还在 → 全 Bash 拒跑，要 ExitWorktree(keep) 才解得开）。
#
# 用法：
#   scripts/cleanup-merged-branches.sh                       # dry-run，列全仓计划
#   scripts/cleanup-merged-branches.sh <branch> [<branch>…]  # dry-run，只限给定分支（精确匹配）
#   scripts/cleanup-merged-branches.sh --yes [<branch>…]     # 真删
#   --force-dirty  连同已合分支 worktree 里未提交的改动一起丢弃（默认跳过脏 worktree）
#   MERGED_LIMIT=<n>  调大 merged PR 拉取上限（默认 1000，当前仓 466 条）
#
# 退出码：0 = 成功或无残留；1 = 执行期有操作失败；2 = 前置条件不满足。
set -euo pipefail

MERGED_LIMIT=${MERGED_LIMIT:-1000}
OPEN_LIMIT=${OPEN_LIMIT:-500}

die() { printf 'error: %s\n' "$*" >&2; exit 2; }
say() { printf '%s\n' "$*"; }

n_plan=0; n_clean=0; n_keep=0; n_fail=0
keep() { say "KEEP        $1 ($2)"; n_keep=$((n_keep+1)); }

# TSV 单值查询：lookup <file> <key-col> <key> <print-col>（无命中输出空）。
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

# ---- 参数 ----------------------------------------------------------------
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

# ---- 前置条件（失败方式 1）----------------------------------------------
command -v gh >/dev/null 2>&1 || die "gh CLI not found; the merged-PR list is the only criterion"
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || die "not inside a git repository"
cd "$REPO_ROOT"
gh auth status >/dev/null 2>&1 || die "gh auth status failed (network down, proxy flaking, or not authenticated)"

say "repo:        $REPO_ROOT"
say "mode:        $MODE$([ "$FORCE_DIRTY" = 1 ] && echo ' (force-dirty)')"

# fetch 只为刷新本地跟踪 ref；权威远端列表来自 ls-remote（实时查询），fetch 失败不致命。
git -C "$REPO_ROOT" fetch --prune origin >/dev/null 2>&1 \
  || say "warn: git fetch --prune failed (continuing; remote truth comes from ls-remote)"

# 远端表存 name<TAB>sha：sha 用于「合并后同分支续跑」守卫（失败方式 9）。
git -C "$REPO_ROOT" ls-remote --heads origin 2>"$RUN_LOG" \
  | awk '{sha=$1; sub(/^refs\/heads\//,"",$2); print $2 "\t" sha}' | sort -u > "$REMOTE_FILE" \
  || die "git ls-remote --heads origin failed (network/auth); refusing to proceed without live remote refs"
[ -s "$REMOTE_FILE" ] || die "ls-remote returned no branches; unexpected — refusing to proceed"

git -C "$REPO_ROOT" for-each-ref refs/heads --format='%(refname:short)' | sort -u > "$LOCAL_FILE"

# worktree 册：path<TAB>branch<TAB>flag（flag ∈ locked|bare|""）。入口先 prune 掉幽灵注册（失败方式 6）。
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

# merged / open 两张表（判据本体 + 复用守卫）。gh 失败 = 中止，不降级（失败方式 1）。
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

# ---- 候选集 = 本地分支 ∪ 远端分支 ∪ worktree 绑定分支 ---------------------
{ cat "$LOCAL_FILE"; cut -f1 "$REMOTE_FILE"; awk -F'\t' '{print $2}' "$WT_FILE"; } | sort -u > "$CAND_FILE"

while IFS= read -r br; do
  [ -n "$br" ] || continue
  if [ -s "$SCOPE_FILE" ] && ! grep -qxF "$br" "$SCOPE_FILE"; then continue; fi

  # 守卫 3：默认分支 / 当前分支
  if [ "$br" = "$DEFAULT_BRANCH" ]; then keep "$br" "default branch"; continue; fi
  if [ -n "$CURRENT_BRANCH" ] && [ "$br" = "$CURRENT_BRANCH" ]; then
    keep "$br" "current branch of this worktree: $REPO_ROOT"; continue
  fi

  # 守卫 2：分支名复用 —— open PR 优先于历史 merged
  open_pr=$(lookup "$OPEN_FILE" 1 "$br" 2)
  if [ -n "$open_pr" ]; then
    keep "$br" "open PR #$open_pr still uses this branch name"; continue
  fi

  # 判据本体：GitHub merged 列表
  prnum=$(lookup "$MERGED_FILE" 1 "$br" 2)
  if [ -z "$prnum" ]; then
    keep "$br" "not in the GitHub merged-PR list"; continue
  fi

  has_local=no;  if grep -qxF "$br" "$LOCAL_FILE";  then has_local=yes; fi
  has_remote=no; remote_sha=""
  remote_sha=$(lookup "$REMOTE_FILE" 1 "$br" 2)
  if [ -n "$remote_sha" ]; then has_remote=yes; fi

  # 守卫 9：合并后同分支续跑 —— 分支 tip 必须仍是某个 merged PR 的 head。
  # tip 已越过合并点 = 有新提交还没进 GitHub（第二个 PR 未开），删了就丢。
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

  # 守卫 3b：主检出 worktree（用户可能把任意分支检出在主检出里）
  if [ -n "$wt_path" ] && [ "$wt_path" = "$MAIN_WT" ]; then
    keep "$br" "PR #$prnum merged, but the branch is checked out in the main worktree $MAIN_WT"; continue
  fi
  # 守卫 3c：脚本所在 worktree 本体（防御：正常已被 CURRENT_BRANCH 挡下）
  if [ -n "$wt_path" ] && [ "$wt_path" = "$REPO_ROOT" ]; then
    keep "$br" "PR #$prnum merged, but it is checked out in the worktree this script runs from"; continue
  fi
  # 守卫 5：锁定的 worktree
  if [ "$wt_flag" = "locked" ]; then
    keep "$br" "PR #$prnum merged, but worktree $wt_path is locked; git worktree unlock it first"; continue
  fi

  # 守卫 4：脏 worktree（未提交改动不可恢复）
  wt_action=none
  if [ -n "$wt_path" ]; then
    if [ -d "$wt_path" ]; then
      if [ -n "$(git -C "$wt_path" status --porcelain </dev/null 2>/dev/null)" ] && [ "$FORCE_DIRTY" != 1 ]; then
        keep "$br" "PR #$prnum merged, but worktree $wt_path has uncommitted changes; pass --force-dirty to discard"
        continue
      fi
      if [ "$FORCE_DIRTY" = 1 ]; then wt_action=remove-force; else wt_action=remove; fi
    else
      wt_action=prune  # 失败方式 6：目录已不在册所指的盘上
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

  # ---- 执行（顺序：worktree → 本地分支 → 远端分支）------------------------
  # 三个变更型 git 调用都带 </dev/null：外层 while 的 stdin 是候选清单，凭据/askpass
  # 提示若从它读一口，会吞掉后续候选行；RUN_LOG 每次操作前清空，FAIL 摘要只含本次输出。
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
    # squash 合并 ⇒ 分支不是 main 祖先 ⇒ `-d` 必拒；判据已由 merged 列表钉死，用 -D。
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
