// Live-stack probe for #1277. Machine wire (no daemon, no LLM) posts the
// done payload the daemon sends when HEAD sits on another branch.
// --expect=old records the pre-fix union: hasChanges=true + drift enters review.
// --expect=new records the hard fail: phase=failed, both branch names, no PR.

import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const EXPECT = process.argv.includes('--expect=new') ? 'new' : 'old';
const REPO =
  process.env.VERIFY_REPO_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(REPO, '.claude/verify-run');
const ports = JSON.parse(readFileSync(join(RUN_DIR, 'ports.json'), 'utf8'));
const SERVER = `http://127.0.0.1:${ports.serverPort}`;
const WEB = `http://127.0.0.1:${ports.webPort}`;
const DB_PATH = join(RUN_DIR, 'home/server/server.db');
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ??
  join(REPO, `.claude/verify-evidence/${ts}-1277-drift-${EXPECT}`);
mkdirSync(EVIDENCE, { recursive: true });

const require2 = createRequire(join(REPO, 'apps/server/package.json'));
const Database = require2('better-sqlite3');

const DRIFT = {
  expected: 'pacman/conv-0198f6c0-0000-7000-8000-000000000000',
  actual: 'dogfood/tracer-1153-verification-note',
};
const PR = { prUrl: 'https://github.com/example/repo/pull/1277', prNumber: 1277 };

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail: detail ?? null });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}\n`);
}

async function jget(path) {
  const res = await fetch(`${SERVER}${path}`);
  return { status: res.status, body: await res.json() };
}
async function jpost(path, body, token, method = 'POST') {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${SERVER}${path}`, {
    method,
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

function sqliteBuild(buildId) {
  const db = new Database(DB_PATH, { readonly: true });
  try {
    const build = db
      .prepare(
        'SELECT id, "errorMessage", prUrl, prNumber FROM build WHERE id = ?',
      )
      .get(buildId);
    const todo = db
      .prepare(
        'SELECT id, phase, hasChanges FROM todo WHERE id = (SELECT todoId FROM build WHERE id = ?)',
      )
      .get(buildId);
    const steps = db
      .prepare('SELECT id, kind, status FROM step WHERE buildId = ?')
      .all(buildId);
    return { build, todo, steps };
  } finally {
    db.close();
  }
}

const teams = await jget('/api/teams');
const teamId = teams.body?.[0]?.id;
if (!teamId) throw new Error(`no team: ${JSON.stringify(teams.body).slice(0, 200)}`);
const prov = await jpost(`/api/teams/${teamId}/providers`, {
  providerId: 'stub-gw-1277',
  label: 'Stub Gateway',
  baseUrl: 'http://127.0.0.1:9/v1',
  api: 'openai-completions',
  authHeader: true,
  compat: { supportsDeveloperRole: false },
  models: [{ id: 'stub-model', name: 'stub-model' }],
});
if (![200, 201, 409].includes(prov.status)) throw new Error(`provider ${prov.status} ${JSON.stringify(prov.body)}`);
const apiKey = await jpost(`/api/teams/${teamId}/api-keys`, {
  name: 'verify-1277-machine',
  gitAccess: false,
  mcpAccess: false,
  toolGrants: { read: [], write: [] },
});
const apiKeyPlain = apiKey.body?.plaintext ?? apiKey.body?.token;
if (!apiKeyPlain) throw new Error(`api-key: ${JSON.stringify(apiKey.body)}`);
const enroll = await jpost(
  '/api/machine/enroll',
  { teamId, name: 'verify-1277-machine', cliVersion: '0.1.0' },
  apiKeyPlain,
);
const machineToken = enroll.body?.token;
const machineId = enroll.body?.id ?? enroll.body?.machineId;
if (!machineToken || !machineId) throw new Error(`enroll: ${JSON.stringify(enroll.body)}`);
const agent = await jpost(`/api/teams/${teamId}/agents`, {
  displayName: 'verify-builder-1277',
  provider: 'stub-gw-1277',
  modelId: 'stub-model',
  machineId,
});
const agentId = agent.body?.id ?? agent.body?.agentId ?? agent.body?.record?.id;
if (!agentId) throw new Error(`agent: ${JSON.stringify(agent.body)}`);
const project = await jpost('/api/projects', { name: '1277-artifact-drift', repoKind: 'hosted' });
const projectId = project.body?.id;
if (!projectId) throw new Error(`project: ${JSON.stringify(project.body)}`);

async function runCase(label, doneBody) {
  const todo = await jpost(`/api/projects/${projectId}/todos`, {
    title: `1277 ${label}`,
    spec: 'probe: machine done payload, no daemon',
  });
  const todoId = todo.body?.id;
  if (!todoId) throw new Error(`todo ${label}: ${JSON.stringify(todo.body)}`);
  const started = await jpost(`/api/projects/${projectId}/builds`, {
    todoIds: [todoId],
    assignment: { plan: { agentId }, build: { agentId } },
    withPlan: false,
  });
  const buildId = started.body?.builds?.[0]?.id;
  if (!buildId) throw new Error(`build ${label}: ${JSON.stringify(started.body)}`);
  const claim = await jpost('/api/machine/tasks/claim', {}, machineToken);
  const step = claim.body?.step?.step ?? claim.body?.step;
  if (step?.kind !== 'build') throw new Error(`claim ${label}: ${JSON.stringify(claim.body).slice(0, 400)}`);
  const done = await jpost(`/api/machine/done/${step.id}`, { ...doneBody, sessionId: `pi-${label}` }, machineToken);
  if (done.status !== 200) throw new Error(`done ${label} ${done.status} ${JSON.stringify(done.body)}`);
  const apiTodo = await jget(`/api/todos/${todoId}`);
  const apiBuild = await jget(`/api/builds/${buildId}`);
  const sql = sqliteBuild(buildId);
  const snap = {
    label,
    doneBody,
    http: { todo: apiTodo.body, build: apiBuild.body },
    sqlite: sql,
  };
  writeFileSync(join(EVIDENCE, `${label}.json`), `${JSON.stringify(snap, null, 2)}\n`);
  return { todoId, buildId, apiTodo: apiTodo.body, apiBuild: apiBuild.body, sql };
}

const zero = await runCase('zero-changes', { status: 'success', hasChanges: false });
check(
  'control zero-changes → failed 构建零改动',
  zero.apiTodo?.phase === 'failed' && zero.apiBuild?.errorMessage === '构建零改动' && zero.sql.build?.errorMessage === '构建零改动',
  `phase=${zero.apiTodo?.phase} msg=${zero.apiBuild?.errorMessage}`,
);

const driftEmpty = await runCase('drift-no-commits', {
  status: 'success',
  hasChanges: false,
  workBranchDrift: DRIFT,
});
check(
  'control drift+hasChanges=false → failed naming both branches',
  driftEmpty.apiTodo?.phase === 'failed' &&
    String(driftEmpty.apiBuild?.errorMessage).includes(DRIFT.actual) &&
    String(driftEmpty.apiBuild?.errorMessage).includes(DRIFT.expected) &&
    driftEmpty.apiBuild?.errorMessage !== '构建零改动',
  `phase=${driftEmpty.apiTodo?.phase} msg=${driftEmpty.apiBuild?.errorMessage}`,
);

const onBranch = await runCase('on-branch-changes', { status: 'success', hasChanges: true });
check(
  'control hasChanges=true no drift → review',
  onBranch.apiTodo?.phase === 'review' && onBranch.apiBuild?.errorMessage == null,
  `phase=${onBranch.apiTodo?.phase} msg=${onBranch.apiBuild?.errorMessage}`,
);

const drifted = await runCase('drift-with-commits', {
  status: 'success',
  hasChanges: true,
  workBranchDrift: DRIFT,
  ...PR,
});
const driftedPhase = drifted.apiTodo?.phase;
const driftedMsg = drifted.apiBuild?.errorMessage ?? null;
const driftedPr = drifted.apiBuild?.prUrl ?? drifted.sql.build?.prUrl ?? null;
const driftedPrN = drifted.apiBuild?.prNumber ?? drifted.sql.build?.prNumber ?? null;
writeFileSync(
  join(EVIDENCE, 'drift-with-commits-summary.txt'),
  [
    `expect=${EXPECT}`,
    `phase=${driftedPhase}`,
    `errorMessage=${driftedMsg}`,
    `prUrl=${driftedPr}`,
    `prNumber=${driftedPrN}`,
    `stepStatus=${JSON.stringify(drifted.sql.steps)}`,
    `sqlitePhase=${drifted.sql.todo?.phase}`,
    `sqliteHasChanges=${drifted.sql.todo?.hasChanges}`,
    `server=${SERVER}`,
    `web=${WEB}`,
    `head=${process.env.GIT_HEAD ?? ''}`,
  ].join('\n') + '\n',
);

if (EXPECT === 'old') {
  check(
    'BEFORE bug: hasChanges=true + drift enters review',
    driftedPhase === 'review' && driftedMsg == null,
    `phase=${driftedPhase} msg=${driftedMsg}`,
  );
  check(
    'BEFORE observation: PR backfill stored on the review build',
    driftedPr === PR.prUrl && driftedPrN === PR.prNumber,
    `prUrl=${driftedPr} prNumber=${driftedPrN}`,
  );
} else {
  check(
    'AFTER: hasChanges=true + drift → failed',
    driftedPhase === 'failed' && drifted.sql.todo?.phase === 'failed',
    `phase=${driftedPhase} sqlite=${drifted.sql.todo?.phase}`,
  );
  check(
    'AFTER: error names both branches',
    typeof driftedMsg === 'string' && driftedMsg.includes(DRIFT.actual) && driftedMsg.includes(DRIFT.expected),
    `msg=${driftedMsg}`,
  );
  check(
    'AFTER: message is not the no-commit wording',
    typeof driftedMsg === 'string' && !driftedMsg.includes('未见任何提交') && driftedMsg !== '构建零改动',
    `msg=${driftedMsg}`,
  );
  check(
    'AFTER: no PR backfill kept',
    driftedPr == null && driftedPrN == null && drifted.sql.build?.prUrl == null && drifted.sql.build?.prNumber == null,
    `prUrl=${driftedPr} prNumber=${driftedPrN} sqlPr=${drifted.sql.build?.prUrl}`,
  );
  check(
    'AFTER: step failed, review unreachable',
    drifted.sql.steps.every((s) => s.status === 'failed') && driftedPhase !== 'review',
    JSON.stringify(drifted.sql.steps),
  );
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 732 } });
  await page.goto(`${WEB}/app/todo/${drifted.todoId}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(EVIDENCE, `detail-drift-with-commits-${EXPECT}.png`) });
  const bodyText = await page.locator('body').innerText();
  writeFileSync(join(EVIDENCE, `detail-text-${EXPECT}.txt`), bodyText.slice(0, 4000));
  check(
    'ui: detail page rendered the drifted todo title',
    bodyText.includes('1277 drift-with-commits'),
  );
} finally {
  await browser.close();
}

const passed = checks.filter((c) => c.ok).length;
writeFileSync(
  join(EVIDENCE, 'result.json'),
  `${JSON.stringify({ probe: 'drive-1277-artifact-drift', expect: EXPECT, server: SERVER, web: WEB, passed, total: checks.length, checks }, null, 2)}\n`,
);
process.stdout.write(`\n${passed}/${checks.length}  expect=${EXPECT}  → ${EVIDENCE}\n`);
if (checks.some((c) => !c.ok)) process.exitCode = 1;
