#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const SCRIPT_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const ROOT = process.env.VERIFY_REPO_ROOT
  ? resolve(process.env.VERIFY_REPO_ROOT)
  : SCRIPT_ROOT;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(ROOT, '.claude', 'verify-run');
const PORTS_FILE = join(RUN_DIR, 'ports.json');

function groupAlive(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

const results = [];
const check = (ok, label, detail = '') => {
  results.push({ ok, label, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

if (!existsSync(PORTS_FILE)) {
  console.error(`无栈:${PORTS_FILE} 不存在。先跑 launch.mjs`);
  process.exit(1);
}

const stack = JSON.parse(readFileSync(PORTS_FILE, 'utf8'));
const API = `http://127.0.0.1:${stack.serverPort}`;
const WEB = `http://127.0.0.1:${stack.webPort}`;

check(
  groupAlive(stack.serverPid),
  `server 进程组存活(pid ${stack.serverPid})`,
  '挂了 → cleanup.mjs 后重 launch',
);
check(
  groupAlive(stack.webPid),
  `vite dev 进程组存活(pid ${stack.webPid})`,
  '挂了 → cleanup.mjs 后重 launch',
);

const getJson = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
  const body = await res.json();
  return { status: res.status, body };
};

try {
  const session = await getJson(`${API}/api/auth/session`);
  check(
    session.status === 200 && session.body?.displayName === 'Owner',
    'GET /api/auth/session = seed 用户 Owner',
    `status=${session.status} displayName=${session.body?.displayName}`,
  );

  const teams = await getJson(`${API}/api/teams`);
  check(
    teams.status === 200 && Array.isArray(teams.body) && teams.body.length >= 1,
    'GET /api/teams 200 且非空',
    `status=${teams.status} n=${teams.body?.length}`,
  );

  const projects = await getJson(`${API}/api/projects`);
  check(
    projects.status === 200 && Array.isArray(projects.body),
    'GET /api/projects 200',
    `status=${projects.status} n=${projects.body?.length}(全新库为 0,正常)`,
  );

  const web = await fetch(`${WEB}/app`, { signal: AbortSignal.timeout(8000) });
  check(
    web.ok && (web.headers.get('content-type') ?? '').includes('text/html'),
    'GET /app 200 html(vite SPA fallback)',
    `status=${web.status}`,
  );
} catch (err) {
  check(false, 'HTTP 探测失败', String(err?.message ?? err));
}

console.log(`home:${stack.homeDir}(用户真数据 ~/.cairn 不被本栈触碰)`);

const failed = results.filter((r) => !r.ok).length;
if (failed > 0) {
  console.error(`doctor:${failed} 项 FAIL`);
  process.exit(1);
}
console.log('doctor:all PASS');
