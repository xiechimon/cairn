// verify-cairn seed helper（M7 #312 review-modal probe 前置）：live 栈下
// seed provider/agent/project/todo + 一台机器走完 plan → confirm phase。
// 输出 JSON { todoId, machineToken, buildId, teamId, agentId } 到 stdout。
// 用法：VERIFY_REPO_ROOT=<worktree> node setup-review-seed.mjs
//
// 不清理：与 drive-review 串行；cleanup 留给调用方走 cleanup.mjs。

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

// 1. 拿 team（session 不带 teamId；teams 读面）
const teams = await jget('/api/teams');
if (teams.status !== 200 || !teams.body?.[0]) throw new Error(`teams status=${teams.status}`);
const teamId = teams.body[0].id;

// 2. provider（指向不可达网关无所谓；只是数据面）。409 = 已被前一 seed 创建，跳过。
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
if (prov.status !== 201 && prov.status !== 200 && prov.status !== 409) {
  throw new Error(`provider status=${prov.status} body=${JSON.stringify(prov.body)}`);
}

// 3. agent（createAgentBodySchema：displayName/provider/modelId）
const agent = await jpost(`/api/teams/${teamId}/agents`, {
  displayName: 'verify-builder',
  provider: providerId,
  modelId: 'stub-model',
});
if (agent.status !== 201 && agent.status !== 200) {
  throw new Error(`agent status=${agent.status} body=${JSON.stringify(agent.body)}`);
}
const AGENT_ID = agent.body?.id ?? agent.body?.agentId ?? agent.body?.record?.id;
if (!AGENT_ID) throw new Error(`agent missing id in ${JSON.stringify(agent.body)}`);

// 4. project（createProjectBodySchema：name）
const project = await jpost('/api/projects', { name: '审核探针' });
if (project.status !== 201) throw new Error(`project status=${project.status} body=${JSON.stringify(project.body)}`);
const projectId = project.body.id ?? project.body.projectId ?? project.body.record?.id;
if (!projectId) throw new Error(`project missing id in ${JSON.stringify(project.body)}`);

// 5. todo（createTodoBodySchema：title/spec）
const todo = await jpost(`/api/projects/${projectId}/todos`, {
  title: '审核探针',
  spec: '写一段示例代码供 AI 审核',
});
if (todo.status !== 201) throw new Error(`todo status=${todo.status} body=${JSON.stringify(todo.body)}`);
const todoId = todo.body.id ?? todo.body.record?.id;
if (!todoId) throw new Error(`todo missing id in ${JSON.stringify(todo.body)}`);

// 6. 起 build（startBuildsBodySchema：todoIds/assignment/withPlan）
const build = await jpost(`/api/projects/${projectId}/builds`, {
  todoIds: [todoId],
  assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
  withPlan: true,
});
if (build.status !== 201) throw new Error(`build status=${build.status} body=${JSON.stringify(build.body)}`);
const buildId = build.body.builds?.[0]?.id;
if (!buildId) throw new Error(`build missing id in ${JSON.stringify(build.body)}`);

// 7. api-key（enroll 用 Bearer apiKey，cairn_<48hex>，02 §8）
const apiKey = await jpost(`/api/teams/${teamId}/api-keys`, {
  name: 'review-mbp',
  gitAccess: false,
  mcpAccess: false,
  toolGrants: { read: [], write: [] },
});
if (apiKey.status !== 201 && apiKey.status !== 200) {
  throw new Error(`api-key status=${apiKey.status} body=${JSON.stringify(apiKey.body)}`);
}
const apiKeyPlain = apiKey.body?.plaintext ?? apiKey.body?.record?.plaintext ?? apiKey.body?.token;
if (!apiKeyPlain) throw new Error(`api-key missing plaintext in ${JSON.stringify(apiKey.body)}`);

// 8. enroll machine（Bearer = apiKey 明文）
const enroll = await jpost('/api/machine/enroll', {
  teamId,
  name: 'review-mbp',
  cliVersion: '0.1.0',
}, apiKeyPlain);
if (enroll.status !== 200) throw new Error(`enroll status=${enroll.status} body=${JSON.stringify(enroll.body)}`);
const machineToken = enroll.body?.token ?? enroll.body?.machine?.token;

// 9. claim plan step（#951 维护轮：claim 前先打 presence 拍——假机器不发
// 心跳，enroll 的 online 窗过期后 claimed 步会被释放扫尾摘走；见
// drive-review-reject.mjs machineClaimDone 同注。）
await jpost('/api/machine/presence', {}, machineToken);
const claim = await jpost('/api/machine/tasks/claim', {}, machineToken);
// 响应形状:{step:{step:{id,kind,...},conversationId,session,todo,project,agent,remoteTools}}
const planStep = claim.body?.step?.step ?? claim.body?.step;
if (!planStep || planStep.kind !== 'plan') {
  throw new Error(`plan claim failed body=${JSON.stringify(claim.body)}`);
}

// 10. upload plan.md（直连 fetch，与 jpost 共验 token 是否被改坏）
const urls = await fetch(`${SERVER}/api/machine/upload-urls/${planStep.id}`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    authorization: `Bearer ${machineToken}`,
  },
  body: JSON.stringify({ files: [{ name: 'plan.md' }] }),
});
const urlsText = await urls.text();
if (urls.status !== 200) {
  throw new Error(`upload-urls status=${urls.status} body=${urlsText}`);
}
const { uploads } = JSON.parse(urlsText);
const up = uploads[0];
const put = await fetch(`${SERVER}${up.url.replace(/^https?:\/\/[^/]+/, '')}`, {
  method: 'PUT',
  headers: { authorization: `Bearer ${machineToken}`, 'content-type': 'text/markdown' },
  body: '# plan v1\n\n审核探针方案\n',
});
if (put.status !== 200) throw new Error(`put status=${put.status}`);

// 11. mark plan done → phase 推进 confirm
const done = await jpost(`/api/machine/done/${planStep.id}`, { status: 'success' }, machineToken);
if (done.status !== 200) throw new Error(`done status=${done.status} body=${JSON.stringify(done.body)}`);

// 12. 验证 phase
const todoFace = await jget(`/api/todos/${todoId}`);
if (todoFace.body.phase !== 'confirm') {
  throw new Error(`expected phase=confirm, got ${todoFace.body.phase}`);
}

process.stdout.write(
  `${JSON.stringify({ todoId, machineToken, buildId, teamId, agentId: AGENT_ID })}\n`,
);
