// #905 evidence run: one script, one viewport, two stacks (before = detached
// origin/main worktree, after = this branch) — the same fake-daemon timeline
// drives both, so the before/after GIFs are the same chain at the same
// coordinates (method = docs/verify/873, seed = public REST + fake machine
// claim, zero real daemon zero LLM).
//
// The fake daemon replays the wire shape a real daemon sends on
// POST /api/machine/tool/{stepId}: activity reports (4th body shape, #905),
// a toolcall record with result, transcript deltas. On the before stack the
// activity posts are rejected (old server has no 4th shape → 400) and the old
// web ignores activity events — the row stays the reported black box
// (`处理中...` + `本步：规划中`) for the whole run. That rejection is recorded in
// result.json instead of being hidden.
//
//   usage: VERIFY_REPO_ROOT=<stack repo> EVIDENCE_TAG=before|after \
//          node evidence-905.mjs
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const REPO =
  process.env.VERIFY_REPO_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(REPO, '.claude/verify-run');
const ports = JSON.parse(readFileSync(join(RUN_DIR, 'ports.json'), 'utf8'));
const SERVER = `http://127.0.0.1:${ports.serverPort}`;
const WEB = `http://127.0.0.1:${ports.webPort}`;
const tag = process.env.EVIDENCE_TAG ?? 'after';
const OUT = join(REPO, '.claude/verify-shots/905');
mkdirSync(join(OUT, 'video'), { recursive: true });

// —— REST helpers (seed-long.mjs, #873, same shapes) ————————————————
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

// —— seed: team → provider → agent → project → todo → build(withPlan) ————
const teams = await jget('/api/teams');
const teamId = teams.body[0].id;
await jpost(`/api/teams/${teamId}/providers`, {
  providerId: 'stub-gw',
  label: 'Stub Gateway',
  baseUrl: 'http://127.0.0.1:9/v1',
  api: 'openai-completions',
  authHeader: true,
  compat: { supportsDeveloperRole: false },
  models: [{ id: 'stub-model', name: 'stub-model' }],
});
const agent = await jpost(`/api/teams/${teamId}/agents`, {
  displayName: 'verify-builder',
  provider: 'stub-gw',
  modelId: 'stub-model',
});
const AGENT_ID = agent.body?.id ?? agent.body?.agentId;
const project = await jpost('/api/projects', { name: '活动相位探针' });
const projectId = project.body.id;
const todo = await jpost(`/api/projects/${projectId}/todos`, {
  title: '规划黑盒可见性',
  spec: '验证规划步在飞时活行给出「在做什么」。',
});
const todoId = todo.body.id;
const build = await jpost(`/api/projects/${projectId}/builds`, {
  todoIds: [todoId],
  assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
  withPlan: true,
});
const buildId = build.body.builds?.[0]?.id;
const apiKey = await jpost(`/api/teams/${teamId}/api-keys`, {
  name: 'activity-probe',
  gitAccess: false,
  mcpAccess: false,
  toolGrants: { read: [], write: [] },
});
const apiKeyPlain = apiKey.body?.plaintext ?? apiKey.body?.token;
const enroll = await jpost(
  '/api/machine/enroll',
  { teamId, name: 'activity-probe', cliVersion: '0.1.0' },
  apiKeyPlain,
);
const machineToken = enroll.body?.token;

// claim the plan step (fresh scratch DB → first claim is ours; drain anyway)
async function claimOwn(targetBuildId) {
  for (let i = 0; i < 8; i++) {
    const res = await jpost('/api/machine/tasks/claim', {}, machineToken);
    const step = res.body?.step?.step ?? res.body?.step;
    if (!step?.id) throw new Error(`claim failed ${JSON.stringify(res.body)}`);
    if (step.buildId === targetBuildId) return step;
    await jpost(`/api/machine/done/${step.id}`, { status: 'failed' }, machineToken);
  }
  throw new Error(`no step for build ${targetBuildId}`);
}
const planStep = await claimOwn(buildId);

// —— fake daemon: the #905 activity relay (4th body shape) ————————————
const activityLog = [];
async function sendActivity(activity) {
  const res = await jpost(
    `/api/machine/tool/${planStep.id}`,
    { kind: 'activity', activity },
    machineToken,
  );
  activityLog.push({ activity, status: res.status });
}
async function sendDelta(text) {
  await jpost(
    `/api/machine/tool/${planStep.id}`,
    { kind: 'transcript_delta', text },
    machineToken,
  );
}
async function sendToolDone() {
  const nowMs = Date.now();
  await jpost(
    `/api/machine/tool/${planStep.id}`,
    {
      id: `call-905-${tag}`,
      name: 'bash',
      arguments: { command: 'rg -n "plan" src | head -40' },
      result: 'src/plan.ts:1: export const PLAN_FILE = "plan.md";',
      startedAt: nowMs - 8000,
      endedAt: nowMs,
    },
    machineToken,
  );
}

// —— browser: record the same chain on both stacks ————————————————————
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 732 },
  recordVideo: { dir: join(OUT, 'video'), size: { width: 1440, height: 732 } },
});
const page = await context.newPage();
const video = page.video();
const settle = (ms) => page.waitForTimeout(ms);

const rowLabel = () => page.locator('.chat-streaming-label').first().textContent();
const shots = [];
async function shot(name) {
  const p = join(OUT, `${tag}-${name}.png`);
  await page.screenshot({ path: p });
  shots.push(p);
}

await page.goto(`${WEB}/app/todo/${todoId}`, { waitUntil: 'networkidle' });
await page.waitForSelector('.chat-streaming', { timeout: 20000 });
await settle(800);

// checkpoint sampler: label text at each phase boundary
const samples = [];
async function sample(name) {
  const label = (await rowLabel())?.trim() ?? null;
  samples.push({ at: name, label });
  return label;
}

// 0. the reported black box window: claimed, nothing relayed yet
await sample('claim+0s');
await shot('00-claimed');

// 1. preparing → starting (workspace + session open window)
await sendActivity({ phase: 'preparing' });
await settle(1800);
await sample('preparing');
await sendActivity({ phase: 'starting' });
await settle(1800);
await sample('starting');

// 2. the long thinking window — the user's black box. Relays refresh every
//    ~4s like a real daemon's event-gated repeat, so freshness stays low.
await sendActivity({ phase: 'thinking' });
await settle(1200);
await sample('thinking');
await shot('01-thinking');
// open the disclosure panel: step + machine + last-signal freshness
await page.locator('.chat-streaming').first().click();
await settle(900);
await shot('02-panel');
const panelTexts = await page.locator('.chat-live-panel .chat-live-line').allTextContents();
await sendActivity({ phase: 'thinking' });
await settle(4000);
await sendActivity({ phase: 'thinking' });
await settle(4000);
await sample('thinking+8s(relays flowing)');

// 3. tool window: call block streamed, bash executing — no other signal.
//    Freshness grows while the tool runs (honest: nothing new arrived).
await sendActivity({ phase: 'tool', tool: 'bash' });
await settle(1500);
await sample('tool:bash');
await shot('03-tool');
await settle(6500);
await sample('tool:bash+8s(no new signal)');
await shot('04-tool-aged');
await sendToolDone();
await settle(1200);

// 4. responding: text streams (the one signal that was already visible
//    before #905 — parity check, not the point).
await sendActivity({ phase: 'responding' });
await sendDelta('规划中：先读仓库结构，');
await settle(700);
await sendDelta('再列改动面与验证方式。');
await settle(1500);
await sample('responding');
await shot('05-responding');

// 5. stuck demo: the daemon goes silent — freshness must keep growing
//    (the "moving vs stuck" discriminator; #471: the number never freezes).
//    Note: the toolcall row landing re-fetches messages, which re-keys the
//    transcript list and remounts the row (expanded state resets — existing
//    #873 behaviour, not introduced here). Re-open the panel before sampling.
await sendActivity({ phase: 'awaiting_model' });
await settle(1500);
if ((await page.locator('.chat-live-panel').count()) === 0) {
  await page.locator('.chat-streaming').first().click();
  await settle(600);
}
const stuckSamples = [];
for (let i = 0; i < 3; i++) {
  await settle(4000);
  const fresh = await page.locator('.chat-live-panel .chat-live-line').allTextContents();
  stuckSamples.push(fresh.at(-1) ?? null);
}
await shot('06-silence');

await context.close();
await browser.close();

const result = {
  tag,
  todoId,
  buildId,
  stepId: planStep.id,
  stack: { server: SERVER, web: WEB },
  samples,
  panelTexts,
  stuckFreshnessSamples: stuckSamples,
  activityRelay: {
    posts: activityLog.length,
    accepted: activityLog.filter((a) => a.status === 200).length,
    rejected: activityLog.filter((a) => a.status !== 200).map((a) => a.status),
  },
  shots,
};
writeFileSync(join(OUT, `result-${tag}.json`), `${JSON.stringify(result, null, 2)}\n`);
const produced = await video.path();
renameSync(produced, join(OUT, 'video', `${tag}.webm`));
console.log(JSON.stringify({ tag, samples, activityRelay: result.activityRelay }, null, 2));
console.log('video:', join(OUT, 'video', `${tag}.webm`));
