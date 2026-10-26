#!/bin/bash
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"

if ! command -v node-gyp >/dev/null 2>&1; then
  NPM_GYP_BIN="$(npm root -g)/npm/bin/node-gyp-bin"
  if [ -x "$NPM_GYP_BIN/node-gyp" ]; then
    export PATH="$NPM_GYP_BIN:$PATH"
  fi
fi

pnpm install --frozen-lockfile

ALIAS_DIR="$HOME/.cache/cairn-pw-browsers"
PREINSTALLED="${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}"
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
    for entry in "$PREINSTALLED"/*; do
      [ -e "$ALIAS_DIR/$(basename "$entry")" ] || ln -sfn "$entry" "$ALIAS_DIR/$(basename "$entry")"
    done
    EXPORT_LINE="export PLAYWRIGHT_BROWSERS_PATH=\"$ALIAS_DIR\""
    if [ -n "${CLAUDE_ENV_FILE:-}" ] && ! grep -qxF "$EXPORT_LINE" "$CLAUDE_ENV_FILE" 2>/dev/null; then
      echo "$EXPORT_LINE" >> "$CLAUDE_ENV_FILE"
    fi
  fi
fi
