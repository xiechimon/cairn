#!/usr/bin/env node
// verify-pacman probe — #1170（技能导入通道：localPath + GitHub URL + refresh
// 重拉）live 面证据。
//
// 取证六面：
//   A. localPath 导入（真用户路径——web 技能页 topbar「导入」开弹窗、填路径、
//      提交）：列表即现 + REST 读面（record/文件内容对拍）+ 盘上文件集 +
//      来源记录 skill-sources.json（kind/ref/importedAt）。
//   B. GitHub URL 导入（真 anthropics/skills 子目录 skills/pdf——12 文件纯文本
//      目录）：列表即现 + 文件清单对拍（12 个文件）+ 来源记录 canonical URL。
//   C. refresh：C1 手建技能（直接落目录，无来源记录）→ 409 说明；C2 本地源
//      改内容 → refresh → 200、id 不变、盘上内容更新；C3 machine-wire 物化
//      清单（假机器 REST：apiKey → enroll → agent 白名单 → build → claim →
//      manifest）含导入技能 + C4 源再改 → refresh → 同 id 新 sha256（#920 接力
//      ——新 digest 视图的根因）；C5 skill_audit 审计行（create/import +
//      update/refresh，SQLite 只读）。
//   D. 红态面（真拒绝，非模拟）：SSRF 逐形（http://127.0.0.1、私网段、
//      非 GitHub host）、localPath 落技能根内、二进制文件、超单文件上限——
//      全部 400 且消息点名根因；另取一张 UI 错误态截图（弹窗内联错误行 +
//      server 原文 detail）。
//
// 栈必须已在跑（launch.mjs；坐标取 VERIFY_RUN_DIR/ports.json）。证据落
// VERIFY_EVIDENCE_DIR；任一断言失败退出码 1。
// 运行前置：proxy env 全 unset（回环请求过代理会 502 假阳性）；URL 导入
// 依赖 server 直连 api.github.com / raw.githubusercontent.com（Node fetch
// 不吃 proxy env——launch 形态即直连）。
// 注：B 相位打真实 GitHub（票面验收口径「从一个 GitHub 公共技能仓用 url
// 导入」）——树/文件拉取共 14 次出站请求，网络抖动时重跑本脚本即可。

import { createRequire } from 'node:module';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SCRIPT_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const ROOT = process.env.VERIFY_REPO_ROOT ? resolve(process.env.VERIFY_REPO_ROOT) : SCRIPT_ROOT;
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
const HOME = stack.homeDir;
const SKILLS_DIR = join(HOME, 'skills');
const SOURCES_PATH = join(HOME, 'server', 'skill-sources.json');
const DB_PATH = join(HOME, 'server', 'server.db');

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ??
  join(SCRIPT_ROOT, '.claude', 'verify-evidence', `${stamp}-1170-skill-import`);
mkdirSync(EVIDENCE, { recursive: true });

const checks = [];
let failures = 0;
const check = (ok, label, detail) => {
  checks.push({ ok, label, detail: detail ?? null });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail != null ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const j = (path, body, method = 'POST', token) => {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
};

const saveJson = (name, data) => {
  writeFileSync(join(EVIDENCE, name), `${JSON.stringify(data, null, 2)}\n`);
};

// —— 源目录组装（技能根外的 scratch 位置）———————————————————————————

const SRC = join(RUN_DIR, 'import-src');
rmSync(SRC, { recursive: true, force: true });
mkdirSync(join(SRC, 'my-live-skill', 'scripts'), { recursive: true });
const MY_SKILL_MD =
  '---\nname: my-live-skill\ndescription: live 栈导入的本地技能 v1\n---\n# my-live-skill\n\nv1 正文\n';
writeFileSync(join(SRC, 'my-live-skill', 'SKILL.md'), MY_SKILL_MD);
writeFileSync(join(SRC, 'my-live-skill', 'helper.md'), 'helper v1\n');
writeFileSync(join(SRC, 'my-live-skill', 'scripts', 'run.sh'), 'echo v1\n');

// 红态源：二进制 + 超限。
mkdirSync(join(SRC, 'bin-src'), { recursive: true });
writeFileSync(join(SRC, 'bin-src', 'SKILL.md'), '---\nname: bin-src\ndescription: d\n---\n');
writeFileSync(join(SRC, 'bin-src', 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe]));
mkdirSync(join(SRC, 'big-src'), { recursive: true });
writeFileSync(join(SRC, 'big-src', 'SKILL.md'), '---\nname: big-src\ndescription: d\n---\n');
writeFileSync(join(SRC, 'big-src', 'big.txt'), 'x'.repeat(512_001));

// —— 相位驱动 ————————————————————————————————————————————————

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 732 } });
try {
  const teams = (await (await j('/api/teams', undefined, 'GET')).json())[0];
  const TEAM = teams.id;
  const rows = () => j(`/api/skills?teamId=${TEAM}`, undefined, 'GET').then((r) => r.json());
  const importApi = (body) => j(`/api/teams/${TEAM}/skills/import`, body);
  const refreshApi = (sid) => j(`/api/teams/${TEAM}/skills/${sid}/refresh`, {});
  const detailApi = (sid) =>
    j(`/api/teams/${TEAM}/skills/${encodeURIComponent(sid)}`, undefined, 'GET').then((r) => r.json());

  // —— A. localPath 导入（web 真用户路径）——
  await page.goto(`${WEB}/app/resources/skills`);
  await page.getByTestId('resource-empty').waitFor({ state: 'visible' });
  await page.getByTestId('resource-import').click();
  const dlg = page.getByRole('dialog', { name: '导入技能' });
  await dlg.locator('#dlg-skill-import-path').waitFor({ state: 'visible' });
  check(true, 'A2 导入弹窗开（topbar 钮，空态同样可达）');
  await dlg.locator('#dlg-skill-import-path').fill(join(SRC, 'my-live-skill'));
  await dlg.getByRole('button', { name: '导入', exact: true }).click();
  await dlg.waitFor({ state: 'hidden', timeout: 20_000 });
  check(true, 'A3 提交后弹窗关');

  const rowsA = await rows();
  const mine = rowsA.find((r) => r.id === 'my-live-skill');
  check(mine != null, 'A4 列表含导入技能（REST 读面）', mine ? `id=${mine.id} desc=${mine.description}` : 'missing');
  check(mine?.description === 'live 栈导入的本地技能 v1', 'A5 record 对拍（description）');

  const detailA = await detailApi('my-live-skill');
  const fileNames = detailA.fileNames.map(String).sort();
  check(
    fileNames.join(',') === 'SKILL.md,helper.md,scripts/run.sh',
    'A6 文件清单对拍（SKILL.md + helper.md + scripts/run.sh）',
    fileNames.join(','),
  );
  const helper = await (
    await j(`/api/teams/${TEAM}/skills/my-live-skill/file?fileName=helper.md`, undefined, 'GET')
  ).json();
  check(helper.content === 'helper v1\n', 'A7 文件内容对拍（helper.md 经 /file 读面）');

  const onDisk = readdirSync(join(SKILLS_DIR, 'my-live-skill'), { recursive: true }).map(String).sort();
  check(onDisk.join(',') === 'SKILL.md,helper.md,scripts,scripts/run.sh', 'A8 盘上文件集对拍', onDisk.join(','));
  const sources = JSON.parse(readFileSync(SOURCES_PATH, 'utf8'));
  check(
    sources.sources['my-live-skill']?.kind === 'localPath' &&
      sources.sources['my-live-skill']?.ref === join(SRC, 'my-live-skill') &&
      typeof sources.sources['my-live-skill']?.importedAt === 'number',
    'A9 来源记录（kind=localPath + realpath ref + importedAt）',
    JSON.stringify(sources.sources['my-live-skill'] ?? null),
  );
  await page.screenshot({ path: join(EVIDENCE, 'a-localpath-list.png') });
  check(true, 'A10 截图：导入后列表行');

  // —— B. GitHub URL 导入（真 anthropics/skills 子目录）——
  await page.getByTestId('resource-import').click();
  const dlgB = page.getByRole('dialog', { name: '导入技能' });
  await dlgB.locator('#dlg-skill-import-url').waitFor({ state: 'visible' });
  await dlgB
    .getByRole('button', { name: '导入', exact: true })
    .waitFor({ state: 'visible' });
  check(await dlgB.locator('#dlg-skill-import-url').isEnabled(), 'B1 弹窗再开（url 字段在位）');
  await dlgB.locator('#dlg-skill-import-url').fill('https://github.com/anthropics/skills/tree/main/skills/pdf');
  await dlgB.getByRole('button', { name: '导入', exact: true }).click();
  await dlgB.waitFor({ state: 'hidden', timeout: 120_000 });
  check(true, 'B2 提交后弹窗关（真实拉取：repo meta + tree + 12 文件 raw）');

  const rowsB = await rows();
  const pdf = rowsB.find((r) => r.id === 'pdf');
  check(pdf != null, 'B3 列表含 GitHub 导入技能（id=pdf）', pdf ? `desc=${pdf.description?.slice(0, 40)}…` : 'missing');
  const detailB = await detailApi('pdf');
  check(detailB.fileNames.length === 12, 'B4 文件清单 12 件对拍', `${detailB.fileNames.length} files`);
  const pdfEntry = await (
    await j(`/api/teams/${TEAM}/skills/pdf/file?fileName=SKILL.md`, undefined, 'GET')
  ).json();
  check(pdfEntry.content.startsWith('---\nname: pdf\n'), 'B5 SKILL.md 内容对拍（frontmatter name: pdf）');
  const sourcesB = JSON.parse(readFileSync(SOURCES_PATH, 'utf8'));
  check(
    sourcesB.sources.pdf?.kind === 'github' &&
      sourcesB.sources.pdf?.ref === 'https://github.com/anthropics/skills/tree/main/skills/pdf',
    'B6 来源记录（kind=github + canonical URL 含 ref）',
    JSON.stringify(sourcesB.sources.pdf ?? null),
  );
  await page.screenshot({ path: join(EVIDENCE, 'b-github-list.png') });
  check(true, 'B7 截图：两行导入技能');

  // —— C1. 手建技能 refresh → 409 ——
  mkdirSync(join(SKILLS_DIR, 'hand-made-skill'));
  writeFileSync(
    join(SKILLS_DIR, 'hand-made-skill', 'SKILL.md'),
    '---\nname: hand-made-skill\ndescription: 手建\n---\n',
  );
  const c1 = await refreshApi('hand-made-skill');
  const c1Body = await c1.json();
  check(
    c1.status === 409 && /source/.test(c1Body.error ?? ''),
    'C1 手建技能（无来源记录）refresh → 409 说明',
    `${c1.status}: ${c1Body.error}`,
  );

  // —— C2. 源改内容 → refresh → 200 id 不变 盘上更新 ——
  writeFileSync(
    join(SRC, 'my-live-skill', 'SKILL.md'),
    MY_SKILL_MD.replace('v1 正文', 'v2 正文（refresh 后）').replace('本地技能 v1', '本地技能 v2'),
  );
  writeFileSync(join(SRC, 'my-live-skill', 'helper.md'), 'helper v2 (refreshed)\n');
  const c2 = await refreshApi('my-live-skill');
  const c2Body = await c2.json();
  check(c2.status === 200 && c2Body.id === 'my-live-skill', 'C2 refresh → 200 且 id 不变', `${c2.status}`);
  check(
    c2Body.description === 'live 栈导入的本地技能 v2' &&
      readFileSync(join(SKILLS_DIR, 'my-live-skill', 'SKILL.md'), 'utf8').includes('v2 正文'),
    'C3 盘上内容更新（SKILL.md v2）',
  );
  const helper2 = await (
    await j(`/api/teams/${TEAM}/skills/my-live-skill/file?fileName=helper.md`, undefined, 'GET')
  ).json();
  check(helper2.content === 'helper v2 (refreshed)\n', 'C4 覆写语义（列出者覆写——helper.md v2）');

  // —— C5. machine-wire 物化清单（#920 接力：假机器 REST 全链）——
  const keyRes = await j(`/api/teams/${TEAM}/api-keys`, {
    name: 'probe-machine',
    gitAccess: false,
    mcpAccess: false,
    toolGrants: { read: [], write: [] },
  });
  const key = (await keyRes.json()).plaintext;
  const enroll = await j('/api/machine/enroll', {
    teamId: TEAM,
    name: 'import-probe',
    cliVersion: '0.1.0',
  }, 'POST', key);
  const { token } = await enroll.json();
  const agentRes = await j(`/api/teams/${TEAM}/agents`, {
    displayName: '物化验证 Agent',
    provider: 'p',
    modelId: 'm',
    skillsAllowlist: ['my-live-skill'],
  });
  const agentRec = await agentRes.json();
  const agentId = agentRec.id ?? agentRec.agent?.id;
  const project = await (await j('/api/projects', { name: 'import-probe' })).json();
  const todo = await (
    await j(`/api/projects/${project.id}/todos`, { title: '', spec: '导技能\n\n现在的情况：没技能' })
  ).json();
  await j(`/api/projects/${project.id}/builds`, {
    todoIds: [todo.id],
    assignment: { plan: null, build: { agentId } },
    withPlan: false,
  });
  const claim = await j('/api/machine/tasks/claim', {}, 'POST', token);
  const claimed = (await claim.json()).step;
  const manifestGet = () =>
    j(`/api/machine/skills/${claimed.step.id}`, undefined, 'GET', token).then((r) => r.json());
  const manifest1 = await manifestGet();
  const entry1 = manifest1.skills?.find((s) => s.id === 'my-live-skill');
  check(
    manifest1.selection === 'whitelist' && entry1 != null,
    'C5 物化清单含导入技能（agent 白名单 ∩ 现扫）',
    `selection=${manifest1.selection} files=${entry1?.files?.length}`,
  );
  const shaBefore = entry1?.files?.find((f) => f.path === 'SKILL.md')?.sha256;
  saveJson('c-manifest-before.json', manifest1);

  // C6: 源再改 → refresh → 清单同 id 新 sha。
  writeFileSync(
    join(SRC, 'my-live-skill', 'SKILL.md'),
    MY_SKILL_MD.replace('v1 正文', 'v3 正文（物化对拍）').replace('本地技能 v1', '本地技能 v3'),
  );
  const c6 = await refreshApi('my-live-skill');
  check(c6.status === 200, 'C6 源再改 + refresh → 200');
  const manifest2 = await manifestGet();
  const entry2 = manifest2.skills?.find((s) => s.id === 'my-live-skill');
  const shaAfter = entry2?.files?.find((f) => f.path === 'SKILL.md')?.sha256;
  saveJson('c-manifest-after.json', manifest2);
  check(
    entry2 != null && shaBefore != null && shaAfter != null && shaBefore !== shaAfter,
    'C7 refresh 后物化清单同 id 新 sha256（#920 新 digest 视图的根因）',
    `id=${entry2?.id} sha ${shaBefore?.slice(0, 8)}→${shaAfter?.slice(0, 8)}`,
  );

  // —— C8. 审计行（SQLite 只读）——
  const requireServer = createRequire(join(ROOT, 'apps', 'server', 'package.json'));
  const Database = requireServer('better-sqlite3');
  const db = new Database(DB_PATH, { readonly: true });
  const auditRows = db
    .prepare(
      "SELECT skillId, actorType, actorId, action, bytes, createdAt FROM skill_audit ORDER BY createdAt, skillId",
    )
    .all();
  db.close();
  saveJson('c-skill-audit-rows.json', auditRows);
  const byAction = {};
  for (const row of auditRows) byAction[`${row.action}:${row.skillId}`] = row;
  check(
    byAction['create:my-live-skill'] != null && byAction['update:my-live-skill'] != null &&
      byAction['create:pdf'] != null,
    'C8 审计行（create×2 导入 + update×2 refresh，actor=member）',
    auditRows.map((r) => `${r.action}:${r.skillId}`).join(' '),
  );

  // —— D. 红态面（真拒绝）——
  const ssrf = [
    ['http://127.0.0.1/skills/x', /127\.0\.0\.1|https/],
    ['https://192.168.1.5/acme/repo', /192\.168\.1\.5|private|loopback/],
    ['https://internal.corp.example/acme/repo', /GitHub/],
  ];
  const red = [];
  for (const [url, re] of ssrf) {
    const res = await importApi({ url });
    const body = await res.json();
    red.push({ url, status: res.status, error: body.error });
    check(res.status === 400 && re.test(body.error ?? ''), `D1 SSRF 拒：${url}`, `${res.status}: ${body.error}`);
  }
  const inside = await importApi({ localPath: join(SKILLS_DIR, 'hand-made-skill') });
  const insideBody = await inside.json();
  red.push({ url: `localPath in skillsDir`, status: inside.status, error: insideBody.error });
  check(
    inside.status === 400 && /skills directory/.test(insideBody.error ?? ''),
    'D2 localPath 落技能根内 → 400（已由 pacman 管理）',
    `${inside.status}: ${insideBody.error}`,
  );
  const bin = await importApi({ localPath: join(SRC, 'bin-src') });
  const binBody = await bin.json();
  red.push({ url: 'binary file', status: bin.status, error: binBody.error });
  check(
    bin.status === 400 && /UTF-8/.test(binBody.error ?? ''),
    'D3 二进制文件 → 400 点名（文本通道边界）',
    `${bin.status}: ${binBody.error}`,
  );
  const big = await importApi({ localPath: join(SRC, 'big-src') });
  const bigBody = await big.json();
  red.push({ url: 'oversize', status: big.status, error: bigBody.error });
  check(
    big.status === 400 && /512000/.test(bigBody.error ?? ''),
    'D4 超单文件上限 → 400 点名上限',
    `${big.status}: ${bigBody.error}`,
  );
  saveJson('d-red-states.json', red);

  // —— D5. UI 错误态截图（SSRF 形经弹窗）——
  await page.getByTestId('resource-import').click();
  const dlgD = page.getByRole('dialog', { name: '导入技能' });
  await dlgD.locator('#dlg-skill-import-url').waitFor({ state: 'visible' });
  await dlgD.locator('#dlg-skill-import-url').fill('http://127.0.0.1:8787/skills/leak');
  await dlgD.getByRole('button', { name: '导入', exact: true }).click();
  await dlgD.getByRole('alert').waitFor({ state: 'visible', timeout: 10_000 });
  const alertText = await dlgD.getByRole('alert').innerText();
  check(
    /拉取来源失败|来源未通过校验|127\.0\.0\.1/.test(alertText),
    'D5 UI 错误行（headline + server 原文 detail）',
    alertText.replace(/\n/g, ' | ').slice(0, 120),
  );
  await page.screenshot({ path: join(EVIDENCE, 'd-red-ui.png') });

  // 收尾真值存档。
  saveJson('a-import-rest-rows.json', rowsB);
  const sourcesFinal = JSON.parse(readFileSync(SOURCES_PATH, 'utf8'));
  saveJson('sources-records.json', sourcesFinal);
} finally {
  await browser.close();
}

writeFileSync(
  join(EVIDENCE, 'result.json'),
  `${JSON.stringify({ probe: '1170-skill-import', checks, stack: { API, WEB, HOME }, stamp }, null, 2)}\n`,
);
console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAIL`}  evidence: ${EVIDENCE}`);
process.exit(failures === 0 ? 0 : 1);
