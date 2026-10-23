#!/bin/sh
# 双包 pack 冒烟（#264/#299）：`npm pack`（发布真身形态；prepack 自建 bundle +
# web dist）→ manifest 断言（双包）→ 仓外临时目录装主包 tarball → 裸 `node` 起
# → 断言 `/api/user/me` 200 + `/app` 200 + 数据根隔离（临时 CAIRN_HOME）。
# 失败方式枚举 = spec #260 Testing Decisions + 首发 0.1.0 事故（#266）固化：
#   1. bundle 缺依赖（external 误伤）→ 裸 node 起不来 → 红
#   2. web dist 未进包 / webDir 解析错 → /app 非 200 → 红
#   3. migration 未进包 → 首启 migrate 崩 → 红
#   4. tarball 含 src/test → 内容清单断言红
#   5. dependencies 残留 catalog:/workspace:（npm 原样打包、装包静默崩）→ 红
#   6. bin 路径带 ./ 前缀（npm publish 判 invalid 静默摘除、npx 无入口）→ 红
# 仓外安装 = 规避 npm 沿目录树爬到仓根解析 `catalog:` 的祖先坑；探针一律
# 不碰真实 ~/.cairn。cli 包断言 manifest+内容清单（不起进程——enroll 链
# 归 e2e/首发实测）。
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/cairn-pack-smoke.XXXXXX")
SERVER_PID=""
cleanup() {
  if [ -n "$SERVER_PID" ]; then kill "$SERVER_PID" 2>/dev/null || true; fi
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "== pack @xiechimon/cairn（prepack: web build + esbuild bundle + stage-web） =="
# npm pack = npm publish 的真身形态：pnpm pack 会替换 catalog:/workspace:，npm 不会——
# 断言必须测发布形态（首发 0.1.0 坏包教训，#299）。
(cd "$ROOT/apps/server" && npm pack --pack-destination "$WORK" >/dev/null)

TGZ=$(find "$WORK" -maxdepth 1 -name 'xiechimon-cairn-*.tgz' ! -name '*-cli-*' | head -n1)
[ -n "$TGZ" ] || { echo "FAIL: server tarball 未产出"; exit 1; }

echo "== pack @xiechimon/cairn-cli（prepack: esbuild bundle） =="
(cd "$ROOT/apps/daemon" && npm pack --pack-destination "$WORK" >/dev/null)

TGZ_CLI=$(find "$WORK" -maxdepth 1 -name 'xiechimon-cairn-cli-*.tgz' | head -n1)
[ -n "$TGZ_CLI" ] || { echo "FAIL: cli tarball 未产出"; exit 1; }

echo "== tarball manifest 断言（双包） =="
assert_manifest() {
  tar -xzf "$1" -O package/package.json | node -e "
let s='';
process.stdin.on('data',d=>s+=d).on('end',()=>{
  const p=JSON.parse(s);
  const deps=Object.entries(p.dependencies||{});
  const bad=deps.filter(([,v])=>/workspace:|catalog:/.test(v));
  if (bad.length) { console.error('FAIL: '+p.name+' dependencies 残留 workspace/catalog: '+JSON.stringify(bad)); process.exit(1); }
  if (!p.bin || !p.bin.cairn) { console.error('FAIL: '+p.name+' bin.cairn 缺'); process.exit(1); }
  const binBad=Object.entries(p.bin).filter(([,v])=>String(v).startsWith('./'));
  if (binBad.length) { console.error('FAIL: '+p.name+' bin 路径带 ./ 前缀（npm publish 会静默摘除 bin）: '+JSON.stringify(binBad)); process.exit(1); }
  console.log('ok: '+p.name+'@'+p.version+' deps = ' + (deps.map(([k])=>k).join(', ') || '(none)'));
})"
}
assert_manifest "$TGZ"
assert_manifest "$TGZ_CLI"

echo "== cli tarball 内容断言 =="
LIST_CLI=$(tar -tzf "$TGZ_CLI")
for want in '^package/dist/cli.mjs$' '^package/LICENSE$'; do
  if printf '%s\n' "$LIST_CLI" | grep -q "$want"; then :; else echo "FAIL: cli tarball 缺 $want"; exit 1; fi
done
if printf '%s\n' "$LIST_CLI" | grep -q '^package/src/'; then echo "FAIL: cli src 泄漏进 tarball"; exit 1; fi
echo "ok: cli bundle/LICENSE 在位、无 src 泄漏"

echo "== tarball 内容断言 =="
LIST=$(tar -tzf "$TGZ")
for want in '^package/dist/index.mjs$' '^package/web/index.html$' '^package/drizzle/meta/_journal.json$' '^package/drizzle/0000' '^package/LICENSE$'; do
  if printf '%s\n' "$LIST" | grep -q "$want"; then :; else echo "FAIL: tarball 缺 $want"; exit 1; fi
done
if printf '%s\n' "$LIST" | grep -q '^package/src/'; then echo "FAIL: src 泄漏进 tarball"; exit 1; fi
if printf '%s\n' "$LIST" | grep -q '^package/test/'; then echo "FAIL: test 泄漏进 tarball"; exit 1; fi
echo "ok: bundle/web dist/migrations/LICENSE 在位、无 src/test 泄漏（$(printf '%s\n' "$LIST" | wc -l | tr -d ' ') 条目）"

echo "== 仓外安装（$WORK/install） =="
mkdir "$WORK/install"
cd "$WORK/install"
npm init -y >/dev/null 2>&1
npm install "$TGZ" --no-audit --no-fund >/dev/null 2>&1
echo "ok: npm install $(basename "$TGZ")"

echo "== 裸 node 起（隔离 CAIRN_HOME） =="
PKG="$WORK/install/node_modules/@xiechimon/cairn"
PORT=""
for candidate in 8395 8396 8397 8398; do
  if ! lsof -iTCP:$candidate -sTCP:LISTEN >/dev/null 2>&1; then PORT=$candidate; break; fi
done
[ -n "$PORT" ] || { echo "FAIL: 8395-8398 全被占用"; exit 1; }
echo "using port $PORT"
PORT=$PORT CAIRN_HOME="$WORK/home" node "$PKG/dist/index.mjs" > "$WORK/server.out" 2>&1 &
SERVER_PID=$!

wait_200() {
  i=0
  while [ "$i" -lt 40 ]; do
    code=$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT$1" 2>/dev/null || echo 000)
    if [ "$code" = "200" ]; then return 0; fi
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then break; fi
    i=$((i + 1))
    sleep 0.5
  done
  return 1
}

if ! wait_200 /api/user/me; then
  echo "FAIL: /api/user/me 未就绪（起不来或超时）——server 输出尾部："
  tail -8 "$WORK/server.out" || true
  exit 1
fi
me_body=$(curl -s --noproxy '*' "http://127.0.0.1:$PORT/api/user/me")
case "$me_body" in *'"displayName":"Owner"'*) echo "ok: /api/user/me 200 + seed 生效";; *) echo "FAIL: me body 异常: $me_body"; exit 1;; esac

if ! wait_200 /app; then
  echo "FAIL: /app 非 200（web dist 未进包或 webDir 解析错）——server 输出尾部："
  tail -8 "$WORK/server.out" || true
  exit 1
fi
echo "ok: /app 200（webDir 包内探测生效）"

kill "$SERVER_PID" 2>/dev/null || true
SERVER_PID=""
echo "PASS: 主包 pack 冒烟全绿"
