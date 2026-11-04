#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ??
  join(SCRIPT_ROOT, '.claude', 'verify-evidence', `${stamp}-1097-folder-drill`);
mkdirSync(EVIDENCE, { recursive: true });

const checks = [];
const artifacts = [];
let failures = 0;
const check = (ok, label) => {
  checks.push({ ok, label });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures += 1;
};

const payloads = {};
async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'verify-1097',
  GIT_AUTHOR_EMAIL: 'verify@local',
  GIT_COMMITTER_NAME: 'verify-1097',
  GIT_COMMITTER_EMAIL: 'verify@local',
};
const git = (args, cwd) => execFileSync('git', args, { cwd, env: GIT_ENV, stdio: 'pipe' });

const MARK_ROOT = 'VERIFY-1097-ROOT-MARKER';
const MARK_DOCS = 'VERIFY-1097-DOCS-MARKER';
const MARK_SETUP = 'VERIFY-1097-SETUP-MARKER';
const MARK_DEEP = 'VERIFY-1097-DEEP-MARKER';
function writeNested(dir) {
  mkdirSync(join(dir, 'docs', 'guide'), { recursive: true });
  writeFileSync(join(dir, 'README.md'), `# verify-1097 root\n\n${MARK_ROOT}\n`);
  writeFileSync(join(dir, 'docs', 'README.md'), `# verify-1097 docs\n\n${MARK_DOCS}\n`);
  writeFileSync(join(dir, 'docs', 'setup.md'), `# verify-1097 setup\n\n${MARK_SETUP}\n`);
  writeFileSync(join(dir, 'docs', 'guide', 'deep.md'), `# verify-1097 deep\n\n${MARK_DEEP}\n`);
}

const props = [];
function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  props.push(dir);
  return dir;
}

const localRepo = tempDir('verify-1097-local-');
git(['init', '-b', 'trunk', localRepo]);
writeNested(localRepo);
git(['add', '.'], localRepo);
git(['commit', '-m', 'init verify-1097 nested local'], localRepo);

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 732 },
  colorScheme: 'dark',
});

const fileRequests = [];
page.on('request', (req) => {
  const u = req.url();
  if (u.includes('/api/projects/') && u.includes('/file?')) fileRequests.push(u);
});

const shot = async (name) => {
  await page.screenshot({ path: join(EVIDENCE, name) });
  artifacts.push(name);
  console.log(`shot  ${name}`);
};

const folderRow = (name) => page.locator('[data-tree-entry="folder"]').filter({ hasText: name });
const fileRow = (name) => page.locator('[data-tree-entry="file"]').filter({ hasText: name });

try {

  const rHosted = await api('POST', '/api/projects', {
    name: 'verify-1097-hosted',
    repoKind: 'hosted',
  });
  payloads.hostedProjectCreated = rHosted;
  const hostedId = rHosted.json?.id;
  check(
    rHosted.status === 201 && typeof hostedId === 'string',
    `REST:repoKind=hosted 项目 201(实际 ${rHosted.status})`,
  );

  const rLocal = await api('POST', '/api/projects', {
    name: 'verify-1097-local',
    kind: 'local',
    localPath: localRepo,
  });
  payloads.localProjectCreated = rLocal;
  const localId = rLocal.json?.id;
  check(
    rLocal.status === 201 && typeof localId === 'string',
    `REST:kind=local 项目 201(实际 ${rLocal.status})`,
  );

  const teamId = rHosted.json?.teamId;
  const rKey = await api('POST', `/api/teams/${teamId}/api-keys`, {
    name: 'verify-1097-push',
    gitAccess: true,
    mcpAccess: false,
    toolGrants: { read: [], write: [] },
  });
  payloads.apiKeyCreated = { status: rKey.status, masked: rKey.json?.masked };
  const apiKey = rKey.json?.plaintext;
  check(
    rKey.status === 201 && typeof apiKey === 'string',
    `REST:git push 用 API key 创建 201(实际 ${rKey.status})`,
  );

  const cloneUrl = new URL(rHosted.json?.cloneUrl ?? '');
  cloneUrl.username = 'git';
  cloneUrl.password = apiKey;
  const hostedClone = tempDir('verify-1097-hosted-clone-');
  git(['clone', cloneUrl.toString(), hostedClone], hostedClone);
  writeNested(hostedClone);
  git(['add', '.'], hostedClone);
  git(['commit', '-m', 'docs: nested verify-1097 content'], hostedClone);
  git(['push', '-u', 'origin', 'main'], hostedClone);

  const topTree = await api('GET', `/api/projects/${hostedId}/tree?ref=main`);
  payloads.hostedTreeTop = topTree;
  check(
    topTree.status === 200 &&
      topTree.json?.path === '' &&
      topTree.json?.entries?.some((e) => e.path === 'docs' && e.type === 'tree') &&
      topTree.json?.entries?.some((e) => e.path === 'README.md' && e.type === 'blob'),
    `REST:hosted tree 顶层含 docs(tree)+README.md(blob)(实际 ${topTree.status})`,
  );
  const docsTree = await api('GET', `/api/projects/${hostedId}/tree?ref=main&path=docs`);
  payloads.hostedTreeDocs = docsTree;
  const docsPaths = (docsTree.json?.entries ?? []).map((e) => e.path).sort();
  check(
    docsTree.status === 200 &&
      docsTree.json?.path === 'docs' &&
      JSON.stringify(docsPaths) ===
        JSON.stringify(['docs/README.md', 'docs/guide', 'docs/setup.md']),
    `REST:hosted tree?path=docs → docs 单层 + path 回显(实际 ${docsTree.status} ${JSON.stringify(docsPaths)})`,
  );
  const guideTree = await api(
    'GET',
    `/api/projects/${hostedId}/tree?ref=main&path=${encodeURIComponent('docs/guide')}`,
  );
  payloads.hostedTreeGuide = guideTree;
  check(
    guideTree.status === 200 &&
      guideTree.json?.path === 'docs/guide' &&
      (guideTree.json?.entries ?? []).length === 1 &&
      guideTree.json?.entries?.[0]?.path === 'docs/guide/deep.md',
    `REST:hosted tree?path=docs/guide → 3 层可下钻(实际 ${guideTree.status})`,
  );
  const docsReadme = await api(
    'GET',
    `/api/projects/${hostedId}/file?ref=main&path=${encodeURIComponent('docs/README.md')}`,
  );
  payloads.hostedFileDocsReadme = docsReadme;
  check(
    docsReadme.status === 200 && String(docsReadme.json?.content ?? '').includes(MARK_DOCS),
    `REST:hosted file?path=docs/README.md 读回 docs 标记(实际 ${docsReadme.status})`,
  );

  await page.goto(`${WEB}/app/project/${hostedId}`);
  await fileRow('README.md').first().waitFor({ timeout: 20_000 });
  const docsFolder = folderRow('docs');
  check(await docsFolder.isVisible(), '浏览器:hosted 顶层 docs 文件夹行在(data-tree-entry=folder)');
  const folderD = await docsFolder.locator('svg path').first().getAttribute('d');
  const fileD = await fileRow('README.md').first().locator('svg path').first().getAttribute('d');
  check(
    Boolean(folderD) && Boolean(fileD) && folderD !== fileD,
    '浏览器:文件夹图标与文件图标不同形(非仅颜色区分)',
  );
  await shot('H1-hosted-top-level.png');

  fileRequests.length = 0;
  await docsFolder.click();
  await fileRow('setup.md').waitFor({ timeout: 15_000 });
  const noFailCopy = (await page.getByText('文件加载失败').count()) === 0;
  const noFileFetch = fileRequests.length === 0;
  check(
    noFailCopy && noFileFetch,
    `浏览器:点文件夹 → 下钻列出内容,无「文件加载失败」、零文件读请求(实际 file 请求 ${fileRequests.length})`,
  );
  const nav = page.getByRole('navigation', { name: '目录导航' });
  const crumbCurrent = nav.getByText('docs', { exact: true });
  check(
    (await nav.isVisible()) && (await crumbCurrent.getAttribute('aria-current')) === 'location',
    '浏览器:面包屑在位 + 当前段 docs 有 aria-current=location 回显',
  );
  await shot('H2-hosted-docs-drill.png');

  await fileRow('README.md').first().click();
  await page.getByText(MARK_DOCS).waitFor({ timeout: 15_000 });
  check(true, '浏览器:docs/README.md → 查看器出 docs 标记内容');
  await shot('H3-hosted-docs-readme-viewer.png');

  await nav.getByRole('button', { name: '根目录' }).click();
  await fileRow('README.md').first().waitFor({ timeout: 15_000 });
  const backAtTop = (await folderRow('docs').isVisible()) && (await nav.count()) === 0;
  check(backAtTop, '浏览器:面包屑根段 → 回顶层(文件夹行复位,面包屑隐去)');

  const rootReadme = page.getByRole('button', { name: 'README.md', exact: true });
  await rootReadme.click();
  await page.getByText(MARK_ROOT).waitFor({ timeout: 15_000 });
  check(
    (await rootReadme.getAttribute('aria-current')) === 'true',
    '浏览器:根 README.md → 查看器出根标记 + aria-current 选中态(既有行为零回归)',
  );

  await folderRow('docs').click();
  await fileRow('setup.md').waitFor({ timeout: 15_000 });
  await fileRow('README.md').first().click();
  await page.getByText(MARK_DOCS).waitFor({ timeout: 15_000 });
  await nav.getByRole('button', { name: '根目录' }).click();
  await fileRow('README.md').first().waitFor({ timeout: 15_000 });
  const rootNotCurrent = (await rootReadme.getAttribute('aria-current')) !== 'true';
  const stillDocs =
    (await page.getByText(MARK_DOCS).count()) > 0 && (await page.getByText(MARK_ROOT).count()) === 0;
  check(
    rootNotCurrent && stillDocs,
    '浏览器:同名 README.md 跨目录选中/预览按完整路径分流不串',
  );
  await shot('H4-hosted-samename-no-cross.png');

  await folderRow('docs').click();
  await fileRow('setup.md').waitFor({ timeout: 15_000 });
  await folderRow('guide').click();
  await fileRow('deep.md').waitFor({ timeout: 15_000 });
  const deepCrumbs = await nav.locator('button, [aria-current="location"]').allTextContents();
  check(
    (await fileRow('deep.md').isVisible()) &&
      deepCrumbs.map((s) => s.trim()).join('/') === '根目录/docs/guide',
    `浏览器:3 层下钻 deep.md 在屏 + 面包屑段齐(实际 ${deepCrumbs.map((s) => s.trim()).join('/')})`,
  );
  await shot('H5-hosted-deep-breadcrumb.png');
  await nav.getByRole('button', { name: 'docs', exact: true }).click();
  await fileRow('setup.md').waitFor({ timeout: 15_000 });
  check(true, '浏览器:面包屑中段 docs → 回中间层(setup.md 复位)');

  await page.goto(`${WEB}/app/project/${localId}`);
  await fileRow('README.md').first().waitFor({ timeout: 20_000 });
  const localChip = await page.locator('.prj-branch-chip').textContent();
  check(
    (localChip ?? '').trim() === 'HEAD' && (await folderRow('docs').isVisible()),
    `浏览器:local 顶层 chip=HEAD + docs 文件夹行在(实际 "${(localChip ?? '').trim()}")`,
  );
  await shot('L1-local-top-level.png');
  await folderRow('docs').click();
  await fileRow('setup.md').waitFor({ timeout: 15_000 });
  await fileRow('setup.md').click();
  await page.getByText(MARK_SETUP).waitFor({ timeout: 15_000 });
  check(true, '浏览器:local 下钻 docs → setup.md → 查看器出 setup 标记');
  await shot('L2-local-drill-viewer.png');

  try {
    const requireServer = createRequire(join(ROOT, 'apps', 'server', 'package.json'));
    const Database = requireServer('better-sqlite3');
    const db = new Database(DB_PATH, { readonly: true });
    try {
      const rowHosted = db
        .prepare('SELECT repoKind FROM project WHERE id = ?')
        .get(hostedId);
      const rowLocal = db.prepare('SELECT repoKind, localPath FROM project WHERE id = ?').get(localId);
      payloads.sqlite = { hostedProjectRow: rowHosted, localProjectRow: rowLocal };
      check(
        rowHosted?.repoKind === 'hosted' &&
          rowLocal?.repoKind === 'local' &&
          rowLocal?.localPath === localRepo,
        'SQLite:hosted/local 两项目行落库(repoKind/localPath)',
      );
    } finally {
      db.close();
    }
  } catch (err) {
    check(false, `SQLite 只读真值失败:${String(err?.message ?? err)}`);
  }
} finally {
  await browser.close();
  for (const dir of props) rmSync(dir, { recursive: true, force: true });
}

const result = {
  probe: '1097-folder-drill',
  ticket: 1097,
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
