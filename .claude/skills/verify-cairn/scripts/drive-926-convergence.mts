// #926 机制生效实物探针：重试面显式化 + 收敛判定改 agent_settled。
//
// 取「运行时真值」而非读源码（.claude/skills/verify-cairn「机制生效验收:实物判据」）：
//   Phase A — pi 真 SettingsManager 读回 daemon 显式 retry 配置（getRetrySettings），
//             证明 retry.* 不再是上游默认、而是被 pi 实际消费的显式值。
//   Phase B — 起一个真 pi AgentSession（daemon materializeProvider + buildPiSessionSettings
//             + ModelRuntime + createAgentSession）打 stub LLM，订阅**原始 pi 事件**：
//             实证真 pi 发 agent_end 之后还发 agent_settled，且 daemon 的 mapPiSessionEvent
//             只在 agent_settled 处产出 done（agent_end 处不产出）——收敛信号 = settled。
//   Phase C — mapPiSessionEvent 的确定性对照（agent_end(!willRetry) → 空；agent_settled → done）。
//
// 运行（tsx 在 daemon 包内）：
//   cd apps/daemon && corepack pnpm exec tsx \
//     <repo>/.claude/skills/verify-cairn/scripts/drive-926-convergence.mts
// 产物：docs/verify/926/convergence-evidence.json（+ stdout 人读摘要）。退出码 0 = 全部断言通过。
//
// import 形态（CLAUDE.md 禁 inline import，top-level only）：探针在 .claude/ 下，bare
// `@earendil-works/*` 只在 apps/daemon 内解析（pnpm 未 hoist 到仓根），故一律走 repo-relative
// 静态 import——daemon 源码（.ts，tsx 直接加载）+ pi 的 dist 入口（package.json exports "."
// 的 import 位）。探针位置与 pnpm 布局固定，相对路径稳定；pi dist 内部 bare import 从其
// realpath（.pnpm store）解析，不受探针位置影响。

import { createServer, type Server } from 'node:http';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildPiSessionSettings,
  mapPiSessionEvent,
  materializeProvider,
  newMapState,
} from '../../../../apps/daemon/src/backend/pi.ts';
import { PI_RETRY_SETTINGS, RETRY_STORM_MAX } from '../../../../apps/daemon/src/backend/pi-retry.ts';
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '../../../../apps/daemon/node_modules/@earendil-works/pi-coding-agent/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`);
}

// —— stub LLM：OpenAI Chat Completions 兼容 SSE（integration/test/stub-llm.ts 同形，单轮）——
interface StubLlm {
  url: string;
  close: () => Promise<void>;
}
async function startStubLlm(): Promise<StubLlm> {
  const server: Server = createServer((req, res) => {
    if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
      res.writeHead(404).end();
      return;
    }
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const base = {
        id: 'chatcmpl-stub',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'stub-model',
      };
      const chunk = (payload: object) => `data: ${JSON.stringify(payload)}\n\n`;
      res.write(chunk({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] }));
      for (const word of ['Hello', ' world', '.']) {
        res.write(chunk({ ...base, choices: [{ index: 0, delta: { content: word } }] }));
      }
      res.write(chunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }));
      res.write(
        chunk({
          ...base,
          choices: [],
          usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20, prompt_tokens_details: { cached_tokens: 0 } },
        }),
      );
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    close: () => new Promise<void>((r2, rej) => server.close((e) => (e ? rej(e) : r2()))),
  };
}

const evidence: Record<string, unknown> = { ticket: 926, generatedAt: new Date().toISOString() };

// —— Phase A：pi 真 SettingsManager 读回显式 retry 配置 + 设置驱动读回对照 ——————
{
  const settings = buildPiSessionSettings();
  const sm = SettingsManager.inMemory(settings);
  const readback = sm.getRetrySettings();
  const providerReadback = sm.getProviderRetrySettings();
  // 关键对照：上面的显式值恰与 pi 1.0.4 内建默认逐字节相同，单看读回**分不清**「读了我们
  // 的设置」还是「回落默认」。故再喂同一 inMemory 一份 maxRetries ≠ 默认（5）的 retry 设置，
  // 读回随即变 5 —— 证明 getRetrySettings 读的是传入设置（设置驱动读回）。配合单测的引用
  // 同一性（buildPiSessionSettings().retry === PI_RETRY_SETTINGS）与 pi.ts 把该设置喂进
  // SettingsManager.inMemory，即得：真会话里 pi 读到的 maxRetries=3 来自我们的显式设置，不是
  // 默认巧合；且改动设置值会改变 pi 重试逻辑读到的值（不是摆设）。
  const probeMaxRetries = 5; // 故意 ≠ pi 默认 3
  const drivenReadback = SettingsManager.inMemory({
    compaction: { enabled: true },
    retry: { ...PI_RETRY_SETTINGS, maxRetries: probeMaxRetries },
  }).getRetrySettings();
  evidence.phaseA = {
    buildPiSessionSettings: settings,
    piGetRetrySettings: readback,
    piGetProviderRetrySettings: providerReadback,
    drivenProbe: { injectedMaxRetries: probeMaxRetries, readbackMaxRetries: drivenReadback.maxRetries },
    RETRY_STORM_MAX,
  };
  console.log('\n[Phase A] pi SettingsManager 读回显式 retry 配置 + 设置驱动读回对照');
  check('retry.enabled 显式 = true', readback.enabled === true, readback.enabled);
  check('retry.maxRetries 显式 = 3', readback.maxRetries === 3, readback.maxRetries);
  check('retry.baseDelayMs 显式 = 2000', readback.baseDelayMs === 2000, readback.baseDelayMs);
  check('retry.maxAgentDelayMs 显式 = 60000', readback.maxAgentDelayMs === 60000, readback.maxAgentDelayMs);
  check('retry.provider.maxRetries 显式 = 0', providerReadback.maxRetries === 0, providerReadback.maxRetries);
  check(
    `设置驱动读回：注入 maxRetries=${probeMaxRetries}（≠默认 3）→ pi 读回随之 = ${probeMaxRetries}（证非默认巧合）`,
    drivenReadback.maxRetries === probeMaxRetries,
    drivenReadback.maxRetries,
  );
  check('RETRY_STORM_MAX === pi getRetrySettings().maxRetries（护栏与设置不脱钩）', RETRY_STORM_MAX === readback.maxRetries, {
    RETRY_STORM_MAX,
    maxRetries: readback.maxRetries,
  });
}

// —— Phase B：真 pi AgentSession 打 stub LLM，捕获原始事件序 ——————————————
{
  const stub = await startStubLlm();
  const stubUrl = stub.url;
  const scratch = join(tmpdir(), `cairn-926-${Date.now()}`);
  const agentDir = join(scratch, 'agent');
  const sessionDir = join(scratch, 'sessions');
  const cwd = join(scratch, 'cwd');
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(sessionDir, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  process.env.PI_OFFLINE = '1';
  process.env.PI_CODING_AGENT_DIR = agentDir;

  const provider = {
    kind: 'http',
    providerId: 'stub-gw',
    baseUrl: stubUrl,
    api: 'openai-completions',
    authHeader: true,
    models: [{ id: 'stub-model', name: 'stub-model' }],
  };
  const modelsPath = join(agentDir, 'models.json');
  const authPath = join(agentDir, 'auth.json');
  materializeProvider(modelsPath, provider);

  const rawTypes: string[] = [];
  const mappedTypes: string[] = [];
  const doneAtRawIndex: number[] = [];
  try {
    const runtime = await ModelRuntime.create({ authPath, modelsPath });
    await runtime.setRuntimeApiKey('stub-gw', 'stub-key');
    const model = runtime.getModel('stub-gw', 'stub-model');
    const settingsManager = SettingsManager.inMemory(buildPiSessionSettings());
    const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager, noSkills: true });
    await loader.reload();
    const sessionManager = SessionManager.create(cwd, sessionDir);
    const { session } = await createAgentSession({
      cwd,
      agentDir,
      model,
      modelRuntime: runtime,
      resourceLoader: loader,
      sessionManager,
      settingsManager,
      noTools: true,
    });
    const state = newMapState();
    session.subscribe((event: { type: string }) => {
      const rawIndex = rawTypes.length;
      rawTypes.push(event.type);
      for (const mapped of mapPiSessionEvent(event, state)) {
        mappedTypes.push(mapped.type);
        if (mapped.type === 'done') doneAtRawIndex.push(rawIndex);
      }
    });
    await session.prompt('Say hello in one short sentence.');
    session.dispose();
  } finally {
    await stub.close();
    rmSync(scratch, { recursive: true, force: true });
  }

  const agentEndIdx = rawTypes.indexOf('agent_end');
  const settledIdx = rawTypes.indexOf('agent_settled');
  evidence.phaseB = { rawEventOrder: rawTypes, mappedEventOrder: mappedTypes, agentEndIdx, settledIdx, doneAtRawIndex };

  console.log('\n[Phase B] 真 pi AgentSession × stub LLM：原始事件序 + 映射 done 时机');
  console.log(`  raw pi events: ${rawTypes.join(' → ')}`);
  console.log(`  mapped StepEvents: ${mappedTypes.join(' → ')}`);
  check('真 pi 发出 agent_end', agentEndIdx >= 0, agentEndIdx);
  check('真 pi 发出 agent_settled', settledIdx >= 0, settledIdx);
  check('agent_settled 在 agent_end 之后（settled 是收敛权威信号）', settledIdx > agentEndIdx && agentEndIdx >= 0, {
    agentEndIdx,
    settledIdx,
  });
  check('映射产出恰好一个 done', mappedTypes.filter((t) => t === 'done').length === 1, mappedTypes.filter((t) => t === 'done').length);
  check(
    'done 由 agent_settled 触发（done 对应的原始事件索引 == agent_settled 索引）',
    doneAtRawIndex.length === 1 && doneAtRawIndex[0] === settledIdx,
    { doneAtRawIndex, settledIdx },
  );
  check(
    'agent_end 未触发 done（旧路径会在此提前发 done）',
    !doneAtRawIndex.includes(agentEndIdx),
    { agentEndIdx, doneAtRawIndex },
  );
}

// —— Phase C：mapPiSessionEvent 确定性对照 ————————————————
{
  const s1 = newMapState();
  const endOut = mapPiSessionEvent({ type: 'agent_end', willRetry: false }, s1);
  const settledOut = mapPiSessionEvent({ type: 'agent_settled' }, s1);
  evidence.phaseC = { agentEndWillRetryFalse: endOut, agentSettled: settledOut };
  console.log('\n[Phase C] mapPiSessionEvent 确定性对照');
  check('agent_end(willRetry=false) → 不发 done（空）', endOut.length === 0, endOut);
  check('agent_settled → 发 done', settledOut.length === 1 && settledOut[0].type === 'done', settledOut);
}

// —— 落盘 + 收尾 ————————————————
const outDir = resolve(root, 'docs/verify/926');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, 'convergence-evidence.json');
evidence.failures = failures;
writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
console.log(`\n证据写入 ${outPath}`);
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
