#!/usr/bin/env node
// verify-cairn probe — #1030 local 项目 Files tab 开闸(推翻 spec 12 out-of-scope):
// 三相位真用户路径取证(live 栈 + 真浏览器,URL 不带 ?scenario=):
//   A local 可读:真 git 工作树仓(默认分支 trunk,非 main——钉「local 默认分支
//     任意,web 不硬编码 ref」的根因面)→ 项目页 Files tab 开闸、文件行/查看器/
//     历史 seg 全链;分支 chip = HEAD 回显。
//   B hosted 对照零回归:托管 bare repo push 真 README 后同页面链路(chip='main')。
//   C local 不可达降级:删仓目录 → 页面出人话降级文案(主行 + reason 分译行),
//     不空树不 500;API 侧 404 + reason=not_found。
// REST 侧真值:tree/file/branches/commits/files 五读面 JSON(可达 + 不可达双态)
// 落 responses.json;SQLite project 行(repoKind/localPath)。栈必须已在跑
// (launch.mjs;坐标取 VERIFY_RUN_DIR/ports.json,worktree 车道传 VERIFY_REPO_ROOT)。
// 证据(result.json + responses.json + 截图)落 VERIFY_EVIDENCE_DIR;交付见
// SKILL.md「证据归档纪律」。任一断言失败退出码 1。
// 运行前置:proxy env 全 unset(回环请求过代理会 502 假阳性)。

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
  join(SCRIPT_ROOT, '.claude', 'verify-evidence', `${stamp}-1030-local-files`);
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

// git 隔离环境(git-hosting.test.ts 同款:防用户 git 配置/凭证干扰)
const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'verify-1030',
  GIT_AUTHOR_EMAIL: 'verify@local',
  GIT_COMMITTER_NAME: 'verify-1030',
  GIT_COMMITTER_EMAIL: 'verify@local',
};
const git = (args, cwd) => execFileSync('git', args, { cwd, env: GIT_ENV, stdio: 'pipe' });

// —— 道具:local 真仓(默认分支 trunk + README 标记行)————————————
const props = [];
function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  props.push(dir);
  return dir;
}
const LOCAL_README_MARKER = 'verify-1030 local repo marker line';
const localRepo = tempDir('verify-1030-local-');
git(['init', '-b', 'trunk', localRepo]);
writeFileSync(join(localRepo, 'README.md'), `# verify-1030\n\n${LOCAL_README_MARKER}\n`);
git(['add', '.'], localRepo);
git(['commit', '-m', 'init verify-1030 local'], localRepo);

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

try {
  // —— REST 铺底:local + hosted 项目 + git push 凭证 —————————————————
  const rLocal = await api('POST', '/api/projects', {
    name: 'verify-1030-local',
    kind: 'local',
    localPath: localRepo,
  });
  payloads.localProjectCreated = rLocal;
  const localId = rLocal.json?.id;
  check(
    rLocal.status === 201 && typeof localId === 'string',
    `REST:kind=local 项目 201(实际 ${rLocal.status})`,
  );

  const rHosted = await api('POST', '/api/projects', {
    name: 'verify-1030-hosted',
    repoKind: 'hosted',
  });
  payloads.hostedProjectCreated = rHosted;
  const hostedId = rHosted.json?.id;
  check(
    rHosted.status === 201 && typeof hostedId === 'string',
    `REST:repoKind=hosted 项目 201(实际 ${rHosted.status})`,
  );

  const teamId = rHosted.json?.teamId;
  const rKey = await api('POST', `/api/teams/${teamId}/api-keys`, {
    name: 'verify-1030-push',
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

  // hosted bare repo push 真 README(cloneUrl origin = 请求源,与本栈同源)
  const cloneUrl = new URL(rHosted.json?.cloneUrl ?? '');
  cloneUrl.username = 'git';
  cloneUrl.password = apiKey;
  const hostedClone = tempDir('verify-1030-hosted-clone-');
  git(['clone', cloneUrl.toString(), hostedClone], hostedClone);
  writeFileSync(join(hostedClone, 'README.md'), '# verify-1030 hosted\n\nhosted README body\n');
  git(['add', '.'], hostedClone);
  git(['commit', '-m', 'docs: hosted readme'], hostedClone);
  git(['push', '-u', 'origin', 'main'], hostedClone);

  // —— REST 真值:local 五读面(可达态)———————————————————————
  const localTree = await api('GET', `/api/projects/${localId}/tree`);
  payloads.localTree = localTree;
  check(
    localTree.status === 200 &&
      localTree.json?.ref === 'HEAD' &&
      /^[0-9a-f]{40}$/.test(String(localTree.json?.commit ?? '')) &&
      localTree.json?.entries?.some(
        (e) => e.path === 'README.md' && e.type === 'blob' && e.size > 0,
      ),
    `REST:local tree 无 ref → HEAD 解析 + README.md blob(实际 ${localTree.status})`,
  );
  const localFile = await api('GET', `/api/projects/${localId}/file?path=README.md`);
  payloads.localFile = localFile;
  check(
    localFile.status === 200 &&
      localFile.json?.encoding === 'utf-8' &&
      String(localFile.json?.content ?? '').includes(LOCAL_README_MARKER),
    `REST:local file 读回标记行(实际 ${localFile.status})`,
  );
  const localBranches = await api('GET', `/api/projects/${localId}/branches`);
  payloads.localBranches = localBranches;
  check(
    localBranches.status === 200 && localBranches.json?.defaultBranch === 'trunk',
    `REST:local branches defaultBranch=trunk(实际 ${JSON.stringify(localBranches.json?.defaultBranch)})`,
  );
  const localCommits = await api('GET', `/api/projects/${localId}/commits`);
  payloads.localCommits = localCommits;
  check(
    localCommits.status === 200 &&
      localCommits.json?.ref === 'trunk' &&
      localCommits.json?.commits?.[0]?.message === 'init verify-1030 local',
    `REST:local commits ref=trunk + 提交行(实际 ${localCommits.status})`,
  );
  const localFiles = await api('GET', `/api/projects/${localId}/files`);
  payloads.localFiles = localFiles;
  check(
    localFiles.status === 200 && localFiles.json?.files?.some((f) => f.path === 'README.md'),
    `REST:local files(@ 候选面)全递归含 README.md(实际 ${localFiles.status})`,
  );

  // —— A. 浏览器:local 项目 Files tab ——————————————————————————
  await page.goto(`${WEB}/app/project/${localId}`);
  const filesTab = page.getByRole('banner').getByRole('tab', { name: '文件' });
  await filesTab.waitFor({ timeout: 20_000 });
  const tabEnabled = await filesTab.isEnabled();
  check(tabEnabled, '浏览器:local 项目 files tab 钮 enabled(开闸,非 disabled)');
  const oldDisableGone = (await page.getByText('本地仓库项目暂不支持在线浏览文件').count()) === 0;
  check(oldDisableGone, '浏览器:旧 disable 占位文案退役');

  const row = page.getByRole('button', { name: 'README.md', exact: true });
  await row.waitFor({ timeout: 20_000 });
  check(true, '浏览器:FilesPane 渲染 + README.md 文件行在');
  // 分支 chip = tree ref 回显(HEAD),非硬编码 main
  const chip = await page.locator('.prj-branch-chip').textContent();
  check(
    (chip ?? '').trim() === 'HEAD',
    `浏览器:分支 chip = HEAD 回显(实际 "${(chip ?? '').trim()}")`,
  );
  await shot('A1-local-files-tab.png');

  await row.click();
  await page.getByText(LOCAL_README_MARKER).waitFor({ timeout: 15_000 });
  await shot('A2-local-file-viewer.png');
  check(true, '浏览器:点文件行 → 查看器出 README 内容(标记行在屏)');

  await page.getByRole('tab', { name: '历史', exact: true }).click();
  await page.getByText('init verify-1030 local').waitFor({ timeout: 15_000 });
  await shot('A3-local-history.png');
  check(true, '浏览器:历史 seg → 提交行在屏');

  // —— B. 浏览器:hosted 对照零回归 ———————————————————————————
  await page.goto(`${WEB}/app/project/${hostedId}`);
  const hostedRow = page.getByRole('button', { name: 'README.md', exact: true });
  await hostedRow.waitFor({ timeout: 20_000 });
  const hostedChip = await page.locator('.prj-branch-chip').textContent();
  check(
    (hostedChip ?? '').trim() === 'main',
    `浏览器:hosted 对照 chip = main(实际 "${(hostedChip ?? '').trim()}")`,
  );
  await hostedRow.click();
  await page.getByText('hosted README body').waitFor({ timeout: 15_000 });
  await shot('B1-hosted-files-zero-regression.png');
  check(true, '浏览器: hosted 文件行 + 查看器内容(push 后真 README)');

  // —— C. local 不可达降级(删目录)————————————————————————————
  rmSync(localRepo, { recursive: true, force: true });
  await page.goto(`${WEB}/app/project/${localId}`);
  await page.getByText('本地仓库当前无法读取。').waitFor({ timeout: 30_000 });
  const reasonLine = page.getByText('路径不存在', { exact: true });
  await reasonLine.waitFor({ timeout: 10_000 });
  await shot('C1-local-unreachable-degradation.png');
  check(true, '浏览器:删仓后 reload → 主行「本地仓库当前无法读取。」+ reason 分译「路径不存在」');
  const paneGone = (await page.getByRole('tab', { name: '历史', exact: true }).count()) === 0;
  check(paneGone, '浏览器:降级态不渲染 FilesPane(不空树、无历史假面)');

  const degradedTree = await api('GET', `/api/projects/${localId}/tree`);
  payloads.degradedTree404 = degradedTree;
  check(
    degradedTree.status === 404 && degradedTree.json?.reason === 'not_found',
    `REST:删仓后 tree → 404 + reason=not_found(实际 ${degradedTree.status}/${JSON.stringify(degradedTree.json?.reason)})`,
  );

  // —— SQLite 只读真值 ————————————————————————————————————
  try {
    const requireServer = createRequire(join(ROOT, 'apps', 'server', 'package.json'));
    const Database = requireServer('better-sqlite3');
    const db = new Database(DB_PATH, { readonly: true });
    try {
      const rowLocal = db
        .prepare('SELECT repoKind, localPath FROM project WHERE id = ?')
        .get(localId);
      payloads.sqlite = { localProjectRow: rowLocal };
      check(
        rowLocal?.repoKind === 'local' && rowLocal?.localPath === localRepo,
        'SQLite:local 项目行 repoKind/localPath 落库',
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
  probe: '1030-local-files',
  ticket: 1030,
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
