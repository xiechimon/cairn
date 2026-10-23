#!/usr/bin/env node
// verify-cairn drive-1033-avatar — 总管抽屉思考行/工具行头像几何（#1033）live 闭环。
//
// 症状路径：#950 退役 chief.css 后，chief-drawer 的思考行与流式期工具行留着
// 死类名（chief-msg / chief-avatar--img / chief-msg-col，匹配 0 条规则）——
// 头像 img 丢掉 [&_img]:size-6 约束，dicebear Lorelei 的真响应是无
// width/height、只有 viewBox="0 0 980 980" 的 SVG，自然盒 = 容器宽，用户
// 现场看到 380×380 巨图独占一行、正文被推到图下方。
//
// 铺底与 drive-chief-segments.mjs 同律：公开 REST + 假机器（provider /
// agent / PATCH chief / POST chief/threads / api-key / machine enroll /
// claim），按真 wire 序推思考段行 + 正文段行 + 工具行开始半，零 daemon、
// 零 LLM。浏览器面拦截 dicebear 域并按**真 Lorelei 形态**fulfill（无
// width/height、viewBox 980——形态即验收判据，网络来源不是）。
//
// 判据（同帧单 evaluate 量取，杜绝跨动画帧采样假倒挂）：
//   new：img 24×24、行 display:flex、列 flex-grow:1 / min-width:0、
//        列在头像右侧且垂直重叠（头像在文字左边、同一行）。
//   old：img 宽 >100（撑满列宽）、行 display:block —— before 基线复现症状。
//
// 用法：
//   after  ：VERIFY_REPO_ROOT=<本 lane worktree> node drive-1033-avatar.mjs
//   before ：origin/main 一次性 worktree 起独立栈（8793/5275），同脚本加
//            --expect=old（drive-agent-identity 先例）。
//
// 探针坑位（drive-chief-segments 同源）：行 id 每次运行唯一（chief_message
// 幂等 upsert 以 id 为冲突键）；断言走 server 读面，SQLite 只作落盘实物。

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SCRIPT_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const REPO = process.env.VERIFY_REPO_ROOT ?? SCRIPT_REPO;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(REPO, '.claude/verify-run');
const EXPECT = process.argv.includes('--expect=old') ? 'old' : 'new';
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
  join(SCRIPT_REPO, '.claude/verify-evidence/' + ts + '-1033-avatar-' + EXPECT);
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

async function apiRows(threadId) {
  const res = await sendJson(SERVER + '/api/conversations/' + threadId + '/messages', undefined, 'GET');
  const messages = res.body?.messages ?? [];
  return messages.map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt }));
}

const DB_PATH = join(stack.homeDir ?? join(RUN_DIR, 'home'), 'server', 'server.db');
/** SQLite 实物快照（真值三件套的库面；只作证据落盘，断言走 server 读面）。 */
function dbDump(threadId) {
  try {
    const requireServer = createRequire(join(REPO, 'apps', 'server', 'package.json'));
    const Database = requireServer('better-sqlite3');
    const db = new Database(DB_PATH);
    const rows = db
      .prepare('SELECT id, role, content, createdAt FROM chief_message WHERE threadId = ? ORDER BY createdAt, rowid')
      .all(threadId);
    db.close();
    return rows;
  } catch {
    return [];
  }
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
  displayName: '头像几何验证员',
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
  content: '请核对头像几何。',
});
const threadId = thread.body?.thread?.id;
if (thread.status !== 201 || !threadId) throw new Error('chief threads → ' + thread.status);

const key = await sendJson(SERVER + '/api/teams/' + teamId + '/api-keys', {
  name: 'avatar-1033-probe',
  gitAccess: false,
  mcpAccess: false,
  toolGrants: { read: [], write: [] },
});
const keyPlain = key.body?.plaintext ?? key.body?.record?.plaintext ?? key.body?.token;
if (!keyPlain) throw new Error('api-key 无 plaintext');

const enroll = await sendJson(
  SERVER + '/api/machine/enroll',
  { teamId, name: 'avatar-1033-machine', cliVersion: '0.1.0' },
  'POST',
  keyPlain,
);
const machineToken = enroll.body?.token ?? enroll.body?.machine?.token;
if (enroll.status !== 200 || !machineToken) throw new Error('enroll → ' + enroll.status);

const claim = await sendJson(SERVER + '/api/machine/tasks/claim', {}, 'POST', machineToken);
const claimed = claim.body?.step?.step ?? claim.body?.step;
if (!claimed?.id) throw new Error('claim 失败：' + JSON.stringify(claim.body));
const stepId = claimed.id;

// —— 帧发射（真 wire 序；回合保持在飞 = 工具行可见）—————————————
async function segmentRow(row) {
  const res = await sendJson(
    SERVER + '/api/machine/tool/' + stepId,
    { kind: 'transcript_row', row },
    'POST',
    machineToken,
  );
  if (res.status !== 200) throw new Error('segment row → ' + res.status + ' ' + JSON.stringify(res.body));
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
const CALL_ID = 'call-1033-' + RUN;

await segmentRow({
  id: nextId(),
  role: 'assistant',
  content: [{ type: 'thinking', thinking: '先把头像的约束链捋一遍。' }],
  createdAt: at(10),
});
await sleep(120);
await segmentRow({
  id: nextId(),
  role: 'assistant',
  content: [{ type: 'text', text: '第一步：核对头像槽几何。' }],
  createdAt: at(20),
});
await sleep(120);
await toolRow({ id: CALL_ID, name: 'todo_write', arguments: {}, startedAt: at(300) });
const toolLanded = await waitFor(
  async () => (await apiRows(threadId)).some((r) => r.id === CALL_ID),
  6000,
);
check('W0 工具行开始半落库（在飞态可见的前提）', toolLanded === true, null);

// —— 浏览器面：同帧几何量取 ————————————————————————————————
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 732 } });
let geometry = null;
try {
  // 真 Lorelei 形态桩：无 width/height、viewBox="0 0 980 980"（票面验收判据
  // 原样）。不 mock 该域会真发外网请求（沙箱实测悬 ~8s），且网络来源不是
  // 判据、形态才是。
  await page.route('**/api.dicebear.com/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 980 980"><rect width="980" height="980" fill="#888"/></svg>',
    }),
  );
  await page.goto(WEB + '/app?chief=' + threadId, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.chief-drawer', { timeout: 20000 });
  const thinking = page.locator('.chief-msg', { hasText: '先把头像的约束链捋一遍' });
  await waitFor(async () => (await thinking.count()) === 1, 8000);
  // 头像 img 必须真加载完成（naturalWidth>0）才量得到自然盒——SVG 未载时
  // rect 是 0×0，会把 old 模式的「巨图」判成假绿/假红。
  const imgLoaded = await waitFor(
    () =>
      thinking.evaluate((row) => {
        const img = row.querySelector('img');
        return img != null && img.naturalWidth > 0;
      }),
    15000,
  );
  check('B0 思考行头像 img 加载完成（naturalWidth>0）', imgLoaded === true, null);

  geometry = await thinking.evaluate((row) => {
    const imgEl = row.querySelector('img');
    const colEl = row.querySelector(':scope > div');
    const img = imgEl?.getBoundingClientRect();
    const col = colEl?.getBoundingClientRect();
    const colCs = colEl != null ? getComputedStyle(colEl) : null;
    return {
      rowDisplay: getComputedStyle(row).display,
      img: img == null ? null : { x: img.x, y: img.y, width: img.width, height: img.height },
      imgNatural: imgEl == null ? null : { w: imgEl.naturalWidth, h: imgEl.naturalHeight },
      col: col == null ? null : { x: col.x, y: col.y, width: col.width, height: col.height },
      colFlexGrow: colCs?.flexGrow ?? null,
      colMinWidth: colCs?.minWidth ?? null,
    };
  });
  const toolGeom = await page.locator('.chief-msg', { hasText: '正在调用 todo_write' }).evaluate((row) => {
    const colEl = row.querySelector(':scope > div');
    const colCs = colEl != null ? getComputedStyle(colEl) : null;
    return {
      rowDisplay: getComputedStyle(row).display,
      colFlexGrow: colCs?.flexGrow ?? null,
      colMinWidth: colCs?.minWidth ?? null,
    };
  });
  geometry.toolRow = toolGeom;
  writeFileSync(join(EVIDENCE, 'geometry.json'), JSON.stringify(geometry, null, 2) + '\n');
  artifacts.push('geometry.json');

  const drawerText = await page.locator('.chief-drawer').innerText();
  writeFileSync(join(EVIDENCE, 'drawer-text.txt'), drawerText + '\n');
  artifacts.push('drawer-text.txt');

  if (EXPECT === 'new') {
    check('G1 头像 24×24（AVATAR_IMG_CLS 的 [&_img]:size-6 约束在位）', geometry.img?.width === 24 && geometry.img?.height === 24, JSON.stringify(geometry.img));
    check('G2 思考行是 flex 行', geometry.rowDisplay === 'flex', 'display=' + geometry.rowDisplay);
    check('G3 消息列 flex-grow:1 / min-width:0（MSG_COL_CLS 在位）', geometry.colFlexGrow === '1' && geometry.colMinWidth === '0px', JSON.stringify({ grow: geometry.colFlexGrow, minW: geometry.colMinWidth }));
    check(
      'G4 头像在文字左侧、同一行（不是巨图独占一行）',
      geometry.col != null && geometry.img != null && geometry.col.x > geometry.img.x && geometry.col.y < geometry.img.y + geometry.img.height,
      JSON.stringify({ img: geometry.img, col: geometry.col }),
    );
    check('G5 工具行同律：flex 行 + 列 flex-grow:1', toolGeom.rowDisplay === 'flex' && toolGeom.colFlexGrow === '1', JSON.stringify(toolGeom));
  } else {
    // before 基线 = 症状复现：无约束 img 撑满列宽、行是 block、列不 grow。
    check('G1old 头像无约束撑满列宽（>100px，症状本体）', (geometry.img?.width ?? 0) > 100, JSON.stringify(geometry.img));
    check('G2old 思考行 display:block（flex 骨架缺失）', geometry.rowDisplay === 'block', 'display=' + geometry.rowDisplay);
    check('G3old 消息列 flex-grow:0（min-w-0 flex-1 缺失）', geometry.colFlexGrow === '0', JSON.stringify({ grow: geometry.colFlexGrow, minW: geometry.colMinWidth }));
  }

  await shot(page, '01-drawer-avatar-' + EXPECT + '.png', { clip: '.chief-drawer' });
  await shot(page, '02-fullpage-' + EXPECT + '.png');
} finally {
  await browser.close();
}

// —— 真值三件套的读面/库面实物 ——————————————————————————————
const rows = await apiRows(threadId);
writeFileSync(
  join(EVIDENCE, 'db-rows.json'),
  JSON.stringify({ viaApi: rows, viaSqlite: dbDump(threadId) }, null, 2) + '\n',
);
artifacts.push('db-rows.json');

const okCount = checks.filter((c) => c.ok).length;
writeFileSync(
  join(EVIDENCE, 'result.json'),
  JSON.stringify(
    {
      probe: 'drive-1033-avatar',
      expect: EXPECT,
      stack: { server: SERVER, web: WEB, runDir: RUN_DIR, repo: REPO },
      threadId,
      stepId,
      checks,
      summary: okCount + '/' + checks.length + ' PASS',
      artifacts,
    },
    null,
    2,
  ) + '\n',
);
process.stdout.write('\n' + okCount + '/' + checks.length + ' PASS  expect=' + EXPECT + '  evidence=' + EVIDENCE + '\n');
process.exit(okCount === checks.length ? 0 : 1);
