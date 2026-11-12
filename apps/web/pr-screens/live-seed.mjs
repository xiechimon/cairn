const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const FAILED_ERROR = '未配置模型：这个 Agent 还没有可用的模型，请在设置里选一个后重试。';

const DIFF =
  'diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1,3 +1,4 @@\n # cairn-demo\n+![CI](https://github.com/example/cairn-demo/actions/workflows/ci.yml/badge.svg)\n';

export function client(server) {
  async function call(method, path, body, token) {
    const headers = { 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(server + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (res.status >= 400)
      throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return {
    get: (path) => call('GET', path),
    post: (path, body, token) => call('POST', path, body, token),
    call,
  };
}

export async function seedWorld(server) {
  const { post, get, call } = client(server);

  const claim = async (token) => {
    await sleep(1500);
    const claimed = await post('/api/machine/tasks/claim', { maxWorkers: 8 }, token);
    return claimed?.step?.step ?? claimed?.step ?? null;
  };

  const teamId = (await get('/api/teams'))[0].id;
  await post(`/api/teams/${teamId}/providers`, {
    providerId: 'stub-gw',
    label: 'Stub Gateway',
    baseUrl: 'http://127.0.0.1:9/v1',
    api: 'openai-completions',
    authHeader: true,
    compat: { supportsDeveloperRole: false },
    models: [{ id: 'stub-model', name: 'stub-model' }],
  });

  await call('PATCH', `/api/teams/${teamId}`, { claudeUsage: 'allow-paid' });
  for (const use of ['session', 'review']) {
    await call('PATCH', `/api/teams/${teamId}/routing-rules/${use}`, {
      provider: 'stub-gw',
      modelId: 'stub-model',
    });
  }

  const enroll = async (name) => {
    const key = await post(`/api/teams/${teamId}/api-keys`, {
      name: `screens-${name}`,
      machineAccess: true,
      gitAccess: false,
      mcpAccess: false,
      toolGrants: { read: [], write: [] },
    });
    const plain = key.plaintext ?? key.record?.plaintext ?? key.token;
    const enrolled = await post('/api/machine/enroll', { teamId, name, cliVersion: '0.1.0' }, plain);
    return {
      token: enrolled.token ?? enrolled.machine?.token,
      id: enrolled.machineId ?? enrolled.machine?.id,
    };
  };
  const online = await enroll('studio-linux');
  await enroll('xmons-mac');

  const agent = await post(`/api/teams/${teamId}/agents`, {
    displayName: 'builder',
    provider: 'stub-gw',
    modelId: 'stub-model',
    machineId: online.id,
  });
  const agentId = agent.id ?? agent.agentId ?? agent.record?.id;
  await call('PATCH', `/api/teams/${teamId}/chief`, { agent: { agentId, thinkingLevel: null } });
  await post('/api/machine/presence', { cliVersion: '0.1.0' }, online.token);

  const project = await post('/api/projects', { name: 'cairn-demo' });
  const projectId = project.id ?? project.record?.id;

  const todoIds = {};
  const build = async (label, title, spec) => {
    const todo = await post(`/api/projects/${projectId}/todos`, { title, spec });
    todoIds[label] = todo.id ?? todo.record?.id;
    await post(`/api/projects/${projectId}/builds`, {
      todoIds: [todoIds[label]],
      assignment: { plan: { agentId }, build: { agentId } },
      withPlan: false,
    });
    const step = await claim(online.token);
    if (!step) throw new Error(`no step for ${label}`);
    return step;
  };

  const review = await build('review', '给 README 加 CI 徽章', '在 README 顶部加 GitHub Actions 状态徽章。');
  await post(
    `/api/machine/done/${review.id}`,
    {
      status: 'success',
      hasChanges: true,
      prUrl: 'https://github.com/example/cairn-demo/pull/42',
      prNumber: 42,
      changesDiff: DIFF,
    },
    online.token,
  );

  const running = await build('running', '修复登录页闪烁', '登录页首屏有白闪，定位并修复。');
  await post(
    `/api/machine/tool/${running.id}`,
    { kind: 'transcript_delta', text: '先读 apps/web/src/main.tsx 和主题初始化顺序。\n' },
    online.token,
  );
  await sleep(150);

  await post(`/api/teams/${teamId}/coordinator/messages`, {
    content: '帮我把 PR #42 合并前再检查一遍，有问题先问我。',
    clientMessageId: crypto.randomUUID(),
  });
  const chief = await claim(online.token);
  if (chief?.kind !== 'chief') throw new Error(`chief claim got ${JSON.stringify(chief)}`);
  await post(
    `/api/machine/ask/${chief.id}?holdMs=0`,
    {
      requestId: `ask-${crypto.randomUUID()}`,
      questions: [
        {
          header: '合并方式',
          question: 'PR #42 只改了 README，CI 还在跑。要现在合并，还是等 CI 绿了再合？',
          options: [
            { label: '等 CI 绿了再合', description: '大约 6 分钟', recommended: true },
            { label: '现在合并', description: '只改文档，风险低' },
            { label: '先别合', description: '我想自己看一下 diff' },
          ],
        },
      ],
    },
    online.token,
  );

  const failed = await build('failed', '升级依赖到 pnpm 10', '把 packageManager 升到 pnpm 10，跑通 CI。');
  await post(`/api/machine/tool/${failed.id}`, { kind: 'transcript_delta', text: '运行 pnpm install…' }, online.token);
  await post(`/api/machine/done/${failed.id}`, { status: 'failed', errorMessage: FAILED_ERROR }, online.token);

  return { teamId, projectId, todoIds, token: online.token, liveStepIds: [running.id, chief.id] };
}

export async function keepAlive(server, state) {
  const { post } = client(server);
  await post('/api/machine/presence', { cliVersion: '0.1.0' }, state.token);
  for (const id of state.liveStepIds) {
    await post(`/api/machine/heartbeat/${id}`, {}, state.token).catch(() => undefined);
  }
}
