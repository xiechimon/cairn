#!/bin/sh
# Dual-package pack smoke (#264/#299): `npm pack` (the real publish shape; prepack
# builds the bundle + web dist) → manifest assertions (both packages) → install the
# main tarball in a temp dir outside the repo → boot with bare `node`
# → assert `/api/user/me` 200 + `/app` 200 + data-root isolation (temp CAIRN_HOME).
# Failure-mode enumeration fixed from spec #260 Testing Decisions + the 0.1.0 first-
# release incident (#266):
#   1. bundle missing a dependency (external misjudged) → bare node fails to boot → red
#   2. web dist not in the package / webDir misresolved → /app not 200 → red
#   3. migrations not in the package → first-boot migrate crashes → red
#   4. tarball contains src/test → content-list assertion red
#   5. dependencies still carry catalog:/workspace: (npm packs verbatim, install
#      fails silently) → red
#   6. bin path carries a ./ prefix (npm publish deems it invalid and silently
#      strips it, leaving npx without an entry) → red
# Installing outside the repo avoids npm's ancestor-resolution pitfall where it
# climbs the directory tree to the repo root to resolve `catalog:`; probes never
# touch the real ~/.cairn. The cli package gets manifest + content-list assertions
# (no process boot — the enroll chain belongs to e2e / first-release live runs).
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/cairn-pack-smoke.XXXXXX")
SERVER_PID=""
cleanup() {
  if [ -n "$SERVER_PID" ]; then kill "$SERVER_PID" 2>/dev/null || true; fi
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "== pack @xiechimon/cairn (prepack: web build + esbuild bundle + stage-web) =="
# npm pack is the real shape of npm publish: pnpm pack rewrites catalog:/workspace:,
# npm does not — assertions must test the publish shape (the broken 0.1.0 first-release
# package, #299).
(cd "$ROOT/apps/server" && npm pack --pack-destination "$WORK" >/dev/null)

TGZ=$(find "$WORK" -maxdepth 1 -name 'xiechimon-cairn-*.tgz' ! -name '*-cli-*' | head -n1)
[ -n "$TGZ" ] || { echo "FAIL: server tarball not produced"; exit 1; }

echo "== pack @xiechimon/cairn-cli (prepack: esbuild bundle) =="
(cd "$ROOT/apps/daemon" && npm pack --pack-destination "$WORK" >/dev/null)

TGZ_CLI=$(find "$WORK" -maxdepth 1 -name 'xiechimon-cairn-cli-*.tgz' | head -n1)
[ -n "$TGZ_CLI" ] || { echo "FAIL: cli tarball not produced"; exit 1; }

echo "== tarball manifest assertions (both packages) =="
assert_manifest() {
  tar -xzf "$1" -O package/package.json | node -e "
let s='';
process.stdin.on('data',d=>s+=d).on('end',()=>{
  const p=JSON.parse(s);
  const deps=Object.entries(p.dependencies||{});
  const bad=deps.filter(([,v])=>/workspace:|catalog:/.test(v));
  if (bad.length) { console.error('FAIL: '+p.name+' dependencies still carry workspace/catalog: '+JSON.stringify(bad)); process.exit(1); }
  if (!p.bin || !p.bin.cairn) { console.error('FAIL: '+p.name+' missing bin.cairn'); process.exit(1); }
  const binBad=Object.entries(p.bin).filter(([,v])=>String(v).startsWith('./'));
  if (binBad.length) { console.error('FAIL: '+p.name+' bin path carries a ./ prefix (npm publish silently strips such bins): '+JSON.stringify(binBad)); process.exit(1); }
  console.log('ok: '+p.name+'@'+p.version+' deps = ' + (deps.map(([k])=>k).join(', ') || '(none)'));
})"
}
assert_manifest "$TGZ"
assert_manifest "$TGZ_CLI"

echo "== cli tarball content assertions =="
LIST_CLI=$(tar -tzf "$TGZ_CLI")
for want in '^package/dist/cli.mjs$' '^package/LICENSE$'; do
  if printf '%s\n' "$LIST_CLI" | grep -q "$want"; then :; else echo "FAIL: cli tarball missing $want"; exit 1; fi
done
if printf '%s\n' "$LIST_CLI" | grep -q '^package/src/'; then echo "FAIL: cli src leaked into the tarball"; exit 1; fi
echo "ok: cli bundle/LICENSE present, no src leak"

echo "== tarball content assertions =="
LIST=$(tar -tzf "$TGZ")
for want in '^package/dist/index.mjs$' '^package/web/index.html$' '^package/drizzle/meta/_journal.json$' '^package/drizzle/0000' '^package/LICENSE$'; do
  if printf '%s\n' "$LIST" | grep -q "$want"; then :; else echo "FAIL: tarball missing $want"; exit 1; fi
done
if printf '%s\n' "$LIST" | grep -q '^package/src/'; then echo "FAIL: src leaked into the tarball"; exit 1; fi
if printf '%s\n' "$LIST" | grep -q '^package/test/'; then echo "FAIL: test leaked into the tarball"; exit 1; fi
echo "ok: bundle/web dist/migrations/LICENSE present, no src/test leak ($(printf '%s\n' "$LIST" | wc -l | tr -d ' ') entries)"

echo "== install outside the repo ($WORK/install) =="
mkdir "$WORK/install"
cd "$WORK/install"
npm init -y >/dev/null 2>&1
npm install "$TGZ" --no-audit --no-fund >/dev/null 2>&1
echo "ok: npm install $(basename "$TGZ")"

echo "== boot with bare node (isolated CAIRN_HOME) =="
PKG="$WORK/install/node_modules/@xiechimon/cairn"
PORT=""
for candidate in 8395 8396 8397 8398; do
  if ! lsof -iTCP:$candidate -sTCP:LISTEN >/dev/null 2>&1; then PORT=$candidate; break; fi
done
[ -n "$PORT" ] || { echo "FAIL: ports 8395-8398 all in use"; exit 1; }
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
  echo "FAIL: /api/user/me not ready (failed to boot or timed out) — server output tail:"
  tail -8 "$WORK/server.out" || true
  exit 1
fi
me_body=$(curl -s --noproxy '*' "http://127.0.0.1:$PORT/api/user/me")
case "$me_body" in *'"displayName":"Owner"'*) echo "ok: /api/user/me 200 + seed effective";; *) echo "FAIL: me body unexpected: $me_body"; exit 1;; esac

if ! wait_200 /app; then
  echo "FAIL: /app not 200 (web dist missing from the package or webDir misresolved) — server output tail:"
  tail -8 "$WORK/server.out" || true
  exit 1
fi
echo "ok: /app 200 (in-package webDir detection works)"

kill "$SERVER_PID" 2>/dev/null || true
SERVER_PID=""
echo "PASS: main-package pack smoke all green"
