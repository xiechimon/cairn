#!/usr/bin/env node
// verify-pacman probe — spec 12 / #361 G2-T4 GitHub 连接认证 + repo picker
// (API 段 + 浏览器 UI 段;live 面,URL 不带 ?scenario=):
// 1. 认证状态读面:GET /api/teams/{id}/github/connection 未连接 → {connected:false}
//    (封套无 token 位);requireTeam 闸(未知 team → 404)
// 2. authorize 签发:POST /api/teams/{id}/github/oauth/authorize —— env 未配
//    → 400 not-configured(error 含 env 槽名,oauth.ts 错误族沿用);env 已配
//    → 200 + authorizationUrl(github authorize 端点 + scope=read:user repo +
//    state 在位;不跟跳真授权页)。两形皆 PASS,label 点名实际形态。
// 3. 断开幂等:DELETE connection 缺行 → 204,状态读面回 {connected:false}
// 4. repos 代理未连接 → 404(T1 面随认证面回归)
// 5. UI 真用户路径(chromium,drive.mjs 同口径 1440×732 dark):新建项目 →
//    「GitHub 仓库」→ 未认证 = 认证钮 + 手动兜底链接;env 未配时点认证 →
//    authorize 400 原文落内联错误行;手动兜底 → owner/repo input → 填名 +
//    合法 ref → 创建钮放开 → 提交 → 跳项目页(公开仓免认证降级路全链)
// 6. 第二只眼:GET /api/projects 投影 repoKind=github + githubRepo 原值
// 真 OAuth 回环(授权页 → callback → token 密封落行 → picker 列表)需真
// GitHub App 凭证 + 人环登录,不可自动化——进程内全链证明在
// apps/server/test/github-oauth.test.ts(mock 上游 14 条),此 probe 不冒充。
// 栈必须已在跑(launch.mjs;坐标取 VERIFY_RUN_DIR/ports.json)。
// 证据(result.json + responses.json + 截图)落 VERIFY_EVIDENCE_DIR;交付见
// SKILL.md「证据归档纪律」(在 PR 分支上 vp.mjs archive <票号> --from <证据目录>
// 拷进 docs/verify/<票号>/ 随 PR 提交,不手工 cp)。任一断言失败退出码 1。
// 运行前置:proxy env 全 unset(回环请求过代理会 502 假阳性)。

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

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

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ??
  join(SCRIPT_ROOT, '.claude', 'verify-evidence', `${stamp}-github-oauth-picker`);
mkdirSync(EVIDENCE, { recursive: true });

const checks = [];
let failures = 0;
const check = (ok, label) => {
  checks.push({ ok, label });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures += 1;
};

const payloads = {};
async function api(method, path, body, headers) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(headers ?? {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

// —— API 段 ——————————————————————————————————————————————————————————————
const session = await api('GET', '/api/auth/session');
payloads.session = session;
check(session.status === 200, `GET /api/auth/session → 200(实际 ${session.status})`);

const teams = await api('GET', '/api/teams');
payloads.teams = teams;
const teamId = teams.json?.[0]?.id;
check(typeof teamId === 'string' && teamId !== '', `GET /api/teams → seed team id 在位`);

const status0 = await api('GET', `/api/teams/${teamId}/github/connection`);
payloads.connectionStatusFresh = status0;
check(
  status0.status === 200 &&
    JSON.stringify(status0.json) === JSON.stringify({ connected: false }),
  `状态读面:全新栈未连接 → {connected:false} 恰形(实际 ${status0.status} ${JSON.stringify(status0.json)})`,
);

const unknownTeam = await api('GET', '/api/teams/nope/github/connection');
payloads.connectionStatusUnknownTeam = unknownTeam;
check(unknownTeam.status === 404, `requireTeam 闸:未知 team 状态读面 → 404(实际 ${unknownTeam.status})`);

const authorize = await api(
  'POST',
  `/api/teams/${teamId}/github/oauth/authorize`,
  {},
  { origin: WEB },
);
payloads.authorize = authorize;
const oauthConfigured = authorize.status === 200;
if (oauthConfigured) {
  const url = new URL(authorize.json?.authorizationUrl ?? 'http://invalid');
  const scope = url.searchParams.get('scope');
  check(
    url.origin + url.pathname === 'https://github.com/login/oauth/authorize' &&
      url.searchParams.get('redirect_uri') === `${WEB}/api/oauth/callback` &&
      scope === 'read:user repo' &&
      (url.searchParams.get('state') ?? '') !== '',
    `authorize(env 已配形):200 + github 端点 + redirect_uri 回跳根 + scope=read:user repo + state 在位(scope=${scope})`,
  );
} else {
  check(
    authorize.status === 400 &&
      String(authorize.json?.error ?? '').includes('PACMAN_GITHUB_OAUTH_CLIENT_ID'),
    `authorize(env 未配形):400 not-configured + error 含 env 槽名(实际 ${authorize.status})`,
  );
}

const disconnected = await api('DELETE', `/api/teams/${teamId}/github/connection`);
payloads.disconnectIdempotent = disconnected;
const statusAfterDelete = await api('GET', `/api/teams/${teamId}/github/connection`);
payloads.connectionStatusAfterDelete = statusAfterDelete;
check(
  disconnected.status === 204 && statusAfterDelete.json?.connected === false,
  `断开幂等:缺行 DELETE → 204,读面仍 {connected:false}(实际 ${disconnected.status})`,
);

const repos = await api('GET', '/api/github/repos');
payloads.reposNoConnection = repos;
check(
  repos.status === 404 && typeof repos.json?.error === 'string',
  `repos 代理未连接 → 404 {error}(T1 面回归;实际 ${repos.status})`,
);

// —— UI 段(chromium;drive.mjs 同口径)—————————————————————————————————————
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 732 },
  colorScheme: 'dark',
});
try {
  await page.goto(`${WEB}/app/project/new`, { waitUntil: 'load' });
  await page.locator('#prj-new-repo').click();
  // #1007 载体迁:.prj-new-* 别名 #946 已退役,探针改语义载体(role 一级)。
  await page
    .getByRole('menu', { name: '仓库' })
    .getByRole('menuitemradio', { name: 'GitHub 仓库' })
    .click();
  // 认证钮 = #prj-new-repo 续作位(label「仓库」关联命名覆盖了按钮文案的
  // 可及名,e2e project-new-github 同律钉 id + 文案判面)——探针同载体。
  // 连接态首取在途 = 禁用占位(不闪认证钮)——等读面收敛再断言。
  const auth = page.locator('#prj-new-repo');
  await expect
    .poll(() => auth.textContent(), { timeout: 8000 })
    .toBe('认证 GitHub');
  const authVisible = await auth.isVisible();
  const linkVisible = await page
    .getByRole('button', { name: '手动输入 owner/repo' })
    .isVisible();
  check(
    authVisible && linkVisible,
    `UI:未认证点「GitHub 仓库」→ 认证钮(文案「认证 GitHub」)+ 手动兜底链接(实际 auth=${authVisible} link=${linkVisible})`,
  );
  await page.screenshot({ path: join(EVIDENCE, 'auth-face.png') });

  if (!oauthConfigured) {
    await auth.click();
    const err = page.getByRole('alert');
    await err.waitFor({ state: 'visible', timeout: 5000 });
    const errText = (await err.textContent()) ?? '';
    check(
      errText.includes('PACMAN_GITHUB_OAUTH_CLIENT_ID'),
      `UI:点认证(env 未配)→ authorize 400 原文落内联错误行(实际「${errText.slice(0, 80)}」)`,
    );
    await page.screenshot({ path: join(EVIDENCE, 'error-face.png') });
  } else {
    console.log('SKIP  UI 点认证(env 已配 = 会跳真 GitHub 授权页,自动化不跟人环;真回环证明归 server test)');
  }

  // 手动兜底 → input → 公开仓免认证降级路全链(填名 + 合法 ref → 提交跳项目页)
  await page.getByRole('button', { name: '手动输入 owner/repo' }).click();
  const input = page.locator('#prj-new-repo');
  const inputOk = (await input.getAttribute('placeholder')) === 'owner/repo';
  check(inputOk, `UI:手动兜底链接 → 现状 owner/repo input(placeholder 实际 ${await input.getAttribute('placeholder')})`);
  await page.locator('#prj-new-name').fill('verify-gh-manual');
  await input.fill('xiechimon/pacman');
  const submit = page.getByRole('button', { name: '创建项目' });
  const enabled = await submit.isEnabled();
  check(enabled, 'UI:name + 合法 owner/repo(isGithubRepoRef 过闸)→ 创建钮放开');
  await submit.click();
  await page.waitForURL(/\/app\/project\/(?!new)/, { timeout: 10000 });
  const landedUrl = page.url();
  check(
    /\/app\/project\/[\w-]+/.test(landedUrl),
    `UI:提交 → 跳项目页(公开仓免认证降级路全链;实际 ${landedUrl})`,
  );
  await page.screenshot({ path: join(EVIDENCE, 'created-project.png') });

  // 第二只眼:REST 投影真值
  const projectId = landedUrl.match(/\/app\/project\/([\w-]+)/)?.[1];
  const list = await api('GET', '/api/projects');
  payloads.projectsAfterCreate = list;
  const row = (list.json ?? []).find((p) => p.id === projectId);
  check(
    row?.repoKind === 'github' && row?.githubRepo === 'xiechimon/pacman',
    `第二只眼:GET /api/projects 行 repoKind=github + githubRepo 原值(实际 ${JSON.stringify({ repoKind: row?.repoKind, githubRepo: row?.githubRepo })})`,
  );
} finally {
  await browser.close();
}

const result = {
  probe: 'github-oauth-picker',
  ticket: 361,
  at: new Date().toISOString(),
  checks,
  stack: { api: API, web: WEB, homeDir: stack.homeDir, root: stack.root },
};
writeFileSync(join(EVIDENCE, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
writeFileSync(join(EVIDENCE, 'responses.json'), `${JSON.stringify(payloads, null, 2)}\n`);
console.log(`\n${checks.length - failures}/${checks.length} PASS`);
console.log(`evidence:${EVIDENCE}`);
process.exit(failures === 0 ? 0 : 1);
