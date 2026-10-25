#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SCRIPT_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const REPO = process.env.VERIFY_REPO_ROOT ?? SCRIPT_REPO;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(REPO, '.claude/verify-run');
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
  process.env.VERIFY_EVIDENCE_DIR ?? join(SCRIPT_REPO, '.claude/verify-evidence/' + ts + '-chief-segments');
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
async function waitFor(fn, timeoutMs) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() >= end) return null;
    await sleep(80);
  }
}

const DB_PATH = join(stack.homeDir ?? join(RUN_DIR, 'home'), 'server', 'server.db');

async function apiRows(threadId) {
  const res = await sendJson(
    SERVER + '/api/conversations/' + threadId + '/messages',
    undefined,
    'GET',
  );
  const messages = res.body?.messages ?? [];
  return messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    createdAt: m.createdAt,
  }));
}

function dbDump(threadId) {
  const requireServer = createRequire(join(REPO, 'apps', 'server', 'package.json'));
  const Database = requireServer('better-sqlite3');
  const db = new Database(DB_PATH);
  const rows = db
    .prepare(
      'SELECT id, role, content, createdAt FROM chief_message WHERE threadId = ? ORDER BY createdAt, rowid',
    )
    .all(threadId);
  db.close();
  return rows;
}

async function openSse(url) {
  const ctrl = new AbortController();
  const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'text/event-stream' } });
  if (!res.ok) throw new Error('SSE ' + url + ' → ' + res.status);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const frames = [];
  let buf = '';
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

            }
          }
        }
        idx = buf.indexOf('\n\n');
      }
    }
  })().catch(() => {});
  return { frames, close: () => ctrl.abort(), pump };
}

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
  displayName: '段行验证员',
  provider: 'stub-gw',
  modelId: 'stub-model',
});
const AGENT_ID = agent.body?.id ?? agent.body?.agentId ?? agent.body?.record?.id;
if (!AGENT_ID) throw new Error('agent 无 id：' + JSON.stringify(agent.body));

const bind = await sendJson(
  SERVER + '/api/teams/' + teamId + '/chief',
  { agent: { agentId: AGENT_ID, thinkingLevel: null } },
  'PATCH',
);
if (bind.status !== 200) throw new Error('chief bind → ' + bind.status);

const thread = await sendJson(SERVER + '/api/teams/' + teamId + '/chief/threads', {
  content: '请依次核对三段，先说结论。',
});
const threadId = thread.body?.thread?.id;
if (thread.status !== 201 || !threadId) throw new Error('chief threads → ' + thread.status);

const key = await sendJson(SERVER + '/api/teams/' + teamId + '/api-keys', {
  name: 'segments-probe',
  gitAccess: false,
  mcpAccess: false,
  toolGrants: { read: [], write: [] },
});
const keyPlain = key.body?.plaintext ?? key.body?.record?.plaintext ?? key.body?.token;
if (!keyPlain) throw new Error('api-key 无 plaintext');

const enroll = await sendJson(
  SERVER + '/api/machine/enroll',
  { teamId, name: 'segments-probe-machine', cliVersion: '0.1.0' },
  'POST',
  keyPlain,
);
const machineToken = enroll.body?.token ?? enroll.body?.machine?.token;
if (enroll.status !== 200 || !machineToken) throw new Error('enroll → ' + enroll.status);

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
  if (res.status !== 200) throw new Error('delta → ' + res.status);
}

async function segmentRow(row) {
  const res = await sendJson(
    SERVER + '/api/machine/tool/' + stepId,
    { kind: 'transcript_row', row },
    'POST',
    machineToken,
  );
  if (res.status !== 200)
    throw new Error('segment row → ' + res.status + ' ' + JSON.stringify(res.body));
}

async function toolRow(call) {
  const res = await sendJson(SERVER + '/api/machine/tool/' + stepId, call, 'POST', machineToken);
  if (res.status !== 200) throw new Error('tool row → ' + res.status);
}

let seq = 0;
const nextId = () => 'msg-' + stepId + '-' + ++seq;

const T0 = Date.now();
const at = (n) => T0 + n;

const RUN = String(Date.now() % 1000000);
const CALL_ID = 'call-1-' + RUN;
const FINAL_ID = 'probe-assistant-final-' + RUN;

async function finishTurn(finalText) {
  const transcript = {
    stepId,
    messages: [
      { id: FINAL_ID, role: 'assistant', content: finalText, createdAt: at(1020) },
    ],
  };
  const urls = await sendJson(
    SERVER + '/api/machine/upload-urls/' + stepId,
    { files: [{ name: 'transcript.json', size: JSON.stringify(transcript).length }] },
    'POST',
    machineToken,
  );
  const upload = urls.body?.uploads?.find((u) => u.name === 'transcript.json');
  if (!upload) throw new Error('upload-urls 无 transcript 槽');
  const put = await fetch(upload.url, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      ...(upload.headers ?? {}),
      authorization: 'Bearer ' + machineToken,
    },
    body: JSON.stringify(transcript),
    signal: AbortSignal.timeout(8000),
  });
  if (!put.ok) throw new Error('PUT transcript → ' + put.status);
  const done = await sendJson(
    SERVER + '/api/machine/done/' + stepId,
    { status: 'success' },
    'POST',
    machineToken,
  );
  if (done.status !== 200) throw new Error('done → ' + done.status);
}

const STREAM_URL = SERVER + '/api/conversations/' + threadId + '/stream';

const sse = await openSse(STREAM_URL);
await sleep(300);

await segmentRow({
  id: nextId(),
  role: 'assistant',
  content: [{ type: 'thinking', thinking: '先把三段的落点捋一遍。' }],
  createdAt: at(10),
});
await sleep(120);

await delta('第一步：读取仓库结构。');
await sleep(120);
await segmentRow({
  id: nextId(),
  role: 'assistant',
  content: [{ type: 'text', text: '第一步：读取仓库结构。' }],
  createdAt: at(20),
});
await sleep(120);
await toolRow({ id: CALL_ID, name: 'todo_write', arguments: {}, startedAt: at(300) });
const toolLanded = await waitFor(
  async () => (await apiRows(threadId)).some((r) => r.id === CALL_ID),
  6000,
);
check('B0 工具行开始半落库（第五形之外的既有 live 工具行路径）', toolLanded === true, null);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 732 } });
try {
  await page.goto(WEB + '/app?chief=' + threadId, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.chief-drawer', { timeout: 20000 });
  await waitFor(
    async () =>
      (await page.locator('.chief-drawer').innerText()).includes('正在调用 todo_write'),
    8000,
  );
  const drawerText = await page.locator('.chief-drawer').innerText();
  writeFileSync(join(EVIDENCE, 'drawer-text.txt'), drawerText + '\n');
  artifacts.push('drawer-text.txt');
  check(
    'B1 抽屉里思考段单列一行（预览可见，非展开态）',
    drawerText.includes('先把三段的落点捋一遍'),
    'drawerText=' + JSON.stringify(drawerText.slice(0, 240)),
  );
  check('B2 抽屉里正文按段分行呈现', drawerText.includes('第一步：读取仓库结构。'), null);
  check(
    'B3 在飞工具行平铺且挂进行态标签（不是折叠面里的裸名）',
    drawerText.includes('正在调用 todo_write'),
    'drawerText=' + JSON.stringify(drawerText.slice(0, 240)),
  );
  await shot(page, '01-drawer-inflight.png', { clip: '.chief-drawer' });
} finally {
  await browser.close();
}

await delta('第二步：核对补发语义。');
await sleep(400);

const late = await openSse(STREAM_URL);
await sleep(700);
const lateDeltas = late.frames.filter((f) => f.type === 'text_delta').map((f) => f.text);
check(
  'A4 D7 不变量：工具行落库后进场者仍拿到当前未封段的文本',
  lateDeltas.join('') === '第二步：核对补发语义。',
  'deltas=' + JSON.stringify(lateDeltas),
);
late.close();

await segmentRow({
  id: nextId(),
  role: 'assistant',
  content: [{ type: 'text', text: '第二步：核对补发语义。' }],
  createdAt: at(1000),
});
await toolRow({
  id: CALL_ID,
  name: 'todo_write',
  arguments: {},
  startedAt: at(300),
  endedAt: at(500),
  result: '{}',
  isError: false,
});
await sleep(300);

await delta('第三步：结论如下，三段全部核对通过。');
await segmentRow({
  id: nextId(),
  role: 'assistant',
  content: [{ type: 'text', text: '第三步：结论如下，三段全部核对通过。' }],
  createdAt: at(1010),
});

await finishTurn('三段已核对完毕，结论：全部通过。');
await sleep(800);
sse.close();

const rows = await apiRows(threadId);

let dump = [];
try {
  dump = dbDump(threadId);
} catch {
  dump = [];
}
writeFileSync(
  join(EVIDENCE, 'db-rows.json'),
  JSON.stringify({ viaApi: rows, viaSqlite: dump }, null, 2) + '\n',
);
artifacts.push('db-rows.json');

function contentText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) =>
        typeof b === 'string'
          ? b
          : b !== null && typeof b === 'object' && b.type === 'text' && typeof b.text === 'string'
            ? b.text
            : '',
      )
      .join('');
  }
  if (content !== null && typeof content === 'object' && content.type === 'text') {
    return typeof content.text === 'string' ? content.text : '';
  }
  return '';
}
function blockTypes(content) {
  let arr = content;
  if (typeof content === 'string') {
    try {
      arr = JSON.parse(content);
    } catch {
      return ['<string>'];
    }
  }
  return Array.isArray(arr)
    ? arr.map((b) => (b !== null && typeof b === 'object' ? b.type : '<scalar>'))
    : ['<scalar>'];
}
const isToolRow = (content) =>
  content !== null &&
  typeof content === 'object' &&
  !Array.isArray(content) &&
  content.kind === 'toolcall';

const idxOf = (pred) => rows.findIndex(pred);
const thinkIdx = idxOf((r) => blockTypes(r.content).includes('thinking'));
const seg1Idx = idxOf((r) => contentText(r.content).includes('读取仓库结构'));
const seg2Idx = idxOf((r) => contentText(r.content).includes('核对补发语义'));
const callIdx = idxOf((r) => isToolRow(r.content));
check(
  'A1 段序：思考段 → 正文段 → 工具行 → 下一段（封口点在工具到达那一刻）',
  thinkIdx >= 0 && seg1Idx > thinkIdx && callIdx > seg1Idx && seg2Idx > callIdx,
  'idx think/seg1/call/seg2 = ' + [thinkIdx, seg1Idx, callIdx, seg2Idx].join('/'),
);

const segRows = rows.filter((r) => {
  const t = blockTypes(r.content);
  return t.length === 1 && (t[0] === 'text' || t[0] === 'thinking');
});
check(
  'A2 落库形：段行 content = 单类型块数组（text / thinking 各成一行）',
  segRows.length === 4,
  '段行数=' + segRows.length + ' shapes=' + JSON.stringify(segRows.map((r) => blockTypes(r.content))),
);

const messageFrames = sse.frames.filter((f) => f.type === 'message');
const frameIds = messageFrames.map((f) => f.message.id);

const firstSeen = frameIds.filter((id, i) => frameIds.indexOf(id) === i);
const dbIds = rows.map((r) => r.id);

const dbOnlyFramed = dbIds.filter((id) => firstSeen.includes(id));
check(
  'A3 先落库再广播：每个 message 帧的行都已在 DB 里，且帧序 = DB 中的相对序',
  frameIds.every((id) => dbIds.includes(id)) &&
    JSON.stringify(firstSeen) === JSON.stringify(dbOnlyFramed),
  'frames=' + JSON.stringify(firstSeen) + ' db=' + JSON.stringify(dbOnlyFramed),
);
const seg1Count = rows.filter(
  (r) => contentText(r.content).includes('读取仓库结构'),
).length;
check('A5 幂等：同一段文本恰一行（终稿同 id 覆盖不双份）', seg1Count === 1, 'count=' + seg1Count);

writeFileSync(
  join(EVIDENCE, 'stream-events.jsonl'),
  sse.frames.map((f) => JSON.stringify(f)).join('\n') + '\n',
);
artifacts.push('stream-events.jsonl');

const failed = checks.filter((c) => !c.ok).length;
writeFileSync(
  join(EVIDENCE, 'result.json'),
  JSON.stringify(
    {
      probe: 'chief-segments',
      ticket: '#955',
      stack: { server: SERVER, web: WEB, home: stack.homeDir ?? null },
      threadId,
      stepId,
      checks,
      artifacts,
    },
    null,
    2,
  ) + '\n',
);
process.stdout.write('\n' + (checks.length - failed) + '/' + checks.length + ' checks passed\n');
process.exit(failed === 0 ? 0 : 1);
