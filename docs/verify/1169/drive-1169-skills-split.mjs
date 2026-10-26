#!/usr/bin/env node

import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const REPO = process.env.VERIFY_REPO_ROOT ?? SCRIPT_REPO;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(REPO, '.claude', 'verify-run');
const ports = existsSync(join(RUN_DIR, 'ports.json'))
  ? JSON.parse(readFileSync(join(RUN_DIR, 'ports.json'), 'utf8'))
  : {};
const SERVER = process.env.SERVER ?? `http://127.0.0.1:${ports.serverPort ?? 8791}`;
const WEB = process.env.WEB ?? `http://127.0.0.1:${ports.webPort ?? 5273}`;
const DB = process.env.DB ?? join(RUN_DIR, 'home', 'server', 'server.db');
const DAEMON_HOME = process.env.DAEMON_HOME ?? '/tmp/cairn-1169-daemon-home';
const LOCAL_SKILLS = process.env.LOCAL_SKILLS ?? '/tmp/cairn-1169-local-skills';
const MODEL = process.env.MODEL ?? 'glm-5.3';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, v] = a.slice(2).split('=');
      return [k, v ?? 'true'];
    }),
);
const PHASE = args.phase ?? 'api';
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ?? `/tmp/cairn-1169-evidence-${PHASE}-${ts}`;
mkdirSync(EVIDENCE, { recursive: true });

const SKILL_MARKER = 'SKILL-SPLIT-1169';
const TASK_TITLE = '读技能并写俳句';
const TASK_SPEC = `读取技能 haiku-helper 的 SKILL.md 全文，按照其中的步骤以「深夜写代码」为主题写一首三行俳句，保存到仓库根目录的 haiku.txt，然后在汇报里逐字复述 SKILL.md 中含 ${SKILL_MARKER} 的那一行。`;

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
function finish(exitOnFail = true) {
  const passed = checks.filter((c) => c.ok).length;
  save('result.json', {
    probe: `drive-1169-skills-split/${PHASE}`,
    server: SERVER,
    web: WEB,
    db: DB,
    daemonHome: DAEMON_HOME,
    localSkills: LOCAL_SKILLS,
    model: PHASE === 'behavior' ? MODEL : null,
    passed,
    total: checks.length,
    checks,
  });
  process.stdout.write(`\n${passed}/${checks.length} checks passed → ${EVIDENCE}\n`);
  if (exitOnFail && passed !== checks.length) process.exit(1);
}

async function jfetch(method, path, opts = {}) {
  const headers = {};
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${SERVER}${path}`, {
    method,
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
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

function openDb() {
  const require2 = createRequire(join(REPO, 'apps/server/package.json'));
  const Database = require2('better-sqlite3');
  return new Database(DB, { readonly: true });
}

async function teamIdOf() {
  const res = await jfetch('GET', '/api/teams');
  const id = Array.isArray(res.body) ? res.body[0]?.id : res.body?.[0]?.id;
  if (!id) throw new Error(`teams failed: ${res.status}`);
  return id;
}

async function enableRuntimes(teamId) {
  const list = await jfetch('GET', `/api/teams/${teamId}/machines`);
  const rows = Array.isArray(list.body) ? list.body : [];
  let patched = 0;
  for (const m of rows) {
    if (!m.online) continue;
    const res = await jfetch('PATCH', `/api/machines/${m.id}`, {
      body: { enabledRuntimes: ['pi', 'claude-code'] },
    });
    if (res.status === 200) patched += 1;
  }
  return patched;
}

async function ensureTeamSkill(teamId) {
  const body = {
    name: 'haiku-helper',
    description: 'Use when the task asks to write a haiku, a three-line short poem.',
    files: [
      {
        path: 'SKILL.md',
        content: `---\nname: haiku-helper\ndescription: Use when the task asks to write a haiku, a three-line short poem.\n---\n\n# haiku-helper\n\n写俳句的步骤：\n\n1. 三行，音节节奏约 5/7/5。\n2. 把俳句写入任务指定的文件。\n3. 汇报时必须复述本文件的 marker 行：${SKILL_MARKER}\n`,
      },
    ],
  };
  const res = await jfetch('POST', `/api/skills?teamId=${encodeURIComponent(teamId)}`, { body });
  if (res.status !== 201 && res.status !== 409) {
    throw new Error(`team skill seed failed: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
  }
  return res.status === 201;
}

async function createAgent(teamId, body) {
  const res = await jfetch('POST', `/api/teams/${teamId}/agents`, { body });
  const agentId = res.body?.id ?? res.body?.agent?.id;
  if (!agentId) {
    throw new Error(`agent create failed: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
  }
  return agentId;
}

async function createTaskAndBuild(projectId, agentId, title, spec) {
  const todoRes = await jfetch('POST', `/api/projects/${projectId}/todos`, {
    body: { title, spec },
  });
  const todoId = todoRes.body?.id;
  const buildRes = await jfetch('POST', `/api/projects/${projectId}/builds`, {
    body: { todoIds: [todoId], assignment: { plan: null, build: { agentId } }, withPlan: false },
  });
  const buildId = buildRes.body?.builds?.[0]?.id ?? buildRes.body?.buildId;
  if (!todoId || !buildId) {
    throw new Error(`task seed failed: ${JSON.stringify(buildRes.body).slice(0, 200)}`);
  }
  return { todoId, buildId };
}

async function waitStepTerminal(buildId, timeoutMs) {
  const db = openDb();
  const started = Date.now();
  try {
    for (;;) {
      const rows = db
        .prepare('SELECT id, kind, status FROM step WHERE buildId = ? ORDER BY createdAt')
        .all(buildId);
      const terminal = rows.filter((r) => ['done', 'failed', 'stopped'].includes(r.status));
      if (terminal.length > 0) {
        const build = db.prepare('SELECT id, errorMessage FROM build WHERE id = ?').get(buildId);
        return { step: terminal[terminal.length - 1], build };
      }
      if (Date.now() - started > timeoutMs) return { step: null, build: null };
      await new Promise((r) => setTimeout(r, 2000));
    }
  } finally {
    db.close();
  }
}

function messagesOf(buildId) {
  const db = openDb();
  try {
    return db
      .prepare('SELECT id, role, content, createdAt FROM message WHERE conversationId = ?')
      .all(buildId)
      .map((r) => ({ ...r, content: tryParse(r.content) }));
  } finally {
    db.close();
  }
}
function tryParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function daemonLogLines() {
  const p = join(DAEMON_HOME, 'daemon.log');
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').filter(Boolean);
}

function ensureLocalSkills() {
  const dir = join(LOCAL_SKILLS, 'unrestrict-local');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: unrestrict-local\ndescription: local-only probe skill for 1169\n---\n\nlocal body.\n`,
    'utf8',
  );
}

async function phaseApi() {
  const teamId = await teamIdOf();
  await ensureTeamSkill(teamId);

  const nullAgentId = await createAgent(teamId, {
    displayName: `split-null-${Date.now()}`,
    provider: 'stub-gw',
    modelId: 'stub-model',
  });
  const g1 = await jfetch('GET', `/api/teams/${teamId}/agents/${nullAgentId}`);
  save('api-a1-null-create.json', g1.body);
  check('A1 创建缺省 = defaultSkill null + skillsAllowlist null（不再 []）', g1.body?.defaultSkill === null && g1.body?.skillsAllowlist === null, JSON.stringify({ d: g1.body?.defaultSkill, a: g1.body?.skillsAllowlist }));
  check('A1 旧 skills 字段不出 wire', !('skills' in (g1.body ?? {})));

  const p1 = await jfetch('PATCH', `/api/teams/${teamId}/agents/${nullAgentId}`, {
    body: { skillsAllowlist: [] },
  });
  check('A2 勾空 [] 原样存（显式全拒）', Array.isArray(p1.body?.skillsAllowlist) && p1.body?.skillsAllowlist?.length === 0, JSON.stringify(p1.body?.skillsAllowlist));
  const p2 = await jfetch('PATCH', `/api/teams/${teamId}/agents/${nullAgentId}`, {
    body: { skillsAllowlist: null },
  });
  check('A2 显式 null 写回（不限制，与省键两态）', p2.body?.skillsAllowlist === null, JSON.stringify(p2.body?.skillsAllowlist));

  const p3 = await jfetch('PATCH', `/api/teams/${teamId}/agents/${nullAgentId}`, {
    body: { defaultSkill: 'haiku-helper' },
  });
  check('A3 defaultSkill 单值存', p3.body?.defaultSkill === 'haiku-helper', JSON.stringify(p3.body?.defaultSkill));
  check('A3 defaultSkill 不动授权面（null 保持）', p3.body?.skillsAllowlist === null);
  const p4 = await jfetch('PATCH', `/api/teams/${teamId}/agents/${nullAgentId}`, {
    body: { skillsAllowlist: ['haiku-helper', 'ghost-id'] },
  });
  check('A4 数组白名单过现扫滤除（ghost 死引用静默脱落）', JSON.stringify(p4.body?.skillsAllowlist) === JSON.stringify(['haiku-helper']), JSON.stringify(p4.body?.skillsAllowlist));
  check('A4 授权面不动携带面（defaultSkill 保持）', p4.body?.defaultSkill === 'haiku-helper');

  const p5 = await jfetch('PATCH', `/api/teams/${teamId}/agents/${nullAgentId}`, {
    body: { defaultSkill: ['haiku-helper'] },
  });
  check('A5 defaultSkill 收数组 = 400', p5.status === 400, `status=${p5.status}`);

  const claimNullAgentId = await createAgent(teamId, {
    displayName: `split-claim-null-${Date.now()}`,
    provider: 'stub-gw',
    modelId: 'stub-model',
  });
  const subsetAgentId = await createAgent(teamId, {
    displayName: `split-subset-${Date.now()}`,
    provider: 'stub-gw',
    modelId: 'stub-model',
    defaultSkill: 'haiku-helper',
    skillsAllowlist: ['haiku-helper'],
  });
  const apiKeyRes = await jfetch('POST', `/api/teams/${teamId}/api-keys`, {
    body: { name: 'probe-1169-wire', gitAccess: true, mcpAccess: false, toolGrants: { read: [], write: [] } },
  });
  const key = apiKeyRes.body?.plaintext;
  check('A6 建机器 API key', Boolean(key), `status=${apiKeyRes.status}`);
  const enroll = await jfetch('POST', '/api/machine/enroll', {
    bearer: key,
    body: { teamId, name: `probe-1169-${Date.now()}`, cliVersion: '0.2.0' },
  });
  const token = enroll.body?.token;
  check('A6 enroll 机器凭证', Boolean(token), `status=${enroll.status}`);

  const projectId = (await jfetch('POST', '/api/projects', {
    body: { name: `probe-1169-${Date.now()}`, repoKind: 'hosted' },
  })).body?.id;

  const nullBuild = await createTaskAndBuild(projectId, claimNullAgentId, 'null 腿', '读一个文件并汇报。');
  const c1 = await jfetch('POST', '/api/machine/tasks/claim', { bearer: token, body: {} });
  const claimed1 = c1.body?.step;
  save('api-claim-null.json', claimed1);
  check('A6 null agent claim 到步', Boolean(claimed1?.step?.id), `todo=${nullBuild.todoId}`);
  check('A6 载荷 skillsAllowlist=null（不限制——非缺省非 []）', claimed1?.agent?.skillsAllowlist === null, JSON.stringify(claimed1?.agent?.skillsAllowlist));
  check('A6 载荷 defaultSkill=null', claimed1?.agent?.defaultSkill === null);
  const m1 = await jfetch('GET', `/api/machine/skills/${claimed1.step.id}`, { bearer: token });
  check('A6 null agent 清单 selection=all（全量分发，非空清单）', m1.body?.selection === 'all', JSON.stringify(m1.body?.selection));
  const n1 = await jfetch('GET', `/api/machine/skills/${claimed1.step.id}/file?dirName=haiku-helper&path=SKILL.md`, { bearer: token });
  check('A6 null agent 直取团队技能文件 200（不限制）', n1.status === 200, `status=${n1.status}`);
  await jfetch('POST', `/api/machine/done/${claimed1.step.id}`, { bearer: token, body: { status: 'failed', errorMessage: 'probe-1169 api leg released' } });

  const subsetBuild = await createTaskAndBuild(projectId, subsetAgentId, 'subset 腿', '读一个文件并汇报。');
  const c2 = await jfetch('POST', '/api/machine/tasks/claim', { bearer: token, body: {} });
  const claimed2 = c2.body?.step;
  save('api-claim-subset.json', claimed2);
  check('A6 subset agent claim 到步', Boolean(claimed2?.step?.id), `todo=${subsetBuild.todoId}`);
  check('A6 载荷 skillsAllowlist 数组原样', JSON.stringify(claimed2?.agent?.skillsAllowlist) === JSON.stringify(['haiku-helper']), JSON.stringify(claimed2?.agent?.skillsAllowlist));
  check('A6 载荷 defaultSkill 单值原样', claimed2?.agent?.defaultSkill === 'haiku-helper');
  const m2 = await jfetch('GET', `/api/machine/skills/${claimed2.step.id}`, { bearer: token });
  check('A6 subset 清单 selection=whitelist 且只含白名单内技能', m2.body?.selection === 'whitelist' && (m2.body?.skills ?? []).every((s) => s.id === 'haiku-helper'), JSON.stringify({ sel: m2.body?.selection, ids: (m2.body?.skills ?? []).map((s) => s.id) }));
  const n2 = await jfetch('GET', `/api/machine/skills/${claimed2.step.id}/file?dirName=unrestrict-local&path=SKILL.md`, { bearer: token });
  check('A6 subset 白名单外 404（授权面零回归）', n2.status === 404, `status=${n2.status}`);
  await jfetch('POST', `/api/machine/done/${claimed2.step.id}`, { bearer: token, body: { status: 'failed', errorMessage: 'probe-1169 api leg released' } });
  return finish();
}

async function phaseBehavior() {
  const teamId = await teamIdOf();

  const patched = await enableRuntimes(teamId);
  check('在线机器 runtime 闸打开（pi + claude-code）', patched > 0, `patched=${patched}`);
  await ensureTeamSkill(teamId);
  ensureLocalSkills();

  const agentId = await createAgent(teamId, {
    displayName: `split-behavior-${Date.now()}`,
    provider: 'claude-code',
    modelId: MODEL,
  });

  const projectId = (await jfetch('POST', '/api/projects', {
    body: { name: `probe-1169-behavior-${Date.now()}`, repoKind: 'hosted' },
  })).body?.id;

  const attempts = [];
  let landed = null;
  for (let attempt = 1; attempt <= 3 && landed === null; attempt++) {
    const { todoId, buildId } = await createTaskAndBuild(projectId, agentId, TASK_TITLE, TASK_SPEC);
    process.stdout.write(`[behavior] attempt ${attempt}: todo=${todoId} build=${buildId}\n`);
    const terminal = await waitStepTerminal(buildId, 600_000);
    attempts.push({ attempt, todoId, buildId, terminal });
    if (terminal.step?.status === 'done') landed = { todoId, buildId };
    else process.stdout.write(`[behavior] attempt ${attempt} not done: ${JSON.stringify(terminal).slice(0, 300)}\n`);
  }
  save('behavior-attempts.json', attempts);
  check('真模型步 done（≤3 次尝试）', landed !== null, landed ? `build=${landed.buildId}` : 'attempts 全失败');
  if (landed === null) return finish();
  const { todoId, buildId } = landed;

  const msgs = messagesOf(buildId);
  save('behavior-messages.json', msgs);
  const msgsFlat = JSON.stringify(msgs);
  check('transcript 含 haiku-helper SKILL.md 的读取', msgsFlat.includes('haiku-helper') && msgsFlat.includes('SKILL.md'));
  check('transcript 复述了技能 marker 行（主判据）', msgsFlat.includes(SKILL_MARKER));

  const logs = daemonLogLines();
  const skillLogs = logs.filter((l) => l.includes('[skills]'));
  save('behavior-daemon-skills-log.txt', skillLogs.join('\n'));
  check('daemon.log 目录行 entries≥1（null = 全量 catalog）', skillLogs.some((l) => /\[skills\] catalog: entries=(\d+)/.test(l) && Number.parseInt(l.match(/entries=(\d+)/)?.[1] ?? '0', 10) >= 1));
  const denyLines = skillLogs.filter((l) => l.includes('[skills] deny:'));
  save('behavior-deny-lines.txt', denyLines.join('\n'));
  check('daemon.log 无硬挡行（不限制 agent 零 deny）', denyLines.length === 0, `${denyLines.length} line(s)`);

  const { execFileSync } = await import('node:child_process');
  const worktree = join(DAEMON_HOME, 'workspaces', buildId);
  let committed = '';
  try {
    committed = execFileSync('git', ['-C', worktree, 'show', 'HEAD:haiku.txt'], { encoding: 'utf8' });
  } catch (err) {
    committed = `(git show failed: ${String(err).slice(0, 120)})`;
  }
  save('behavior-artifact-head-haiku.txt', committed);
  check('提交面 HEAD:haiku.txt 含俳句产物', !committed.startsWith('(git show failed)') && committed.length > 0, committed.slice(0, 120));

  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 732 } });
    await page.goto(`${WEB}/app/todo/${todoId}`);
    const summary = page.locator('[data-testid="skills-summary"]');
    await summary.waitFor({ timeout: 60_000 });
    await page.screenshot({ path: join(EVIDENCE, 'behavior-detail-skills-summary.png') });
    const text = (await summary.textContent()) ?? '';
    save('behavior-summary-text.txt', text);
    check('详情页技能汇总行点名 haiku-helper 且零挡下', text.includes('haiku-helper') && !text.includes('挡下：'), text.trim().slice(0, 160));
  } catch (err) {
    check('详情页技能汇总行截图', false, String(err).slice(0, 200));
  } finally {
    await browser.close();
  }
  return finish();
}

if (PHASE === 'api') {
  await phaseApi();
} else if (PHASE === 'behavior') {
  await phaseBehavior();
} else {
  process.stderr.write(`unknown --phase=${PHASE} (api | behavior)\n`);
  process.exit(2);
}
