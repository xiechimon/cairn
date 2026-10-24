#!/usr/bin/env bash
# Pacman → Cairn 一键迁移（本机跑一次；加 --remote HOST 同时迁移远端，如 omarchy）。
#   migrate-pacman-to-cairn.sh [--repo DIR] [--remote HOST] [--dry-run]
# 前提：改名 PR 已合进 origin/main。幂等：已迁完再跑只做检查。
# 做的事：停旧服务 → ~/.pacman 改名 ~/.cairn 并留软链 → 改服务单元与启动脚本 → 拉新代码装依赖 → 起新服务。
# 软链 ~/.pacman → ~/.cairn 必留：库里和 git worktree 里存着旧绝对路径。
# 所有被替换的文件都先改名成 *.pre-cairn 留底，不删除任何东西。
set -euo pipefail

REPO=""
REMOTE=""
DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --remote) REMOTE="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

run() { if [ "$DRY" = 1 ]; then echo "[dry-run] $*"; else eval "$@"; fi; }
say() { printf '[migrate] %s\n' "$*"; }

if [ -n "$REMOTE" ]; then
  say "远端 $REMOTE"
  ssh -o BatchMode=yes -o ConnectTimeout=5 "$REMOTE" bash -s -- $([ "$DRY" = 1 ] && echo --dry-run) <"$0"
fi

OLD="$HOME/.pacman"
NEW="$HOME/.cairn"
OS="$(uname -s)"

if [ -z "$REPO" ]; then
  for d in "$HOME/Code/AgentProjects/pacman-run" "$HOME/Code/AgentProjects/cairn" "$HOME/Code/AgentProjects/pacman"; do
    if [ -d "$d/.git" ]; then REPO="$d"; break; fi
  done
fi
[ -n "$REPO" ] || { echo "找不到检出目录，用 --repo 指定" >&2; exit 1; }
say "检出目录 $REPO，系统 $OS"

git -C "$REPO" remote set-url origin https://github.com/xiechimon/cairn.git
git -C "$REPO" fetch origin main -q
git -C "$REPO" show origin/main:package.json | grep -q '"name": "cairn"' \
  || { echo "origin/main 还没合进改名，先合并 PR 再跑" >&2; exit 1; }
if git -C "$REPO" status --porcelain --untracked-files=no | grep -qv 'pnpm-lock.yaml'; then
  echo "$REPO 有未提交的改动（不含 pnpm-lock.yaml），先处理再跑" >&2; exit 1
fi

stop_services() {
  if [ "$OS" = Darwin ]; then
    for l in pacman-server pacman-daemon cairn-server cairn-daemon; do
      run "launchctl bootout gui/$(id -u)/com.xiechimon.$l 2>/dev/null || true"
    done
  else
    for u in pacman-daemon cairn-daemon; do
      run "systemctl --user stop $u.service 2>/dev/null || true"
    done
    if [ "$DRY" = 0 ] && systemctl --user is-active --quiet pacman-daemon.service; then
      echo "pacman-daemon.service 停不下来，手工处理" >&2; exit 1
    fi
  fi
}

migrate_home() {
  if [ -L "$OLD" ] && [ -d "$NEW" ]; then say "数据目录已迁移"; return; fi
  [ -d "$OLD" ] || { say "没有 $OLD，跳过数据目录"; return; }
  [ ! -e "$NEW" ] || { echo "$NEW 已存在且 $OLD 不是软链，手工处理" >&2; exit 1; }
  run "mv '$OLD' '$NEW'"
  run "ln -s .cairn '$OLD'"
  for f in pacman-daemon-run.sh pacman-server-run.sh; do
    [ -f "$NEW/$f" ] || continue
    run "mv '$NEW/$f' '$NEW/${f/pacman/cairn}'"
  done
  if [ -f "$NEW/config.json" ]; then
    run "sed -i.pre-cairn 's#~/.pacman/#~/.cairn/#g' '$NEW/config.json'"
  fi
  for f in "$NEW"/cairn-*-run.sh; do
    [ -f "$f" ] || continue
    run "sed -i.pre-cairn -e 's/PACMAN_/CAIRN_/g' -e 's#\\.pacman#.cairn#g' -e 's#pacman-daemon-run#cairn-daemon-run#g' -e 's#pacman-server-run#cairn-server-run#g' -e 's#\\[pacman-#[cairn-#g' '$f'"
  done
}

update_code() {
  if ! git -C "$REPO" diff --quiet -- pnpm-lock.yaml; then
    run "cp '$REPO/pnpm-lock.yaml' '$REPO/pnpm-lock.yaml.pre-cairn'"
    run "git -C '$REPO' checkout -q -- pnpm-lock.yaml"
  fi
  run "git -C '$REPO' checkout -q --detach origin/main"
  if [ "$OS" = Darwin ]; then
    run "(cd '$REPO' && pnpm install --frozen-lockfile)"
  else
    run "(export PATH=\"\$HOME/.local/share/mise/shims:\$PATH\"; cd '$REPO' && pnpm install --frozen-lockfile && pnpm --filter @xiechimon/cairn-cli build)"
  fi
}

start_services() {
  if [ "$OS" = Darwin ]; then
    local la="$HOME/Library/LaunchAgents"
    for k in server daemon; do
      local old="$la/com.xiechimon.pacman-$k.plist" new="$la/com.xiechimon.cairn-$k.plist"
      if [ -f "$old" ]; then
        run "sed -e 's#com.xiechimon.pacman-#com.xiechimon.cairn-#g' -e 's#\\.pacman#.cairn#g' -e 's#PACMAN_#CAIRN_#g' -e 's#cairn/pacman-#cairn/cairn-#g' '$old' > '$new'"
        run "mv '$old' '$old.pre-cairn'"
      fi
      if [ -f "$new" ]; then run "launchctl bootstrap gui/$(id -u) '$new'"; fi
    done
  else
    local u="$HOME/.config/systemd/user"
    if [ -f "$u/pacman-daemon.service" ]; then
      run "sed -e 's/pacman daemon/cairn daemon/' -e 's#\\.pacman#.cairn#g' -e 's#PACMAN_#CAIRN_#g' '$u/pacman-daemon.service' > '$u/cairn-daemon.service'"
      run "systemctl --user disable pacman-daemon.service 2>/dev/null || true"
      run "mv '$u/pacman-daemon.service' '$u/pacman-daemon.service.pre-cairn'"
    fi
    run "systemctl --user daemon-reload"
    run "systemctl --user enable --now cairn-daemon.service"
  fi
}

check() {
  [ "$DRY" = 1 ] && return 0
  sleep 15
  if [ "$OS" = Darwin ]; then
    if lsof -iTCP:8787 -sTCP:LISTEN >/dev/null 2>&1; then say "server 在 :8787 监听"; else echo "server 没起来，看 $NEW/launchd-server.err.log" >&2; exit 1; fi
    if launchctl print "gui/$(id -u)/com.xiechimon.cairn-daemon" >/dev/null 2>&1; then say "daemon 已加载"; else echo "daemon 没加载" >&2; exit 1; fi
  else
    if systemctl --user is-active cairn-daemon.service >/dev/null; then say "daemon 在跑"; else echo "daemon 没起来：journalctl --user -u cairn-daemon" >&2; exit 1; fi
  fi
}

stop_services
migrate_home
update_code
start_services
check
say "完成。环境变量 PACMAN_* 已改 CAIRN_*，命令名 pacman → cairn。"
