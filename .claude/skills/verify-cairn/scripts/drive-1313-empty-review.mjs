#!/usr/bin/env node

import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SCRIPT_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const REPO = process.env.VERIFY_REPO_ROOT ?? SCRIPT_REPO;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(REPO, '.claude/verify-run');
const EXPECT = process.argv.includes('--expect=after') ? 'after' : 'before';
const FOCUS = process.argv.includes('--focus=hunkless') ? 'hunkless' : 'all';
const portsFile = join(RUN_DIR, 'ports.json');
if (!existsSync(portsFile)) {
  process.stderr.write('无栈：' + portsFile + ' 不存在。先跑 launch.mjs\n');
  process.exit(1);
}
const stack = JSON.parse(readFileSync(portsFile, 'utf8'));
const SERVER = 'http://127.0.0.1:' + (stack.serverPort ?? 8791);
const WEB = 'http://127.0.0.1:' + (stack.webPort ?? 5273);
const HOME_DIR = stack.homeDir ?? join(RUN_DIR, 'home');
const DB_PATH = join(HOME_DIR, 'server', 'server.db');
const require2 = createRequire(join(REPO, 'apps/server/package.json'));
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ??
  join(SCRIPT_REPO, '.claude/verify-evidence/' + ts + '-1313-empty-review-' + EXPECT);
mkdirSync(EVIDENCE, { recursive: true });

const MERGE_LABEL = '将改动合并到默认分支';
const EMPTY_NOTE = '本轮没有文件改动，完成不会合并分支。';
const DONE_TEXT = '标记为已完成';
const SAMPLE_DIFF = [
  'diff --git a/README.md b/README.md',
  '--- a/README.md',
  '+++ b/README.md',
  '@@ -1 +1 @@',
  '-old',
  '+new',
  '',
].join('\n');

const RENAME_DIFF = [
  'diff --git a/old-name.txt b/new-name.txt',
  'similarity index 100%',
  'rename from old-name.txt',
  'rename to new-name.txt',
  '',
].join('\n');

const checks = [];
function check(name, ok, detail) {
  if (typeof ok !== 'boolean') throw new TypeError('check ok must be boolean');
  checks.push({ name, ok, detail: detail ?? null });
  process.stdout.write((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  — ' + detail : '') + '\n');
}
const artifacts = [];
async function shot(page, name) {
  await page.screenshot({ path: join(EVIDENCE, name) });
  artifacts.push(name);
  process.stdout.write('shot  ' + name + '\n');
}
async function saveJson(name, data) {
  writeFileSync(join(EVIDENCE, name), JSON.stringify(data, null, 2));
  artifacts.push(name);
}

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}
async function sendJson(url, body, method, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  const res = await fetch(url, {
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

function dbRead(fn) {
  const Database = require2('better-sqlite3');
  const db = new Database(DB_PATH, { readonly: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

let MACHINE_TOKEN = null;
async function claimBuild() {
  await sendJson(SERVER + '/api/machine/presence', {}, 'POST', MACHINE_TOKEN);
  const claim = await sendJson(SERVER + '/api/machine/tasks/claim', {}, 'POST', MACHINE_TOKEN);
  const claimed = claim.body?.step?.step ?? claim.body?.step;
  if (!claimed?.id) throw new Error('claim 失败：' + JSON.stringify(claim.body));
  if (claimed.kind !== 'build') throw new Error('claim kind=' + claimed.kind);
  return claimed;
}
async function doneStep(stepId, body) {
  const done = await sendJson(SERVER + '/api/machine/done/' + stepId, body, 'POST', MACHINE_TOKEN);
  if (done.status !== 200) throw new Error('done → ' + done.status + ' ' + JSON.stringify(done.body));
}

async function seedReview(title, changesDiff) {
  const teams = await getJson(SERVER + '/api/teams');
  const teamId = teams.body[0].id;
  const project = await sendJson(SERVER + '/api/projects', { name: title });
  if (project.status !== 201) throw new Error('project → ' + project.status + ' ' + JSON.stringify(project.body));
  const todo = await sendJson(SERVER + '/api/projects/' + project.body.id + '/todos', {
    title,
    spec: title + '：review 收口探针',
  });
  if (todo.status !== 201) throw new Error('todo → ' + todo.status);
  const build = await sendJson(SERVER + '/api/projects/' + project.body.id + '/builds', {
    todoIds: [todo.body.id],
    assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
    withPlan: false,
  });
  if (build.status !== 201) throw new Error('builds → ' + build.status + ' ' + JSON.stringify(build.body));
  const buildId = build.body.builds[0].id;
  const step = await claimBuild();
  await doneStep(step.id, { status: 'success', hasChanges: true, changesDiff });
  const face = await getJson(SERVER + '/api/todos/' + todo.body.id);
  if (face.body.phase !== 'review') throw new Error(title + ' 相位=' + face.body.phase);
  const changes = await getJson(SERVER + '/api/builds/' + buildId + '/changes');
  return { teamId, todoId: todo.body.id, buildId, face: face.body, changes: changes.body };
}

let AGENT_ID = null;

const session = await getJson(SERVER + '/api/auth/session');
check('session Owner', session.status === 200 && session.body.displayName === 'Owner', session.body?.displayName);
const teams0 = await getJson(SERVER + '/api/teams');
const TEAM_ID = teams0.body[0].id;

const provider = await sendJson(SERVER + '/api/teams/' + TEAM_ID + '/providers', {
  providerId: 'stub-gw',
  label: 'Stub Gateway',
  baseUrl: 'http://127.0.0.1:9/v1',
  api: 'openai-completions',
  authHeader: true,
  compat: { supportsDeveloperRole: false },
  models: [{ id: 'stub-model', name: 'stub-model' }],
});
if (provider.status !== 201 && provider.status !== 409) {
  throw new Error('provider → ' + provider.status + ' ' + JSON.stringify(provider.body));
}
const key = await sendJson(SERVER + '/api/teams/' + TEAM_ID + '/api-keys', {
  name: '1313-probe',
  gitAccess: false,
  mcpAccess: false,
  toolGrants: { read: [], write: [] },
});
const keyPlain = key.body?.plaintext ?? key.body?.token;
if (!keyPlain) throw new Error('api-key 无 plaintext：' + JSON.stringify(key.body));
const enroll = await sendJson(
  SERVER + '/api/machine/enroll',
  { teamId: TEAM_ID, name: '1313-machine', cliVersion: '0.1.0' },
  'POST',
  keyPlain,
);
MACHINE_TOKEN = enroll.body?.token;
const MACHINE_ID = enroll.body?.machineId;
if (enroll.status !== 200 || !MACHINE_TOKEN || !MACHINE_ID) {
  throw new Error('enroll → ' + enroll.status + ' ' + JSON.stringify(enroll.body));
}
const agent = await sendJson(SERVER + '/api/teams/' + TEAM_ID + '/agents', {
  displayName: 'empty-review-builder',
  provider: 'stub-gw',
  modelId: 'stub-model',
  tools: ['推送分支'],
  machineId: MACHINE_ID,
});
if (agent.status !== 201 && agent.status !== 200) throw new Error('agent → ' + agent.status + ' ' + JSON.stringify(agent.body));
AGENT_ID = agent.body?.id ?? agent.body?.agent?.id;
if (!AGENT_ID) throw new Error('agent 无 id：' + JSON.stringify(agent.body));
const members = await getJson(SERVER + '/api/teams/' + TEAM_ID + '/members');
const member = (members.body ?? []).find((m) => m.actorId === AGENT_ID);
const tools = member?.actor?.tools ?? [];
check('agent 缺合并分支', tools.includes('推送分支') && !tools.includes('合并分支'), JSON.stringify(tools));
await saveJson('agent-tools.json', { agentId: AGENT_ID, tools });

if (FOCUS === 'hunkless') {
  const rename = await seedReview('纯重命名', RENAME_DIFF);
  await saveJson('rename-todo.json', rename.face);
  await saveJson('rename-changes.json', rename.changes);
  check(
    'rename hasChanges',
    rename.face.hasChanges === true,
    String(rename.face.hasChanges),
  );
  check(
    'rename parsed files 为空',
    Array.isArray(rename.changes.files) && rename.changes.files.length === 0,
    JSON.stringify(rename.changes),
  );
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 732 } });
  const page = await context.newPage();
  await page.goto(WEB + '/app', { waitUntil: 'domcontentloaded' });
  const card = page.locator('.todo-card[data-todo-id="' + rename.todoId + '"]');
  await card.waitFor({ state: 'visible', timeout: 60000 });
  await card.locator('.todo-card-action').click();
  const dialog = page.getByRole('dialog', { name: '完成任务' });
  await dialog.waitFor({ state: 'visible', timeout: 15000 });
  const expectedMerge = EXPECT === 'before' ? 0 : 1;
  const deadline = Date.now() + 8000;
  let mergeCount = await dialog.getByText(MERGE_LABEL).count();
  while (mergeCount !== expectedMerge && Date.now() < deadline) {
    await page.waitForTimeout(200);
    mergeCount = await dialog.getByText(MERGE_LABEL).count();
  }
  await shot(page, 'hunkless-' + EXPECT + '-rename-dialog.png');
  const doneDisabled = await dialog.getByRole('button', { name: '完成', exact: true }).isDisabled();
  const noteCount = await dialog.getByText(EMPTY_NOTE).count();
  if (EXPECT === 'before') {
    check('before rename 不展示合并行', mergeCount === 0, 'count=' + mergeCount);
    check('before rename 说明行在', noteCount === 1, 'note=' + noteCount);
    check('before rename 完成可点', doneDisabled === false, 'disabled=' + doneDisabled);
  } else {
    check('after rename changes.changed', rename.changes.changed === true, JSON.stringify(rename.changes));
    check('after rename 展示合并行', mergeCount === 1, 'count=' + mergeCount);
    check('after rename 无空提交说明', noteCount === 0, 'note=' + noteCount);
    check('after rename 缺授权时完成禁用', doneDisabled === true, 'disabled=' + doneDisabled);
  }
  await context.close();
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  writeFileSync(
    join(EVIDENCE, 'result.json'),
    JSON.stringify(
      { probe: '1313-hunkless-rename', expect: EXPECT, server: SERVER, web: WEB, ok: failed.length === 0, checks, artifacts },
      null,
      2,
    ),
  );
  process.stdout.write(
    (failed.length === 0 ? 'ALL PASS' : 'FAILED ' + failed.length) + '  evidence=' + EVIDENCE + '\n',
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

const empty = await seedReview('空提交收口', '');
const files = await seedReview('有文件改动', SAMPLE_DIFF);
await saveJson('empty-todo.json', empty.face);
await saveJson('empty-changes.json', empty.changes);
await saveJson('files-todo.json', files.face);
await saveJson('files-changes.json', files.changes);
check('empty hasChanges', empty.face.hasChanges === true, String(empty.face.hasChanges));
check('empty changes files 为空', Array.isArray(empty.changes.files) && empty.changes.files.length === 0, JSON.stringify(empty.changes));
check('files changes 有文件', Array.isArray(files.changes.files) && files.changes.files.length === 1, JSON.stringify(files.changes.files?.map((f) => f.path)));
if (EXPECT === 'after') {
  check('after empty changes reported', empty.changes.reported === true, JSON.stringify(empty.changes));
  check('after files changes reported', files.changes.reported === true, JSON.stringify({ reported: files.changes.reported }));
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 732 } });
const page = await context.newPage();
await page.goto(WEB + '/app', { waitUntil: 'domcontentloaded' });

async function openAccept(todoId) {
  const card = page.locator('.todo-card[data-todo-id="' + todoId + '"]');
  await card.waitFor({ state: 'visible', timeout: 60000 });
  await card.locator('.todo-card-action').click();
  const dialog = page.getByRole('dialog', { name: '完成任务' });
  await dialog.waitFor({ state: 'visible', timeout: 15000 });
  return dialog;
}

async function settleMerge(dialog, expectedCount) {
  const deadline = Date.now() + 8000;
  let count = await dialog.getByText(MERGE_LABEL).count();
  while (count !== expectedCount && Date.now() < deadline) {
    await page.waitForTimeout(200);
    count = await dialog.getByText(MERGE_LABEL).count();
  }
  return count;
}

const emptyDialog = await openAccept(empty.todoId);
const emptyMergeVisible = await settleMerge(emptyDialog, EXPECT === 'before' ? 1 : 0);
await shot(page, EXPECT + '-empty-dialog.png');
const emptyDone = emptyDialog.getByRole('button', { name: '完成', exact: true });
const emptyDoneDisabled = await emptyDone.isDisabled();
const emptyBlock = await emptyDialog.getByText(/授权，无法合并/).count();
if (EXPECT === 'before') {
  check('before empty 展示合并行', emptyMergeVisible === 1, 'count=' + emptyMergeVisible);
  check('before empty 完成禁用', emptyDoneDisabled === true, 'disabled=' + emptyDoneDisabled);
  check('before empty 缺授权文案', emptyBlock === 1, 'block=' + emptyBlock);
  await emptyDialog.getByRole('checkbox', { name: MERGE_LABEL }).click();
  await shot(page, EXPECT + '-empty-unchecked.png');
  const stillDisabled = await emptyDone.isDisabled();
  check('before 取消勾选后完成仍禁用', stillDisabled === true, 'disabled=' + stillDisabled);
} else {
  check('after empty 不展示合并行', emptyMergeVisible === 0, 'count=' + emptyMergeVisible);
  check('after empty 说明行在', (await emptyDialog.getByText(EMPTY_NOTE).count()) === 1);
  check('after empty 完成可点', emptyDoneDisabled === false, 'disabled=' + emptyDoneDisabled);
  check('after empty 无缺授权文案', emptyBlock === 0, 'block=' + emptyBlock);
  await emptyDone.click();
  await emptyDialog.waitFor({ state: 'hidden', timeout: 15000 });
  await page.locator('[data-column="done"] [data-todo-id="' + empty.todoId + '"]').waitFor({
    state: 'visible',
    timeout: 15000,
  });
  await shot(page, EXPECT + '-empty-done-column.png');
}
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

const filesDialog = await openAccept(files.todoId);
const filesMerge = await settleMerge(filesDialog, 1);
await shot(page, EXPECT + '-files-dialog.png');
const filesDisabled = await filesDialog.getByRole('button', { name: '完成', exact: true }).isDisabled();
check(EXPECT + ' files 仍展示合并行', filesMerge === 1, 'count=' + filesMerge);
check(EXPECT + ' files 缺授权时完成禁用', filesDisabled === true, 'disabled=' + filesDisabled);
await page.keyboard.press('Escape');

await context.close();
await browser.close();

if (EXPECT === 'after') {
  const face = await getJson(SERVER + '/api/todos/' + empty.todoId);
  check('after empty 相位 done', face.body.phase === 'done', face.body.phase);
  const steps = dbRead((db) =>
    db.prepare('SELECT kind, status FROM step WHERE buildId = ?').all(empty.buildId),
  );
  await saveJson('empty-steps.json', steps);
  check('after empty 零 merge 步', steps.every((s) => s.kind !== 'merge'), JSON.stringify(steps));
  const messages = dbRead((db) =>
    db.prepare('SELECT role, content, actor FROM message WHERE conversationId = ?').all(empty.buildId),
  );
  const parsed = messages.map((r) => {
    let content = r.content;
    if (typeof content === 'string') {
      try {
        content = JSON.parse(content);
      } catch {

      }
    }
    return { ...r, content };
  });
  await saveJson('empty-messages.json', parsed);
  const doneRow = parsed.find((r) => r.content === DONE_TEXT);
  check('after empty 审计行标记为已完成', doneRow !== undefined, JSON.stringify(doneRow ?? null));
}

const failed = checks.filter((c) => !c.ok);
writeFileSync(
  join(EVIDENCE, 'result.json'),
  JSON.stringify(
    {
      probe: '1313-empty-review',
      expect: EXPECT,
      server: SERVER,
      web: WEB,
      ok: failed.length === 0,
      checks,
      artifacts,
    },
    null,
    2,
  ),
);
process.stdout.write(
  (failed.length === 0 ? 'ALL PASS' : 'FAILED ' + failed.length) + '  evidence=' + EVIDENCE + '\n',
);
process.exit(failed.length === 0 ? 0 : 1);
