import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const API = `http://127.0.0.1:${process.env.VERIFY_PORT ?? 8791}`;
const OUT = new URL('.', import.meta.url).pathname;

async function call(method, path, body, token) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text === '' ? null : JSON.parse(text) };
}

const steps = [];
async function step(name, method, path, body) {
  const result = await call(method, path, body);
  steps.push({ name, request: `${method} ${path}`, ...(body ? { body } : {}), ...result });
  return result;
}

const [team] = (await call('GET', '/api/teams')).body;
await call('POST', `/api/teams/${team.id}/providers`, {
  providerId: 'stub-gw',
  label: 'Stub Gateway',
  baseUrl: 'http://127.0.0.1:9/v1',
  api: 'openai-completions',
  authHeader: true,
  compat: { supportsDeveloperRole: false },
  models: [{ id: 'stub-model', name: 'stub-model' }],
});
const key = await call('POST', `/api/teams/${team.id}/api-keys`, {
  name: 'coordinator-walk',
  gitAccess: false,
  mcpAccess: false,
  machineAccess: true,
  toolGrants: { read: [], write: [] },
});
const enroll = await call(
  'POST',
  '/api/machine/enroll',
  { teamId: team.id, name: 'coordinator-walk-machine', cliVersion: '0.1.0' },
  key.body.plaintext ?? key.body.token,
);
const agent = await call('POST', `/api/teams/${team.id}/agents`, {
  displayName: 'Coordinator',
  provider: 'stub-gw',
  modelId: 'stub-model',
  machineId: enroll.body.machineId ?? enroll.body.id,
});
await step('bind the Coordinator agent', 'PATCH', `/api/teams/${team.id}/chief`, {
  agent: { agentId: agent.body.id },
});
const created = await step('create project api-latency', 'POST', '/api/projects', {
  name: 'api-latency',
  description: 'Bring p95 latency under 200 ms across the whole API.',
  teamId: team.id,
});
const pid = created.body.id;
await step('no conversation yet', 'GET', `/api/projects/${pid}/coordinator`);
const first = await step('first message opens it', 'POST', `/api/projects/${pid}/coordinator/messages`, {
  content: 'Make a plan',
});
await step('second message reuses it', 'POST', `/api/projects/${pid}/coordinator/messages`, {
  content: 'Add a repo',
});
await step('the project conversation', 'GET', `/api/projects/${pid}/coordinator`);
await step('archive', 'POST', `/api/projects/${pid}/archive`);
await step('send while archived', 'POST', `/api/projects/${pid}/coordinator/messages`, {
  content: 'still there?',
});
await step('follow-up via conversation route while archived', 'POST', `/api/conversations/${first.body.thread.id}/messages`, {
  content: 'still there?',
});
await step('unarchive', 'POST', `/api/projects/${pid}/unarchive`);
await step('send after unarchive', 'POST', `/api/projects/${pid}/coordinator/messages`, {
  content: 'Pick up recent work',
});
const threads = await call('GET', `/api/teams/${team.id}/chief/threads`);
steps.push({
  name: 'team thread list leaves the project conversation out',
  request: `GET /api/teams/${team.id}/chief/threads`,
  status: threads.status,
  containsProjectThread: threads.body.some((t) => t.id === first.body.thread.id),
});

writeFileSync(join(OUT, 'coordinator-live.json'), `${JSON.stringify(steps, null, 2)}\n`);
for (const s of steps) console.log(s.status, s.name);
