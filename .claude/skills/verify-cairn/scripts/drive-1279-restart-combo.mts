// verify-cairn drive-1279 — restart combo line bubble (#1279).
//
// Live stack, no daemon, no LLM. A failed-restart round stores two user rows:
// the feedback text, and the daemon combo (task text at claim time + restart
// instruction). classifyUserText runs in the web mapper. This probe plants
// four wire rows against one todo whose title was patched after the combo
// was composed, then reads the rendered user bubbles.
//
//   --expect=old  current main: drifted combo renders as a user bubble
//   --expect=new  fix: drifted combo leaves the bubble list; feedback stays
//
// Run:
//   cd apps/server && pnpm exec tsx ../../.claude/skills/verify-cairn/scripts/drive-1279-restart-combo.mts --expect=old

import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildRestartPrompt,
  buildTaskPromptText,
  classifyUserText,
  composeTaskPromptWithInstruction,
} from '../../../../packages/shared/src/index.ts';

const require = createRequire(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../../package.json'),
);
const { chromium } = require('@playwright/test') as typeof import('@playwright/test');

const EXPECT = process.argv.includes('--expect=new') ? 'new' : 'old';

const SCRIPT_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const REPO = process.env.VERIFY_REPO_ROOT ?? SCRIPT_REPO;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(REPO, '.claude/verify-run');
const portsFile = join(RUN_DIR, 'ports.json');
if (!existsSync(portsFile)) {
  process.stderr.write('no stack: ' + portsFile + '\n');
  process.exit(1);
}
const stack = JSON.parse(readFileSync(portsFile, 'utf8')) as {
  serverPort?: number;
  webPort?: number;
};
const SERVER = 'http://127.0.0.1:' + (stack.serverPort ?? process.env.VERIFY_PORT ?? 8791);
const WEB = 'http://127.0.0.1:' + (stack.webPort ?? process.env.VERIFY_WEB_PORT ?? 5273);
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ??
  join(SCRIPT_REPO, '.claude/verify-evidence/' + ts + '-1279-' + EXPECT);
mkdirSync(EVIDENCE, { recursive: true });

const checks: { name: string; ok: boolean; detail: string | null }[] = [];
function check(name: string, ok: boolean, detail?: string) {
  checks.push({ name, ok, detail: detail ?? null });
  process.stdout.write((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  — ' + detail : '') + '\n');
}

const OLD_TITLE = '漂移前俳句';
const NEW_TITLE = '漂移后俳句';
const SPEC = '写一首俳句，句号收尾。';
const FEEDBACK = '把句号改成叹号试试';
const RESTART = buildRestartPrompt(FEEDBACK);
const OLD_TASK = buildTaskPromptText(OLD_TITLE, SPEC);
const NEW_TASK = buildTaskPromptText(NEW_TITLE, SPEC);
const DRIFTED = composeTaskPromptWithInstruction(OLD_TASK, RESTART).trim();
const MATCHING = composeTaskPromptWithInstruction(NEW_TASK, RESTART).trim();
const STALE_TASK = OLD_TASK.trim();
const BARE = RESTART;
const currentTask = { title: NEW_TITLE, spec: SPEC };

const classified = {
  feedback: classifyUserText(FEEDBACK, currentTask),
  bare: classifyUserText(BARE, currentTask),
  matching: classifyUserText(MATCHING, currentTask),
  drifted: classifyUserText(DRIFTED, currentTask),
  staleTask: classifyUserText(STALE_TASK, currentTask),
};
writeFileSync(join(EVIDENCE, 'classify.json'), JSON.stringify({ expect: EXPECT, classified, drifted: DRIFTED }, null, 2));
process.stdout.write('classify ' + JSON.stringify(classified) + '\n');

async function getJson(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error('GET ' + url + ' → ' + res.status);
  return res.json();
}
async function sendJson(
  url: string,
  body?: unknown,
  method?: string,
  token?: string,
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  const res = await fetch(url, {
    method: method ?? 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    parsed = { raw: text };
  }
  return { status: res.status, body: parsed };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs: number) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() >= end) return null;
    await sleep(120);
  }
}

const teams = (await getJson(SERVER + '/api/teams')) as { id: string }[];
const teamId = teams[0]?.id;
if (!teamId) throw new Error('no team');

const RUN = Date.now().toString(36);
const prov = await sendJson(SERVER + '/api/teams/' + teamId + '/providers', {
  providerId: 'stub-1279-' + RUN,
  label: 'Stub 1279',
  baseUrl: 'http://127.0.0.1:9/v1',
  api: 'openai-completions',
  authHeader: true,
  compat: { supportsDeveloperRole: false },
  models: [{ id: 'stub-model', name: 'stub-model' }],
});
if (![200, 201, 409].includes(prov.status)) throw new Error('provider → ' + prov.status);

const key = await sendJson(SERVER + '/api/teams/' + teamId + '/api-keys', {
  name: 'probe-1279-' + RUN,
  gitAccess: false,
  mcpAccess: false,
  toolGrants: { read: [], write: [] },
});
const keyPlain =
  (key.body?.plaintext as string | undefined) ??
  ((key.body?.record as { plaintext?: string } | undefined)?.plaintext) ??
  (key.body?.token as string | undefined);
if (!keyPlain) throw new Error('api-key has no plaintext');

const enroll = await sendJson(
  SERVER + '/api/machine/enroll',
  { teamId, name: 'probe-1279-machine-' + RUN, cliVersion: '0.1.0' },
  'POST',
  keyPlain,
);
const machineToken =
  (enroll.body?.token as string | undefined) ??
  ((enroll.body?.machine as { token?: string } | undefined)?.token);
if (enroll.status !== 200 || !machineToken) throw new Error('enroll → ' + enroll.status);
const machineRows = (await getJson(SERVER + '/api/teams/' + teamId + '/machines')) as {
  id: string;
  name: string;
}[];
const machineId = machineRows.find((m) => m.name === 'probe-1279-machine-' + RUN)?.id;
if (!machineId) throw new Error('enrolled machine row missing');
const runtime = await sendJson(
  SERVER + '/api/machines/' + machineId,
  { enabledRuntimes: ['pi', 'claude-code'] },
  'PATCH',
);
if (runtime.status !== 200) throw new Error('enable runtime → ' + runtime.status);

const agent = await sendJson(SERVER + '/api/teams/' + teamId + '/agents', {
  displayName: '重启探针',
  provider: 'stub-1279-' + RUN,
  modelId: 'stub-model',
  machineId,
});
const AGENT_ID = agent.body?.id as string | undefined;
if (agent.status !== 201 || !AGENT_ID) {
  throw new Error('agent → ' + agent.status + ' ' + JSON.stringify(agent.body));
}

const projRes = await sendJson(SERVER + '/api/projects', { name: 'probe-1279-' + RUN });
const projectId = projRes.body?.id as string | undefined;
if (!projectId) throw new Error('project → ' + JSON.stringify(projRes.body));

const todoRes = await sendJson(SERVER + '/api/projects/' + projectId + '/todos', {
  title: OLD_TITLE,
  spec: SPEC,
});
const todoId = todoRes.body?.id as string | undefined;
if (!todoId) throw new Error('todo → ' + JSON.stringify(todoRes.body));

const buildRes = await sendJson(SERVER + '/api/projects/' + projectId + '/builds', {
  todoIds: [todoId],
  assignment: { plan: null, build: { agentId: AGENT_ID } },
  withPlan: false,
});
const builds = buildRes.body?.builds as { id: string }[] | undefined;
const buildId = builds?.[0]?.id;
if (!buildId) throw new Error('build → ' + JSON.stringify(buildRes.body));

const claim = await sendJson(SERVER + '/api/machine/tasks/claim', {}, 'POST', machineToken);
const claimed =
  ((claim.body?.step as { step?: { id?: string } } | undefined)?.step) ??
  (claim.body?.step as { id?: string } | undefined);
const stepId = claimed?.id;
if (!stepId) throw new Error('claim failed: ' + JSON.stringify(claim.body));

const patched = await sendJson(SERVER + '/api/todos/' + todoId, { title: NEW_TITLE }, 'PATCH');
if (patched.status !== 200) throw new Error('patch title → ' + patched.status + ' ' + JSON.stringify(patched.body));

const T0 = Date.now();
const messages = [
  { id: 'fb-' + RUN, role: 'user', content: FEEDBACK, createdAt: T0 + 1 },
  { id: 'stale-' + RUN, role: 'user', content: STALE_TASK, createdAt: T0 + 2 },
  { id: 'bare-' + RUN, role: 'user', content: BARE, createdAt: T0 + 3 },
  { id: 'match-' + RUN, role: 'user', content: MATCHING, createdAt: T0 + 4 },
  { id: 'drift-' + RUN, role: 'user', content: DRIFTED, createdAt: T0 + 5 },
  {
    id: 'ack-' + RUN,
    role: 'assistant',
    content: [{ type: 'text', text: '收到，按反馈改句号。' }],
    createdAt: T0 + 6,
  },
];

const transcript = { stepId, messages };
const urls = await sendJson(
  SERVER + '/api/machine/upload-urls/' + stepId,
  { files: [{ name: 'transcript.json', size: JSON.stringify(transcript).length }] },
  'POST',
  machineToken,
);
const uploads = urls.body?.uploads as { name: string; url: string; headers?: Record<string, string> }[] | undefined;
const upload = uploads?.find((u) => u.name === 'transcript.json');
if (!upload) throw new Error('upload-urls missing transcript slot: ' + JSON.stringify(urls.body));
const put = await fetch(upload.url, {
  method: 'PUT',
  headers: {
    'content-type': 'application/json',
    ...(upload.headers ?? {}),
    authorization: 'Bearer ' + machineToken,
  },
  body: JSON.stringify(transcript),
  signal: AbortSignal.timeout(8000),
});
if (!put.ok) throw new Error('PUT transcript → ' + put.status);

const landed = await waitFor(async () => {
  const res = await sendJson(SERVER + '/api/conversations/' + buildId + '/messages', undefined, 'GET');
  const rows = (res.body?.messages as unknown[] | undefined) ?? [];
  return rows.length >= 6 ? res.body : null;
}, 8000);
if (!landed) throw new Error('messages did not land');
writeFileSync(join(EVIDENCE, 'messages.json'), JSON.stringify(landed, null, 2));
const todoNow = await getJson(SERVER + '/api/todos/' + todoId);
writeFileSync(join(EVIDENCE, 'todo.json'), JSON.stringify(todoNow, null, 2));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 732 } });
await page.route('**/api.dicebear.com/**', (route) =>
  route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#888"/></svg>',
  }),
);

try {
  await page.goto(WEB + '/app/todo/' + todoId, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="user-bubble"]', { timeout: 20000 });
  await waitFor(async () => (await page.locator('[data-testid="user-bubble"]').allInnerTexts()).some((t) => t.includes(FEEDBACK)), 10000);

  const bubbles = (await page.locator('[data-testid="user-bubble"]').allInnerTexts()).map((t) => t.trim());
  writeFileSync(join(EVIDENCE, 'bubbles.json'), JSON.stringify(bubbles, null, 2));
  process.stdout.write('bubbles ' + bubbles.length + '\n');
  for (const b of bubbles) process.stdout.write('  BUBBLE ' + JSON.stringify(b.slice(0, 80)) + '\n');

  const shotName = EXPECT === 'old' ? 'before-user-bubble.png' : 'after-combo-hidden.png';
  await page.screenshot({ path: join(EVIDENCE, shotName), fullPage: true });
  const col = page.locator('.chat-col');
  if (await col.count()) {
    await col.screenshot({ path: join(EVIDENCE, EXPECT === 'old' ? 'before-chat-col.png' : 'after-chat-col.png') });
  }
  process.stdout.write('shot ' + shotName + '\n');

  const has = (needle: string) => bubbles.some((b) => b.includes(needle));
  const driftedShown = bubbles.some((b) => b.startsWith(OLD_TITLE) && b.includes('上一轮执行失败'));
  const matchingShown = bubbles.some((b) => b.startsWith(NEW_TITLE) && b.includes('上一轮执行失败'));
  const bareShown = bubbles.some((b) => b.startsWith('上一轮执行失败') && !b.includes(OLD_TITLE) && !b.includes(NEW_TITLE));
  const feedbackShown = bubbles.some((b) => b === FEEDBACK);
  const staleShown = bubbles.some((b) => b === STALE_TASK);

  check('feedback row stays a user bubble', feedbackShown, 'bubbles=' + bubbles.length);
  check('bare restart line is not a bubble', !bareShown);
  check('matching combo (current title) is not a bubble', !matchingShown);
  check('stale task text without an instruction stays a bubble', staleShown);
  if (EXPECT === 'old') {
    check('drifted restart combo renders as a user bubble', driftedShown);
  } else {
    check('drifted restart combo is not a user bubble', !driftedShown);
  }
  check('assistant row still renders', (await page.getByText('收到，按反馈改句号。').count()) > 0);
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.ok);
writeFileSync(
  join(EVIDENCE, 'result.json'),
  JSON.stringify({ probe: '1279-restart-combo', expect: EXPECT, server: SERVER, web: WEB, todoId, buildId, classified, checks }, null, 2),
);
process.stdout.write('evidence ' + EVIDENCE + '\n');
process.exit(failed.length === 0 ? 0 : 1);
