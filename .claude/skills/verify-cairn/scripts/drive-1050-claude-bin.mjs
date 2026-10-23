#!/usr/bin/env node
// verify-cairn 定制 probe（#1050 claude 二进制事实源）：机制实物取证。
//
// 声称面：daemon 探测本机 claude 二进制（PATH 解析 + `claude --version`）与
// 凭据态，随 enroll/presence 上报；server 透传；providers 页把它呈现成
// 「细字行 + 未登录角标」。三条腿各钉一个方向：
//
//   A 装了（PATH 前置 stub claude：--version 报 9.9.9-probe、auth status 报
//     logged-in）→ ① daemon.log `claude binary: <path> (9.9.9-probe)`；
//     ② machine 行 claudeCodeReport.bin/.auth 实测值；③ model-sources 段带
//     bin/auth；④ 页面细字行报版本与路径、data-auth=logged-in、无「未登录」。
//   B 没装（同一台机器，CAIRN_CLAUDE_BIN 指不存在路径）→ bin **缺席**
//     （不是空对象、不是「未知」），页面回「未安装」且无细字行——这是
//     「配置文件在但二进制缺失」那一类假绿被消掉的负向。
//
// 前置：`node .claude/skills/verify-cairn/scripts/launch.mjs` 起隔离栈；
// 本脚本自起 daemon（CAIRN_HOME 独立 scratch）并自回收。
// env：VERIFY_REPO_ROOT / VERIFY_RUN_DIR / SERVER / WEB / DB /
//      VERIFY_EVIDENCE_DIR / STUB_VERSION（缺省 9.9.9-probe）。

import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SCRIPT_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const REPO = process.env.VERIFY_REPO_ROOT ?? SCRIPT_REPO;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(REPO, '.claude', 'verify-run');
const ports = existsSync(join(RUN_DIR, 'ports.json'))
  ? JSON.parse(readFileSync(join(RUN_DIR, 'ports.json'), 'utf8'))
  : {};
const SERVER = process.env.SERVER ?? `http://127.0.0.1:${ports.serverPort ?? 8791}`;
const WEB = process.env.WEB ?? `http://127.0.0.1:${ports.webPort ?? 5273}`;
const DB = process.env.DB ?? join(RUN_DIR, 'home', 'server', 'server.db');
const STUB_VERSION = process.env.STUB_VERSION ?? '9.9.9-probe';
const MACHINE_NAME = 'probe-1050';
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ?? join(REPO, 'docs', 'verify', '1050');
mkdirSync(EVIDENCE, { recursive: true });

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail: detail ?? null });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}\n`);
}
function save(name, data) {
  writeFileSync(
    join(EVIDENCE, name),
    typeof data === 'string' ? data : `${JSON.stringify(data, null, 2)}\n`,
  );
}
function finish() {
  const passed = checks.filter((c) => c.ok).length;
  save('result.json', { probe: 'drive-1050-claude-bin', server: SERVER, web: WEB, checks });
  process.stdout.write(`\n${passed}/${checks.length} checks passed → ${EVIDENCE}\n`);
  if (passed !== checks.length) process.exitCode = 1;
}

async function jfetch(method, path, opts = {}) {
  const res = await fetch(`${SERVER}${path}`, {
    method,
    ...(opts.body !== undefined
      ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(opts.body) }
      : {}),
  });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

function openDb() {
  const require2 = createRequire(join(REPO, 'apps/server/package.json'));
  const Database = require2('better-sqlite3');
  return new Database(DB, { readonly: true });
}

/** machine 行读回（drizzle json 列原文带引号 → JSON.parse 后再比）。 */
function machineRow(name) {
  const db = openDb();
  try {
    const row = db
      .prepare('SELECT name, online, "claudeCodeReport" FROM machine WHERE name = ?')
      .get(name);
    if (!row) return null;
    return {
      name: row.name,
      online: row.online,
      report: row.claudeCodeReport ? JSON.parse(row.claudeCodeReport) : null,
    };
  } finally {
    db.close();
  }
}

/** stub claude：--version 报定值、auth status 报已登录 JSON（其余子命令空答）。 */
function writeStubBin(dir) {
  const p = join(dir, 'claude');
  writeFileSync(
    p,
    [
      '#!/bin/sh',
      'case "$1" in',
      `  --version) echo "${STUB_VERSION} (Claude Code)" ;;`,
      `  auth) echo '{"loggedIn":true,"authMethod":"oauth_token","apiProvider":"firstParty"}' ;;`,
      'esac',
      'exit 0',
      '',
    ].join('\n'),
  );
  chmodSync(p, 0o755);
  return p;
}

function spawnDaemon({ home, env }) {
  const out = [];
  const child = spawn(
    process.execPath,
    [
      join(REPO, 'apps/daemon/node_modules/tsx/dist/cli.mjs'),
      'src/cli.ts',
      'start',
      '-f',
      '--server',
      SERVER,
      '--name',
      MACHINE_NAME,
      '--api-key',
      env.apiKey,
      '--team',
      env.teamId,
    ],
    {
      cwd: join(REPO, 'apps/daemon'),
      env: { ...env.env, CAIRN_HOME: home },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    },
  );
  child.stdout.on('data', (d) => out.push(String(d)));
  child.stderr.on('data', (d) => out.push(String(d)));
  return { child, out };
}

function killDaemon(handle) {
  return new Promise((resolveKill) => {
    if (handle.child.exitCode !== null) return resolveKill();
    handle.child.once('exit', () => resolveKill());
    try {
      process.kill(-handle.child.pid, 'SIGTERM');
    } catch {
      // 组已散：退化成单进程杀。
      try {
        handle.child.kill('SIGTERM');
      } catch {
        // 已退出。
      }
    }
    setTimeout(() => {
      try {
        process.kill(-handle.child.pid, 'SIGKILL');
      } catch {
        // 已退出。
      }
      resolveKill();
    }, 6_000);
  });
}

/** 轮询直到该机器的上报满足谓词（首拍 presence 即带，通常 1 轮内命中）。 */
async function waitForReport(name, predicate, timeoutMs = 30_000) {
  const started = Date.now();
  let last = null;
  for (;;) {
    last = machineRow(name);
    if (last?.report && predicate(last.report)) return last;
    if (Date.now() - started > timeoutMs) return last;
    await new Promise((r) => setTimeout(r, 1_000));
  }
}

const PAGE = '/app/resources/providers?runtime=claude-code';
const HEAD = '[data-route="/app/resources/providers"] [data-testid="runtime-head"][data-runtime="claude-code"]';

const teamRes = await jfetch('GET', '/api/teams');
const teamId = teamRes.body?.[0]?.id ?? teamRes.body?.teams?.[0]?.id;
if (!teamId) {
  check('stack-ready', false, `GET /api/teams 取不到 teamId：${JSON.stringify(teamRes.body)}`);
  finish();
  process.exit(1);
}
check('stack-ready', true, `teamId=${teamId}`);

// 建 key 的 body = shared apiKeyRecordSchema（name 放宽可选）；明文只在
// 创建响应里回一次（字段名 `plaintext`）。
const keyRes = await jfetch('POST', `/api/teams/${teamId}/api-keys`, {
  body: {
    name: '1050-probe',
    gitAccess: false,
    mcpAccess: false,
    toolGrants: { read: [], write: [] },
  },
});
const apiKey = keyRes.body?.plaintext;
check('api-key', typeof apiKey === 'string' && apiKey.length > 0, `status=${keyRes.status}`);

const runsRoot = mkdtempSync(join(tmpdir(), 'cairn-1050-'));
const stubDir = join(runsRoot, 'bin');
mkdirSync(stubDir, { recursive: true });
const stubPath = writeStubBin(stubDir);

// 环回探针与 daemon 都必须绕开本机代理（代理拦 localhost 会造 502 假红）。
const baseEnv = { ...process.env, NO_PROXY: 'localhost,127.0.0.1,::1', no_proxy: 'localhost,127.0.0.1,::1' };
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) {
  delete baseEnv[k];
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });

let handleA = null;
let handleB = null;
try {
  // —— 腿 A：装了（stub 在 PATH 前置）——
  handleA = spawnDaemon({
    home: join(runsRoot, 'home-a'),
    env: { apiKey, teamId, env: { ...baseEnv, PATH: `${stubDir}:${baseEnv.PATH}` } },
  });
  const reportA = await waitForReport(MACHINE_NAME, (r) => r.bin?.version === STUB_VERSION);
  save('daemon-a.log', handleA.out.join(''));
  const logA = handleA.out.join('');
  check(
    'A1 daemon.log 报出探测结果',
    logA.includes(`claude binary: ${stubPath} (${STUB_VERSION})`),
    logA.split('\n').find((l) => l.includes('claude binary:')) ?? '无该行',
  );
  check(
    'A2 machine 行 bin 实测值',
    reportA?.report?.bin?.path === stubPath && reportA?.report?.bin?.version === STUB_VERSION,
    JSON.stringify(reportA?.report?.bin ?? null),
  );
  check(
    'A3 machine 行 auth 实测值',
    reportA?.report?.auth?.state === 'logged-in',
    JSON.stringify(reportA?.report?.auth ?? null),
  );

  const sourcesA = await jfetch('GET', `/api/teams/${teamId}/model-sources`);
  save('model-sources-a.json', sourcesA.body);
  const ccA = (sourcesA.body?.sources ?? []).find((s) => s.runtime === 'claude-code');
  check(
    'A4 model-sources 段带 bin/auth（server 透传）',
    ccA?.bin?.version === STUB_VERSION && ccA?.auth?.state === 'logged-in',
    JSON.stringify({ bin: ccA?.bin, auth: ccA?.auth }),
  );

  await page.goto(`${WEB}${PAGE}`);
  await page.waitForSelector(HEAD, { timeout: 30_000 });
  const headA = page.locator(HEAD);
  const textA = await headA.innerText();
  save('page-a.txt', textA);
  await headA.screenshot({ path: join(EVIDENCE, '01-installed-logged-in.png') });
  check(
    'A5 页面细字行报版本与路径',
    textA.includes(`claude ${STUB_VERSION} · ${stubPath}`),
    textA.replace(/\n/g, ' | '),
  );
  check(
    'A6 页面凭据态 = logged-in、无「未登录」角标',
    (await headA.getAttribute('data-auth')) === 'logged-in' && !textA.includes('未登录'),
    `data-auth=${await headA.getAttribute('data-auth')}`,
  );

  await killDaemon(handleA);
  handleA = null;

  // —— 腿 B：没装（显式指一个不存在的二进制路径，settings.json 不动）——
  handleB = spawnDaemon({
    home: join(runsRoot, 'home-b'),
    env: {
      apiKey,
      teamId,
      env: { ...baseEnv, CAIRN_CLAUDE_BIN: join(runsRoot, 'no-such-claude') },
    },
  });
  const reportB = await waitForReport(
    MACHINE_NAME,
    (r) => r.bin === null && r.auth !== undefined,
  );
  save('daemon-b.log', handleB.out.join(''));
  const logB = handleB.out.join('');
  check(
    'B1 daemon.log 报「PATH 上没有」',
    logB.includes('claude binary: not found on PATH'),
    logB.split('\n').find((l) => l.includes('claude binary:')) ?? '无该行',
  );
  check(
    'B2 machine 行 bin = null（探过了没有，不是空对象、不是键缺席）',
    reportB?.report !== null && 'bin' in (reportB?.report ?? {}) && reportB.report.bin === null,
    JSON.stringify(reportB?.report ?? null).slice(0, 160),
  );

  const sourcesB = await jfetch('GET', `/api/teams/${teamId}/model-sources`);
  save('model-sources-b.json', sourcesB.body);
  const ccB = (sourcesB.body?.sources ?? []).find((s) => s.runtime === 'claude-code');
  check(
    'B3 model-sources 段 bin = null（server 原样透传，不吞成缺席）',
    ccB !== undefined && 'bin' in ccB && ccB.bin === null,
    JSON.stringify(ccB?.bin ?? 'MISSING'),
  );

  await page.goto(`${WEB}${PAGE}`);
  await page.waitForSelector(HEAD, { timeout: 30_000 });
  const headB = page.locator(HEAD);
  const textB = await headB.innerText();
  save('page-b.txt', textB);
  await headB.screenshot({ path: join(EVIDENCE, '02-binary-missing.png') });
  // 页面此刻**同时**有 settings.json（installed:true，本机真配置）与
  // bin:null——旧行为在这里说「已安装在」，正是本票要消的假绿。
  check(
    'B4 页面回「未安装」（不再假报已安装）',
    textB.includes('未安装') && !textB.includes('已安装在'),
    textB.replace(/\n/g, ' | '),
  );
  check(
    'B5 页面无细字行、不写「未知」',
    (await headB.locator('[data-testid="runtime-bin"]').count()) === 0 && !textB.includes('未知'),
    textB.replace(/\n/g, ' | '),
  );
} finally {
  if (handleA) await killDaemon(handleA);
  if (handleB) await killDaemon(handleB);
  await browser.close();
  finish();
}