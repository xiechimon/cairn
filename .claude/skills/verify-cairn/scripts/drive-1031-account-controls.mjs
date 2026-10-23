#!/usr/bin/env node
// verify-cairn drive-1031-account-controls — /app/account 两个控件真接线
// （#1031）。缺陷判因（票面浏览器实测指纹）：① 改名压根没接线（名称行 = 纯
// 文本 + 装饰铅笔，无 button/onClick）；② 推送通知开关结构性单向（checked
// 完全受控于 permission，处理器只在 checked===true 时动作，granted 态点
// 「关」aria-checked 恒 true）。
//
// 本 probe 走真 live 栈（vite dev 5273 proxy → server 8791 → 真 SQLite），
// 证明 fixture e2e（走 route stub）证不到的那一层：
//  · 改名一次往返 = UI 提交 → PATCH /api/user/me → **真 SQLite user 行落库**
//    → 刷新后仍是新值（三真值：截图 + API JSON + SQLite 行）。
//  · 开关 granted / denied 两态在 **live 生产构建**上双向都有可见且持久结果，
//    关档落真 localStorage cairn.notifyEnabled；denied 开态出拦截解释。
//    权限档用与 e2e 同形的确定性 Notification 桩驱动——headless chromium 的
//    真权限 API 不可靠（grantPermissions 不翻 Notification.permission、
//    requestPermission 恒 resolve default，无 prompt UI），桩是唯一能稳定表达
//    三态的通道；default 态同理由 e2e 桩覆盖（account-controls.spec S5/S6）。
//    开关逻辑（偏好 × 权限 → checked/拦截解释）是被测面，权限是其输入。
//
// fixture 面（apps/web e2e account-controls.spec / account-team-cleanse.spec /
// notify-click.spec T5）证明交互与三态；本 probe 证明 live 落库与真浏览器权限。
// 两条都要，互不替代。
// 用法：node <worktree>/.claude/skills/verify-cairn/scripts/drive-1031-account-controls.mjs

import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SCRIPT_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const REPO = process.env.VERIFY_REPO_ROOT ?? SCRIPT_REPO;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(REPO, '.claude/verify-run');
const portsFile = join(RUN_DIR, 'ports.json');
if (!existsSync(portsFile)) {
  process.stderr.write(`无栈：${portsFile} 不存在。先跑 launch.mjs\n`);
  process.exit(1);
}
const stack = JSON.parse(readFileSync(portsFile, 'utf8'));
const SERVER = `http://127.0.0.1:${stack.serverPort ?? process.env.VERIFY_PORT ?? 8791}`;
const WEB = `http://127.0.0.1:${stack.webPort ?? process.env.VERIFY_WEB_PORT ?? 5273}`;
const HOME_DIR = stack.homeDir ?? join(RUN_DIR, 'home');
const DB_PATH = join(HOME_DIR, 'server', 'server.db');
const require2 = createRequire(join(REPO, 'apps/server/package.json'));
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ??
  join(SCRIPT_REPO, `.claude/verify-evidence/${ts}-1031-account-controls`);
mkdirSync(EVIDENCE, { recursive: true });

const RENAMED = '改名验证-1031';
const PREF_KEY = 'cairn.notifyEnabled';

const checks = [];
function check(name, ok, detail) {
  if (typeof ok !== 'boolean') {
    throw new TypeError(`check(${JSON.stringify(name)}) 的 ok 位须为 boolean，收到 ${typeof ok}`);
  }
  checks.push({ name, ok, detail: detail ?? null });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}\n`);
}
const artifacts = [];
async function shot(page, name) {
  await page.screenshot({ path: join(EVIDENCE, name) });
  artifacts.push(name);
  process.stdout.write(`shot  ${name}\n`);
}
async function saveJson(name, data) {
  writeFileSync(join(EVIDENCE, name), `${JSON.stringify(data, null, 2)}\n`);
  artifacts.push(name);
  process.stdout.write(`json  ${name}\n`);
}
async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.json();
}
function dbReadUser() {
  const Database = require2('better-sqlite3');
  const db = new Database(DB_PATH, { readonly: true });
  try {
    return db.prepare('SELECT id, "displayName", "avatarUrl" FROM user').all();
  } finally {
    db.close();
  }
}
/** 轮询条件直到成立（写路径异步：点击 → setState/PATCH → 落库 → 重渲染）。 */
const pollUntil = async (fn, timeoutMs = 6000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if ((await fn()) === true) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
};
const ariaChecked = (loc) => loc.getAttribute('aria-checked');

/** 确定性 Notification 桩（account-team-cleanse.spec / notify-banner.spec 同形）：
 *  permission 读 initial，直到 requestPermission() 把它落到 resolution，调用
 *  计数进 __permCalls。headless 真权限 API 不可靠，桩是稳定表达三态的唯一通道。 */
function stubNotification(ctx, initial, resolution) {
  return ctx.addInitScript(
    ({ p, r }) => {
      let perm = p;
      window.__permCalls = 0;
      Object.defineProperty(window, 'Notification', {
        configurable: true,
        value: {
          get permission() {
            return perm;
          },
          requestPermission() {
            window.__permCalls++;
            perm = r;
            return Promise.resolve(r);
          },
        },
      });
    },
    { p: initial, r: resolution },
  );
}

const extra = { web: WEB, api: SERVER, homeDir: HOME_DIR };

// 基线：全新库 seed 单用户 = Owner
const baseline = await getJson(`${SERVER}/api/user/me`);
check('基线 seed 用户 displayName = Owner', baseline.displayName === 'Owner', baseline.displayName);
await saveJson('00-user-me-baseline.json', baseline);

const browser = await chromium.launch();
try {
  // —— ① 改名一次往返（真 live 栈 + 真 SQLite；与权限无关，无桩）——————————
  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 732 } });
  const page = await ctxA.newPage();
  await page.goto(`${WEB}/app/account`, { waitUntil: 'domcontentloaded' });
  const card = page.locator('.account-card');
  const nameBtn = card.getByRole('button', { name: 'Owner', exact: true });
  await nameBtn.waitFor({ state: 'visible', timeout: 15000 });
  await shot(page, '01-account-before.png');

  // R1：名称行有真按钮载体（旧面 = 纯文本 div，getByRole button 恒 0）
  check('改名 R1：名称行渲染为 button 载体（非纯文本）', (await nameBtn.count()) === 1);
  const editBtn = card.getByRole('button', { name: '编辑' });
  check(
    '改名 R1：铅笔是带可访问名「编辑」的 button（非装饰 svg）',
    (await editBtn.count()) === 1,
  );

  // R2/R3：点进编辑态，预填当前名并聚焦
  await nameBtn.click();
  const input = card.getByRole('textbox');
  await input.waitFor({ state: 'visible', timeout: 5000 });
  check('改名 R2：点击进编辑态（textbox 出现）', await input.isVisible());
  check('改名 R3：编辑框预填当前名 Owner', (await input.inputValue()) === 'Owner');
  check('改名 R3：编辑框聚焦', await input.evaluate((el) => el === document.activeElement));
  await shot(page, '02-account-editing.png');

  // R4：Enter 提交 → 行面显示新名
  await input.fill(RENAMED);
  await input.press('Enter');
  const renamedBtn = card.getByRole('button', { name: RENAMED, exact: true });
  await renamedBtn.waitFor({ state: 'visible', timeout: 5000 });
  check('改名 R4：Enter 提交后行面显示新名', (await renamedBtn.count()) === 1);

  // R7：真 PATCH 落库——API 真值 + SQLite 行真值
  await pollUntil(async () => (await getJson(`${SERVER}/api/user/me`)).displayName === RENAMED);
  const afterApi = await getJson(`${SERVER}/api/user/me`);
  await saveJson('03-user-me-after-rename.json', afterApi);
  check(
    '改名 R7：GET /api/user/me 返回新名（API 真值）',
    afterApi.displayName === RENAMED,
    afterApi.displayName,
  );
  const afterRows = dbReadUser();
  await saveJson('04-sqlite-user-row.json', afterRows);
  check(
    '改名 R7：SQLite user 行 displayName 落库为新名（DB 真值）',
    afterRows.length === 1 && afterRows[0].displayName === RENAMED,
    JSON.stringify(afterRows[0]),
  );

  // R8：刷新后仍是新名（持久化，非组件态残影）
  await page.reload({ waitUntil: 'domcontentloaded' });
  await card
    .getByRole('button', { name: RENAMED, exact: true })
    .waitFor({ state: 'visible', timeout: 15000 });
  check('改名 R8：刷新后行面仍是新名（落库持久）', true);
  await shot(page, '05-account-after-reload.png');
  await ctxA.close();

  // —— ② 开关 granted 态双向 + 持久（live 生产构建 + 确定性 granted 桩）——————
  const ctxG = await browser.newContext({ viewport: { width: 1440, height: 732 } });
  await stubNotification(ctxG, 'granted', 'granted');
  const pageG = await ctxG.newPage();
  await pageG.goto(`${WEB}/app/account`, { waitUntil: 'domcontentloaded' });
  const swG = pageG.getByRole('switch', { name: '推送通知' });
  await swG.waitFor({ state: 'visible', timeout: 15000 });
  check(
    '开关 granted：无偏好时初始 = 开（跟随权限）',
    (await ariaChecked(swG)) === 'true',
  );
  await shot(pageG, '06-switch-granted-on.png');

  // S1：granted 态关得掉（旧面 = 结构性空操作，aria-checked 恒 true）
  await swG.click();
  await pollUntil(async () => (await ariaChecked(swG)) === 'false');
  check(
    '开关 S1：granted 态点「关」→ aria-checked=false（不再单向空操作）',
    (await ariaChecked(swG)) === 'false',
  );
  const prefOff = await pageG.evaluate((k) => localStorage.getItem(k), PREF_KEY);
  check('开关 S1：关档落 localStorage cairn.notifyEnabled=0', prefOff === '0', String(prefOff));
  await shot(pageG, '07-switch-granted-off.png');

  // S2：关档随刷新持久（granted 权限也不覆盖用户偏好）
  await pageG.reload({ waitUntil: 'domcontentloaded' });
  await swG.waitFor({ state: 'visible', timeout: 15000 });
  await pollUntil(async () => (await ariaChecked(swG)) === 'false');
  check(
    '开关 S2：刷新后仍是关档（偏好持久，不被 granted 权限拉回）',
    (await ariaChecked(swG)) === 'false',
  );
  // 开回来：权限已 granted，无需再请求（__permCalls 恒 0）
  await swG.click();
  await pollUntil(async () => (await ariaChecked(swG)) === 'true');
  check('开关 S2：granted 态能再开回来 → aria-checked=true', (await ariaChecked(swG)) === 'true');
  const permCallsG = await pageG.evaluate(() => window.__permCalls);
  check('开关 S2：granted 态开关不触发 requestPermission（已授权）', permCallsG === 0, String(permCallsG));
  const prefOn = await pageG.evaluate((k) => localStorage.getItem(k), PREF_KEY);
  check('开关 S2：开档落 localStorage cairn.notifyEnabled=1', prefOn === '1', String(prefOn));
  await ctxG.close();

  // —— ② 开关 denied 态双向 + 拦截解释（live 生产构建 + 确定性 denied 桩）—————
  const ctxD = await browser.newContext({ viewport: { width: 1440, height: 732 } });
  await stubNotification(ctxD, 'denied', 'denied');
  const pageD = await ctxD.newPage();
  await pageD.goto(`${WEB}/app/account`, { waitUntil: 'domcontentloaded' });
  const cardD = pageD.locator('.account-card');
  const swD = pageD.getByRole('switch', { name: '推送通知' });
  await swD.waitFor({ state: 'visible', timeout: 15000 });
  check('开关 denied：无偏好时初始 = 关', (await ariaChecked(swD)) === 'false');
  const hintD = cardD.locator('.profile-hint');
  check('开关 denied：关态不出拦截解释（无「显示开却不弹」矛盾）', (await hintD.count()) === 0);

  // S3/S4：denied 态点开 = 偏好落地 + 拦截解释（旧面点开恒 false）
  await swD.click();
  await pollUntil(async () => (await ariaChecked(swD)) === 'true');
  check(
    '开关 S3：denied 态点「开」→ aria-checked=true（偏好档，不再单向）',
    (await ariaChecked(swD)) === 'true',
  );
  const permCallsD = await pageD.evaluate(() => window.__permCalls);
  check('开关 S3：denied 态点开驱动一次 requestPermission（#114 路径）', permCallsD === 1, String(permCallsD));
  await hintD.waitFor({ state: 'visible', timeout: 5000 });
  const hintText = await hintD.textContent();
  check(
    '开关 S4：denied 开态出拦截解释（含「重新允许」）',
    (hintText ?? '').includes('重新允许'),
    hintText ?? '',
  );
  await shot(pageD, '08-switch-denied-on-hint.png');

  // denied 开档随刷新持久
  await pageD.reload({ waitUntil: 'domcontentloaded' });
  await swD.waitFor({ state: 'visible', timeout: 15000 });
  await pollUntil(async () => (await ariaChecked(swD)) === 'true');
  check('开关 S3：denied 开档刷新后持久', (await ariaChecked(swD)) === 'true');
  await cardD.locator('.profile-hint').waitFor({ state: 'visible', timeout: 5000 });
  check('开关 S4：denied 开档刷新后拦截解释仍在', true);

  // denied 态也关得掉，解释随关档撤下
  await swD.click();
  await pollUntil(async () => (await ariaChecked(swD)) === 'false');
  check('开关 S3：denied 态也能关回去 → aria-checked=false', (await ariaChecked(swD)) === 'false');
  check('开关 S4：关档后拦截解释撤下', (await cardD.locator('.profile-hint').count()) === 0);
  await shot(pageD, '09-switch-denied-off.png');
  await ctxD.close();
} finally {
  await browser.close();
}

const ok = checks.every((c) => c.ok);
writeFileSync(
  join(EVIDENCE, 'result.json'),
  `${JSON.stringify(
    {
      probe: '1031-account-controls',
      ok,
      at: new Date().toISOString(),
      stack: { api: SERVER, web: WEB, homeDir: HOME_DIR },
      checks,
      artifacts,
      ...extra,
    },
    null,
    2,
  )}\n`,
);
process.stdout.write(
  `\nevidence: ${EVIDENCE}\nallOk=${ok}\n${ok ? 'drive 1031-account-controls:PASS' : 'drive 1031-account-controls:FAIL'}\n`,
);
process.exit(ok ? 0 : 1);
