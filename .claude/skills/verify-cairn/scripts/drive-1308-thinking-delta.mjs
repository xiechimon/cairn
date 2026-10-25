#!/usr/bin/env node

import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SCRIPT_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const REPO = process.env.VERIFY_REPO_ROOT ?? SCRIPT_REPO;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(REPO, '.claude/verify-run');
const EXPECT = process.argv.includes('--expect=old') ? 'old' : 'new';
const MARKER = 'REASONING-MARKER-1308';
const portsFile = join(RUN_DIR, 'ports.json');
if (!existsSync(portsFile)) {
  process.stderr.write('无栈：' + portsFile + ' 不存在。先跑 launch.mjs\n');
  process.exit(1);
}
const stack = JSON.parse(readFileSync(portsFile, 'utf8'));
const SERVER = 'http://127.0.0.1:' + (stack.serverPort ?? 8791);
const WEB = 'http://127.0.0.1:' + (stack.webPort ?? 5273);
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ??
  join(SCRIPT_REPO, '.claude/verify-evidence/' + ts + '-1308-thinking-delta-' + EXPECT);
mkdirSync(EVIDENCE, { recursive: true });

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail: detail ?? null });
  process.stdout.write((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  — ' + detail : '') + '\n');
}
function save(name, data) {
  writeFileSync(join(EVIDENCE, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n');
}

async function sendJson(path, body, method, token) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = 'Bearer ' + token;
  const res = await fetch(SERVER + path, {
    method: method ?? 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function openStream(conversationId) {
  const frames = [];
  const ctrl = new AbortController();
  const done = (async () => {
    const res = await fetch(SERVER + '/api/conversations/' + conversationId + '/stream', {
      signal: ctrl.signal,
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done: ended } = await reader.read();
      if (ended) break;
      buf += decoder.decode(value, { stream: true });
      let idx = buf.indexOf('\n\n');
      while (idx >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of frame.split('\n')) {
          if (line.startsWith('data:')) {
            try {
              frames.push(JSON.parse(line.slice(5).trim()));
            } catch {
              frames.push({ raw: line });
            }
          }
        }
        idx = buf.indexOf('\n\n');
      }
    }
  })();
  return {
    frames,
    close() {
      ctrl.abort();
      return done.catch(() => {});
    },
  };
}

const teams = await sendJson('/api/teams', undefined, 'GET');
const teamId = teams.body?.[0]?.id;
if (!teamId) throw new Error('无 team');
const runTag = Date.now().toString(36);
const prov = await sendJson('/api/teams/' + teamId + '/providers', {
  providerId: 'stub-1308-' + runTag,
  label: 'stub-1308',
  baseUrl: 'http://127.0.0.1:9/v1',
  api: 'openai-completions',
  authHeader: true,
  compat: { supportsDeveloperRole: false },
  models: [{ id: 'stub-model', name: 'stub-model' }],
});
if (prov.status >= 400) throw new Error('provider ' + prov.status);
const key = await sendJson('/api/teams/' + teamId + '/api-keys', {
  name: 'probe-1308-' + runTag,
  gitAccess: false,
  mcpAccess: false,
  toolGrants: { read: [], write: [] },
});
const plaintext = key.body?.plaintext ?? key.body?.key;
if (!plaintext) throw new Error('api-key ' + key.status);
const enroll = await sendJson(
  '/api/machine/enroll',
  { teamId, name: 'probe-1308-' + runTag, cliVersion: '0.1.0' },
  'POST',
  plaintext,
);
const machineToken = enroll.body?.token;
const machineId = enroll.body?.machineId;
if (enroll.status !== 200 || !machineToken || !machineId) {
  throw new Error('enroll ' + enroll.status + ' ' + JSON.stringify(enroll.body).slice(0, 200));
}
const agent = await sendJson('/api/teams/' + teamId + '/agents', {
  displayName: 'probe-1308-' + runTag,
  provider: 'stub-1308-' + runTag,
  modelId: 'stub-model',
  machineId,
  skillsAllowlist: null,
});
const agentId = agent.body?.id ?? agent.body?.agent?.id;
if (!agentId) throw new Error('agent ' + agent.status + ' ' + JSON.stringify(agent.body).slice(0, 240));
const project = await sendJson('/api/projects', { name: 'probe-1308-' + runTag, teamId });
const projectId = project.body?.id;
if (!projectId) throw new Error('project ' + project.status);
const todoRes = await sendJson('/api/projects/' + projectId + '/todos', {
  title: '1308 思考流探针',
  spec: '断言思考正文是否进会话流。',
});
const todoId = todoRes.body?.id;
const buildRes = await sendJson('/api/projects/' + projectId + '/builds', {
  todoIds: [todoId],
  assignment: { plan: { agentId }, build: { agentId } },
  withPlan: false,
});
const buildId = buildRes.body?.builds?.[0]?.id;
if (!todoId || !buildId) throw new Error('task ' + JSON.stringify(buildRes.body).slice(0, 240));

const stream = openStream(buildId);
await sleep(400);
const claim = await sendJson('/api/machine/tasks/claim', { running: 0 }, 'POST', machineToken);
const stepId = claim.body?.step?.step?.id;
if (!stepId) throw new Error('claim ' + JSON.stringify(claim.body).slice(0, 240));

const activity = await sendJson(
  '/api/machine/tool/' + stepId,
  { kind: 'activity', activity: { phase: 'thinking' } },
  'POST',
  machineToken,
);
check('activity thinking 上报 200', activity.status === 200, String(activity.status));

await sleep(200);
const posted = await sendJson(
  '/api/machine/tool/' + stepId,
  { kind: 'thinking_delta', text: MARKER },
  'POST',
  machineToken,
);
save('thinking-delta-post.json', { status: posted.status, body: posted.body });
if (EXPECT === 'old') {
  check('old：thinking_delta 机器体被拒', posted.status === 400, String(posted.status));
} else {
  check('new：thinking_delta 机器体 200', posted.status === 200, String(posted.status));
}

await sleep(600);
const frames = stream.frames.slice();
save('sse-frames.json', frames);
const types = frames.map((f) => f.type);
const markerFrames = frames.filter((f) => JSON.stringify(f).includes(MARKER));
save('sse-summary.json', { expect: EXPECT, types, markerFrames, postStatus: posted.status });
check(
  '会话流有 activity thinking',
  frames.some((f) => f.type === 'activity' && f.activity?.phase === 'thinking'),
  types.join(','),
);
if (EXPECT === 'old') {
  check('old：流上没有 thinking_delta', !types.includes('thinking_delta'), types.join(','));
  check('old：流帧不含思考正文', markerFrames.length === 0, String(markerFrames.length));
} else {
  check(
    'new：流上有 thinking_delta 且正文等于标记',
    markerFrames.some((f) => f.type === 'thinking_delta' && f.text === MARKER),
    JSON.stringify(markerFrames),
  );
}

const messagesBefore = await sendJson('/api/conversations/' + buildId + '/messages', undefined, 'GET');
const persistedBefore = JSON.stringify(messagesBefore.body).includes(MARKER);
check('thinking_delta 不落库', persistedBefore === false, String(persistedBefore));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 732 } });
await page.route('**/api.dicebear.com/**', (route) =>
  route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 980 980"></svg>',
  }),
);
try {
  await page.goto(WEB + '/app/todo/' + todoId, { waitUntil: 'domcontentloaded' });
  await page.getByText('模型思考中...').waitFor({ timeout: 20000 });
  await sleep(400);
  const bodyText = await page.locator('body').innerText();
  save('page-text.txt', bodyText);
  await page.screenshot({ path: join(EVIDENCE, 'detail-' + EXPECT + '.png') });
  check('页面有思考相位标签', bodyText.includes('模型思考中...'), null);
  if (EXPECT === 'old') {
    check('old：页面没有思考正文', !bodyText.includes(MARKER), null);
  } else {
    check('new：页面思考行带出正文', bodyText.includes(MARKER), null);
    const row = await sendJson(
      '/api/machine/tool/' + stepId,
      {
        kind: 'transcript_row',
        row: {
          id: 'msg-' + stepId + '-think',
          role: 'assistant',
          content: [{ type: 'thinking', thinking: MARKER }],
          createdAt: Date.now(),
        },
      },
      'POST',
      machineToken,
    );
    check('thinking 段行落库 200', row.status === 200, String(row.status));
    await sleep(800);
    const settled = await page.locator('body').innerText();
    const copies = settled.split(MARKER).length - 1;
    save('page-text-settled.txt', settled);
    await page.screenshot({ path: join(EVIDENCE, 'detail-settled.png') });
    check('落定后标记只出现一次', copies === 1, String(copies));
    const requireServer = createRequire(join(REPO, 'apps/server/package.json'));
    const Database = requireServer('better-sqlite3');
    const db = new Database(join(stack.homeDir, 'server', 'server.db'), { readonly: true });
    const rows = db
      .prepare('SELECT id, content FROM message WHERE conversationId = ?')
      .all(buildId);
    db.close();
    save('sqlite-messages.json', rows);
    check(
      '库里只有段行一份标记',
      rows.filter((r) => JSON.stringify(r.content).includes(MARKER)).length === 1,
      String(rows.length),
    );
  }
} finally {
  await browser.close();
  await stream.close();
}

save('result.json', {
  probe: 'drive-1308-thinking-delta',
  expect: EXPECT,
  server: SERVER,
  web: WEB,
  buildId,
  stepId,
  todoId,
  passed: checks.filter((c) => c.ok).length,
  total: checks.length,
  checks,
});
process.stdout.write(
  '\n' + checks.filter((c) => c.ok).length + '/' + checks.length + ' → ' + EVIDENCE + '\n',
);
if (checks.some((c) => !c.ok)) process.exitCode = 1;
