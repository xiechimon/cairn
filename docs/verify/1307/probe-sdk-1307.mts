// #1307 实物取证探针（三态受管 MCP：strictMcpConfig 锁真生效，非源码推断）。
// 917 探针同型：真 @anthropic-ai/claude-agent-sdk@0.3.278（bundled CLI）+
// 真 daemon 组装函数（buildClaudeSdkOptions 本尊，非手抄形状）。两组四臂：
//
//   A 组（argv 捕获，无网络无凭据）：SDK 出口翻译面——stub 可执行文件当
//   pathToClaudeCodeExecutable，捕获 SDK 实际拼给 CLI 的参数：
//     A1 managed（受管空 + strict）→ argv 必含 --strict-mcp-config 与 --mcp-config
//     A2 inherit（缺省态）        → argv 必不含 --strict-mcp-config（逃生门零回归）
//   B 组（真会话，本机 claude 登录态 + 真模型）：prompt_snapshot 工具面对照——
//     B1 control（缺省态 = pre-fix 形状，mcpServers 键不发）→ 用户全局 MCP
//        全家桶进会话（复现 #1307 泄漏面）
//     B2 managed（受管 + strict + in-process pacman 缝一条 dummy 工具）→
//        工具面 = builtin + mcp__pacman__*，零全局 MCP（泄漏不再发生）
//   判据 = 会话存档 jsonl 的 attachment[type=prompt_snapshot].tools 直方图
//   （与票面取证同法：b70499b7 存档 319 工具/960KB 即该字段）。
//
// 运行（B 组两个前提，NOTES.md §1 有实测依据）：
//   1. 干净环境起（无 CLAUDECODE/CLAUDE_CODE_* 嵌套标记——嵌套会话环境里
//      子 CLI 不加载用户全局 MCP，control 臂假阴性）；
//   2. 机器 claude 可执行文件（SDK bundled CLI 在 SDK spawn 形下不加载用户
//      全局 mcpServers；dogfood 泄漏会话与 daemon 生产形都是机器 claude）。
// `cd apps/daemon && env -i HOME="$HOME" TMPDIR=/tmp PATH="<fnm bin>:/opt/homebrew/bin:/usr/bin:/bin" \
//    ANTHROPIC_AUTH_TOKEN="$ANTHROPIC_AUTH_TOKEN" ANTHROPIC_BASE_URL="$ANTHROPIC_BASE_URL" \
//    pnpm exec tsx ../../docs/verify/1307/probe-sdk-1307.mts`
// 环境变量：PROBE_MODEL（缺省 glm-5.3，917 同款）；PROBE_EXECUTABLE（缺省
// /opt/homebrew/bin/claude）；SKIP_B=1 只跑 A 组。
// 产物 = 同目录 argv-managed.json / argv-inherit.json / session-contrast.json。

import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const require_ = createRequire(new URL('../../../apps/daemon/package.json', import.meta.url));
const { z } = require_('zod') as typeof import('zod');
const sdk = await import(
  new URL(
    '../../../apps/daemon/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs',
    import.meta.url,
  ).href
);
const { buildClaudeSdkOptions } = (await import(
  '../../../apps/daemon/src/backend/claude-code.js'
)) as typeof import('../../../apps/daemon/src/backend/claude-code.js');

const ARTIFACT_DIR = new URL('.', import.meta.url).pathname;
const MODEL = process.env.PROBE_MODEL || 'glm-5.3';
const PROMPT = 'Reply with exactly: PROBE-OK-1307';
// B 组对齐 daemon 生产形态（#1050：machine-loop 探测本机 claude 可执行文件 →
// pathToClaudeCodeExecutable）——dogfood 泄漏会话即 2.1.294 机器 claude 所写；
// SDK bundled CLI（2.1.278）在该起法下不加载用户全局 mcpServers，用它做
// control 臂会假阴性。A 组不受影响（stub 可执行文件捕获 argv，与版本无关）。
const MACHINE_CLAUDE =
  process.env.PROBE_EXECUTABLE ??
  ['/opt/homebrew/bin/claude', '/usr/local/bin/claude'].find((p) => existsSync(p));

function baseParts(over: Record<string, unknown> = {}) {
  return {
    cwd: mkdtempSync(join(tmpdir(), 'pacman-1307-')),
    modelId: MODEL,
    resumeId: null,
    sessionId: randomUUID(),
    disallowedTools: [],
    mcpServers: {},
    abortController: new AbortController(),
    ...over,
  } as Parameters<typeof buildClaudeSdkOptions>[0];
}

// —— A 组：stub 可执行文件捕获 SDK → CLI argv ————————————————

async function captureArgv(label: string, parts: ReturnType<typeof baseParts>): Promise<unknown[]> {
  const stubDir = mkdtempSync(join(tmpdir(), 'pacman-1307-stub-'));
  const stub = join(stubDir, 'stub-cli.mjs');
  const argvOut = join(stubDir, 'argv.json');
  writeFileSync(
    stub,
    `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(argvOut)}, JSON.stringify(process.argv.slice(2), null, 2));
process.exit(0);
`,
    'utf8',
  );
  chmodSync(stub, 0o755);
  const options = buildClaudeSdkOptions({ ...parts, executablePath: stub });
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 30_000);
  try {
    const q = sdk.query({ prompt: 'x', options: { ...options, abortController: abort } });
    for await (const _msg of q) {
      // stub 立即退出：迭代器很快抛/终；argv 文件在 spawn 时已落盘。
    }
  } catch {
    // 预期：stub 不讲 stream-json 协议。
  } finally {
    clearTimeout(timer);
  }
  if (!existsSync(argvOut)) throw new Error(`${label}: stub was never spawned (no argv file)`);
  const argv = JSON.parse(readFileSync(argvOut, 'utf8')) as string[];
  const hasStrict = argv.includes('--strict-mcp-config');
  const mcpIdx = argv.indexOf('--mcp-config');
  const artifact = {
    arm: label,
    hasStrictMcpConfig: hasStrict,
    hasMcpConfigFlag: mcpIdx >= 0,
    mcpConfigValue: mcpIdx >= 0 ? argv[mcpIdx + 1] : null,
    argv,
  };
  writeFileSync(
    join(ARTIFACT_DIR, `argv-${label === 'managed' ? 'managed' : 'inherit'}.json`),
    JSON.stringify(artifact, null, 2),
    'utf8',
  );
  console.log(
    `[A/${label}] --strict-mcp-config=${hasStrict} --mcp-config=${mcpIdx >= 0} value=${
      mcpIdx >= 0 ? String(argv[mcpIdx + 1]).slice(0, 120) : '-'
    }`,
  );
  return [hasStrict, mcpIdx >= 0];
}

// —— B 组：真会话 prompt_snapshot 工具面对照 ————————————————

function findTranscript(sessionId: string): string | null {
  const root = join(homedir(), '.claude', 'projects');
  if (!existsSync(root)) return null;
  for (const dir of readdirSync(root)) {
    const p = join(root, dir, `${sessionId}.jsonl`);
    if (existsSync(p)) return p;
  }
  return null;
}

function snapshotFacts(transcript: string) {
  let best: { tools?: { name?: string }[] } | null = null;
  for (const line of readFileSync(transcript, 'utf8').split('\n')) {
    if (line.length === 0) continue;
    try {
      const o = JSON.parse(line) as { attachment?: { type?: string; tools?: { name?: string }[] } };
      if (o.attachment?.type === 'prompt_snapshot' && o.attachment.tools) best = o.attachment;
    } catch {
      // 半行/控制行，跳过。
    }
  }
  if (best === null || !best.tools) return null;
  const hist: Record<string, number> = {};
  for (const t of best.tools) {
    const n = t.name ?? '?';
    const key = n.startsWith('mcp__') ? n.split('__').slice(0, 2).join('__') : 'builtin';
    hist[key] = (hist[key] ?? 0) + 1;
  }
  return {
    toolCount: best.tools.length,
    promptSnapshotBytes: new TextEncoder().encode(JSON.stringify(best)).length,
    histogram: hist,
  };
}

async function runRealSession(label: string, parts: ReturnType<typeof baseParts>) {
  const options = buildClaudeSdkOptions(parts);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 180_000);
  let reply: string | null = null;
  let error: string | null = null;
  try {
    const q = sdk.query({ prompt: PROMPT, options: { ...options, abortController: abort } });
    for await (const msg of q) {
      const m = msg as { type?: string; subtype?: string; result?: string };
      if (m.type === 'result') reply = typeof m.result === 'string' ? m.result.slice(0, 200) : null;
    }
  } catch (err) {
    error = err instanceof Error ? err.message.slice(0, 400) : String(err).slice(0, 400);
  } finally {
    clearTimeout(timer);
  }
  const transcript = findTranscript(parts.sessionId);
  const facts = transcript !== null ? snapshotFacts(transcript) : null;
  const out = {
    arm: label,
    sessionId: parts.sessionId,
    cwd: parts.cwd,
    transcript,
    reply,
    error,
    ...(facts ?? {}),
  };
  console.log(
    `[B/${label}] tools=${facts?.toolCount ?? 'NO-SNAPSHOT'} bytes=${
      facts?.promptSnapshotBytes ?? '-'
    } hist=${JSON.stringify(facts?.histogram ?? null)} reply=${JSON.stringify(reply)} error=${
      error ?? '-'
    }`,
  );
  return out;
}

// —— 主流程 ——————————————————————————————————————————————

const summary: Record<string, unknown> = { model: MODEL, arms: [] };

// A1 managed：受管空 + strict（#1307 修后形状）。
const a1 = await captureArgv('managed', baseParts({ mcpServers: {}, strictMcpConfig: true }));
// A2 inherit：缺省态（旧 server 形/逃生门，pre-fix 同形）。
const a2 = await captureArgv('inherit', baseParts({ mcpServers: {} }));
summary.aManaged = { hasStrict: a1[0], hasMcpConfig: a1[1] };
summary.aInherit = { hasStrict: a2[0], hasMcpConfig: a2[1] };

if (process.env.SKIP_B !== '1') {
  if (MACHINE_CLAUDE === undefined) throw new Error('no machine claude executable found for B arms');
  const execPart = { executablePath: MACHINE_CLAUDE };
  // B1 control：pre-fix 形状（受管空但键不发）→ 复现用户全局 MCP 泄漏。
  const b1 = await runRealSession('control-inherit', baseParts({ mcpServers: {}, ...execPart }));
  // B2 managed：修后形状（受管 + strict + in-process pacman 缝一条 dummy 工具）。
  const seam = sdk.createSdkMcpServer({
    name: 'pacman',
    alwaysLoad: true,
    tools: [
      sdk.tool(
        'probe_echo',
        'Probe dummy tool (#1307 host seam stand-in).',
        { text: z.string() },
        async (params: { text: string }) => ({
          content: [{ type: 'text', text: params.text }],
        }),
      ),
    ],
  });
  const b2 = await runRealSession(
    'managed-strict',
    baseParts({ mcpServers: { pacman: seam }, strictMcpConfig: true, ...execPart }),
  );
  summary.arms = [b1, b2];
  writeFileSync(
    join(ARTIFACT_DIR, 'session-contrast.json'),
    JSON.stringify(summary, null, 2),
    'utf8',
  );
}

console.log('PROBE-DONE', JSON.stringify({ aManaged: summary.aManaged, aInherit: summary.aInherit }));
