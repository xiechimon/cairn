#!/bin/bash
# 云端会话启动 hook：新容器无 node_modules，先装依赖让 lint / typecheck / spec:parse 三闸可跑。
# 只在 Claude Code 云端会话执行；本地 CLI 直接退出，不动本机环境。
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"

# better-sqlite3 带 binding.gyp，pnpm 会隐式跑 node-gyp rebuild；云端容器 PATH 上没有 node-gyp
# （编译工具链 python3/make/g++ 是齐的），借 npm 自带那份补上。
if ! command -v node-gyp >/dev/null 2>&1; then
  NPM_GYP_BIN="$(npm root -g)/npm/bin/node-gyp-bin"
  if [ -x "$NPM_GYP_BIN/node-gyp" ]; then
    export PATH="$NPM_GYP_BIN:$PATH"
  fi
fi

# --frozen-lockfile：锁文件纪律，启动 hook 绝不改 pnpm-lock.yaml。
# 依赖构建脚本的放行范围由 pnpm-workspace.yaml 的 allowBuilds 决定，不在此另开口子。
pnpm install --frozen-lockfile

# 云端已预装 Chromium（PLAYWRIGHT_BROWSERS_PATH），不跑 playwright install。
# 但仓库钉的 @playwright/test 要的修订号可能比预装的新（1.63 要 chromium-1243，容器只有 1194），
# 直接跑 e2e 会报 Executable doesn't exist。做法：建别名目录，把缺的 <name>-<rev> 软链到同名预装
# 的最高修订，再用 CLAUDE_ENV_FILE 把会话的 PLAYWRIGHT_BROWSERS_PATH 指过去。仅为本地受影响面
# 能跑；浏览器大版本不同，视觉/几何断言以 CI（真修订）为准。
ALIAS_DIR="$HOME/.cache/pacman-pw-browsers"
PREINSTALLED="${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}"
# resume 时会话环境可能已指向别名目录，回到预装源头重算。
[ "$PREINSTALLED" = "$ALIAS_DIR" ] && PREINSTALLED=/opt/pw-browsers
BROWSERS_JSON="$(node -e '
  const { createRequire } = require("node:module");
  const req = createRequire(require.resolve("@playwright/test/package.json", { paths: ["apps/web"] }));
  process.stdout.write(require("node:path").join(require("node:path").dirname(req.resolve("playwright-core/package.json")), "browsers.json"));
' 2>/dev/null || true)"
if [ -d "$PREINSTALLED" ] && [ -f "$BROWSERS_JSON" ]; then
  NEED_ALIAS=0
  while read -r name rev; do
    [ -e "$PREINSTALLED/$name-$rev" ] && continue
    src="$(ls -d "$PREINSTALLED/$name"-[0-9]* 2>/dev/null | sort -V | tail -1 || true)"
    [ -n "$src" ] || continue
    # 新修订改了目录布局（chrome-linux/ → chrome-linux64/、headless_shell →
    # chrome-headless-shell-linux64/chrome-headless-shell），整目录软链不够，按新布局逐项链。
    dst="$ALIAS_DIR/$name-$rev"
    mkdir -p "$dst"
    for f in "$src"/*; do ln -sfn "$f" "$dst/$(basename "$f")"; done
    if [ -d "$src/chrome-linux" ]; then
      ln -sfn "$src/chrome-linux" "$dst/chrome-linux64"
      if [ -x "$src/chrome-linux/headless_shell" ]; then
        mkdir -p "$dst/chrome-headless-shell-linux64"
        ln -sfn "$src/chrome-linux/headless_shell" "$dst/chrome-headless-shell-linux64/chrome-headless-shell"
      fi
    fi
    NEED_ALIAS=1
  done < <(node -e '
    for (const b of require(process.argv[1]).browsers)
      if (b.installByDefault) console.log(b.name.replace(/-/g, "_"), b.revision);
  ' "$BROWSERS_JSON")
  if [ "$NEED_ALIAS" = 1 ]; then
    # 已对上修订的条目也链进别名目录，保证切换 PLAYWRIGHT_BROWSERS_PATH 后不丢。
    for entry in "$PREINSTALLED"/*; do
      [ -e "$ALIAS_DIR/$(basename "$entry")" ] || ln -sfn "$entry" "$ALIAS_DIR/$(basename "$entry")"
    done
    EXPORT_LINE="export PLAYWRIGHT_BROWSERS_PATH=\"$ALIAS_DIR\""
    if [ -n "${CLAUDE_ENV_FILE:-}" ] && ! grep -qxF "$EXPORT_LINE" "$CLAUDE_ENV_FILE" 2>/dev/null; then
      echo "$EXPORT_LINE" >> "$CLAUDE_ENV_FILE"
    fi
  fi
fi
