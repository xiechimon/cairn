import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const REPO = '/workspace';
const RUN_DIR = join(REPO, '.claude/verify-run');
const stack = JSON.parse(readFileSync(join(RUN_DIR, 'ports.json'), 'utf8'));
const SERVER = `http://127.0.0.1:${stack.serverPort}`;
const EVIDENCE = process.env.EVIDENCE_DIR ?? '/tmp/1186-after';
const SKILLS_DIR = '/tmp/cairn-1186-skills';
const DAEMON_HOME = '/tmp/cairn-1186-daemon-home';
const DB = join(stack.homeDir, 'server', 'server.db');
const RUN_TAG = `1186-${Date.now().toString(36)}`;
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

async function jfetch(method, path, opts = {}) {
  const headers = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${SERVER}${path}`, {
    method,
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    signal: AbortSignal.timeout(20_000),
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

function startStub() {
  const requests = [];
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
      res.writeHead(404).end();
      return;
    }
    let raw = '';
    req.on('data', (d) => {
      raw += d;
    });
    req.on('end', () => {
      requests.push(JSON.parse(raw));
      const n = requests.length;
      const base = {
        id: 'chatcmpl-stub',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'stub-model',
      };
      const chunk = (payload) => `data: ${JSON.stringify(payload)}\n\n`;
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      res.write(
        chunk({
          ...base,
          choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
        }),
      );
      if (n % 2 === 1) {
        const callId = `call-${RUN_TAG}-${n}`;
        const args = JSON.stringify({ command: `printf "${RUN_TAG}-${n}\\n" >> README.md` });
        res.write(
          chunk({
            ...base,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: callId,
                      type: 'function',
                      function: { name: 'bash', arguments: '' },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          }),
        );
        res.write(
          chunk({
            ...base,
            choices: [
              {
                index: 0,
                delta: { tool_calls: [{ index: 0, function: { arguments: args } }] },
                finish_reason: null,
              },
            ],
          }),
        );
        res.write(
          chunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }),
        );
      } else {
        res.write(
          chunk({
            ...base,
            choices: [{ index: 0, delta: { content: 'done' }, finish_reason: null }],
          }),
        );
        res.write(chunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }));
      }
      res.write(
        chunk({
          ...base,
          choices: [],
          usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
        }),
      );
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}/v1`,
        requests,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

function writeSkills() {
  rmSync(SKILLS_DIR, { recursive: true, force: true });
  const files = [
    [
      'demo-skill/SKILL.md',
      '---\nname: demo-skill\ndescription: Probe skill named in the task text.\n---\n\n# demo-skill\n\nmarker DEMO-1186\n',
    ],
    [
      'extra-skill/SKILL.md',
      '---\nname: extra-skill\ndescription: Skill outside the allowlist.\n---\n\nextra body.\n',
    ],
  ];
  const roots = [SKILLS_DIR, join(stack.homeDir, 'skills')];
  for (const root of roots) {
    for (const [rel, content] of files) {
      const p = join(root, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content, 'utf8');
    }
  }
}

function openDb() {
  const require2 = createRequire(join(REPO, 'apps/server/package.json'));
  const Database = require2('better-sqlite3');
  return new Database(DB, { readonly: true });
}

function parseJson(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  try {
    const once = JSON.parse(value);
    if (typeof once === 'string') {
      try {
        return JSON.parse(once);
      } catch {
        return once;
      }
    }
    return once;
  } catch {
    return value;
  }
}

async function waitFor(pred, timeoutMs, label) {
  const started = Date.now();
  for (;;) {
    const v = await pred();
    if (v) return v;
    if (Date.now() - started > timeoutMs) throw new Error(`timeout: ${label}`);
    await new Promise((r) => setTimeout(r, 400));
  }
}

function daemonLogLines() {
  const p = join(DAEMON_HOME, 'daemon.log');
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').filter(Boolean);
}

function spawnDaemon(apiKey, teamId) {
  const env = { ...process.env };
  for (const k of [
    'http_proxy',
    'https_proxy',
    'all_proxy',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'ALL_PROXY',
  ]) {
    delete env[k];
  }
  env.NO_PROXY = '*';
  env.CAIRN_HOME = DAEMON_HOME;
  env.CAIRN_SKILLS_DIR = SKILLS_DIR;
  const out = join(EVIDENCE, 'daemon-console.txt');
  writeFileSync(out, '');
  const child = spawn(
    'pnpm',
    [
      'exec',
      'tsx',
      'src/cli.ts',
      'start',
      '--foreground',
      '--server',
      SERVER,
      '--api-key',
      apiKey,
      '--team',
      teamId,
      '--name',
      'verify-1186',
    ],
    { cwd: join(REPO, 'apps/daemon'), env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  child.stdout.on('data', (d) => appendFileSync(out, d));
  child.stderr.on('data', (d) => appendFileSync(out, d));
  return child;
}

function checkOf(messages) {
  for (const m of messages) {
    const content = parseJson(m.content);
    if (content && typeof content === 'object' && content.kind === 'skill_injection_check') {
      return content;
    }
  }
  return null;
}

async function main() {
  writeSkills();
  rmSync(DAEMON_HOME, { recursive: true, force: true });
  const stub = await startStub();
  const teams = await jfetch('GET', '/api/teams');
  const teamId = teams.body[0]?.id;
  if (!teamId) throw new Error(`no team ${JSON.stringify(teams.body).slice(0, 200)}`);
  const providerId = `stub-${RUN_TAG}`;
  const provider = await jfetch('POST', `/api/teams/${teamId}/providers`, {
    body: {
      providerId,
      label: providerId,
      baseUrl: stub.url,
      api: 'openai-completions',
      authHeader: true,
      compat: { supportsDeveloperRole: false },
      models: [{ id: 'stub-model', name: 'stub-model' }],
    },
  });
  if (provider.status >= 400) {
    throw new Error(`provider ${provider.status} ${JSON.stringify(provider.body).slice(0, 300)}`);
  }
  const keyRes = await jfetch('POST', `/api/teams/${teamId}/api-keys`, {
    body: {
      name: `probe-${RUN_TAG}`,
      gitAccess: false,
      mcpAccess: false,
      toolGrants: { read: [], write: [] },
    },
  });
  const apiKey = keyRes.body?.plaintext ?? keyRes.body?.key;
  if (!apiKey) {
    throw new Error(`api key ${keyRes.status} ${JSON.stringify(keyRes.body).slice(0, 200)}`);
  }
  const proj = await jfetch('POST', '/api/projects', { body: { name: `probe-${RUN_TAG}` } });
  const projectId = proj.body?.id;
  if (!projectId) {
    throw new Error(`project ${proj.status} ${JSON.stringify(proj.body).slice(0, 200)}`);
  }

  const daemon = spawnDaemon(apiKey, teamId);
  try {
    await waitFor(
      () => daemonLogLines().some((l) => l.includes('[wake] push channel connected')),
      60_000,
      'daemon online',
    );
    const machines = await jfetch('GET', `/api/teams/${teamId}/machines`);
    const machine =
      (Array.isArray(machines.body) ? machines.body : []).find((m) => m.online) ??
      machines.body?.[0];
    save('machines.json', machines.body);
    if (!machine?.id) throw new Error(`no machine ${JSON.stringify(machines.body).slice(0, 300)}`);

    async function makeAgent(name, skillsAllowlist) {
      const res = await jfetch('POST', `/api/teams/${teamId}/agents`, {
        body: {
          displayName: name,
          provider: providerId,
          modelId: 'stub-model',
          machineId: machine.id,
          skillsAllowlist,
        },
      });
      const id = res.body?.id;
      if (!id) {
        throw new Error(`agent ${name} ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`);
      }
      const got = await jfetch('GET', `/api/teams/${teamId}/agents/${id}`);
      return { id, record: got.body };
    }

    const openAgent = await makeAgent('1186-open', ['demo-skill']);
    const closedAgent = await makeAgent('1186-closed', []);
    save('agents.json', { open: openAgent.record, closed: closedAgent.record });
    check(
      'closed agent persisted skillsAllowlist []',
      Array.isArray(closedAgent.record?.skillsAllowlist) &&
        closedAgent.record.skillsAllowlist.length === 0,
      JSON.stringify(closedAgent.record?.skillsAllowlist),
    );

    async function makeTask(agentId, title) {
      const todoRes = await jfetch('POST', `/api/projects/${projectId}/todos`, {
        body: { title, spec: 'Write a one-line note. The task text names demo-skill.' },
      });
      const todoId = todoRes.body?.id;
      const buildRes = await jfetch('POST', `/api/projects/${projectId}/builds`, {
        body: {
          todoIds: [todoId],
          assignment: { plan: null, build: { agentId } },
          withPlan: false,
        },
      });
      const buildId = buildRes.body?.builds?.[0]?.id;
      if (!todoId || !buildId) {
        throw new Error(`task ${JSON.stringify(buildRes.body).slice(0, 300)}`);
      }
      return { todoId, buildId };
    }

    async function waitTerminal(buildId) {
      return waitFor(
        () => {
          const db = openDb();
          try {
            const rows = db
              .prepare('SELECT id, kind, status, skillInjection FROM step WHERE buildId = ?')
              .all(buildId);
            const terminal = rows.filter((r) => ['done', 'failed', 'stopped'].includes(r.status));
            if (terminal.length === 0) return null;
            const messages = db
              .prepare('SELECT id, role, content FROM message WHERE conversationId = ?')
              .all(buildId);
            return { rows, messages };
          } finally {
            db.close();
          }
        },
        180_000,
        `terminal ${buildId}`,
      );
    }

    const openTask = await makeTask(openAgent.id, 'Please use demo-skill and write a note');
    const openDone = await waitTerminal(openTask.buildId);
    const closedTask = await makeTask(closedAgent.id, 'Please use demo-skill and write a note');
    const closedDone = await waitTerminal(closedTask.buildId);

    const skillLogs = daemonLogLines().filter((l) => l.includes('[skills]'));
    save('skills-log.txt', `${skillLogs.join('\n')}\n`);
    const openSteps = openDone.rows.map((r) => ({
      ...r,
      skillInjection: parseJson(r.skillInjection),
    }));
    const closedSteps = closedDone.rows.map((r) => ({
      ...r,
      skillInjection: parseJson(r.skillInjection),
    }));
    const openMessages = openDone.messages.map((m) => ({ ...m, content: parseJson(m.content) }));
    const closedMessages = closedDone.messages.map((m) => ({
      ...m,
      content: parseJson(m.content),
    }));
    save('open-step.json', openSteps);
    save('closed-step.json', closedSteps);
    save('open-messages.json', openMessages);
    save('closed-messages.json', closedMessages);

    const openCheck = checkOf(openDone.messages);
    const closedCheck = checkOf(closedDone.messages);
    save('open-check.json', openCheck);
    save('closed-check.json', closedCheck);

    check(
      'open step still done',
      openSteps.at(-1)?.status === 'done',
      openSteps.at(-1)?.status ?? 'missing',
    );
    check(
      'closed step still done',
      closedSteps.at(-1)?.status === 'done',
      closedSteps.at(-1)?.status ?? 'missing',
    );
    check(
      'open check is yellow injected-unread and not red',
      openCheck?.level === 'yellow' &&
        openCheck.reds?.length === 0 &&
        openCheck.injected?.includes('demo-skill') &&
        openCheck.yellows?.some((y) => y.code === 'injected-unread' && y.skill === 'demo-skill'),
      JSON.stringify(openCheck),
    );
    check(
      'closed check is red allowlist-closed with empty injected',
      closedCheck?.level === 'red' &&
        closedCheck.reds?.some((r) => r.code === 'allowlist-closed') &&
        Array.isArray(closedCheck.injected) &&
        closedCheck.injected.length === 0,
      JSON.stringify(closedCheck),
    );
    check(
      'step.skillInjection stays the requested hit set',
      openSteps.at(-1)?.skillInjection?.hits?.[0]?.id === 'demo-skill' &&
        !Array.isArray(openSteps.at(-1)?.skillInjection?.injected),
      JSON.stringify(openSteps.at(-1)?.skillInjection),
    );

    const passed = checks.filter((c) => c.ok).length;
    save('result.json', { probe: '1186-after', passed, total: checks.length, checks });
    process.stdout.write(`\n${passed}/${checks.length} → ${EVIDENCE}\n`);
    if (checks.some((c) => !c.ok)) process.exitCode = 1;
  } finally {
    daemon.kill('SIGTERM');
    await Promise.race([stub.close(), new Promise((r) => setTimeout(r, 1500))]);
  }
  process.exit(process.exitCode ?? 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
