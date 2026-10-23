// verify-cairn seed helper（#700 verdict 提取 verify 前置）：live 栈下
// seed provider（指向 stub-review-700.mjs）/agent/project/两个 todo + 一台
// 机器走完 plan → confirm phase。两个 todo 即两个场景：
//   A「审核探针」——plan 无 marker：stub 回 blocking verdict + set_task_meta
//     尾部工具调用（#519 形状）→ 预期：findings 提取成功、review→planning
//     回流触发。
//   B「提取失败探针」——plan 带 EXTRACT-FAIL-MARKER：stub 回纯散文 → 预期：
//     daemon findingsError → server「判定提取失败」+ extractionError 上浮。
// 输出 JSON { todoA, todoB, machineToken, apiKeyPlain, buildA, buildB, teamId,
// agentId } 到 stdout。用法：VERIFY_REPO_ROOT=<worktree> STUB_LLM_URL=http://127.0.0.1:8921/v1
// node setup-review-700-seed.mjs
//
// 不清理：与 drive-review-700 串行；cleanup 留给调用方走 cleanup.mjs。

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO =
  process.env.VERIFY_REPO_ROOT ??
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(REPO, '.claude/verify-run');
const ports = existsSync(join(RUN_DIR, 'ports.json'))
  ? JSON.parse(readFileSync(join(RUN_DIR, 'ports.json'), 'utf8'))
  : {};
const SERVER = `http://127.0.0.1:${ports.serverPort ?? process.env.VERIFY_PORT ?? 8791}`;
const STUB_LLM_URL = process.env.STUB_LLM_URL ?? 'http://127.0.0.1:8921/v1';

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

// 1. 拿 team
const teams = await jget('/api/teams');
if (teams.status !== 200 || !teams.body?.[0]) throw new Error(`teams status=${teams.status}`);
const teamId = teams.body[0].id;

// 2. provider（baseUrl = 本地 stub——与 9 端口不可达网关不同，这里必须真连，
//    daemon 的 pi 会话要真打这个端点）。
const providerId = 'stub-gw-700';
const prov = await jpost(`/api/teams/${teamId}/providers`, {
  providerId,
  label: 'Stub Gateway 700',
  baseUrl: STUB_LLM_URL,
  api: 'openai-completions',
  authHeader: true,
  compat: { supportsDeveloperRole: false },
  models: [{ id: 'stub-model', name: 'stub-model' }],
});
if (prov.status !== 201 && prov.status !== 200 && prov.status !== 409) {
  throw new Error(`provider status=${prov.status} body=${JSON.stringify(prov.body)}`);
}

// 3. agent
const agent = await jpost(`/api/teams/${teamId}/agents`, {
  displayName: 'verify-reviewer-700',
  provider: providerId,
  modelId: 'stub-model',
});
if (agent.status !== 201 && agent.status !== 200) {
  throw new Error(`agent status=${agent.status} body=${JSON.stringify(agent.body)}`);
}
const AGENT_ID = agent.body?.id ?? agent.body?.agentId ?? agent.body?.record?.id;
if (!AGENT_ID) throw new Error(`agent missing id in ${JSON.stringify(agent.body)}`);

// 4. project
const project = await jpost('/api/projects', { name: '审核探针 700' });
if (project.status !== 201)
  throw new Error(`project status=${project.status} body=${JSON.stringify(project.body)}`);
const projectId = project.body.id ?? project.body.projectId ?? project.body.record?.id;
if (!projectId) throw new Error(`project missing id in ${JSON.stringify(project.body)}`);

/** 建 todo + startBuilds（withPlan）→ claim plan 步 → 上传 plan.md → done
 * → confirm。plan 文本由调用方给（场景 B 的 plan 带 marker）。 */
async function seedTodo(title, spec, planText) {
  const todo = await jpost(`/api/projects/${projectId}/todos`, { title, spec });
  if (todo.status !== 201)
    throw new Error(`todo status=${todo.status} body=${JSON.stringify(todo.body)}`);
  const todoId = todo.body.id ?? todo.body.record?.id;
  if (!todoId) throw new Error(`todo missing id in ${JSON.stringify(todo.body)}`);
  const build = await jpost(`/api/projects/${projectId}/builds`, {
    todoIds: [todoId],
    assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
    withPlan: true,
  });
  if (build.status !== 201)
    throw new Error(`build status=${build.status} body=${JSON.stringify(build.body)}`);
  const buildId = build.body.builds?.[0]?.id;
  if (!buildId) throw new Error(`build missing id in ${JSON.stringify(build.body)}`);
  const claim = await jpost('/api/machine/tasks/claim', {}, machineTokenRef.token);
  const planStep = claim.body?.step?.step ?? claim.body?.step;
  if (!planStep || planStep.kind !== 'plan') {
    throw new Error(`plan claim failed body=${JSON.stringify(claim.body)}`);
  }
  const urls = await fetch(`${SERVER}/api/machine/upload-urls/${planStep.id}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${machineTokenRef.token}`,
    },
    body: JSON.stringify({ files: [{ name: 'plan.md' }] }),
  });
  if (urls.status !== 200) throw new Error(`upload-urls status=${urls.status}`);
  const { uploads } = await urls.json();
  const put = await fetch(`${SERVER}${uploads[0].url.replace(/^https?:\/\/[^/]+/, '')}`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${machineTokenRef.token}`,
      'content-type': 'text/markdown',
    },
    body: planText,
  });
  if (put.status !== 200) throw new Error(`put status=${put.status}`);
  const done = await jpost(
    `/api/machine/done/${planStep.id}`,
    { status: 'success', sessionId: `sess-plan-${todoId}` },
    machineTokenRef.token,
  );
  if (done.status !== 200) throw new Error(`done status=${done.status}`);
  const todoFace = await jget(`/api/todos/${todoId}`);
  if (todoFace.body.phase !== 'confirm') {
    throw new Error(`expected phase=confirm for ${title}, got ${todoFace.body.phase}`);
  }
  return { todoId, buildId };
}

// 5. api-key + enroll machine（先 enroll 再 seed todo——plan 步 claim 要用
//    machine token）。
const apiKey = await jpost(`/api/teams/${teamId}/api-keys`, {
  name: 'review-700-mbp',
  gitAccess: false,
  mcpAccess: false,
  toolGrants: { read: [], write: [] },
});
if (apiKey.status !== 201 && apiKey.status !== 200) {
  throw new Error(`api-key status=${apiKey.status} body=${JSON.stringify(apiKey.body)}`);
}
const apiKeyPlain =
  apiKey.body?.plaintext ?? apiKey.body?.record?.plaintext ?? apiKey.body?.token;
if (!apiKeyPlain) throw new Error(`api-key missing plaintext in ${JSON.stringify(apiKey.body)}`);
const enroll = await jpost(
  '/api/machine/enroll',
  { teamId, name: 'review-700-mbp', cliVersion: '0.1.0' },
  apiKeyPlain,
);
if (enroll.status !== 200)
  throw new Error(`enroll status=${enroll.status} body=${JSON.stringify(enroll.body)}`);
const machineTokenRef = { token: enroll.body?.token ?? enroll.body?.machine?.token };
if (!machineTokenRef.token) throw new Error('enroll missing token');

// 6. 两个场景 todo
const PLAN_A = '# plan v1（场景 A：blocking verdict 提取）\n\n## Changes\n- 加 parseInput\n';
const PLAN_B =
  '# plan v1（场景 B：EXTRACT-FAIL-MARKER 提取失败）\n\n## Changes\n- 加 parseInput\n';
const a = await seedTodo('审核探针', '写一段示例代码供 AI 审核', PLAN_A);
const b = await seedTodo('提取失败探针', '写一段示例代码供 AI 审核（提取失败场景）', PLAN_B);

process.stdout.write(
  `${JSON.stringify({
    todoA: a.todoId,
    buildA: a.buildId,
    todoB: b.todoId,
    buildB: b.buildId,
    machineToken: machineTokenRef.token,
    apiKeyPlain,
    teamId,
    agentId: AGENT_ID,
  })}\n`,
);
