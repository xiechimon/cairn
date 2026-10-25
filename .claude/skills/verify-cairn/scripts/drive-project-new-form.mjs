#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SCRIPT_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const ROOT = process.env.VERIFY_REPO_ROOT
  ? resolve(process.env.VERIFY_REPO_ROOT)
  : SCRIPT_ROOT;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(ROOT, '.claude', 'verify-run');

let stack;
try {
  stack = JSON.parse(readFileSync(join(RUN_DIR, 'ports.json'), 'utf8'));
} catch {
  console.error(`无栈:${join(RUN_DIR, 'ports.json')} 不存在或损坏。先跑 launch.mjs`);
  process.exit(1);
}
const API = `http://127.0.0.1:${stack.serverPort}`;
const WEB = `http://127.0.0.1:${stack.webPort}`;
const DB_PATH = join(stack.homeDir, 'server', 'server.db');
const NEW_PAGE = `${WEB}/app/project/new`;

const FOCUS_RING = 'rgb(147, 142, 138)';
const DANGER = 'rgb(255, 171, 183)';

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ??
  join(SCRIPT_ROOT, '.claude', 'verify-evidence', `${stamp}-project-new-form`);
mkdirSync(EVIDENCE, { recursive: true });

const checks = [];
const artifacts = [];
const payloads = {};
let failures = 0;
const check = (ok, label) => {
  checks.push({ ok, label });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures += 1;
};

const props = [];
function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  props.push(dir);
  return dir;
}
const gitRepo = tempDir('verify-form-repo-');
execFileSync('git', ['init', gitRepo], { stdio: 'pipe' });
execFileSync(
  'git',
  ['-c', 'user.email=verify@local', '-c', 'user.name=verify', 'commit', '--allow-empty', '-m', 'init'],
  { cwd: gitRepo, stdio: 'pipe' },
);
const plainDir = tempDir('verify-form-plain-');
const missingPath = join(tempDir('verify-form-missing-base-'), 'no-such-dir');
const repoBase = basename(gitRepo);

const getJson = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.json();
};

const dbQuery = (fn) => {
  try {
    const requireServer = createRequire(join(ROOT, 'apps', 'server', 'package.json'));
    const Database = requireServer('better-sqlite3');
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

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 732 },
  colorScheme: 'dark',
});

const shot = async (name) => {
  await page.screenshot({ path: join(EVIDENCE, name) });
  artifacts.push(name);
  console.log(`shot  ${name}`);
};
const gotoNew = async () => {
  await page.goto(NEW_PAGE);
  await page.waitForSelector('#prj-new-name', { timeout: 20_000 });
};
const menu = () => page.getByRole('menu', { name: '仓库' });
const openMenu = async () => {

  if (await menu().isVisible()) return;
  const swap = page.locator('button[aria-label="选择仓库"]');
  if (await swap.isVisible()) await swap.click();
  else await page.locator('#prj-new-repo').click();
  await menu().waitFor({ timeout: 5000 });
};
const selectRow = async (label) => {
  await openMenu();
  await menu().getByRole('menuitemradio', { name: label }).click();
  await menu().waitFor({ state: 'hidden', timeout: 5000 });
};
const waitProjectUrl = () =>
  page.waitForURL(
    (url) => /^\/app\/project\/[^/]+$/.test(url.pathname) && url.pathname !== '/app/project/new',
    { timeout: 15_000 },
  );
const nameValue = () => page.locator('#prj-new-name').inputValue();
const errorRow = page.getByRole('alert');

try {

  await gotoNew();
  await openMenu();
  const rows = menu().getByRole('menuitemradio');
  const rowCount = await rows.count();
  const rowTexts = await rows.allTextContents();
  payloads.menuRows = rowTexts;
  check(
    rowCount === 2 &&
      rowTexts[0].includes('GitHub 仓库') &&
      rowTexts[1].includes('本地文件夹') &&
      !rowTexts.some((t) => t.includes('托管')),
    `菜单恰两行「GitHub 仓库」「本地文件夹」,无 hosted 行(实际 ${rowCount}:${rowTexts.join('|')})`,
  );
  await shot('01-menu-two-rows.png');

  await selectRow('本地文件夹');
  const localInput = page.locator('input[aria-label="本地文件夹"]');
  check(await localInput.isVisible(), '本地文件夹选态:触发行换成路径输入面');
  await localInput.fill(gitRepo);
  check(
    (await nameValue()) === repoBase,
    `local 回填:项目名 = basename(实际「${await nameValue()}」,期望「${repoBase}」)`,
  );
  await shot('02-backfill-local.png');

  await page.locator('#prj-new-name').fill('Custom Name');
  await localInput.fill(plainDir);
  check((await nameValue()) === 'Custom Name', '手改项目名后,路径变化不再覆盖');
  await page.locator('#prj-new-name').fill('');
  await localInput.fill(gitRepo);
  check(
    (await nameValue()) === repoBase,
    `清空名称后回填恢复(实际「${await nameValue()}」)`,
  );

  await selectRow('GitHub 仓库');
  check(
    (await page.locator('input[aria-label="本地文件夹"]').count()) === 0,
    '切到 GitHub 形态:本地路径输入面退场(无陈旧态骑提交)',
  );
  await page.getByRole('button', { name: '手动输入 owner/repo' }).click();
  const ghInput = page.locator('input[aria-label="GitHub 仓库"]');
  await ghInput.fill('xiechimon/cairn');
  check(
    (await nameValue()) === 'cairn',
    `github 回填:项目名 = repo 段(实际「${await nameValue()}」)`,
  );

  await page.locator('#prj-new-name').click();
  await page.waitForTimeout(300);
  const focus = await page.locator('#prj-new-name').evaluate((el) => {
    const s = getComputedStyle(el);
    return { outline: s.outlineStyle, border: s.borderTopColor, shadow: s.boxShadow };
  });
  payloads.focusStyles = focus;
  check(
    focus.outline === 'none' &&
      focus.border === FOCUS_RING &&
      focus.shadow.includes('3px') &&
      !focus.shadow.includes('rgb(0, 95, 204)'),
    `名称输入框 focus:outline none + registry 环(border-ring + ring-3,实际 ${JSON.stringify(focus)})`,
  );
  await shot('03-focus-ring-registry.png');

  await gotoNew();
  await page.locator('#prj-new-name').fill('Gated');
  await selectRow('本地文件夹');
  check(
    await page.getByRole('button', { name: '创建项目' }).isDisabled(),
    '提交闸:local 形态空路径 = 创建钮 disabled',
  );

  await page.locator('input[aria-label="本地文件夹"]').fill(missingPath);
  await page.getByRole('button', { name: '创建项目' }).click();
  await errorRow.waitFor({ state: 'visible', timeout: 8000 });
  const errText1 = await errorRow.textContent();
  const errColor = await errorRow.evaluate((el) => getComputedStyle(el).color);
  payloads.errorNotFound = { errText1, errColor, url: page.url() };
  check(
    errText1 === '路径不存在' && errColor === DANGER,
    `400 不存在路径 → 红色错误行「路径不存在」(实际「${errText1}」/${errColor})`,
  );
  check(page.url().endsWith('/app/project/new'), '400 后不导航(阻止提交生效)');
  await shot('04-error-path-not-found.png');
  await page.locator('input[aria-label="本地文件夹"]').fill(plainDir);
  check((await errorRow.count()) === 0, '编辑路径后陈旧错误行即撤');

  await page.getByRole('button', { name: '创建项目' }).click();
  await errorRow.waitFor({ state: 'visible', timeout: 8000 });
  const errText2 = await errorRow.textContent();
  payloads.errorNotGit = { errText2, url: page.url() };
  check(errText2 === '不是 git 仓库', `400 非 git 目录 → 错误行「不是 git 仓库」(实际「${errText2}」)`);
  await shot('05-error-not-git.png');

  await gotoNew();
  await selectRow('本地文件夹');
  await page.locator('input[aria-label="本地文件夹"]').fill(gitRepo);
  check(
    (await nameValue()) === repoBase,
    `成功链前置:名称自动回填「${repoBase}」`,
  );
  await page.getByRole('button', { name: '创建项目' }).click();
  await waitProjectUrl();
  await shot('06-created-local-project.png');
  const localUrl = page.url();
  const listA = await getJson(`${API}/api/projects`);
  const localRow = listA.find((p) => p.name === repoBase);
  payloads.localProject = { url: localUrl, record: localRow ?? null };
  check(
    localRow?.repoKind === 'local' && localRow?.localPath === gitRepo,
    `local 创建链:导航 ${localUrl} + record repoKind=local + localPath 原值`,
  );
  const dbLocal = dbQuery((db) => ({
    row: db
      .prepare('SELECT repoKind, localPath FROM project WHERE id = ?')
      .get(String(localRow?.id)),
  }));
  payloads.sqliteLocal = dbLocal;
  check(
    dbLocal.ok && dbLocal.row?.repoKind === 'local' && dbLocal.row?.localPath === gitRepo,
    `SQLite:local 项目行 repoKind/localPath 落库(${JSON.stringify(dbLocal.row ?? dbLocal)})`,
  );

  await gotoNew();
  await selectRow('GitHub 仓库');
  await page.getByRole('button', { name: '手动输入 owner/repo' }).click();
  await page.locator('input[aria-label="GitHub 仓库"]').fill('xiechimon/cairn');
  await page.getByRole('button', { name: '创建项目' }).click();
  await waitProjectUrl();
  const listB = await getJson(`${API}/api/projects`);
  const ghRow = listB.find((p) => p.name === 'cairn');
  payloads.githubProject = { url: page.url(), record: ghRow ?? null };
  check(
    ghRow?.repoKind === 'github' && ghRow?.githubRepo === 'xiechimon/cairn',
    `github 创建链:record repoKind=github + githubRepo 落库(实际 ${JSON.stringify(ghRow ?? null)})`,
  );

  await gotoNew();
  const untouchedName = `verify-untouched-${Date.now() % 100000}`;
  await page.locator('#prj-new-name').fill(untouchedName);
  await page.getByRole('button', { name: '创建项目' }).click();
  await waitProjectUrl();
  const listC = await getJson(`${API}/api/projects`);
  const bareRow = listC.find((p) => p.name === untouchedName);
  payloads.untouchedProject = { url: page.url(), record: bareRow ?? null };
  check(
    bareRow != null && bareRow.repoKind == null,
    `未选形态:hosted 默认已移除,创建 = 无 repo 项目(repoKind ${JSON.stringify(bareRow?.repoKind)})`,
  );
  const dbBare = dbQuery((db) => ({
    row: db.prepare('SELECT repoKind FROM project WHERE id = ?').get(String(bareRow?.id)),
  }));
  payloads.sqliteUntouched = dbBare;
  check(
    dbBare.ok && dbBare.row?.repoKind === null,
    `SQLite:未选形态行 repoKind NULL(${JSON.stringify(dbBare.row ?? dbBare)})`,
  );
} catch (err) {
  check(false, `probe 异常:${String(err?.message ?? err)}`);

  try {
    payloads.crashDom = await page.evaluate(() => ({
      url: location.href,
      repoField: document.querySelector('.prj-new-repo-field')?.innerHTML.slice(0, 600) ?? null,
      inputs: [...document.querySelectorAll('input')].map((i) => i.getAttribute('aria-label') ?? i.id),
      ghError: document.querySelector('.prj-new-gh-error')?.textContent ?? null,
      prjError: document.querySelector('.prj-new-error')?.textContent ?? null,
    }));
  } catch (dumpErr) {
    payloads.crashDomError = String(dumpErr?.message ?? dumpErr);
  }
  try {
    await shot('99-crash.png');
  } catch {}
} finally {
  await browser.close();
  for (const dir of props) rmSync(dir, { recursive: true, force: true });
}

const result = {
  probe: 'project-new-form',
  ticket: 360,
  at: new Date().toISOString(),
  checks,
  artifacts,
  stack: { api: API, web: WEB, homeDir: stack.homeDir, root: stack.root },
};
writeFileSync(join(EVIDENCE, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
writeFileSync(join(EVIDENCE, 'responses.json'), `${JSON.stringify(payloads, null, 2)}\n`);
console.log(`\n${checks.length - failures}/${checks.length} PASS`);
console.log(`evidence:${EVIDENCE}`);
process.exit(failures === 0 ? 0 : 1);
