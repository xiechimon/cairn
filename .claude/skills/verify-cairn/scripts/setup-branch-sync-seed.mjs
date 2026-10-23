#!/usr/bin/env node
// verify-cairn seed helper（M7 #319 branch-sync probe 前置）：造一个可被真
// daemon 同步的现场，输出 JSON { todoId, buildId, teamId, apiKey, ref, commit,
// directory, origin } 到 stdout。
//
// 为什么需要「预备现场」而不是纯 API seed：同步是 daemon 执行面（git 操作），
// 面板显示的目标机器、ref、commit 三件都来自 build 的真实数据——ref =
// `cairn/conv-<buildId>`（brand.conversationBranch），commit = step 表的
// checkpointCommit（build info 取它前 7 位）。所以这里：
//   1) 走 API 建 provider/agent/project/todo/build（同 setup-review-seed）
//   2) 在 /tmp 造一个**真 git 现场**：bare origin + 目标克隆，origin 上是
//      两次提交 C1→C2，目标是「停在 C1 + 有未提交改动 + 有未跟踪文件」的脏态
//   3) 把 build 的 step.checkpointCommit 置为 C2（daemon 复位目标）
// 同步跑完后目标应变成「HEAD==C2 + 工作区干净」——脏态差异就是同步真做了事
// 的证据，不会被「本来就干净」蒙混过去。
//
// 不清理：与 drive-branch-sync 串行；daemon 由调用方起、调用方收。

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

/** 现场根：按 buildId 分目录，避免并行/重跑互相覆写。 */
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

// 1. team
const teams = await jget('/api/teams');
if (teams.status !== 200 || !teams.body?.[0]) throw new Error(`teams status=${teams.status}`);
const teamId = teams.body[0].id;

// 2. provider（数据面即可；409 = 已存在，跳过）
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

// 3. agent
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

// 4. project / 5. todo / 6. build
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

// 7. api-key（调用方拿它起 daemon；daemon 自注册的机器才会是 online）
const apiKey = await jpost(`/api/teams/${teamId}/api-keys`, {
  name: 'branch-sync-mbp',
  gitAccess: false,
  mcpAccess: false,
  toolGrants: { read: [], write: [] },
});
if (![201, 200].includes(apiKey.status)) throw new Error(`api-key status=${apiKey.status}`);
const apiKeyPlain = apiKey.body?.plaintext ?? apiKey.body?.record?.plaintext ?? apiKey.body?.token;
if (!apiKeyPlain) throw new Error(`api-key missing plaintext in ${JSON.stringify(apiKey.body)}`);

// 8. 真 git 现场
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

// 目标 = origin 的克隆，然后退到 C1 并弄脏（未提交改动 + 未跟踪文件）。
// 同步后应回到 C2 且工作区干净——脏态就是同步确实做了事的判据。
git(['clone', originDir, directory]);
git(['config', 'user.email', 'verify@cairn.local'], directory);
git(['config', 'user.name', 'verify-cairn'], directory);
git(['reset', '--hard', c1], directory);
writeFileSync(join(directory, 'a.txt'), 'C1\ndirty local change\n');
writeFileSync(join(directory, 'junk.txt'), 'untracked junk\n');

// 9. 置 step.checkpointCommit = C2（build info 的 commit 字段取它前 7 位）
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