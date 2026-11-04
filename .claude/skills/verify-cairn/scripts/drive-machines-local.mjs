#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { hostname } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SCRIPT_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const REPO = process.env.VERIFY_REPO_ROOT ?? SCRIPT_REPO;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(REPO, '.claude/verify-run');
const portsFile = join(RUN_DIR, 'ports.json');
if (!existsSync(portsFile)) {
  process.stderr.write(`无栈：${portsFile} 不存在或损坏。先跑 launch.mjs\n`);
  process.exit(1);
}
const stack = JSON.parse(readFileSync(portsFile, 'utf8'));
const SERVER = `http://127.0.0.1:${stack.serverPort ?? process.env.VERIFY_PORT ?? 8791}`;
const WEB = `http://127.0.0.1:${stack.webPort ?? process.env.VERIFY_WEB_PORT ?? 5273}`;
const DB_PATH = join(stack.homeDir ?? join(RUN_DIR, 'home'), 'server', 'server.db');
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ??
  join(SCRIPT_REPO, `.claude/verify-evidence/${ts}-machines-local`);
mkdirSync(EVIDENCE, { recursive: true });

const require2 = createRequire(join(REPO, 'apps/server/package.json'));

const checks = [];
function check(name, ok, detail) {

  if (typeof ok !== 'boolean') {
    throw new TypeError(`check(${JSON.stringify(name)}) 的 ok 位须为 boolean，收到 ${typeof ok}`);
  }
  checks.push({ name, ok, detail: detail ?? null });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}\n`);
}
const artifacts = [];
const shot = async (page, name, selector) => {

  const target = selector ? page.locator(selector).first() : page;
  await target.screenshot({ path: join(EVIDENCE, name) });
  artifacts.push(name);
  process.stdout.write(`shot  ${name}${selector ? `  — ${selector}` : ''}\n`);
};

const getJson = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.json();
};
const tryGetJson = async (url) => {
  try {
    return { ok: true, data: await getJson(url) };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  }
};

const dbQuery = (fn) => {
  try {
    const Database = require2('better-sqlite3');
    const db = new Database(DB_PATH, { readonly: true });
    try {
      return { ok: true, ...fn(db) };
    } finally {
      db.close();
    }
  } catch (err) {
    return { ok: false, skipped: true, reason: String(err?.message ?? err) };
  }
};

const softVisible = async (page, selector, timeout = 5000) =>
  page
    .waitForSelector(selector, { state: 'visible', timeout })
    .then(() => true)
    .catch(() => false);
const softCount = async (page, selector) => page.locator(selector).count().catch(() => 0);
const softText = async (page, selector) =>
  page
    .locator(selector)
    .first()
    .innerText()
    .catch(() => '');
const oneLine = (s) => (s ?? '').replace(/\s*\n\s*/g, ' / ').slice(0, 200);

const switchChecked = async (page, selector) =>
  page
    .getAttribute(selector, 'aria-checked')
    .then((v) => (v == null ? null : v === 'true'))
    .catch(() => null);

const pollUntil = async (fn, timeoutMs = 6000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if ((await fn()) === true) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
};

const PAGE_PATH = '/app/resources/machines';
const SHELL = `[data-route="${PAGE_PATH}"]`;

const ROW = `${SHELL} div[data-machine-id]`;
const LOCAL_ROW = `${ROW}[data-kind="local"]`;
const HOST = hostname();
const extra = { hostname: HOST };

const runtimeSel = (runtime) => `${LOCAL_ROW} [data-runtime="${runtime}"]`;

const runtimeOn = async (page, runtime) =>
  page
    .evaluate(
      (sel) => {
        const el = document.querySelector(sel);
        return el == null ? null : el.getAttribute('data-enabled') === 'true';
      },
      runtimeSel(runtime),
    )
    .catch(() => null);

const fetchLocalMachine = async (teamId) => {
  const res = await tryGetJson(`${SERVER}/api/teams/${teamId}/machines`);
  if (!res.ok) return { error: res.error, record: null };
  const rows = Array.isArray(res.data) ? res.data : [];
  return { error: null, record: rows.find((m) => m.kind === 'local') ?? null, rows };
};

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 732 },
  colorScheme: 'dark',
});

try {

  await page.goto(`${WEB}${PAGE_PATH}`);
  const shellReady = await softVisible(page, SHELL, 15_000);
  check('page-ready', shellReady, shellReady ? `${PAGE_PATH} shell 就绪` : '页面 shell 未渲染');
  await shot(page, '01-machines-arrival.png');

  const teamsRes = await tryGetJson(`${SERVER}/api/teams`);
  const teamId = teamsRes.ok ? (teamsRes.data?.[0]?.id ?? null) : null;
  check(
    'api-team-ready',
    teamId != null,
    teamId != null ? `GET /api/teams 取到 teamId=${teamId}` : `取 teamId 失败：${teamsRes.error}`,
  );

  const bodyText = await softText(page, `${SHELL} .page-main`);
  const facadeGone = bodyText !== '' && !bodyText.includes('Cairn 托管机器');
  check(
    'no-hosted-facade',
    facadeGone,
    bodyText === ''
      ? '页面正文不可读（.page-main 缺失？）——负向断言不可空判'
      : facadeGone
        ? '页面无「Cairn 托管机器」facade 行'
        : 'spec 11 A8：「Cairn 托管机器」facade 行仍在（前端静态装饰行未除）',
  );

  const before =
    teamId != null ? await fetchLocalMachine(teamId) : { error: '无 teamId', record: null };
  check(
    'api-local-row',
    before.record != null && before.record.name === HOST,
    before.record != null
      ? `GET machines 含本机记录（name="${before.record.name}", kind=${before.record.kind}）`
      : `spec 11 A8/T2：server 启动应 seed 本机行 kind='local' name=os.hostname()——实测 ${
          before.error ?? `machines=[${(before.rows ?? []).map((m) => m.name).join(', ')}] 无 kind='local' 记录`
        }`,
  );
  const localId = before.record?.id ?? null;
  extra.localMachineId = localId;
  const apiRuntimes = Array.isArray(before.record?.enabledRuntimes)
    ? before.record.enabledRuntimes
    : [];
  extra.enabledRuntimes = apiRuntimes;

  const firstRowKind = await page
    .evaluate(
      (rowSel) => document.querySelector(rowSel)?.getAttribute('data-kind') ?? null,
      ROW,
    )
    .catch(() => null);
  const localRowOk = await softVisible(page, LOCAL_ROW);
  const localRowText = localRowOk ? await softText(page, LOCAL_ROW) : '';
  check(
    'ui-local-row-first',
    firstRowKind === 'local' && localRowOk && localRowText.includes(HOST),
    localRowOk
      ? `本机行在列表首（data-kind=${firstRowKind}），行文本含 hostname "${HOST}"`
      : `spec 11 A8：本机行（div[data-machine-id][data-kind="local"]）应钉列表首且显示 hostname——未实现（首行 data-kind=${firstRowKind ?? '无行'}）`,
  );
  await shot(page, '02-local-row.png');

  const deleteCtl = localRowOk
    ? await softCount(
        page,
        `${LOCAL_ROW} button[aria-label*="删除"], ${LOCAL_ROW} [aria-haspopup="menu"]`,
      )
    : -1;
  check(
    'local-row-nodelete',
    deleteCtl === 0,
    deleteCtl === 0
      ? '本机行无删除控件（不可删）'
      : `spec 11 A8：本机行不可删——行内命中 ${deleteCtl} 个删除类控件${deleteCtl < 0 ? '（前置本机行缺失）' : ''}`,
  );

  const piMarkOk = await softVisible(page, `${runtimeSel('pi')} svg`);
  const ccMarkOk = await softVisible(page, `${runtimeSel('claude-code')} svg`);
  const piLabel = await page.getAttribute(runtimeSel('pi'), 'aria-label').catch(() => null);
  const ccLabel = await page
    .getAttribute(runtimeSel('claude-code'), 'aria-label')
    .catch(() => null);
  check(
    'marks-present',
    piMarkOk && ccMarkOk && piLabel === 'pi' && ccLabel === 'Claude Code',
    piMarkOk && ccMarkOk && piLabel === 'pi' && ccLabel === 'Claude Code'
      ? '本机行内 pi + Claude Code 两个品牌 mark 在位（svg + aria-label 可读名）'
      : `#503：本机行应带 per-runtime 品牌 mark（[data-runtime] 内 svg + aria-label 可读名）——实测 mark pi=${piMarkOk} cc=${ccMarkOk}，label pi="${piLabel}" cc="${ccLabel}"`,
  );

  const piOn0 = await runtimeOn(page, 'pi');
  const ccOn0 = await runtimeOn(page, 'claude-code');
  const consistent0 =
    piOn0 === apiRuntimes.includes('pi') && ccOn0 === apiRuntimes.includes('claude-code');
  check(
    'marks-ui-api-consistent',
    consistent0,
    consistent0
      ? `mark 亮度分态与 API 一致（enabledRuntimes=[${apiRuntimes.join(', ')}]）`
      : `#503：mark 亮度分态应等于 API enabledRuntimes 成员——UI pi=${piOn0} cc=${ccOn0} vs API [${apiRuntimes.join(', ')}]`,
  );

  const SHELL_SW = `${LOCAL_ROW} [role="switch"]`;
  const swCount = localRowOk ? await softCount(page, `${LOCAL_ROW} [role="switch"]`) : -1;
  const btnCount = localRowOk ? await softCount(page, `${LOCAL_ROW} button`) : -1;

  const swOnly = swCount === 1 && btnCount <= 1;
  check(
    'shell-switch-single',
    swOnly,
    swOnly
      ? `本机行内活控件 = shell 开关 + 并发触发钮（switch=${swCount} button=${btnCount}，#1108 canon；per-runtime 位仍是 mark 展示）`
      : `XMON-113/#1108：本机行应恰有一个 role=switch（shell 开关）、至多一个 button（并发触发钮）——实测 switch=${swCount} button=${btnCount}${swCount < 0 ? '（前置本机行缺失）' : ''}`,
  );

  const apiShell0 = before.record?.shellEnabled === true;
  const uiShell0 = await switchChecked(page, SHELL_SW);
  check(
    'shell-ui-api-consistent',
    uiShell0 === apiShell0,
    uiShell0 === apiShell0
      ? `开关读真值一致（API shellEnabled=${apiShell0} / UI aria-checked=${uiShell0}）`
      : `XMON-113：开关态应等于 GET machines 的 shellEnabled——API=${apiShell0} UI=${uiShell0}`,
  );

  const HINT_CANON = '已授权「远程 shell」的 Agent 可在该机器上执行命令。';
  const tipLocator = page.locator('[data-slot="tooltip-content"]');
  const restNoHint = localRowOk && !localRowText.includes('已授权');
  const tipAtRest = await tipLocator.count();
  await page.hover(SHELL_SW).catch(() => {});
  const tipShown = await tipLocator
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  const tipText = tipShown ? await tipLocator.innerText().catch(() => '') : '';
  const subOk =
    restNoHint && tipAtRest === 0 && tipShown && tipText.includes(HINT_CANON) && !localRowText.includes('· max');
  check(
    'subline-hint-tooltip',
    subOk,
    subOk
      ? `hint 句静息不在行内（portal 计数 ${tipAtRest}），真 hover 开关簇弹出「${oneLine(tipText)}」`
      : `#1175：hint 句应静息缺席 + hover 开关簇弹 tooltip——静息无句=${restNoHint} 静息 portal=${tipAtRest} hover 弹出=${tipShown} tooltip 文案「${oneLine(tipText)}」行文本「${oneLine(localRowText)}」`,
  );
  await shot(page, '03-tooltip-hover.png');

  await page.mouse.move(5, 5);
  await shot(page, '03-marks.png');

  const target = !apiShell0;
  let writeOk = false;
  let dbShell = null;
  let uiAfterReload = null;
  if (swOnly) {
    await page.click(SHELL_SW).catch(() => {});
    writeOk = await pollUntil(async () => {
      const now = await fetchLocalMachine(teamId);
      return now.record?.shellEnabled === target;
    });
  }
  check(
    'shell-write-api',
    writeOk,
    writeOk
      ? `点击后 API 回读 shellEnabled=${target}（写入真落库，初值 ${apiShell0}）`
      : `XMON-113：拨开关应经 PATCH /api/machines/{id} 落库——API 回读未变（期望 ${target}）`,
  );
  const dbShellRes =
    localId != null
      ? dbQuery((db) => ({
          row: db.prepare('SELECT shellEnabled FROM machine WHERE id = ?').get(localId),
        }))
      : { ok: false, skipped: true, reason: 'prune' };
  dbShell = dbShellRes.row?.shellEnabled;
  const dbShellBool = dbShell === 1 || dbShell === true;
  check(
    'shell-write-db',
    dbShellBool === target,
    dbShellBool === target
      ? `SQLite machine.shellEnabled=${dbShell}（与 API 写法一致）`
      : `XMON-113：SQLite machine.shellEnabled 应随写入变化——实测 ${JSON.stringify(dbShell ?? dbShellRes.reason)}（期望 ${target}）`,
  );
  await shot(page, '03b-shell-flipped.png');
  await shot(page, '03b-row-zoom.png', LOCAL_ROW);

  await page.reload();
  await page.waitForSelector(SHELL, { timeout: 15_000 }).catch(() => {});
  uiAfterReload = await switchChecked(page, SHELL_SW);
  check(
    'shell-persist-reload',
    uiAfterReload === target,
    uiAfterReload === target
      ? `reload 后开关回显 ${target}（读侧投影持久）`
      : `XMON-113：reload 后开关应回显写入值——实测 ${uiAfterReload}（期望 ${target}）`,
  );
  await shot(page, '03c-shell-after-reload.png');

  const restored = await (async () => {
    if (!swOnly) return false;
    await page.click(SHELL_SW).catch(() => {});
    return pollUntil(async () => {
      const now = await fetchLocalMachine(teamId);
      return now.record?.shellEnabled === apiShell0;
    });
  })();
  check(
    'shell-restore',
    restored,
    restored
      ? `开关已拨回初值 ${apiShell0}（栈状态复原）`
      : `XMON-113：收尾应把开关拨回初值 ${apiShell0}——未复原`,
  );

  const dbTruth =
    localId != null
      ? dbQuery((db) => ({
          row: db
            .prepare('SELECT id, name, kind, enabledRuntimes FROM machine WHERE id = ?')
            .get(localId),
        }))
      : { ok: false, skipped: true, reason: 'API 无本机记录，无 id 可查' };
  const dbRow = dbTruth.row ?? null;
  let dbParsed = null;
  try {
    dbParsed = dbRow?.enabledRuntimes != null ? JSON.parse(dbRow.enabledRuntimes) : null;
  } catch {
    dbParsed = null;
  }
  check(
    'db-kind-local',
    dbRow?.kind === 'local',
    dbRow != null
      ? `SQLite machine 行 kind=${dbRow.kind}（期望 local）`
      : `spec 11 A9：SQLite machine 表应有 kind='local' 本机行——${dbTruth.reason ?? '行缺失'}`,
  );
  const dbMatchesApi =
    Array.isArray(dbParsed) &&
    dbParsed.length === apiRuntimes.length &&
    apiRuntimes.every((r) => dbParsed.includes(r));
  check(
    'db-enabled-runtimes',
    dbMatchesApi,
    Array.isArray(dbParsed)
      ? `SQLite enabledRuntimes=[${dbParsed.join(', ')}]（API=[${apiRuntimes.join(', ')}]）`
      : `spec 11 A9：SQLite machine.enabledRuntimes（JSON 列）应与 API 同集——${
          dbTruth.reason ?? (dbRow != null ? `列值 ${JSON.stringify(dbRow?.enabledRuntimes ?? null)} 非 JSON 数组` : '行缺失')
        }`,
  );

  await page.reload();
  await page.waitForSelector(SHELL, { timeout: 15_000 }).catch(() => {});
  const afterReload = teamId != null ? await fetchLocalMachine(teamId) : { record: null };
  const apiRuntimes1 = Array.isArray(afterReload.record?.enabledRuntimes)
    ? afterReload.record.enabledRuntimes
    : [];
  const piOn1 = await runtimeOn(page, 'pi');
  const ccOn1 = await runtimeOn(page, 'claude-code');
  const persisted =
    piOn1 === apiRuntimes1.includes('pi') && ccOn1 === apiRuntimes1.includes('claude-code');
  check(
    'persist-reload',
    persisted,
    persisted
      ? `reload 后 mark 亮度分态持久（API enabledRuntimes=[${apiRuntimes1.join(', ')}]，UI 一致）`
      : `#503：mark 亮度分态应随 enabledRuntimes 持久——reload 后 UI pi=${piOn1} cc=${ccOn1} vs API [${apiRuntimes1.join(', ')}]`,
  );
  await shot(page, '04-after-reload.png');

  const ADD_DLG = '[role="dialog"]:has-text("添加机器")';
  const addOk = await softVisible(page, `${SHELL} button:text-is("添加机器")`);
  let addDialogOk = false;
  if (addOk) {
    await page.click(`${SHELL} button:text-is("添加机器")`).catch(() => {});
    addDialogOk = await softVisible(page, ADD_DLG);
    if (addDialogOk) {
      const dlgText = (await softText(page, ADD_DLG)).toLowerCase();
      addDialogOk = dlgText.includes('cairn');
      await shot(page, '05-add-machine-dialog.png');
      await page.click(`${ADD_DLG} button[aria-label="关闭"]`).catch(() => {});
      await page.waitForSelector(ADD_DLG, { state: 'hidden', timeout: 5000 }).catch(() => {});
    }
  }
  check(
    'add-machine-intact',
    addOk && addDialogOk,
    addOk && addDialogOk
      ? '「添加机器」钮开 CLI 命令 dialog（流程不变）'
      : `spec 11 A8：添加机器流程应不变（button:text-is("添加机器") → CLI 命令 dialog）——钮=${addOk} dialog=${addDialogOk}`,
  );

  const chevCount = await softCount(
    page,
    `${SHELL} [data-kind][role="button"], ${SHELL} [data-kind] a`,
  );
  check(
    'rows-no-affordance',
    chevCount === 0,
    `spec 11 A7：无 handler 行不渲染 chevron（行级 role=button / 行内链接计数 0）——实测 ${chevCount} 个`,
  );
  await shot(page, '06-final.png');
} catch (err) {
  check('probe-exception', false, String(err?.message ?? err));
  try {
    await shot(page, '99-error.png');
  } catch {

  }
} finally {
  await browser.close();
}

const ok = checks.every((c) => c.ok);
const result = {
  probe: 'machines-local',
  ok,
  at: new Date().toISOString(),
  stack: { api: SERVER, web: WEB, homeDir: stack.homeDir },
  checks,
  artifacts,
  ...extra,
};
writeFileSync(join(EVIDENCE, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(
  `\nevidence: ${EVIDENCE}\nallOk=${ok}\n${ok ? 'drive machines-local:PASS' : `drive machines-local:FAIL(${checks.filter((c) => !c.ok).length} 项)`}\n`,
);
process.exit(ok ? 0 : 1);
