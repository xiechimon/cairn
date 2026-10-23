#!/usr/bin/env node
// verify-cairn drive-1094-threads-scroll — 总管切换器长列表滚动（#1094）双向证据。
//
// 缺陷路径：头部主题切换器容器零 max-height / 零 overflow，父链窗体
// WINDOW_CLS 是 overflow-hidden——线程攒到 22 条时列表 668px 冲出 600px
// 窗底，尾部行被裁掉：看不见、滚不到、点不着（真实命中测试落在窗后
// 的板面上）。不是换代回归：退役前 .chief-switcher 同缺口。
//
// 修法（本票）：容器加 max-h-[220px] overflow-y-auto（slash-menu 的绝对
// 定位列表先例值；registry 的 max-h-(--available-height) 不适用——该变量
// 由 Base UI Positioner 注入，本容器不在 Positioner 里，探针 N13/O12 实测
// 恒空）。
//
// 铺底全走公开 REST（drive-1034 同律）：零 daemon、零 LLM、零 SQL——
// POST /chief/threads 建 22 条线程（标题 = 首句截断，API 回读为准）。
// 交互面断言用 page.mouse 坐标级真实点击（不用 locator.click——它对
// fixed 祖先裁剪不做命中测试，改前也会放行，测不出「点不到」）。
//
// 用法：
//   VERIFY_REPO_ROOT=<检出> node drive-1094-threads-scroll.mjs --expect=new
//   # before 基线（origin/main 一次性 worktree 栈，期望反转 = 复现缺陷）：
//   VERIFY_REPO_ROOT=/tmp/<main 检出> VERIFY_PORT=8793 VERIFY_WEB_PORT=5275 \
//     node <lane>/.../drive-1094-threads-scroll.mjs --expect=old

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const EXPECT = process.argv.includes('--expect=old') ? 'old' : 'new';
const OLD = EXPECT === 'old';

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
  process.env.VERIFY_EVIDENCE_DIR ??
  join(SCRIPT_REPO, '.claude/verify-evidence/' + ts + '-1094-' + EXPECT);
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

// —— 铺底（全 REST，非被测路径）————————————————————————————————————
const teams = await getJson(SERVER + '/api/teams');
const teamId = teams[0]?.id;
if (!teamId) throw new Error('无 team——先重 launch（全新库 seed）');

const RUN = Date.now().toString(36);
const prov = await sendJson(SERVER + '/api/teams/' + teamId + '/providers', {
  providerId: 'stub-1094-' + RUN,
  label: 'Stub 1094',
  baseUrl: 'http://127.0.0.1:9/v1',
  api: 'openai-completions',
  authHeader: true,
  compat: { supportsDeveloperRole: false },
  models: [{ id: 'stub-model', name: 'stub-model' }],
});
if (![200, 201, 409].includes(prov.status)) throw new Error('provider → ' + prov.status);

const agent = await sendJson(SERVER + '/api/teams/' + teamId + '/agents', {
  displayName: '滚动验证员',
  provider: 'stub-1094-' + RUN,
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

// 线程 22 条：先建 2 条（短列面对照面），再补 20 条（长列面）。
// listChiefThreads 按 updatedAt 降序 → 最新在前，尾行 = 最先建的那条。
const TITLES = [];
async function makeThread(label) {
  const r = await sendJson(SERVER + '/api/teams/' + teamId + '/chief/threads', {
    content: '1094 长列表主题 ' + label,
  });
  const id = r.body?.thread?.id;
  if (r.status !== 201 || !id) throw new Error('chief threads → ' + r.status);
  TITLES.push({ label, id, title: r.body?.thread?.title ?? null });
  return r.body.thread;
}
for (const label of ['01', '02']) await makeThread(label);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 732 } });

async function openSwitcher() {
  await page.goto(WEB + '/app');
  const drawer = page.locator('.chief-drawer');
  if (!(await drawer.isVisible())) {
    await page.locator('.chief-fab').click();
    await drawer.waitFor({ state: 'visible' });
    // 窗体进场 fade+scale（ADR 0013 D7）——几何量测前等动画落定
    await drawer.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  }
  const menu = page.getByRole('menu');
  if (!(await menu.isVisible().catch(() => false))) {
    await page.locator('.chief-drawer button[aria-label="主题"]').click();
    await menu.waitFor({ state: 'visible' });
  }
  return { drawer, menu };
}

// —— A 面：短列表（2 条）——两面同判据 = 视觉零变化对照 —————————————
{
  const { drawer, menu } = await openSwitcher();
  const geom = await menu.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      rows: el.querySelectorAll('[role="menuitem"]').length,
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
      width: el.getBoundingClientRect().width,
      maxHeight: cs.maxHeight,
      overflowY: cs.overflowY,
    };
  });
  // 2 行 × 30px + p-1（4px × 2）= 68——封顶在下面长列面才咬合，短列面
  // 盒尺寸两面必须逐值相同（零变化的量化判据）
  check('A1 短列面 2 行在位', geom.rows === 2, JSON.stringify(geom));
  check('A2 短列面自然高 68px', geom.clientHeight === 68, 'clientHeight=' + geom.clientHeight);
  check(
    'A3 短列面无滚动',
    geom.scrollHeight <= geom.clientHeight,
    'scroll/client=' + geom.scrollHeight + '/' + geom.clientHeight,
  );
  check('A4 宽度 262 不动', geom.width === 262, 'width=' + geom.width);
  check(
    'A5 封顶形态（old=none/visible，new=220px/auto）',
    OLD ? geom.maxHeight === 'none' && geom.overflowY === 'visible' : geom.maxHeight === '220px' && geom.overflowY === 'auto',
    'maxHeight=' + geom.maxHeight + ' overflowY=' + geom.overflowY,
  );
  await shot(drawer, '01-short-list.png');
  // 收面：Esc 关切换器 + 最小化，回 FAB 态
  await page.keyboard.press('Escape');
}

// —— B 面：长列表（22 条）———————————————————————————————————————
for (let i = 3; i <= 22; i++) await makeThread(String(i).padStart(2, '0'));
const apiThreads = await getJson(SERVER + '/api/teams/' + teamId + '/chief/threads');
writeFileSync(join(EVIDENCE, 'api-chief-threads.json'), JSON.stringify(apiThreads, null, 2));
check('B1 API 线程 22 条', Array.isArray(apiThreads) && apiThreads.length === 22, 'len=' + apiThreads?.length);
const tailThread = apiThreads[apiThreads.length - 1]; // updatedAt 升序尾 = 最先建的 01
const headThread = apiThreads[0];

{
  const { drawer, menu } = await openSwitcher();
  const rows = menu.getByRole('menuitem');
  await page.waitForFunction(
    (n) => document.querySelectorAll('[role="menu"] [role="menuitem"]').length === n,
    22,
  );
  check('B2 切换器 22 行', (await rows.count()) === 22, 'count=' + (await rows.count()));

  const m = await menu.evaluate((el) => {
    const cs = getComputedStyle(el);
    const win = el.closest('.chief-drawer');
    const er = el.getBoundingClientRect();
    const wr = win.getBoundingClientRect();
    const last = el.querySelector('[role="menuitem"]:last-of-type');
    const lr = last.getBoundingClientRect();
    return {
      maxHeight: cs.maxHeight,
      overflowY: cs.overflowY,
      availableHeight: cs.getPropertyValue('--available-height').trim(),
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
      menuBottom: er.bottom,
      winBottom: wr.bottom,
      lastRowCenterY: lr.top + lr.height / 2,
      lastRowCenterX: lr.left + lr.width / 2,
      lastRowBottom: lr.bottom,
      scrolledToBottom: Math.abs(el.scrollTop + el.clientHeight - el.scrollHeight) <= 1,
    };
  });
  writeFileSync(join(EVIDENCE, 'measurements.json'), JSON.stringify(m, null, 2));

  if (OLD) {
    // 缺陷复现面：无封顶、列表冲出窗底、尾行被裁、真实命中测试打不到尾行
    check('O3 无封顶', m.maxHeight === 'none', 'maxHeight=' + m.maxHeight);
    check('O4 无滚动轴', m.overflowY === 'visible', 'overflowY=' + m.overflowY);
    check(
      'O5 内容高 == 盒高（没有滚动口）',
      m.scrollHeight === m.clientHeight,
      'scroll/client=' + m.scrollHeight + '/' + m.clientHeight,
    );
    check(
      'O6 列表底冲出窗底',
      m.menuBottom > m.winBottom,
      'menuBottom=' + m.menuBottom + ' > winBottom=' + m.winBottom,
    );
    check(
      'O7 尾行底在窗外',
      m.lastRowBottom > m.winBottom,
      'lastRowBottom=' + m.lastRowBottom + ' winBottom=' + m.winBottom,
    );
    // 「点不到」的物理判据：尾行中心点上真正接事件的元素不是尾行
    const hit = await page.evaluate(
      ({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        if (!el) return null;
        const row = document.querySelector('[role="menu"] [role="menuitem"]:last-of-type');
        return el === row || row.contains(el) ? 'ROW' : (el.className?.toString?.() ?? el.tagName).slice(0, 60);
      },
      { x: m.lastRowCenterX, y: m.lastRowCenterY },
    );
    check('O8 尾行中心点命中测试打不到尾行', hit !== 'ROW', 'hit=' + JSON.stringify(hit));
    check('O12 --available-height 恒空（形态2不可行实测）', m.availableHeight === '', 'v=' + JSON.stringify(m.availableHeight));
    await shot(drawer, '02-long-list-clipped.png');
    await shot(page, '03-long-list-page.png');
  } else {
    check('N3 封顶 220px', m.maxHeight === '220px', 'maxHeight=' + m.maxHeight);
    check('N4 纵向滚动 auto', m.overflowY === 'auto', 'overflowY=' + m.overflowY);
    check(
      'N5 内容高于滚动口（可滚）',
      m.scrollHeight > m.clientHeight,
      'scroll/client=' + m.scrollHeight + '/' + m.clientHeight,
    );
    check(
      'N6 列表底收进窗内',
      m.menuBottom <= m.winBottom,
      'menuBottom=' + m.menuBottom + ' ≤ winBottom=' + m.winBottom,
    );
    check(
      'N13 --available-height 恒空（形态2不可行，选形态1的实测依据）',
      m.availableHeight === '',
      'v=' + JSON.stringify(m.availableHeight),
    );

    // 滚到底：尾行进滚动口且仍在窗内
    await menu.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    const bottom = await menu.evaluate((el) => {
      const win = el.closest('.chief-drawer');
      const er = el.getBoundingClientRect();
      const wr = win.getBoundingClientRect();
      const lr = el.querySelector('[role="menuitem"]:last-of-type').getBoundingClientRect();
      return {
        scrolledToBottom: Math.abs(el.scrollTop + el.clientHeight - el.scrollHeight) <= 1,
        withinScroller: lr.bottom <= er.bottom + 1 && lr.top >= er.top - 1,
        withinWindow: lr.bottom <= wr.bottom + 1 && lr.top >= wr.top - 1,
        centerY: lr.top + lr.height / 2,
        centerX: lr.left + lr.width / 2,
      };
    });
    check('N7a 已滚到底', bottom.scrolledToBottom, JSON.stringify(bottom));
    check('N7b 尾行在滚动口内', bottom.withinScroller, JSON.stringify(bottom));
    check('N7c 尾行在窗内', bottom.withinWindow, JSON.stringify(bottom));
    await shot(drawer, '02-long-list-bottom.png');
    await shot(menu, '03-menu-scrolled.png');

    // 坐标级真实点击尾行 → active 切换 + 头部 chip 换成尾行标题
    const beforeCurrent = await menu
      .evaluate((el) => el.querySelector('[aria-current="true"]')?.textContent ?? null);
    await page.mouse.click(bottom.centerX, bottom.centerY);
    await page.getByRole('menu').waitFor({ state: 'detached' });
    const chip = await page.locator('.chief-drawer button[aria-label="主题"] span').textContent();
    check(
      'N8a 点击后切换器收起',
      true,
      'menu detached',
    );
    check(
      'N8b 头部标题切到尾行线程',
      (chip ?? '').includes(tailThread.title) || chip === tailThread.title,
      'chip=' + JSON.stringify(chip) + ' tail=' + JSON.stringify(tailThread.title),
    );
    check('N8c 点击前 active 是首行（对照位）', (beforeCurrent ?? '').includes(headThread.title), 'before=' + JSON.stringify(beforeCurrent));
    await shot(drawer, '04-after-tail-click.png');

    // 键盘面：重开切换器，Tab 走到尾行（滚动口带焦滚动），Enter 切换
    await page.locator('.chief-drawer button[aria-label="主题"]').click();
    const menu2 = page.getByRole('menu');
    await menu2.waitFor({ state: 'visible' });
    const items = menu2.getByRole('menuitem');
    await items.first().focus();
    for (let i = 0; i < 21; i++) await page.keyboard.press('Tab');
    const focused = await menu2.evaluate((el) => {
      const last = el.querySelector('[role="menuitem"]:last-of-type');
      const er = el.getBoundingClientRect();
      const lr = last.getBoundingClientRect();
      return {
        isLast: document.activeElement === last,
        withinScroller: lr.bottom <= er.bottom + 1 && lr.top >= er.top - 1,
      };
    });
    check('N9 Tab 走到尾行且获得焦点', focused.isLast, JSON.stringify(focused));
    check('N10 焦点行在滚动口内（带焦滚动生效）', focused.withinScroller, JSON.stringify(focused));
    await shot(drawer, '05-keyboard-focus-tail.png');
    await page.keyboard.press('Enter');
    await page.getByRole('menu').waitFor({ state: 'detached' });
    const chip2 = await page.locator('.chief-drawer button[aria-label="主题"] span').textContent();
    check(
      'N11 Enter 切换生效（标题仍钉尾行线程）',
      (chip2 ?? '').includes(tailThread.title) || chip2 === tailThread.title,
      'chip=' + JSON.stringify(chip2),
    );
    await shot(drawer, '06-after-enter.png');
  }
}

await browser.close();

const failed = checks.filter((c) => !c.ok);
const result = {
  ticket: 1094,
  expect: EXPECT,
  server: SERVER,
  web: WEB,
  checks,
  artifacts,
  pass: failed.length === 0,
  summary: (checks.length - failed.length) + '/' + checks.length + ' PASS',
};
writeFileSync(join(EVIDENCE, 'result.json'), JSON.stringify(result, null, 2));
process.stdout.write('\n' + result.summary + '  evidence: ' + EVIDENCE + '\n');
if (failed.length > 0) process.exit(1);
await sleep(0);
