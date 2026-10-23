#!/usr/bin/env node
// verify-cairn drive-chief-catchup — 回合进行中订阅会话流的进场补发（#740）live 闭环。
//
// 症状路径：#640「开始任务」发完回合只给 toast → 用户点「查看会话」开抽屉时
// 回合已在飞 → 订阅前流掉的增量此前任何地方都不存在（hub 零缓冲）。本票 =
// hub 为在飞段维护文本缓冲、subscribe 时作为一条 text_delta 快照补发。
//
// 铺底全走公开 REST + **假机器**（drive-agent-identity.mjs 同律）：provider +
// agent + PATCH chief 绑定 + POST chief/threads 建线程入队回合步 + api-key/
// machine enroll 后认领该步、经 machine tool 缝推 transcript_delta、终局 PUT
// transcript.json + POST done——零 daemon、零 LLM，回合数据面与真机器同形。
//
// 两条证据面：
//  A. API 面（确定性）：回合在飞时第二个 SSE 客户端进场 = 收到一条补发
//     text_delta（全前缀精确拼接）；接续增量不重不断；断线重连同快照；
//     终局后新流零补发。
//  B. 浏览器面：中途打开 chief 抽屉 → 打字尾行即刻显示已流出前缀 → 继续
//     打字 → 终稿收敛（不双份）。动效面证据 = GIF（本仓 #656/#644 先例）。
//
// 双态：缺省 = 新行为全链应 PASS；`--expect=old` 反转期望取「同等场景」
// before 基线（drive-agent-identity.mjs / drive-newtask-key.mjs 先例）：
// 中途进场打字行零文本（前缀丢失）、API 面零补发帧。依赖全新库：重验 =
// 重 launch。
// 用法：VERIFY_REPO_ROOT=<worktree> node drive-chief-catchup.mjs [--expect=old]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SCRIPT_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const REPO = process.env.VERIFY_REPO_ROOT ?? SCRIPT_REPO;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(REPO, '.claude/verify-run');
const EXPECT_OLD = process.argv.includes('--expect=old');
const portsFile = join(RUN_DIR, 'ports.json');
if (!existsSync(portsFile)) {
  process.stderr.write('无栈：' + portsFile + ' 不存在或损坏。先跑 launch.mjs\n');
  process.exit(1);
}
const stack = JSON.parse(readFileSync(portsFile, 'utf8'));
const SERVER = 'http://127.0.0.1:' + (stack.serverPort ?? process.env.VERIFY_PORT ?? 8791);
const WEB = 'http://127.0.0.1:' + (stack.webPort ?? process.env.VERIFY_WEB_PORT ?? 5273);
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ??
  join(SCRIPT_REPO, '.claude/verify-evidence/' + ts + '-chief-catchup' + (EXPECT_OLD ? '-before' : ''));
mkdirSync(EVIDENCE, { recursive: true });

const checks = [];
function check(name, ok, detail) {
  if (typeof ok !== 'boolean') {
    throw new TypeError('check(' + JSON.stringify(name) + ') 的 ok 位须为 boolean，收到 ' + typeof ok);
  }
  checks.push({ name, ok, detail: detail ?? null });
  process.stdout.write((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  — ' + detail : '') + '\n');
}
const artifacts = [];
async function shot(page, name, opts) {
  const target = opts?.clip ? page.locator(opts.clip) : page;
  await target.screenshot({ path: join(EVIDENCE, name) });
  artifacts.push(name);
  process.stdout.write('shot  ' + name + '\n');
}

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error('GET ' + url + ' → ' + res.status);
  return res.json();
}
async function sendJson(url, body, method, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  const res = await fetch(url, {
    method: method ?? 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeoutMs, label) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() >= end) return null;
    await sleep(60);
  }
}

/** 原生 SSE 读流（Node fetch 流式 body）：frames 累积 text_delta 事件载荷。 */
async function openSse(url) {
  const ctrl = new AbortController();
  const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'text/event-stream' } });
  if (!res.ok) throw new Error('SSE ' + url + ' → ' + res.status);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const frames = [];
  let buf = '';
  let closed = false;
  const pump = (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buf += decoder.decode(value, { stream: true });
      let idx = buf.indexOf('\n\n');
      while (idx >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of frame.split('\n')) {
          if (line.startsWith('data:')) {
            try {
              frames.push(JSON.parse(line.slice(5).trim()));
            } catch {
              /* 半帧防御 */
            }
          }
        }
        idx = buf.indexOf('\n\n');
      }
    }
  })().catch(() => {});
  return {
    frames,
    deltas: () => frames.filter((f) => f.type === 'text_delta').map((f) => f.text),
    close: () => {
      closed = true;
      ctrl.abort();
      void pump;
    },
    isClosed: () => closed,
  };
}

// —— 铺底（全 REST + 假机器，非被测路径）————————————————————————
const teams = await getJson(SERVER + '/api/teams');
const teamId = teams[0]?.id;
if (!teamId) throw new Error('无 team——先重 launch（全新库 seed）');

const prov = await sendJson(SERVER + '/api/teams/' + teamId + '/providers', {
  providerId: 'stub-gw',
  label: 'Stub Gateway',
  baseUrl: 'http://127.0.0.1:9/v1',
  api: 'openai-completions',
  authHeader: true,
  compat: { supportsDeveloperRole: false },
  models: [{ id: 'stub-model', name: 'stub-model' }],
});
if (![200, 201, 409].includes(prov.status)) throw new Error('provider → ' + prov.status);

const agent = await sendJson(SERVER + '/api/teams/' + teamId + '/agents', {
  displayName: '补发验证员',
  provider: 'stub-gw',
  modelId: 'stub-model',
});
if (![200, 201].includes(agent.status)) throw new Error('agent → ' + agent.status);
const AGENT_ID = agent.body?.id ?? agent.body?.agentId ?? agent.body?.record?.id;
if (!AGENT_ID) throw new Error('agent 无 id：' + JSON.stringify(agent.body));

const bind = await sendJson(
  SERVER + '/api/teams/' + teamId + '/chief',
  { agent: { agentId: AGENT_ID, thinkingLevel: null } },
  'PATCH',
);
if (bind.status !== 200) throw new Error('chief bind → ' + bind.status);

const thread = await sendJson(SERVER + '/api/teams/' + teamId + '/chief/threads', {
  content: '请核对补发链路，先说明思路再给结论。',
});
if (thread.status !== 201) throw new Error('chief threads → ' + thread.status);
const threadId = thread.body?.thread?.id;
if (!threadId) throw new Error('thread 无 id：' + JSON.stringify(thread.body));

const key = await sendJson(SERVER + '/api/teams/' + teamId + '/api-keys', {
  name: 'catchup-probe',
  gitAccess: false,
  mcpAccess: false,
  toolGrants: { read: [], write: [] },
});
const keyPlain = key.body?.plaintext ?? key.body?.record?.plaintext ?? key.body?.token;
if (!keyPlain) throw new Error('api-key 无 plaintext：' + JSON.stringify(key.body));

const enroll = await sendJson(
  SERVER + '/api/machine/enroll',
  { teamId, name: 'catchup-probe-machine', cliVersion: '0.1.0' },
  'POST',
  keyPlain,
);
const machineToken = enroll.body?.token ?? enroll.body?.machine?.token;
if (enroll.status !== 200 || !machineToken) throw new Error('enroll → ' + enroll.status);

// 假机器认领 chief 回合步（响应双层包装 {step:{step:{…}}}，machine-wire 律）。
const claim = await sendJson(SERVER + '/api/machine/tasks/claim', {}, 'POST', machineToken);
const claimed = claim.body?.step?.step ?? claim.body?.step;
if (!claimed?.id) throw new Error('claim 失败：' + JSON.stringify(claim.body));
const stepId = claimed.id;

async function delta(text) {
  const res = await sendJson(
    SERVER + '/api/machine/tool/' + stepId,
    { kind: 'transcript_delta', text },
    'POST',
    machineToken,
  );
  if (res.status !== 200) throw new Error('delta → ' + res.status + ' ' + JSON.stringify(res.body));
  return res;
}
async function finishTurn(finalText) {
  const transcript = {
    stepId,
    messages: [{ id: 'probe-assistant-final', role: 'assistant', content: finalText, createdAt: Date.now() }],
  };
  const urls = await sendJson(
    SERVER + '/api/machine/upload-urls/' + stepId,
    { files: [{ name: 'transcript.json', size: JSON.stringify(transcript).length }] },
    'POST',
    machineToken,
  );
  const upload = urls.body?.uploads?.find((u) => u.name === 'transcript.json');
  if (!upload) throw new Error('upload-urls 无 transcript 槽：' + JSON.stringify(urls.body));
  const put = await fetch(upload.url, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...(upload.headers ?? {}), authorization: 'Bearer ' + machineToken },
    body: JSON.stringify(transcript),
    signal: AbortSignal.timeout(8000),
  });
  if (!put.ok) throw new Error('PUT transcript → ' + put.status);
  const done = await sendJson(SERVER + '/api/machine/done/' + stepId, { status: 'success' }, 'POST', machineToken);
  if (done.status !== 200) throw new Error('done → ' + done.status);
}

// 无订阅期增量（回合在飞、观众未进场——症状原态）。
const SEG_A = '第一步：读取仓库结构。';
const SEG_B = '第二步：核对补发语义。';
await delta(SEG_A);
await sleep(150);
await delta(SEG_B);
const PREFIX = SEG_A + SEG_B;

const STREAM_URL = SERVER + '/api/conversations/' + threadId + '/stream';

// —— A. API 面（第二个 SSE 客户端中途进场）———————————————————————
const s1 = await openSse(STREAM_URL);
await sleep(600); // 补发落地窗口
const d1 = s1.deltas();
if (!EXPECT_OLD) {
  check(
    'A1 中场进场补发：首个 text_delta = 已流出前缀的精确拼接',
    d1.length === 1 && d1[0] === PREFIX,
    'deltas=' + JSON.stringify(d1),
  );
} else {
  check('O-A1 旧态零补发：订阅后无任何 text_delta', d1.length === 0, 'deltas=' + JSON.stringify(d1));
}
// 接缝：进场后新增量实时到达，且与补发精确拼接（不重不断）。
await delta('第三步：结论如下。');
await sleep(600);
const d2 = s1.deltas();
if (!EXPECT_OLD) {
  check(
    'A2 接缝不重不断：补发 + 实时增量 = 精确拼接',
    d2.join('') === PREFIX + '第三步：结论如下。' && d2.length === 2,
    JSON.stringify(d2),
  );
} else {
  check(
    'O-A2 旧态：实时增量照常（仅首帧丢失，非通道坏）',
    d2.length === 1 && d2[0] === '第三步：结论如下。',
    JSON.stringify(d2),
  );
}
s1.close();
await sleep(200);

// 断线重连 = 新订阅：服务端补发当前段全量快照。
const s2 = await openSse(STREAM_URL);
await sleep(600);
const d3 = s2.deltas();
if (!EXPECT_OLD) {
  check(
    'A3 断线重连：新流收到的快照 = 整段前缀（不重不丢）',
    d3.length === 1 && d3[0] === PREFIX + '第三步：结论如下。',
    'deltas=' + JSON.stringify(d3),
  );
} else {
  check('O-A3 旧态：重连同样零补发', d3.length === 0, 'deltas=' + JSON.stringify(d3));
}
s2.close();
await sleep(200);

// —— B. 浏览器面：中途打开抽屉（打字行即刻显示前缀）———————————————
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 732 } });
await page.route('**/api.dicebear.com/**', (route) =>
  route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#888"/></svg>',
  }),
);

// #950 载体迁移：.chief-stream/.chief-msg 类钩退役 → data-testid 同名载体
// （.chief-drawer 是零规则机制钩子，存活不动）。
await page.goto(WEB + '/app?chief=' + threadId);
const drawer = page.locator('.chief-drawer');
await drawer.waitFor({ state: 'visible', timeout: 8000 });
await page.locator('[data-testid="chief-stream"] [data-testid="chief-msg"]').first().waitFor({ timeout: 8000 });
await drawer.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished))).catch(() => {});

const streamText = () => page.locator('[data-testid="chief-stream"]').innerText();
const tailText = async () => {
  const n = await page.locator('[data-testid="chief-stream"] [data-testid="chief-msg"]').count();
  if (n === 0) return '';
  return page.locator('[data-testid="chief-stream"] [data-testid="chief-msg"]').last().innerText();
};
const hasPrefix = await waitFor(async () => (await streamText()).includes(PREFIX), 5000, 'prefix');
if (!EXPECT_OLD) {
  check('B1 中途进场：抽屉打字行即刻显示已流出前缀（一个刷新窗口内补齐）', hasPrefix !== null);
  await shot(page, '01-midturn-drawer-prefix.png', { clip: '.chief-drawer' });
} else {
  check('O-B1 旧态：中途进场零文本（前缀丢失——发一条什么也没有）', hasPrefix === null);
  await shot(page, '01-before-midturn-no-text.png', { clip: '.chief-drawer' });
}

// GIF 帧：进场快照 → 逐段增量 → 收敛（同一视角，逐帧可复现）。
const frames = [];
async function grabFrame(tag) {
  const f = 'gif-' + String(frames.length).padStart(2, '0') + '-' + tag + '.png';
  await page.locator('.chief-drawer').screenshot({ path: join(EVIDENCE, f) });
  frames.push(f);
}
await grabFrame('catchup');

const SEG_D = '第四步：追加验证断线重连。';
await delta(SEG_D);
const grew = await waitFor(async () => (await streamText()).includes(SEG_D), 5000, 'delta-d');
if (!EXPECT_OLD) {
  check('B2 继续实时打字：进场后增量照常落在打字行', grew !== null);
} else {
  check('O-B2 旧态：进场后实时增量照常出现（通道本体健在）', grew !== null);
}
await sleep(250);
await grabFrame('delta-live');
await shot(page, '02-midturn-live-delta.png', { clip: '.chief-drawer' });

// GIF 逐段帧：连续增量各抓一帧（同一视角，逐帧可复现）。
const SEG_E = '第五步：核对写盘顺序。';
const SEG_F = '第六步：核对越权面。';
const SEG_G = '第七步：收尾。';
for (const seg of [SEG_E, SEG_F, SEG_G]) {
  await delta(seg);
  await waitFor(async () => (await streamText()).includes(seg), 5000, 'seg');
  await sleep(200);
  await grabFrame('stream');
}

// —— C. 回合终局：终稿接管，前缀不双份 ————————————————————————
const FINAL = PREFIX + '第三步：结论如下。' + SEG_D + SEG_E + SEG_F + SEG_G + ' 终稿：补发链路核对完成。';
await finishTurn(FINAL);
const converged = await waitFor(async () => (await streamText()).includes('终稿：补发链路核对完成。'), 6000, 'final');
check('C1 终局收敛：终稿行接管呈现', converged !== null);
await sleep(300);
await grabFrame('converged');
await shot(page, '03-converged-final.png', { clip: '.chief-drawer' });
const drawerText = await streamText();
const occurrences = drawerText.split(SEG_A).length - 1;
check('C2 不双份：已落库文本在抽屉里只出现一次', occurrences === 1, 'occurrences=' + occurrences);
await browser.close();

// —— D. 终局后新订阅：缓冲已清，零补发 ————————————————————————
const s3 = await openSse(STREAM_URL);
await sleep(900);
const d4 = s3.deltas();
check('D1 终局后缓冲清空：新流零 text_delta（下一回合从空开始）', d4.length === 0, 'deltas=' + JSON.stringify(d4));
s3.close();

// —— 证据落盘 ————————————————————————————————————————————
const failed = checks.filter((c) => !c.ok);
writeFileSync(
  join(EVIDENCE, 'result.json'),
  JSON.stringify(
    {
      probe: 'chief-catchup',
      mode: EXPECT_OLD ? 'expect-old' : 'expect-new',
      ticket: '#740',
      stack: { server: SERVER, web: WEB, repo: REPO },
      threadId,
      machineStepId: stepId,
      prefix: PREFIX,
      gifFrames: frames,
      checks,
      artifacts,
    },
    null,
    2,
  ),
);
process.stdout.write('\n' + (checks.length - failed.length) + '/' + checks.length + ' PASS  evidence=' + EVIDENCE + '\n');
process.exit(failed.length > 0 ? 1 : 0);