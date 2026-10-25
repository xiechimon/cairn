#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
const DB_PATH = join(stack.homeDir, 'server', 'server.db');

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ??
  join(SCRIPT_ROOT, '.claude', 'verify-evidence', `${stamp}-local-repos-api`);
mkdirSync(EVIDENCE, { recursive: true });

const checks = [];
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
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

const props = [];
function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  props.push(dir);
  return dir;
}
const gitRepo = tempDir('verify-local-repo-');
execFileSync('git', ['init', gitRepo], { stdio: 'pipe' });
execFileSync(
  'git',
  ['-c', 'user.email=verify@local', '-c', 'user.name=verify', 'commit', '--allow-empty', '-m', 'init'],
  { cwd: gitRepo, stdio: 'pipe' },
);
const plainDir = tempDir('verify-plain-dir-');

try {

  const session = await api('GET', '/api/auth/session');
  payloads.session = session;
  check(session.status === 200, `GET /api/auth/session → 200(实际 ${session.status})`);

  const missing = join(tempDir('verify-missing-base-'), 'no-such-dir');
  const rMissing = await api('POST', '/api/projects', {
    name: 'verify-local-missing',
    kind: 'local',
    localPath: missing,
  });
  payloads.localPathMissing = rMissing;
  check(
    rMissing.status === 400 && String(rMissing.json?.error ?? '').includes('localPath'),
    `三态一:不存在路径 → 400 且 error 指 localPath(实际 ${rMissing.status})`,
  );
  check(
    rMissing.json?.reason === 'not_found',
    `三态一 reason code = not_found(实际 ${JSON.stringify(rMissing.json?.reason)})`,
  );

  const rNotGit = await api('POST', '/api/projects', {
    name: 'verify-local-notgit',
    kind: 'local',
    localPath: plainDir,
  });
  payloads.localPathNotGit = rNotGit;
  check(
    rNotGit.status === 400 && String(rNotGit.json?.error ?? '').includes('git'),
    `三态二:非 git 目录 → 400(实际 ${rNotGit.status})`,
  );
  check(
    rNotGit.json?.reason === 'not_git',
    `三态二 reason code = not_git(实际 ${JSON.stringify(rNotGit.json?.reason)})`,
  );

  const rOk = await api('POST', '/api/projects', {
    name: 'verify-local-ok',
    kind: 'local',
    localPath: gitRepo,
  });
  payloads.localProjectCreated = rOk;
  check(
    rOk.status === 201 && rOk.json?.repoKind === 'local' && rOk.json?.localPath === gitRepo,
    `三态三:真 git 仓 → 201 + repoKind=local + localPath 原值落 record(实际 ${rOk.status})`,
  );

  const rHosted = await api('POST', '/api/projects', { name: 'verify-hosted', repoKind: 'hosted' });
  payloads.hostedProjectCreated = rHosted;
  check(
    rHosted.status === 201 &&
      rHosted.json?.repoKind === 'hosted' &&
      typeof rHosted.json?.repoName === 'string' &&
      String(rHosted.json?.cloneUrl ?? '').includes('/git/'),
    `旧 hosted 面:repoKind:'hosted' → 201 + repoName/cloneUrl 在位(实际 ${rHosted.status})`,
  );

  const list = await api('GET', '/api/projects');
  payloads.projectsList = list;
  const localRow = (list.json ?? []).find((p) => p.id === rOk.json?.id);
  check(
    list.status === 200 && localRow?.localPath === gitRepo && localRow?.repoKind === 'local',
    'GET /api/projects 投影带 localPath/repoKind=local',
  );

  const repos = await api('GET', '/api/github/repos');
  payloads.githubReposNoConnection = repos;
  check(
    repos.status === 404 && typeof repos.json?.error === 'string',
    `GET /api/github/repos 未连接 → 404 {error}(实际 ${repos.status})`,
  );

  const requireServer = createRequire(join(ROOT, 'apps', 'server', 'package.json'));
  const Database = requireServer('better-sqlite3');
  const db = new Database(DB_PATH, { readonly: true });
  try {
    const projectCols = db.prepare(`PRAGMA table_info('project')`).all().map((c) => c.name);
    payloads.sqlite = { projectCols };
    check(projectCols.includes('localPath'), 'SQLite:project 表含 localPath 列(migration 0012 已应用)');

    const row = db
      .prepare('SELECT repoKind, localPath FROM project WHERE id = ?')
      .get(String(rOk.json?.id));
    payloads.sqlite.localProjectRow = row;
    check(
      row?.repoKind === 'local' && row?.localPath === gitRepo,
      'SQLite:local 项目行 repoKind/localPath 与 record 一致',
    );

    const connCols = db
      .prepare(`PRAGMA table_info('github_connection')`)
      .all()
      .map((c) => c.name)
      .sort();
    payloads.sqlite.githubConnectionCols = connCols;
    check(
      JSON.stringify(connCols) ===
        JSON.stringify(['accessTokenCipher', 'createdAt', 'login', 'scope', 'teamId']),
      `SQLite:github_connection 列集 = teamId/login/accessTokenCipher/scope/createdAt,无 plaintext token 列(实际 ${connCols.join(',')})`,
    );

    const connCount = db.prepare('SELECT COUNT(*) AS n FROM github_connection').get();
    check(connCount?.n === 0, 'SQLite:github_connection 空表起步(连接写入面归 G2-T4 OAuth)');
  } finally {
    db.close();
  }
} finally {
  for (const dir of props) rmSync(dir, { recursive: true, force: true });
}

const result = {
  probe: 'local-repos-api',
  ticket: 359,
  at: new Date().toISOString(),
  checks,
  stack: { api: API, homeDir: stack.homeDir, root: stack.root },
};
writeFileSync(join(EVIDENCE, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
writeFileSync(join(EVIDENCE, 'responses.json'), `${JSON.stringify(payloads, null, 2)}\n`);
console.log(`\n${checks.length - failures}/${checks.length} PASS`);
console.log(`evidence:${EVIDENCE}`);
process.exit(failures === 0 ? 0 : 1);
