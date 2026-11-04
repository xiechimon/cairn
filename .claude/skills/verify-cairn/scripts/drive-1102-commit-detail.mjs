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
  join(SCRIPT_ROOT, '.claude', 'verify-evidence', `${stamp}-1102-commit-detail`);
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
  GIT_AUTHOR_NAME: 'verify-1102',
  GIT_AUTHOR_EMAIL: 'verify@local',
  GIT_COMMITTER_NAME: 'verify-1102',
  GIT_COMMITTER_EMAIL: 'verify@local',
};
const git = (args, cwd) => execFileSync('git', args, { cwd, env: GIT_ENV, stdio: 'pipe' });
const gitOut = (args, cwd) => git(args, cwd).toString('utf8').trim();

const props = [];
function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  props.push(dir);
  return dir;
}
const LOCAL_ROOT_MARKER = 'verify-1102 LOCAL-ROOT-MARKER';
const LOCAL_SECOND_MARKER = 'verify-1102 LOCAL-SECOND-MARKER';
const localRepo = tempDir('verify-1102-local-');
git(['init', '-b', 'trunk', localRepo]);
writeFileSync(join(localRepo, 'README.md'), `# verify-1102 local\n\n${LOCAL_ROOT_MARKER}\n`);
git(['add', '.'], localRepo);
git(['commit', '-m', 'init verify-1102 local'], localRepo);
writeFileSync(
  join(localRepo, 'README.md'),
  `# verify-1102 local\n\n${LOCAL_ROOT_MARKER}\n${LOCAL_SECOND_MARKER}\n`,
);
git(['commit', '-am', 'docs: append second marker'], localRepo);
const LOCAL_ROOT_SHA = gitOut(['rev-list', '--max-parents=0', 'HEAD'], localRepo);
const LOCAL_HEAD_SHA = gitOut(['rev-parse', 'HEAD'], localRepo);

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

const historyTab = () => page.getByRole('tab', { name: '历史', exact: true });
const historyRow = (message) => page.locator('.prj-history-row').filter({ hasText: message });
const pane = page.locator('[data-commit-detail="pane"]');

try {

  const rHosted = await api('POST', '/api/projects', {
    name: 'verify-1102-hosted',
    repoKind: 'hosted',
  });
  payloads.hostedProjectCreated = rHosted;
  const hostedId = rHosted.json?.id;
  check(
    rHosted.status === 201 && typeof hostedId === 'string',
    `REST:repoKind=hosted 项目 201(实际 ${rHosted.status})`,
  );

  const rLocal = await api('POST', '/api/projects', {
    name: 'verify-1102-local',
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
    name: 'verify-1102-push',
    gitAccess: true,
    mcpAccess: false,
    toolGrants: { read: [], write: [] },
  });
  const apiKey = rKey.json?.plaintext;
  check(
    rKey.status === 201 && typeof apiKey === 'string',
    `REST:git push 用 API key 创建 201(实际 ${rKey.status})`,
  );

  const HOSTED_MARKER = 'verify-1102 HOSTED-README-MARKER';
  const cloneUrl = new URL(rHosted.json?.cloneUrl ?? '');
  cloneUrl.username = 'git';
  cloneUrl.password = apiKey;
  const hostedClone = tempDir('verify-1102-hosted-clone-');
  git(['clone', cloneUrl.toString(), hostedClone], hostedClone);
  writeFileSync(join(hostedClone, 'README.md'), `# verify-1102 hosted\n\n${HOSTED_MARKER}\n`);
  git(['add', '.'], hostedClone);
  git(['commit', '-m', 'docs: hosted readme'], hostedClone);
  git(['checkout', '-b', 'side'], hostedClone);
  writeFileSync(join(hostedClone, 'side.txt'), 'SIDE-BRANCH-WORK\n');
  git(['add', '.'], hostedClone);
  git(['commit', '-m', 'side: add side.txt'], hostedClone);
  git(['checkout', 'main'], hostedClone);
  writeFileSync(join(hostedClone, 'another.txt'), 'MAIN-SIDE-WORK\n');
  git(['add', '.'], hostedClone);
  git(['commit', '-m', 'main: add another.txt'], hostedClone);
  git(['merge', '--no-ff', 'side', '-m', 'merge side into main'], hostedClone);
  git(['push', '-u', 'origin', 'main'], hostedClone);

  const hList = await api('GET', `/api/projects/${hostedId}/commits`);
  payloads.hostedCommits = hList;
  const rows = hList.json?.commits ?? [];
  const byMsg = Object.fromEntries(rows.map((c) => [c.message, c]));
  check(
    hList.status === 200 && rows.length === 5,
    `REST:hosted commits 列表 5 行(种子+README+side+another+merge;实际 ${rows.length})`,
  );

  const readmeRow = byMsg['docs: hosted readme'];
  const hReadme = await api('GET', `/api/projects/${hostedId}/commits/${readmeRow.sha}`);
  payloads.hostedDetailReadme = hReadme;
  const rd = hReadme.json ?? {};
  check(
    hReadme.status === 200 &&
      rd.sha === readmeRow.sha &&
      rd.shortSha === readmeRow.shortSha &&
      rd.message === readmeRow.message &&
      rd.authorName === readmeRow.authorName &&
      rd.at === readmeRow.at,
    `REST:详情元信息与列表行逐字段一致(sha/shortSha/message/authorName/at;实际 ${hReadme.status})`,
  );
  check(
    Array.isArray(rd.files) &&
      rd.files.length === 1 &&
      rd.files[0].path === 'README.md' &&
      rd.files[0].additions === 3 &&
      rd.files[0].hunks[0].lines.some((l) => l === `+${HOSTED_MARKER}`),
    'REST:普通提交 diff = README.md +3 含标记行(parseUnifiedDiff 真输出)',
  );

  const mergeRow = byMsg['merge side into main'];
  const hMerge = await api('GET', `/api/projects/${hostedId}/commits/${mergeRow.sha}`);
  payloads.hostedDetailMerge = hMerge;
  check(
    hMerge.status === 200 &&
      (hMerge.json?.files ?? []).map((f) => f.path).join(',') === 'side.txt',
    `REST:merge 提交 = 第一父 diff(side.txt 单文件;combined 恒空的反面钉;实际 ${JSON.stringify((hMerge.json?.files ?? []).map((f) => f.path))})`,
  );

  const seedRow = byMsg['init verify-1102-hosted'];
  const hSeed = await api('GET', `/api/projects/${hostedId}/commits/${seedRow.sha}`);
  payloads.hostedDetailSeed = hSeed;
  check(
    hSeed.status === 200 && Array.isArray(hSeed.json?.files) && hSeed.json.files.length === 0,
    `REST:种子提交(根、空树)= 200 + files[] 定义态(实际 ${hSeed.status}/${JSON.stringify(hSeed.json?.files)})`,
  );

  const hUnknown = await api('GET', `/api/projects/${hostedId}/commits/${'0'.repeat(40)}`);
  payloads.hostedDetailUnknownSha = hUnknown;
  check(hUnknown.status === 404, `REST:不可达 sha → 404(实际 ${hUnknown.status})`);
  const hInject = await api(
    'GET',
    `/api/projects/${hostedId}/commits/${encodeURIComponent('HEAD; echo hacked')}`,
  );
  payloads.hostedDetailInjection = hInject;
  check(hInject.status === 404, `REST:注入形 sha → 404 不 500(实际 ${hInject.status})`);

  await page.goto(`${WEB}/app/project/${hostedId}`);
  await historyTab().waitFor({ timeout: 30_000 });
  await historyTab().click();
  const readmeRowEl = historyRow('docs: hosted readme');
  await readmeRowEl.waitFor({ timeout: 20_000 });
  check((await page.locator('.prj-history-row').count()) === 5, '浏览器:hosted 历史 5 行在屏');
  await shot('H1-hosted-history-list.png');

  await readmeRowEl.click();
  await pane.waitFor({ timeout: 20_000 });
  await page.getByText(HOSTED_MARKER).waitFor({ timeout: 15_000 });
  check(
    (await page.locator('[data-commit-detail="message"]').textContent()) ===
      'docs: hosted readme',
    '浏览器:点行 → 详情面开,头带 message = 所点行标题',
  );
  const rowMeta = ((await readmeRowEl.locator('span.font-mono').textContent()) ?? '').trim();
  const headMeta = ((await page.locator('[data-commit-detail="meta"]').textContent()) ?? '').trim();
  check(
    rowMeta === headMeta && rowMeta.includes('verify-1102'),
    `浏览器:元信息与列表行一致(author · 相对时间 · shortSha 同文本;"${headMeta}")`,
  );
  const ariaSel = await readmeRowEl.getAttribute('aria-current');
  check(ariaSel === 'true', '浏览器:选中行 aria-current=true(#910 裁定 3 载体)');
  const addLine = pane.locator('[data-kind="add"]', { hasText: HOSTED_MARKER });
  check((await addLine.count()) === 1, '浏览器:diff 渲染 = 文件行 + 新增标记行(非空、非「加载失败」)');
  check(
    (await pane.locator('.doc-file-row', { hasText: 'README.md' }).count()) === 1,
    '浏览器:DiffFileBlock 文件行复用面在屏(doc-file-row)',
  );
  await shot('H2-hosted-readme-diff.png');

  await historyRow('merge side into main').click();
  await pane.locator('.doc-file-row', { hasText: 'side.txt' }).waitFor({ timeout: 15_000 });
  const readmeGone = (await pane.locator('.doc-file-row', { hasText: 'README.md' }).count()) === 0;
  check(readmeGone, '浏览器:切 merge 提交 → side.txt(第一父 diff),README 内容退场不串');
  await shot('H3-hosted-merge-first-parent.png');

  await historyRow('init verify-1102-hosted').click();
  await page.getByText('该提交没有可显示的改动。').waitFor({ timeout: 15_000 });
  check(true, '浏览器:种子空提交 → 「该提交没有可显示的改动。」定义态(不白屏不报错)');
  await shot('H4-hosted-seed-empty.png');

  await page.getByRole('button', { name: '关闭提交详情' }).click();
  await page.getByText('请选择一个提交查看').waitFor({ timeout: 15_000 });
  check(
    (await page.locator('[data-commit-detail="pane"]').count()) === 0 &&
      (await readmeRowEl.getAttribute('aria-current')) === null,
    '浏览器:关闭钮清选中 → 占位还原,行 aria-current 撤回',
  );

  const lRoot = await api('GET', `/api/projects/${localId}/commits/${LOCAL_ROOT_SHA}`);
  payloads.localDetailRoot = lRoot;
  check(
    lRoot.status === 200 &&
      (lRoot.json?.files ?? []).length === 1 &&
      lRoot.json.files[0].path === 'README.md' &&
      lRoot.json.files[0].additions === 3 &&
      lRoot.json.files[0].deletions === 0,
    `REST:local 根提交(无父)= 相对空树全文件新增 +3/-0(实际 ${lRoot.status})`,
  );
  const lHead = await api('GET', `/api/projects/${localId}/commits/${LOCAL_HEAD_SHA}`);
  payloads.localDetailHead = lHead;
  check(
    lHead.status === 200 &&
      lHead.json?.files?.[0]?.additions === 1 &&
      lHead.json.files[0].hunks[0].lines.some((l) => l === `+${LOCAL_SECOND_MARKER}`),
    'REST:local 二次提交 = 增量 +1 含第二标记行',
  );

  await page.goto(`${WEB}/app/project/${localId}`);
  await historyTab().waitFor({ timeout: 30_000 });
  await historyTab().click();
  const localRootRow = historyRow('init verify-1102 local');
  await localRootRow.waitFor({ timeout: 20_000 });
  await localRootRow.click();
  await page.getByText(LOCAL_ROOT_MARKER).waitFor({ timeout: 15_000 });
  const delCount = await pane.locator('[data-kind="del"]').count();
  check(
    (await page.locator('[data-commit-detail="message"]').textContent()) ===
      'init verify-1102 local' && delCount === 0,
    '浏览器:local 根提交详情 = 全新增(标记行在屏、零删行)',
  );
  await shot('L1-local-root-commit.png');

  rmSync(localRepo, { recursive: true, force: true });
  const dDetail = await api('GET', `/api/projects/${localId}/commits/${LOCAL_ROOT_SHA}`);
  payloads.degradedDetail404 = dDetail;
  check(
    dDetail.status === 404 && dDetail.json?.reason === 'not_found',
    `REST:删仓后详情面 → 404 + reason=not_found(不 500 不空树;实际 ${dDetail.status}/${JSON.stringify(dDetail.json?.reason)})`,
  );
  await page.goto(`${WEB}/app/project/${localId}`);
  await page.getByText('本地仓库当前无法读取。').waitFor({ timeout: 30_000 });
  const reasonLine = page.getByText('路径不存在', { exact: true });
  await reasonLine.waitFor({ timeout: 10_000 });
  check(
    (await historyTab().count()) === 0,
    '浏览器:删仓 reload → 整 pane 人话降级(主行 + reason 分译),历史面同闸不渲染假行',
  );
  await shot('D1-local-unreachable-degradation.png');

  try {
    const requireServer = createRequire(join(ROOT, 'apps', 'server', 'package.json'));
    const Database = requireServer('better-sqlite3');
    const db = new Database(DB_PATH, { readonly: true });
    try {
      const rowHosted = db
        .prepare('SELECT repoKind, repoName FROM project WHERE id = ?')
        .get(hostedId);
      const rowLocal = db.prepare('SELECT repoKind, localPath FROM project WHERE id = ?').get(localId);
      payloads.sqlite = { hostedProjectRow: rowHosted, localProjectRow: rowLocal };
      check(
        rowHosted?.repoKind === 'hosted' && rowLocal?.repoKind === 'local',
        'SQLite:双项目行 repoKind 落库(hosted + local)',
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
  probe: '1102-commit-detail',
  ticket: 1102,
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
