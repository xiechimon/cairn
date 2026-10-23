#!/usr/bin/env node
// verify-cairn drive-agent-identity — agent 身份可点进设置（#741）live 闭环。
//
// 真用户路径：/app（board）FAB 开 drawer → 绑定总管的 robot 行身份 chip
// （头像+名字，整块 anchor）→ 点击 SPA 导航进 /app/resources/agents/<id>
// 设置页；robot markdown 里的 agent 提及 chip 同律可点。键盘面：composer
// 持焦 → Shift+Tab 走上身份 chip → Enter 激活（真 anchor 键盘律）。
//
// 铺底全走公开 REST（drive-chief-drawer / setup-review-seed 铺底律，非被测
// 路径）：provider + agent + PATCH chief 绑定 + POST chief/threads 建线程
// 入队回合步 + api-key/machine enroll 后**假机器**认领该步、经 upload-urls
// PUT transcript.json（assistant 终稿行，内嵌 [名](agent:<id>) 提及 wire）、
// POST done 收尾——零 daemon、零 LLM，回合数据面与真机器逐字节同形。
//
// 双态：缺省 = 新行为全链应 PASS；`--expect=old` 反转期望取「同等场景」
// before 基线（drive-newtask-key.mjs 先例）：身份 chip 不存在（robot 行
// 头像不可点、无名字），提及 chip 是死 span（点击零导航）。
// 依赖全新库：重验 = 重 launch。
// 用法：VERIFY_REPO_ROOT=<worktree> node drive-agent-identity.mjs [--expect=old]

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
  join(SCRIPT_REPO, '.claude/verify-evidence/' + ts + '-agent-identity' + (EXPECT_OLD ? '-before' : ''));
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
async function shot(page, name) {
  await page.screenshot({ path: join(EVIDENCE, name) });
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

const AGENT_NAME = '验证员 Kimi';

// —— 铺底（全 REST，非被测路径）—————————————————————————————
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
  displayName: AGENT_NAME,
  provider: 'stub-gw',
  modelId: 'stub-model',
});
if (![200, 201].includes(agent.status)) throw new Error('agent → ' + agent.status + ' ' + JSON.stringify(agent.body));
const AGENT_ID = agent.body?.id ?? agent.body?.agentId ?? agent.body?.record?.id;
if (!AGENT_ID) throw new Error('agent 无 id：' + JSON.stringify(agent.body));

const bind = await sendJson(
  SERVER + '/api/teams/' + teamId + '/chief',
  { agent: { agentId: AGENT_ID, thinkingLevel: null } },
  'PATCH',
);
if (bind.status !== 200) throw new Error('chief bind → ' + bind.status + ' ' + JSON.stringify(bind.body));

const thread = await sendJson(SERVER + '/api/teams/' + teamId + '/chief/threads', {
  content: '请复核凭证链路，完成后汇报',
});
if (thread.status !== 201) throw new Error('chief threads → ' + thread.status + ' ' + JSON.stringify(thread.body));
const threadId = thread.body?.thread?.id;
if (!threadId) throw new Error('thread 无 id：' + JSON.stringify(thread.body));

const key = await sendJson(SERVER + '/api/teams/' + teamId + '/api-keys', {
  name: 'identity-probe',
  gitAccess: false,
  mcpAccess: false,
  toolGrants: { read: [], write: [] },
});
const keyPlain = key.body?.plaintext ?? key.body?.record?.plaintext ?? key.body?.token;
if (!keyPlain) throw new Error('api-key 无 plaintext：' + JSON.stringify(key.body));

const enroll = await sendJson(
  SERVER + '/api/machine/enroll',
  { teamId, name: 'identity-probe-machine', cliVersion: '0.1.0' },
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

// 终稿 assistant 行：内嵌 agent 提及 wire（segments 单源解析面）。
const replyText = '凭证链路复核完成：由 [' + AGENT_NAME + '](agent:' + AGENT_ID + ') 承接，三项检查全部通过。';
const transcript = {
  stepId,
  messages: [{ id: 'probe-assistant-1', role: 'assistant', content: replyText, createdAt: Date.now() }],
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
  headers: { 'content-type': 'application/json', ...upload.headers, authorization: 'Bearer ' + machineToken },
  body: JSON.stringify(transcript),
  signal: AbortSignal.timeout(8000),
});
if (!put.ok) throw new Error('PUT transcript → ' + put.status + ' ' + (await put.text()));

const done = await sendJson(SERVER + '/api/machine/done/' + stepId, { status: 'success' }, 'POST', machineToken);
if (done.status !== 200) throw new Error('done → ' + done.status + ' ' + JSON.stringify(done.body));

// 铺底真值：会话读面带 assistant 终稿行（不是只看 UI）。threadId 自带
// chief- 前缀，会话 id 即 threadId（r5 §3.6 键形）。
const msgs = await getJson(SERVER + '/api/conversations/' + threadId + '/messages');
const rows = msgs?.messages ?? [];
check(
  'seed: chief 回合终稿行落库（REST 双真值）',
  rows.some((m) => m.role === 'assistant' && String(m.content ?? '').includes('agent:' + AGENT_ID)),
  'messages=' + rows.length + ' threadId=' + threadId,
);

// —— 浏览器面（live 模式，无 scenario）————————————————————————
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 732 } });
// dicebear 外网桩（e2e 同配方）：头像立即落，不悬 8s。
await page.route('**/api.dicebear.com/**', (route) =>
  route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#888"/></svg>',
  }),
);

// 抽屉就位（防御式）：已开则直用（SPA back 后 open 态可能仍在——FAB 点击
// 会被 composer 件拦截）；未开走 FAB（真用户路径）；落新主题 hero 面则
// ?chief= 深链兜底。滑入动画落定后返回（chief-panel settled 同律）。
async function ensureDrawer() {
  const drawer = page.locator('.chief-drawer');
  if (!(await drawer.isVisible().catch(() => false))) {
    await page.locator('button[aria-label="总管"]').click();
    await drawer.waitFor({ state: 'visible', timeout: 8000 });
  }
  if ((await page.locator('[data-testid="chief-stream"] [data-testid="chief-msg"]').count()) === 0) {
    await page.goto(WEB + '/app?chief=' + threadId);
    await drawer.waitFor({ state: 'visible', timeout: 8000 });
  }
  await page.locator('[data-testid="chief-stream"] [data-testid="chief-msg"]').first().waitFor({ timeout: 8000 });
  await drawer.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished))).catch(() => {});
}

await page.goto(WEB + '/app');
await ensureDrawer();

// #950 载体迁移：身份 chip = robot 行的行级直子 anchor（.chief-identity 类
// 退役；mention chip 是气泡 markdown 深层的 a.mention-chip--agent，直子位
// 不撞）；名字载体 = link 文本（.chief-identity-name 退役）。
const chip = page.locator('[data-testid="chief-msg"] > a');
const mention = page.locator('[data-testid="chief-stream"] .mention-chip--agent');

if (!EXPECT_OLD) {
  // N1 身份 chip：头像+名字并排，整块 anchor。
  await chip.waitFor({ state: 'visible', timeout: 8000 });
  check('N1 身份 chip 渲染（头像 img + 名字）', (await chip.locator('img').count()) === 1 &&
    ((await chip.textContent()) ?? '').trim() === AGENT_NAME);
  check('N2 身份 chip href 指 Agent 设置页',
    (await chip.getAttribute('href')) === '/app/resources/agents/' + AGENT_ID,
    'href=' + (await chip.getAttribute('href')));
  // N3 hover 正典：仅 cursor，无背景变化（参考站实测）。
  const bgBefore = await chip.evaluate((el) => getComputedStyle(el).backgroundColor);
  await chip.hover();
  const bgAfter = await chip.evaluate((el) => getComputedStyle(el).backgroundColor);
  check('N3 hover 无背景态、cursor=pointer',
    bgBefore === bgAfter && (await chip.evaluate((el) => getComputedStyle(el).cursor)) === 'pointer');
  await shot(page, '01-drawer-identity-chip-hover.png');
  // N4 点击 = 同 tab SPA 路由进设置页，落点解析真记录。live 面 agent 记录
  // 走 GET 异步——加载窗口内 source undefined 会先闪「找不到该 Agent」回退
  // 态，等 tabs 真可见再断言（不是竞态放行，是等真值落定）。
  await chip.click();
  await page.waitForURL((u) => u.pathname === '/app/resources/agents/' + AGENT_ID, { timeout: 8000 });
  await page.locator('.agent-tabs').waitFor({ state: 'visible', timeout: 10000 });
  check('N4 点击导航进 Agent 设置页（三 tab 落点，非抽屉非新 tab）',
    (await page.locator('.agent-missing').count()) === 0 &&
    (await page.locator('.agent-tabs').isVisible()) &&
    (await page.locator('body').textContent()).includes(AGENT_NAME));
  await shot(page, '02-agent-settings-landing.png');
  // N5 键盘可达：回板面重开抽屉，composer 持焦 → Shift+Tab 走上 chip → Enter。
  await page.goBack();
  await ensureDrawer();
  await page.locator('.chief-composer textarea').focus();
  let reached = false;
  for (let i = 0; i < 30 && !reached; i += 1) {
    await page.keyboard.press('Shift+Tab');
    reached = await chip.evaluate((el) => el === document.activeElement).catch(() => false);
  }
  check('N5 键盘 Tab 可达身份 chip', reached);
  await shot(page, '03-keyboard-focus-ring.png');
  await page.keyboard.press('Enter');
  await page.waitForURL((u) => u.pathname === '/app/resources/agents/' + AGENT_ID, { timeout: 8000 });
  check('N6 Enter 激活导航', true);
  // N7/N8 提及 chip（robot markdown 内 [名](agent:<id>) wire）。
  await page.goBack();
  await ensureDrawer();
  await mention.waitFor({ state: 'visible', timeout: 8000 });
  check('N7 agent 提及 chip 成 anchor 指同一路由',
    (await mention.evaluate((el) => el.tagName)) === 'A' &&
    (await mention.getAttribute('href')) === '/app/resources/agents/' + AGENT_ID &&
    (await mention.textContent()) === AGENT_NAME);
  await shot(page, '04-drawer-mention-chip.png');
  await mention.click();
  await page.waitForURL((u) => u.pathname === '/app/resources/agents/' + AGENT_ID, { timeout: 8000 });
  await page.locator('.agent-tabs').waitFor({ state: 'visible', timeout: 10000 });
  check('N8 提及 chip 点击导航进 Agent 设置页',
    (await page.locator('.agent-missing').count()) === 0 &&
    (await page.locator('body').textContent()).includes(AGENT_NAME));
  await shot(page, '05-mention-landing.png');
} else {
  // O1 robot 行头像不可点、无名字：身份 chip 零出现，头像仍是惰性槽。
  // #950 载体：身份 link = 行级直子 anchor、名字 = link 内 span、头像 =
  // 行级 img（.chief-identity*/.chief-avatar--img 类退役）。
  check('O1 身份 chip 不存在（旧态：头像惰性、无名字）',
    (await page.locator('[data-testid="chief-msg"] > a').count()) === 0 &&
    (await page.locator('[data-testid="chief-msg"] > a span').count()) === 0 &&
    (await page.locator('[data-testid="chief-msg"] img').count()) >= 1);
  // O2 提及 chip 是死 span：无 href，点击零导航。
  await mention.waitFor({ state: 'visible', timeout: 8000 });
  const tag = await mention.evaluate((el) => el.tagName);
  const href = await mention.getAttribute('href');
  await shot(page, '01-before-drawer-dead-chips.png');
  await mention.click();
  await page.waitForTimeout(800);
  const stillBoard = new URL(page.url()).pathname === '/app';
  check('O2 提及 chip 死 span（旧态：点击零导航）', tag === 'SPAN' && href === null && stillBoard,
    'tag=' + tag + ' href=' + href + ' url=' + page.url());
  await shot(page, '02-before-click-noop.png');
}

await browser.close();

const failed = checks.filter((c) => !c.ok);
writeFileSync(
  join(EVIDENCE, 'result.json'),
  JSON.stringify(
    {
      probe: 'agent-identity',
      mode: EXPECT_OLD ? 'expect-old' : 'expect-new',
      ticket: '#741',
      stack: { server: SERVER, web: WEB, repo: REPO },
      agentId: AGENT_ID,
      threadId,
      checks,
      artifacts,
    },
    null,
    2,
  ),
);
process.stdout.write('\n' + (checks.length - failed.length) + '/' + checks.length + ' PASS  evidence=' + EVIDENCE + '\n');
process.exit(failed.length > 0 ? 1 : 0);
