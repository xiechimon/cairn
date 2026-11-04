#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const EXPECT = process.argv.includes('--expect=old') ? 'old' : 'new';

const SCRIPT_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
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
  process.env.VERIFY_EVIDENCE_DIR ??
  join(SCRIPT_REPO, '.claude/verify-evidence/' + ts + '-1034-' + EXPECT);
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
async function shot(target, name) {
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
    await sleep(120);
  }
}

const LONG_CJK =
  '用户只是打了个招呼「你好」，没有具体任务，先不路由到任何看板任务，等下一句话再判断意图，同时留意要不要唤起定时器或者翻既有会话记录';

const LONG_LATIN =
  '> The user just said "你好" — pure greeting. No task. I should not route it to the board yet; wait for the next line to tell intent.';

const LONG_DETAIL =
  '用户这句「你好」是纯招呼，没有任务实体：先不路由看板，也不建卡。接下来要做的事分三步——第一步核对会话历史里有没有未收口的执行步，第二步看定时器有没有到点要唤起的复盘，第三步再判断这句招呼背后是不是藏着一个新需求的开头；如果三步都空，就只回一句招呼，等用户把真实意图说出来再动手。另外留意中英混排时省略号的落点，别让截断把行尾标点吃掉半个，视觉上会显得字被切坏而不是被收纳。';
if (LONG_CJK.length >= 150 || LONG_LATIN.length >= 150 || LONG_DETAIL.length <= 150) {
  throw new Error('被测文本长度契约破坏：CJK/LATIN 须 < 150，DETAIL 须 > 150');
}

const teams = await getJson(SERVER + '/api/teams');
const teamId = teams[0]?.id;
if (!teamId) throw new Error('无 team——先重 launch（全新库 seed）');

const RUN = Date.now().toString(36);
const prov = await sendJson(SERVER + '/api/teams/' + teamId + '/providers', {
  providerId: 'stub-1034-' + RUN,
  label: 'Stub 1034',
  baseUrl: 'http://127.0.0.1:9/v1',
  api: 'openai-completions',
  authHeader: true,
  compat: { supportsDeveloperRole: false },
  models: [{ id: 'stub-model', name: 'stub-model' }],
});
if (![200, 201, 409].includes(prov.status)) throw new Error('provider → ' + prov.status);

const agent = await sendJson(SERVER + '/api/teams/' + teamId + '/agents', {
  displayName: '截断验证员',
  provider: 'stub-1034-' + RUN,
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
  content: '看一下这两段思考的呈现。',
});
const threadId = thread.body?.thread?.id;
if (thread.status !== 201 || !threadId) throw new Error('chief threads → ' + thread.status);

const key = await sendJson(SERVER + '/api/teams/' + teamId + '/api-keys', {
  name: 'probe-1034-' + RUN,
  gitAccess: false,
  mcpAccess: false,
  toolGrants: { read: [], write: [] },
});
const keyPlain = key.body?.plaintext ?? key.body?.record?.plaintext ?? key.body?.token;
if (!keyPlain) throw new Error('api-key 无 plaintext');

const enroll = await sendJson(
  SERVER + '/api/machine/enroll',
  { teamId, name: 'probe-1034-machine-' + RUN, cliVersion: '0.1.0' },
  'POST',
  keyPlain,
);
const machineToken = enroll.body?.token ?? enroll.body?.machine?.token;
if (enroll.status !== 200 || !machineToken) throw new Error('enroll → ' + enroll.status);

async function claimStep() {
  const claim = await sendJson(SERVER + '/api/machine/tasks/claim', {}, 'POST', machineToken);
  const claimed = claim.body?.step?.step ?? claim.body?.step;
  if (!claimed?.id) throw new Error('claim 失败：' + JSON.stringify(claim.body));
  return claimed.id;
}

const chiefStepId = await claimStep();
const T0 = Date.now();
const at = (n) => T0 + n;
let seq = 0;
const nextId = () => 'msg-1034-' + RUN + '-' + ++seq;

async function segmentRow(row) {
  const res = await sendJson(
    SERVER + '/api/machine/tool/' + chiefStepId,
    { kind: 'transcript_row', row },
    'POST',
    machineToken,
  );
  if (res.status !== 200)
    throw new Error('segment row → ' + res.status + ' ' + JSON.stringify(res.body));
}

await segmentRow({
  id: nextId(),
  role: 'assistant',
  content: [{ type: 'thinking', thinking: LONG_CJK }],
  createdAt: at(10),
});
await segmentRow({
  id: nextId(),
  role: 'assistant',
  content: [{ type: 'thinking', thinking: LONG_LATIN }],
  createdAt: at(20),
});

async function uploadTranscript(stepId, messages) {
  const transcript = { stepId, messages };
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
}

await uploadTranscript(chiefStepId, [
  { id: 'final-1034-' + RUN, role: 'assistant', content: '两段思考已给出。', createdAt: at(1020) },
]);
const chiefDone = await sendJson(
  SERVER + '/api/machine/done/' + chiefStepId,
  { status: 'success' },
  'POST',
  machineToken,
);
if (chiefDone.status !== 200) throw new Error('chief done → ' + chiefDone.status);

const projRes = await sendJson(SERVER + '/api/projects', { name: 'probe-1034-' + RUN });
const projectId = projRes.body?.id;
if (!projectId) throw new Error('project → ' + JSON.stringify(projRes.body));
const todoRes = await sendJson(SERVER + '/api/projects/' + projectId + '/todos', {
  title: '凭证链路巡检',
  spec: '# 任务目标\n\n巡检凭证链路并给出报告。',
});
const todoId = todoRes.body?.id;
if (!todoId) throw new Error('todo → ' + JSON.stringify(todoRes.body));
const buildRes = await sendJson(SERVER + '/api/projects/' + projectId + '/builds', {
  todoIds: [todoId],
  assignment: { plan: null, build: { agentId: AGENT_ID } },
  withPlan: false,
});
const buildId = buildRes.body?.builds?.[0]?.id;
if (!buildId) throw new Error('build → ' + JSON.stringify(buildRes.body));

const buildStepId = await claimStep();
if (buildStepId === chiefStepId) throw new Error('claim 拿回的还是 chief 步——build 步未入队');
await uploadTranscript(buildStepId, [
  {
    id: 'det-u1-' + RUN,
    role: 'user',
    content: '凭证链路巡检\n\n# 任务目标\n\n巡检凭证链路并给出报告。',
    createdAt: at(2000),
  },
  {
    id: 'det-a1-' + RUN,
    role: 'assistant',
    content: [{ type: 'thinking', thinking: LONG_DETAIL }],
    createdAt: at(2100),
  },
  {
    id: 'det-a2-' + RUN,
    role: 'assistant',
    content: [{ type: 'text', text: '巡检完成，链路正常。' }],
    createdAt: at(2200),
  },
]);

await sendJson(SERVER + '/api/machine/done/' + buildStepId, { status: 'success' }, 'POST', machineToken);
const detailLanded = await waitFor(async () => {
  const res = await sendJson(SERVER + '/api/conversations/' + buildId + '/messages', undefined, 'GET');
  return (res.body?.messages ?? []).some(
    (m) => Array.isArray(m.content) && m.content.some((b) => b?.type === 'thinking'),
  );
}, 8000);
if (!detailLanded) throw new Error('详情面 thinking 行未落库');

const measurements = {};
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 732 } });

await page.route('**/api.dicebear.com/**', (route) =>
  route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#888"/></svg>',
  }),
);

async function measureRow(row, colSelector) {
  return row
    .getByRole('button', { name: /展开思考|收起思考/ })
    .evaluate(
      (el, colSel) => {
        const label = el.querySelector('span');
        const cs = getComputedStyle(label);
        const col = el.closest(colSel);
        return {
          labelText: label.textContent ?? '',
          textOverflow: cs.textOverflow,
          overflowX: cs.overflowX,
          whiteSpace: cs.whiteSpace,
          labelClient: label.clientWidth,
          labelScroll: label.scrollWidth,
          btnW: Math.round(el.getBoundingClientRect().width),
          colW: Math.round(col.getBoundingClientRect().width),
        };
      },
      colSelector,
    );
}

try {

  await page.goto(WEB + '/app?chief=' + threadId, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.chief-drawer', { timeout: 20000 });
  await waitFor(
    async () =>
      (await page.locator('.chief-drawer').innerText()).includes(LONG_CJK.slice(0, 12)),
    10000,
  );
  const cjkRow = page.locator('.chief-msg', { hasText: LONG_CJK.slice(0, 16) });
  const latinRow = page.locator('.chief-msg', { hasText: LONG_LATIN.slice(0, 16) });
  measurements.chiefCjk = await measureRow(cjkRow, '.chief-msg-col');
  measurements.chiefLatin = await measureRow(latinRow, '.chief-msg-col');
  measurements.chiefPageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  await shot(page.locator('.chief-drawer'), '01-chief-drawer.png');
  await shot(
    cjkRow.getByRole('button', { name: /展开思考|收起思考/ }),
    '02-chief-cjk-button.png',
  );

  const c = measurements.chiefCjk;
  const l = measurements.chiefLatin;
  if (EXPECT === 'new') {
    check('C1 CJK 行：CSS 省略号生效（ellipsis + hidden）', c.textOverflow === 'ellipsis' && c.overflowX === 'hidden', JSON.stringify({ textOverflow: c.textOverflow, overflowX: c.overflowX }));
    check('C2 CJK 行：可见宽 < 内容宽', c.labelScroll > c.labelClient, 'scroll/client=' + c.labelScroll + '/' + c.labelClient);
    check('C3 CJK 行：钮宽 ≤ 列宽', c.btnW <= c.colW, 'btn/col=' + c.btnW + '/' + c.colW);
    check('C4 拉丁行：CSS 省略号生效（ellipsis + hidden）', l.textOverflow === 'ellipsis' && l.overflowX === 'hidden', JSON.stringify({ textOverflow: l.textOverflow, overflowX: l.overflowX }));
    check('C5 拉丁行：可见宽 < 内容宽', l.labelScroll > l.labelClient, 'scroll/client=' + l.labelScroll + '/' + l.labelClient);
    check('C6 拉丁行：钮宽 ≤ 列宽', l.btnW <= l.colW, 'btn/col=' + l.btnW + '/' + l.colW);
    check('C7 页面级零横向溢出', measurements.chiefPageOverflow <= 0, 'overflow=' + measurements.chiefPageOverflow);

    check('C8 切片未触发（预览 = 全文，无字面 …）而截断仍生效', c.labelText === LONG_CJK && l.labelText === LONG_LATIN, 'cjkLen=' + c.labelText.length + ' latinLen=' + l.labelText.length);
  } else {

    check('C1o CJK 行：无 CSS 省略号（text-overflow clip）', c.textOverflow !== 'ellipsis', 'textOverflow=' + c.textOverflow);
    check('C2o CJK 行：span 无可溢出的盒（scroll == client）', c.labelScroll === c.labelClient, 'scroll/client=' + c.labelScroll + '/' + c.labelClient);
    check('C3o CJK 行：钮宽 > 列宽（fit-content 解成整段文本宽）', c.btnW > c.colW, 'btn/col=' + c.btnW + '/' + c.colW);
    check('C4o 拉丁行：无 CSS 省略号', l.textOverflow !== 'ellipsis', 'textOverflow=' + l.textOverflow);
    check('C5o 拉丁行：钮宽 > 列宽', l.btnW > l.colW, 'btn/col=' + l.btnW + '/' + l.colW);

    process.stdout.write('note  改前页面级横向溢出 = ' + measurements.chiefPageOverflow + '（记录，不断言）\n');
    check('C6o 切片未参与时宽度无人收（预览全文直出成钮宽）', c.labelText === LONG_CJK, 'cjkLen=' + c.labelText.length);
  }

  await page.goto(WEB + '/app/todo/' + todoId, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="transcript-col"]', { timeout: 20000 });
  const detailRow = page.locator('div.chat-row--agent', { hasText: LONG_DETAIL.slice(0, 12) });
  await waitFor(async () => (await detailRow.count()) === 1, 10000);
  measurements.detail = await measureRow(detailRow, '.chat-text');
  measurements.detailLayout = await detailRow.evaluate((el) => {
    const avatar = el.querySelector('[data-testid="msg-avatar"]');
    const text = el.querySelector('.chat-text');
    const csText = getComputedStyle(text);
    const a = avatar.getBoundingClientRect();
    const t = text.getBoundingClientRect();
    return {
      display: getComputedStyle(el).display,
      avatarW: Math.round(a.width),
      gapTextMinusAvatar: Math.round(t.left - a.right),
      textMaxWidth: csText.maxWidth,
      textMinWidth: csText.minWidth,
    };
  });
  measurements.detailPageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  await shot(page.getByTestId('transcript-col'), '03-detail-transcript.png');
  await shot(detailRow, '04-detail-thinking-row.png');

  const d = measurements.detail;
  const dl = measurements.detailLayout;
  if (EXPECT === 'new') {
    check('D1 详情行是 flex（改前：死类名零规则 = block）', dl.display === 'flex', 'display=' + dl.display);
    check('D2 头像与文字列 robot 行同距（ml 11px，不重叠）', dl.gapTextMinusAvatar === 11, 'gap=' + dl.gapTextMinusAvatar);
    check('D3 chat-text 有宽度上限 + min-w-0', dl.textMaxWidth !== 'none' && dl.textMinWidth === '0px', JSON.stringify({ maxWidth: dl.textMaxWidth, minWidth: dl.textMinWidth }));
    check('D4 长预览 CSS 省略号生效（ellipsis + hidden）', d.textOverflow === 'ellipsis' && d.overflowX === 'hidden', JSON.stringify({ textOverflow: d.textOverflow, overflowX: d.overflowX }));
    check('D5 可见宽 < 内容宽', d.labelScroll > d.labelClient, 'scroll/client=' + d.labelScroll + '/' + d.labelClient);
    check('D6 钮宽 ≤ 文字列宽', d.btnW <= d.colW, 'btn/col=' + d.btnW + '/' + d.colW);
    check('D7 页面级零横向溢出', measurements.detailPageOverflow <= 0, 'overflow=' + measurements.detailPageOverflow);
  } else {
    check('D1o 详情行不是 flex（block——头像压字的根）', dl.display !== 'flex', 'display=' + dl.display);
    check('D2o 头像与文字列没有 11px 间距（重叠或贴死）', dl.gapTextMinusAvatar !== 11, 'gap=' + dl.gapTextMinusAvatar);
    check('D3o chat-text 无宽度上限（max-width none）', dl.textMaxWidth === 'none', 'maxWidth=' + dl.textMaxWidth);
    check('D4o 长预览无 CSS 省略号', d.textOverflow !== 'ellipsis', 'textOverflow=' + d.textOverflow);
    check('D5o 钮宽 > 文字列宽（无界）', d.btnW > d.colW, 'btn/col=' + d.btnW + '/' + d.colW);
    process.stdout.write('note  改前详情面页面级横向溢出 = ' + measurements.detailPageOverflow + '（记录，不断言）\n');
  }

  check(
    'D8 切片管预览长度：> 150 字符的预览以字面 … 收尾且短于全文',
    d.labelText.endsWith('…') && d.labelText.length < LONG_DETAIL.length,
    'previewLen=' + d.labelText.length + '/fullLen=' + LONG_DETAIL.length,
  );
  await detailRow.getByRole('button', { name: '展开思考' }).click();
  const pre = detailRow.locator('pre');
  await waitFor(async () => (await pre.count()) === 1, 5000);
  const preText = (await pre.textContent()) ?? '';
  check('D9 展开交互不被截断修法砸掉：pre 见全文', preText.trim() === LONG_DETAIL.trim(), 'preLen=' + preText.length);
  await shot(detailRow, '05-detail-expanded.png');
} finally {
  await browser.close();
}

const chiefRows = await sendJson(SERVER + '/api/conversations/' + threadId + '/messages', undefined, 'GET');
writeFileSync(join(EVIDENCE, 'api-chief-messages.json'), JSON.stringify(chiefRows.body, null, 2) + '\n');
artifacts.push('api-chief-messages.json');
const detailRows = await sendJson(SERVER + '/api/conversations/' + buildId + '/messages', undefined, 'GET');
writeFileSync(join(EVIDENCE, 'api-detail-messages.json'), JSON.stringify(detailRows.body, null, 2) + '\n');
artifacts.push('api-detail-messages.json');

try {
  const requireServer = createRequire(join(REPO, 'apps', 'server', 'package.json'));
  const Database = requireServer('better-sqlite3');
  const db = new Database(join(stack.homeDir ?? join(RUN_DIR, 'home'), 'server', 'server.db'), {
    readonly: true,
  });
  const rows = db
    .prepare('SELECT id, role, content FROM message WHERE conversationId = ?')
    .all(buildId);
  db.close();
  writeFileSync(join(EVIDENCE, 'sqlite-detail-messages.json'), JSON.stringify(rows, null, 2) + '\n');
  artifacts.push('sqlite-detail-messages.json');
} catch (err) {
  process.stdout.write('note  SQLite 快照跳过：' + (err instanceof Error ? err.message : String(err)) + '\n');
}

writeFileSync(join(EVIDENCE, 'measurements.json'), JSON.stringify(measurements, null, 2) + '\n');
artifacts.push('measurements.json');

const failed = checks.filter((c) => !c.ok).length;
writeFileSync(
  join(EVIDENCE, 'result.json'),
  JSON.stringify(
    {
      probe: 'drive-1034-thinking-truncate',
      ticket: '#1034',
      expect: EXPECT,
      stack: { server: SERVER, web: WEB, home: stack.homeDir ?? null, repo: REPO },
      threadId,
      todoId,
      buildId,
      checks,
      artifacts,
    },
    null,
    2,
  ) + '\n',
);
process.stdout.write('\n' + (checks.length - failed) + '/' + checks.length + ' checks passed (expect=' + EXPECT + ')\n');
process.exit(failed === 0 ? 0 : 1);
