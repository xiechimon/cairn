import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SCRIPT_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const REPO = process.env.VERIFY_REPO_ROOT ?? SCRIPT_REPO;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(REPO, '.claude/verify-run');
const ports = existsSync(join(RUN_DIR, 'ports.json'))
  ? JSON.parse(readFileSync(join(RUN_DIR, 'ports.json'), 'utf8'))
  : {};
const SERVER = `http://127.0.0.1:${ports.serverPort ?? process.env.VERIFY_PORT ?? 8791}`;
const WEB = `http://127.0.0.1:${ports.webPort ?? process.env.VERIFY_WEB_PORT ?? 5273}`;
const DB_PATH = join(RUN_DIR, 'home/server/server.db');
const REPOS_DIR = join(RUN_DIR, 'home/server/repos');
const BRANCH_PREFIX = 'cairn/conv-';
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ??
  join(SCRIPT_REPO, `.claude/verify-evidence/${ts}-failed-review-restore`);
mkdirSync(EVIDENCE, { recursive: true });

const require2 = createRequire(join(REPO, 'apps/server/package.json'));
const Database = require2('better-sqlite3');

const GIT_ID = ['-c', 'user.name=verify-702', '-c', 'user.email=verify-702@localhost'];
function git(args, cwd) {
  return execFileSync('git', [...GIT_ID, ...args], { cwd, encoding: 'utf8' }).trim();
}

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

async function driveToDeadlock(seed) {
  const { todoId, machineToken, agentId } = seed;

  const build = await jpost(`/api/projects/${seed.projectId}/builds`, {
    todoIds: [todoId],
    assignment: { plan: { agentId }, build: { agentId } },
    withPlan: true,
  });
  const buildId = build.body?.builds?.[0]?.id;
  if (!buildId) throw new Error(`build create failed: ${JSON.stringify(build.body)}`);
  const planClaim = await jpost('/api/machine/tasks/claim', {}, machineToken);
  const planStep = planClaim.body?.step?.step ?? planClaim.body?.step;
  if (planStep?.kind !== 'plan') throw new Error(`expected plan claim: ${JSON.stringify(planClaim.body)}`);
  const urls = await jpost(`/api/machine/upload-urls/${planStep.id}`, {
    files: [{ name: 'plan.md' }],
  }, machineToken);
  const up = urls.body?.uploads?.[0];
  const put = await fetch(`${SERVER}${up.url.replace(/^https?:\/\/[^/]+/, '')}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${machineToken}`, 'content-type': 'text/markdown' },
    body: '# plan v1\n\n702 恢复探针方案\n',
  });
  if (put.status !== 200) throw new Error(`plan upload ${put.status}`);
  const planDone = await jpost(`/api/machine/done/${planStep.id}`, {
    status: 'success',
    sessionId: `pi-${buildId}`,
  }, machineToken);
  if (planDone.status !== 200) throw new Error(`plan done ${planDone.status}`);

  const confirm = await jpost(`/api/builds/${buildId}/steps`, { action: 'confirm' });
  if (confirm.status !== 202) throw new Error(`confirm ${confirm.status}`);

  const bareDir = join(REPOS_DIR, seed.teamId, `${seed.repoName}.git`);
  const work = mkdtempSync(join(tmpdir(), 'cairn-702-'));
  try {
    git(['clone', bareDir, 'repo'], work);
    const repoDir = join(work, 'repo');
    const branch = `${BRANCH_PREFIX}${buildId}`;
    git(['checkout', '-B', branch], repoDir);
    writeFileSync(join(repoDir, `probe-${buildId.slice(0, 8)}.md`), `# probe ${buildId}\n`);
    git(['add', '-A'], repoDir);
    git(['commit', '-m', 'conv round (702 probe)'], repoDir);
    git(['push', 'origin', branch], repoDir);
    const convSha = git(['rev-parse', 'HEAD'], repoDir);

    const buildClaim = await jpost('/api/machine/tasks/claim', {}, machineToken);
    const buildStep = buildClaim.body?.step?.step ?? buildClaim.body?.step;
    if (buildStep?.kind !== 'build') throw new Error(`expected build claim: ${JSON.stringify(buildClaim.body)}`);
    const buildDone = await jpost(`/api/machine/done/${buildStep.id}`, {
      status: 'success',
      sessionId: `pi-${buildId}`,
      hasChanges: true,
      commit: convSha,
    }, machineToken);
    if (buildDone.status !== 200) throw new Error(`build done ${buildDone.status}`);
    const phase1 = await jget(`/api/todos/${todoId}`);
    if (phase1.body.phase !== 'review') throw new Error(`expected review, got ${phase1.body.phase}`);

    const reviewStart = await jpost(`/api/builds/${buildId}/steps`, {
      action: 'review',
      agentId,
    });
    if (reviewStart.status !== 202) throw new Error(`review start ${reviewStart.status}`);
    const reviewClaim = await jpost('/api/machine/tasks/claim', {}, machineToken);
    const reviewStep = reviewClaim.body?.step?.step ?? reviewClaim.body?.step;
    if (reviewStep?.kind !== 'review') throw new Error(`expected review claim: ${JSON.stringify(reviewClaim.body)}`);
    const reviewDone = await jpost(`/api/machine/done/${reviewStep.id}`, {
      status: 'failed',
      errorMessage: 'stream timeout (first=300000ms idle=480000ms)',
    }, machineToken);
    if (reviewDone.status !== 200) throw new Error(`review done ${reviewDone.status}`);
    const phase2 = await jget(`/api/todos/${todoId}`);
    if (phase2.body.phase !== 'failed') throw new Error(`expected failed, got ${phase2.body.phase}`);
    return { buildId, convSha, reviewStepId: reviewStep.id };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 732 } });

  const teams = await jget('/api/teams');
  const teamId = teams.body?.[0]?.id;
  const prov = await jpost(`/api/teams/${teamId}/providers`, {
    providerId: 'stub-gw',
    label: 'Stub Gateway',
    baseUrl: 'http://127.0.0.1:9/v1',
    api: 'openai-completions',
    authHeader: true,
    compat: { supportsDeveloperRole: false },
    models: [{ id: 'stub-model', name: 'stub-model' }],
  });
  if (![200, 201, 409].includes(prov.status)) throw new Error(`provider ${prov.status}`);
  const agent = await jpost(`/api/teams/${teamId}/agents`, {
    displayName: 'verify-builder-702',
    provider: 'stub-gw',
    modelId: 'stub-model',
  });
  const agentId = agent.body?.id ?? agent.body?.agentId ?? agent.body?.record?.id;
  if (!agentId) throw new Error(`agent create: ${JSON.stringify(agent.body)}`);
  const grant = await jpost(
    `/api/teams/${teamId}/agents/${agentId}`,
    { tools: ['合并分支', '推送分支'] },
    undefined,
    'PATCH',
  );
  if (grant.status !== 200) throw new Error(`agent tools grant ${grant.status}`);
  const project = await jpost('/api/projects', {
    name: '702-restore-probe',
    repoKind: 'hosted',
  });
  const projectId = project.body?.id;
  const repoName = project.body?.repoName;
  if (!projectId || !repoName) throw new Error(`project: ${JSON.stringify(project.body)}`);
  const apiKey = await jpost(`/api/teams/${teamId}/api-keys`, {
    name: 'verify-702-mbp',
    gitAccess: false,
    mcpAccess: false,
    toolGrants: { read: [], write: [] },
  });
  const apiKeyPlain = apiKey.body?.plaintext ?? apiKey.body?.token;
  if (!apiKeyPlain) throw new Error(`api-key: ${JSON.stringify(apiKey.body)}`);
  const enroll = await jpost('/api/machine/enroll', {
    teamId,
    name: 'verify-702-mbp',
    cliVersion: '0.1.0',
  }, apiKeyPlain);
  const machineToken = enroll.body?.token;
  if (!machineToken) throw new Error(`enroll: ${JSON.stringify(enroll.body)}`);
  const seed = { teamId, projectId, repoName, machineToken, agentId };

  const todoA = await jpost(`/api/projects/${projectId}/todos`, {
    title: '702 恢复探针 A（合并出口）',
    spec: '走完 build 腿，审核步撞墙后从产品内合并',
  });
  const todoB = await jpost(`/api/projects/${projectId}/todos`, {
    title: '702 恢复探针 B（审核重跑出口）',
    spec: '走完 build 腿，审核步撞墙后只重跑审核',
  });
  const deadA = await driveToDeadlock({ ...seed, todoId: todoA.body.id });
  const deadB = await driveToDeadlock({ ...seed, todoId: todoB.body.id });

  const stepsA = await jget(`/api/builds/${deadA.buildId}/steps`);
  const buildStepA = (stepsA.body ?? []).filter((s) => s.kind === 'build').at(-1);
  const reviewStepA = (stepsA.body ?? []).filter((s) => s.kind === 'review').at(-1);
  check('deadlock-shape-build-done', buildStepA?.status === 'done', `status=${buildStepA?.status}`);
  check('deadlock-shape-build-commit', (buildStepA?.checkpointCommit ?? null) === deadA.convSha,
    `checkpointCommit=${buildStepA?.checkpointCommit}`);
  check('deadlock-shape-review-failed', reviewStepA?.status === 'failed', `status=${reviewStepA?.status}`);
  const todoAFace = await jget(`/api/todos/${todoA.body.id}`);
  check('deadlock-shape-todo-failed', todoAFace.body.phase === 'failed', `phase=${todoAFace.body.phase}`);
  const bareDir = join(REPOS_DIR, teamId, `${repoName}.git`);
  const branchA = `${BRANCH_PREFIX}${deadA.buildId}`;
  const branchTip = git(['rev-parse', `refs/heads/${branchA}`], bareDir);
  check('deadlock-artifact-branch-exists', branchTip === deadA.convSha, `tip=${branchTip}`);
  writeFileSync(join(EVIDENCE, 'api-todoA-failed.json'), JSON.stringify(todoAFace.body, null, 2));
  writeFileSync(join(EVIDENCE, 'api-buildA-steps-deadlock.json'), JSON.stringify(stepsA.body, null, 2));

  await page.goto(`${WEB}/app/todo/${todoA.body.id}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(EVIDENCE, '01-todoA-failed-detail.png'), fullPage: true });
  check('ui-failed-detail-reachable', Boolean(await page.$('.detail-head-icon--more')), 'failed 详情页 + 更多钮在');
  await page.click('.detail-head-icon--more');
  await page.waitForSelector('.more-menu', { timeout: 5_000 });
  await page.screenshot({ path: join(EVIDENCE, '02-todoA-more-menu-complete-enabled.png') });
  const completeRow = page.locator('.more-menu-item', { hasText: '完成' });
  check('ui-complete-row-enabled', await completeRow.isEnabled(), 'build 腿已交付 → 完成钮回亮（修前 = 消失/禁用）');

  const mergeResponseP = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes(`/api/builds/${deadA.buildId}/merge`),
    { timeout: 10_000 },
  );
  await completeRow.click();
  await page.waitForSelector('[role="dialog"]', { timeout: 5_000 });
  await page.screenshot({ path: join(EVIDENCE, '03-todoA-accept-dialog.png') });
  check('ui-accept-dialog-opened', (await page.locator('[role="dialog"]').getAttribute('aria-label')) === '完成任务', '验收确认弹层打开（可及名载体，#952）');

  await page.locator('[role="dialog"]').getByRole('button', { name: '完成' }).click();
  const mergeResponse = await mergeResponseP;
  check('api-merge-from-failed-202', mergeResponse.status() === 202,
    `POST /builds/{id}/merge from failed = ${mergeResponse.status()}（修前 409 illegal phase transition）`);
  await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 5_000 });

  const restored = await jget(`/api/todos/${todoA.body.id}`);
  check('api-restored-phase-review', restored.body.phase === 'review', `phase=${restored.body.phase}`);
  const stepsA2 = await jget(`/api/builds/${deadA.buildId}/steps`);
  const mergeStep = (stepsA2.body ?? []).filter((s) => s.kind === 'merge').at(-1);
  check('api-merge-step-queued', mergeStep?.status === 'pending', `status=${mergeStep?.status}`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(EVIDENCE, '04-todoA-restored-review-gate.png'), fullPage: true });

  const mergeClaim = await jpost('/api/machine/tasks/claim', {}, machineToken);
  const mergeStepClaimed = mergeClaim.body?.step?.step ?? mergeClaim.body?.step;
  check('machine-claim-merge-step', mergeStepClaimed?.kind === 'merge', `kind=${mergeStepClaimed?.kind}`);
  const mergeDone = await jpost(`/api/machine/done/${mergeStepClaimed.id}`, {
    status: 'success',
    sessionId: `pi-${deadA.buildId}`,
    commit: deadA.convSha,
  }, machineToken);
  check('machine-done-merge-step', mergeDone.status === 200, `status=${mergeDone.status}`);

  let doneFace = null;
  for (let i = 0; i < 20; i++) {
    doneFace = await jget(`/api/todos/${todoA.body.id}`);
    if (doneFace.body.phase === 'done') break;
    await new Promise((r) => setTimeout(r, 250));
  }
  check('api-final-phase-done', doneFace?.body.phase === 'done', `phase=${doneFace?.body.phase}`);
  const mainTip = git(['rev-parse', 'refs/heads/main'], bareDir);
  check('git-merge-landed-in-product', mainTip === deadA.convSha,
    `bare main = conv HEAD（${mainTip.slice(0, 8)}）——合并 100% 在产品内落地，PR 不孤儿化`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(EVIDENCE, '05-todoA-done-final.png'), fullPage: true });
  writeFileSync(join(EVIDENCE, 'api-todoA-done.json'), JSON.stringify(doneFace?.body, null, 2));
  writeFileSync(join(EVIDENCE, 'api-buildA-steps-final.json'), JSON.stringify((await jget(`/api/builds/${deadA.buildId}/steps`)).body, null, 2));

  const reviewAgain = await jpost(`/api/builds/${deadB.buildId}/steps`, {
    action: 'review',
    agentId,
  });
  check('api-review-rerun-from-failed-202', reviewAgain.status === 202,
    `steps action review from failed = ${reviewAgain.status}（修前 409「当前相位 failed」）`);
  const restoredB = await jget(`/api/todos/${todoB.body.id}`);
  check('api-review-rerun-restored-review', restoredB.body.phase === 'review', `phase=${restoredB.body.phase}`);
  const stepsB = await jget(`/api/builds/${deadB.buildId}/steps`);
  const reviewStepsB = (stepsB.body ?? []).filter((s) => s.kind === 'review');
  check('api-review-rerun-new-step-pending', reviewStepsB.length === 2 && reviewStepsB[1].status === 'pending',
    `review steps=${JSON.stringify(reviewStepsB.map((s) => s.status))}（旧 failed + 新 pending）`);

  const buildStepsB = (stepsB.body ?? []).filter((s) => s.kind === 'build');
  check('api-review-rerun-build-leg-untouched', buildStepsB.length === 1 && buildStepsB[0].status === 'done',
    `build steps=${JSON.stringify(buildStepsB.map((s) => s.status))}`);
  await page.goto(`${WEB}/app/todo/${todoB.body.id}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(EVIDENCE, '06-todoB-restored-review-gate.png'), fullPage: true });
  writeFileSync(join(EVIDENCE, 'api-todoB-restored.json'), JSON.stringify(restoredB.body, null, 2));
  writeFileSync(join(EVIDENCE, 'api-buildB-steps-restored.json'), JSON.stringify(stepsB.body, null, 2));

  const db = new Database(DB_PATH, { readonly: true });
  const rowsA = db
    .prepare('select kind, status, checkpointCommit from step where buildId = ? order by createdAt')
    .all(deadA.buildId);
  const todoARow = db.prepare('select phase from todo where id = ?').get(todoA.body.id);
  const rowsB = db
    .prepare('select kind, status, checkpointCommit from step where buildId = ? order by createdAt')
    .all(deadB.buildId);
  const todoBRow = db.prepare('select phase from todo where id = ?').get(todoB.body.id);
  db.close();
  writeFileSync(join(EVIDENCE, 'sqlite-rows.json'), JSON.stringify({ rowsA, todoARow, rowsB, todoBRow }, null, 2));
  check('sqlite-buildA-final', rowsA.map((r) => `${r.kind}:${r.status}`).join(',') ===
    'plan:done,build:done,review:failed,merge:done',
    `rowsA=${JSON.stringify(rowsA.map((r) => `${r.kind}:${r.status}`))}`);
  check('sqlite-todoA-done', todoARow?.phase === 'done', `phase=${todoARow?.phase}`);
  check('sqlite-buildB-restored', rowsB.map((r) => `${r.kind}:${r.status}`).join(',') ===
    'plan:done,build:done,review:failed,review:pending',
    `rowsB=${JSON.stringify(rowsB.map((r) => `${r.kind}:${r.status}`))}`);
  check('sqlite-todoB-review', todoBRow?.phase === 'review', `phase=${todoBRow?.phase}`);

  writeFileSync(
    join(EVIDENCE, 'result.json'),
    JSON.stringify(
      {
        probe: 'failed-review-restore (#702 custom, scripts/drive-failed-review-restore.mjs)',
        at: new Date().toISOString(),
        stack: { server: SERVER, web: WEB, teamId, projectId, repoName },
        todos: {
          A: { todoId: todoA.body.id, buildId: deadA.buildId, convSha: deadA.convSha },
          B: { todoId: todoB.body.id, buildId: deadB.buildId, convSha: deadB.convSha },
        },
        checks,
        allOk: checks.every((c) => c.ok),
      },
      null,
      2,
    ),
  );
  process.stdout.write(`\nevidence: ${EVIDENCE}\nallOk=${checks.every((c) => c.ok)}\n`);
} finally {
  await browser.close();
}
