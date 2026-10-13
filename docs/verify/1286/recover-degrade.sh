#!/usr/bin/env bash
# #1286 recover 面降级实证
# 实物一：单测 5 失败方式全绿（真 runner 降级链）；实物二：真 pi 后端缺 .jsonl
# → SessionNotResumableError（issue 报告的三连跪真实触发条件）。
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
TD="$(mktemp -d /tmp/pacman-1286-verify-XXXX)"
trap 'rm -rf "$TD"' EXIT
cd "$REPO_ROOT/apps/daemon"

echo "=== Evidence 1: SessionNotResumableError class + missing .jsonl (real pi backend) ==="
cat > "$TD/ev.mts" <<'TS'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PiBackend } from './src/backend/pi.js';
import { SessionNotResumableError } from './src/backend/errors.js';

const home = process.env.PACMAN_HOME!;
const piHome = join(home, "pi-home");
const agentDir = join(home, "agent-dir");
const sessionDir = join(home, "chat-sessions");
mkdirSync(piHome, { recursive: true });
mkdirSync(agentDir, { recursive: true });
mkdirSync(sessionDir, { recursive: true });

writeFileSync(join(sessionDir, "index.json"),
  JSON.stringify({"pi-sess-dead":"/nonexistent/pi-sess-dead.jsonl"}));

writeFileSync(join(agentDir, "models.json"), JSON.stringify({
  providers: [{ id: "tp", label: "T", kind: "http", baseUrl: "http://127.0.0.1:9/v1",
    api: "openai-completions", authHeader: true, models: [{ id: "tm", name: "tm" }] }]
}));

const backend = new PiBackend({
  piHome, agentDir, sessionDir,
  resolveSessionFile(id: string) {
    try { return JSON.parse(readFileSync(join(sessionDir,"index.json"),"utf-8"))[id] ?? null; }
    catch { return null; }
  },
  onSession() {},
});

const idx = JSON.parse(readFileSync(join(sessionDir,"index.json"),"utf-8"));
console.log("index has pi-sess-dead:", "pi-sess-dead" in idx);
console.log("file exists:", existsSync(idx["pi-sess-dead"]));

try {
  await backend.continueSession("pi-sess-dead", {
    provider: { kind: "http", providerId: "tp", baseUrl: "http://127.0.0.1:9/v1",
      api: "openai-completions", authHeader: true, models: [{ id: "tm", name: "tm" }] },
    modelId: "tm", cwd: piHome,
  });
  console.log("BUG: did not throw");
  process.exit(1);
} catch (err: any) {
  const ok = err instanceof SessionNotResumableError;
  console.log("error type:", ok ? "SessionNotResumableError OK" : `WRONG: ${err?.constructor?.name}`);
  console.log("message:", err.message);
  console.log("matches issue:", err.message.includes("not found on this machine"));
}
TS
cp "$TD/ev.mts" ./ev.mts
PACMAN_HOME="$TD/pacman-home" npx tsx ./ev.mts 2>&1
rm -f ./ev.mts
echo ""

echo "=== Evidence 2: unit tests (5 failure modes) ==="
npx vitest run test/runner-recover-degrade.test.ts --reporter=verbose 2>&1
echo ""

echo "=== Done ==="