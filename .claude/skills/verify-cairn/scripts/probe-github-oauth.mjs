#!/usr/bin/env node

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
      String(authorize.json?.error ?? '').includes('CAIRN_GITHUB_OAUTH_CLIENT_ID'),
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

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 732 },
  colorScheme: 'dark',
});
try {
  await page.goto(`${WEB}/app/project/new`, { waitUntil: 'load' });
  await page.locator('#prj-new-repo').click();

  await page
    .getByRole('menu', { name: '仓库' })
    .getByRole('menuitemradio', { name: 'GitHub 仓库' })
    .click();

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
      errText.includes('CAIRN_GITHUB_OAUTH_CLIENT_ID'),
      `UI:点认证(env 未配)→ authorize 400 原文落内联错误行(实际「${errText.slice(0, 80)}」)`,
    );
    await page.screenshot({ path: join(EVIDENCE, 'error-face.png') });
  } else {
    console.log('SKIP  UI 点认证(env 已配 = 会跳真 GitHub 授权页,自动化不跟人环;真回环证明归 server test)');
  }

  await page.getByRole('button', { name: '手动输入 owner/repo' }).click();
  const input = page.locator('#prj-new-repo');
  const inputOk = (await input.getAttribute('placeholder')) === 'owner/repo';
  check(inputOk, `UI:手动兜底链接 → 现状 owner/repo input(placeholder 实际 ${await input.getAttribute('placeholder')})`);
  await page.locator('#prj-new-name').fill('verify-gh-manual');
  await input.fill('xiechimon/cairn');
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

  const projectId = landedUrl.match(/\/app\/project\/([\w-]+)/)?.[1];
  const list = await api('GET', '/api/projects');
  payloads.projectsAfterCreate = list;
  const row = (list.json ?? []).find((p) => p.id === projectId);
  check(
    row?.repoKind === 'github' && row?.githubRepo === 'xiechimon/cairn',
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
