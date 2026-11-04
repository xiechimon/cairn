#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const REPO = process.env.VERIFY_REPO_ROOT ?? SCRIPT_REPO;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(REPO, '.claude/verify-run');
const ports = existsSync(join(RUN_DIR, 'ports.json'))
  ? JSON.parse(readFileSync(join(RUN_DIR, 'ports.json'), 'utf8'))
  : {};
const SERVER = `http://127.0.0.1:${ports.serverPort ?? process.env.VERIFY_PORT ?? 8791}`;
const DB_PATH = join(RUN_DIR, 'home/server/server.db');

const siteRootOf = (buildId) => join('/tmp', 'cairn-verify-branch-sync', buildId);

async function jget(path) {
  const res = await fetch(`${SERVER}${path}`);
  return { status: res.status, body: await res.json() };
}
async function jpost(path, body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${SERVER}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  let parsed = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = await res.text();
  }
  return { status: res.status, body: parsed };
}

const git = (args, cwd) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const teams = await jget('/api/teams');
if (teams.status !== 200 || !teams.body?.[0]) throw new Error(`teams status=${teams.status}`);
const teamId = teams.body[0].id;

const providerId = 'stub-gw';
const prov = await jpost(`/api/teams/${teamId}/providers`, {
  providerId,
  label: 'Stub Gateway',
  baseUrl: 'http://127.0.0.1:9/v1',
  api: 'openai-completions',
  authHeader: true,
  compat: { supportsDeveloperRole: false },
  models: [{ id: 'stub-model', name: 'stub-model' }],
});
if (![201, 200, 409].includes(prov.status)) {
  throw new Error(`provider status=${prov.status} body=${JSON.stringify(prov.body)}`);
}

const agent = await jpost(`/api/teams/${teamId}/agents`, {
  displayName: 'verify-sync-builder',
  provider: providerId,
  modelId: 'stub-model',
});
if (![201, 200].includes(agent.status)) {
  throw new Error(`agent status=${agent.status} body=${JSON.stringify(agent.body)}`);
}
const agentId = agent.body?.id ?? agent.body?.agentId ?? agent.body?.record?.id;
if (!agentId) throw new Error(`agent missing id in ${JSON.stringify(agent.body)}`);

const project = await jpost('/api/projects', { name: '分支同步探针' });
if (project.status !== 201) throw new Error(`project status=${project.status}`);
const projectId = project.body.id ?? project.body.record?.id;

const todo = await jpost(`/api/projects/${projectId}/todos`, {
  title: '分支同步探针',
  spec: '造一个可被同步的 build',
});
if (todo.status !== 201) throw new Error(`todo status=${todo.status}`);
const todoId = todo.body.id ?? todo.body.record?.id;

const build = await jpost(`/api/projects/${projectId}/builds`, {
  todoIds: [todoId],
  assignment: { plan: { agentId }, build: { agentId } },
  withPlan: true,
});
if (build.status !== 201) throw new Error(`build status=${build.status}`);
const buildId = build.body.builds?.[0]?.id;
if (!buildId) throw new Error(`build missing id in ${JSON.stringify(build.body)}`);

const apiKey = await jpost(`/api/teams/${teamId}/api-keys`, {
  name: 'branch-sync-mbp',
  gitAccess: false,
  mcpAccess: false,
  toolGrants: { read: [], write: [] },
});
if (![201, 200].includes(apiKey.status)) throw new Error(`api-key status=${apiKey.status}`);
const apiKeyPlain = apiKey.body?.plaintext ?? apiKey.body?.record?.plaintext ?? apiKey.body?.token;
if (!apiKeyPlain) throw new Error(`api-key missing plaintext in ${JSON.stringify(apiKey.body)}`);

const branch = `cairn/conv-${buildId}`;
const siteRoot = siteRootOf(buildId);
const originDir = join(siteRoot, 'origin.git');
const workDir = join(siteRoot, 'work');
const directory = join(siteRoot, 'workspaces', buildId);
mkdirSync(siteRoot, { recursive: true });

git(['init', '--bare', '--initial-branch', branch, originDir]);
git(['symbolic-ref', 'HEAD', `refs/heads/${branch}`], originDir);
git(['clone', originDir, workDir]);
git(['config', 'user.email', 'verify@cairn.local'], workDir);
git(['config', 'user.name', 'verify-cairn'], workDir);
git(['checkout', '-b', branch], workDir);
writeFileSync(join(workDir, 'a.txt'), 'C1\n');
git(['add', 'a.txt'], workDir);
git(['commit', '-m', 'C1'], workDir);
const c1 = git(['rev-parse', 'HEAD'], workDir);
writeFileSync(join(workDir, 'b.txt'), 'C2\n');
git(['add', 'b.txt'], workDir);
git(['commit', '-m', 'C2'], workDir);
const c2 = git(['rev-parse', 'HEAD'], workDir);
git(['push', 'origin', branch], workDir);

git(['clone', originDir, directory]);
git(['config', 'user.email', 'verify@cairn.local'], directory);
git(['config', 'user.name', 'verify-cairn'], directory);
git(['reset', '--hard', c1], directory);
writeFileSync(join(directory, 'a.txt'), 'C1\ndirty local change\n');
writeFileSync(join(directory, 'junk.txt'), 'untracked junk\n');

const require2 = createRequire(join(REPO, 'apps', 'server', 'package.json'));
const Database = require2('better-sqlite3');
const db = new Database(DB_PATH);
try {
  const info = db
    .prepare('UPDATE step SET checkpointCommit = ? WHERE buildId = ?')
    .run(c2, buildId);
  if (info.changes < 1) throw new Error(`no step row updated for build ${buildId}`);
} finally {
  db.close();
}

process.stdout.write(
  `${JSON.stringify({
    todoId,
    buildId,
    teamId,
    agentId,
    apiKey: apiKeyPlain,
    ref: branch,
    commit: c2,
    c1,
    directory,
    origin: originDir,
  })}\n`,
);
