#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SCRIPT_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const REPO = process.env.VERIFY_REPO_ROOT ?? SCRIPT_REPO;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(REPO, '.claude/verify-run');
const portsFile = join(RUN_DIR, 'ports.json');
if (!existsSync(portsFile)) {
  process.stderr.write('无栈：' + portsFile + ' 不存在或损坏。先跑 launch.mjs\n');
  process.exit(1);
}
const stack = JSON.parse(readFileSync(portsFile, 'utf8'));
const SERVER = 'http://127.0.0.1:' + (stack.serverPort ?? process.env.VERIFY_PORT ?? 8791);
const WEB = 'http://127.0.0.1:' + (stack.webPort ?? process.env.VERIFY_WEB_PORT ?? 5273);
const HOME_DIR = stack.homeDir ?? join(RUN_DIR, 'home');
const DB_PATH = join(HOME_DIR, 'server', 'server.db');
const require2 = createRequire(join(REPO, 'apps/server/package.json'));
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ??
  join(SCRIPT_REPO, '.claude/verify-evidence/' + ts + '-1251-capability-gate');
mkdirSync(EVIDENCE, { recursive: true });

const checks = [];
function check(name, ok, detail) {
  if (typeof ok !== 'boolean') {
    throw new TypeError('check(' + JSON.stringify(name) + ') 的 ok 位须为 boolean，收到 ' + typeof ok);
  }
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
  process.stdout.write('json  ' + name + '\n');
}
async function getJson(url, token) {
  const headers = token ? { authorization: 'Bearer ' + token } : undefined;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error('GET ' + url + ' → ' + res.status);
  return res.json();
}
async function sendJson(url, body, method, token, timeoutMs) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  const res = await fetch(url, {
    method: method ?? 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs ?? 8000),
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
function machineRowByName(name) {
  return dbRead((db) => db.prepare('SELECT * FROM machine WHERE name = ?').get(name));
}
function capsOf(name) {
  const row = machineRowByName(name);
  if (!row) return undefined;
  return row.capabilities === null || row.capabilities === undefined
    ? null
    : JSON.parse(row.capabilities);
}
function stepRow(stepId) {
  return dbRead((db) => db.prepare('SELECT * FROM step WHERE id = ?').get(stepId));
}
function stepsOf(buildId) {
  return dbRead((db) =>
    db.prepare('SELECT * FROM step WHERE "buildId" = ? ORDER BY "createdAt"').all(buildId),
  );
}

const teams = await getJson(SERVER + '/api/teams');
const teamId = teams[0]?.id;
if (!teamId) throw new Error('无 team——先重 launch（全新库 seed）');

const mcpList = await getJson(SERVER + '/api/teams/' + teamId + '/mcp-servers');
const mcpSlugs = (mcpList.mcpServers ?? mcpList ?? []).map((r) => r.id ?? r.slug ?? r.name);
if (!mcpSlugs.includes('figma') || !mcpSlugs.includes('ctx')) {
  process.stderr.write(
    'MCP 投影词表非 fixture 形（要 figma+ctx，实到 ' +
      JSON.stringify(mcpSlugs) +
      '）。重 launch：先写 fixture（mcpServers: figma/ctx 两条目），' +
      'CAIRN_MCP_CONFIG=<fixture> VERIFY_PORT=… node launch.mjs\n',
  );
  process.exit(1);
}

const prov = await sendJson(SERVER + '/api/teams/' + teamId + '/providers', {
  providerId: 'stub-gw',
  label: 'Stub Gateway',
  baseUrl: 'http://127.0.0.1:9/v1',
  api: 'openai-completions',
  authHeader: true,
  compat: { supportsDeveloperRole: false },
  models: [{ id: 'stub-model', name: 'stub-model' }],
});
if (![200, 201, 409].includes(prov.status)) throw new Error('provider → ' + prov.status);

async function newKey(name) {
  const key = await sendJson(SERVER + '/api/teams/' + teamId + '/api-keys', {
    name,
    gitAccess: false,
    mcpAccess: false,
    toolGrants: { read: [], write: [] },
  });
  const plain = key.body?.plaintext ?? key.body?.record?.plaintext ?? key.body?.token;
  if (!plain) throw new Error('api-key 无 plaintext：' + JSON.stringify(key.body));
  return plain;
}
async function enrollMachine(name, extra) {
  const keyPlain = await newKey('enroll-' + name);
  const res = await sendJson(
    SERVER + '/api/machine/enroll',
    { teamId, name, cliVersion: '0.1.0', ...(extra ?? {}) },
    'POST',
    keyPlain,
  );
  const token = res.body?.token ?? res.body?.machine?.token;
  const machineId = res.body?.machineId ?? res.body?.machine?.machineId;
  if (res.status !== 200 || !token) throw new Error('enroll ' + name + ' → ' + res.status);
  return { token, machineId };
}

const A = await enrollMachine('cap-mbp', {
  capabilities: { mcpServers: ['figma'], skills: ['probe-skill'] },
});
const rowA = machineRowByName('cap-mbp');
check(
  'R1 enroll 携带能力清单 → machine.capabilities 列落库 + record 读面透出（GET me / teams machines）',
  capsOf('cap-mbp')?.mcpServers?.join() === 'figma' &&
    capsOf('cap-mbp')?.skills?.join() === 'probe-skill',
  'row=' + JSON.stringify(capsOf('cap-mbp')),
);
const meA = await getJson(SERVER + '/api/machine/me', A.token);
const listMachines = await getJson(SERVER + '/api/teams/' + teamId + '/machines');
const listA = (listMachines.machines ?? listMachines).find?.((m) => m.id === A.machineId) ??
  (Array.isArray(listMachines) ? listMachines.find((m) => m.id === A.machineId) : undefined);
check(
  'R1b 读面随行：GET /api/machine/me 与 GET teams/{id}/machines 的 capabilities 同值',
  JSON.stringify(meA.capabilities) === JSON.stringify({ mcpServers: ['figma'], skills: ['probe-skill'] }) &&
    JSON.stringify(listA?.capabilities) === JSON.stringify(meA.capabilities),
  'me=' + JSON.stringify(meA.capabilities),
);

const badShapes = [{ mcpServers: 'oops' }, 42, { mcpServers: [1], skills: [] }];
const badResults = [];
for (const bad of badShapes) {
  const res = await sendJson(
    SERVER + '/api/machine/presence',
    { cliVersion: '0.1.0', capabilities: bad },
    'POST',
    A.token,
  );
  badResults.push({ bad, status: res.status, body: res.body });
}
check(
  'R2 心跳红线：presence capabilities 坏形状三形 → 200 {ok:true}，旧值保留（坏字段永不打死心跳）',
  badResults.every((r) => r.status === 200 && r.body?.ok === true) &&
    capsOf('cap-mbp')?.mcpServers?.join() === 'figma',
  'statuses=' + JSON.stringify(badResults.map((r) => r.status)),
);
await saveJson('r2-heartbeat-tolerance.json', { badResults, rowAfter: capsOf('cap-mbp') });

const presOk = await sendJson(
  SERVER + '/api/machine/presence',
  { cliVersion: '0.1.0', capabilities: { mcpServers: ['ctx'], skills: [] } },
  'POST',
  A.token,
);
check(
  'R3 presence 合法清单 → 覆写落列（闸相位的「缺 figma」前提就位）',
  presOk.status === 200 && capsOf('cap-mbp')?.mcpServers?.join() === 'ctx',
  'row=' + JSON.stringify(capsOf('cap-mbp')),
);

const B = await enrollMachine('cap-legacy');
const rowB = machineRowByName('cap-legacy');
check(
  'R4 老 daemon 形（enroll/presence 均不带位）→ 列 NULL ≠ 空集（未知与缺失两态）',
  rowB !== undefined && rowB.capabilities === null,
  'raw=' + (rowB === undefined ? 'row-missing' : JSON.stringify(rowB.capabilities)),
);

const capAgentRes = await sendJson(SERVER + '/api/teams/' + teamId + '/agents', {
  displayName: '能力闸探针 Agent',
  description: '#1251 probe：要求 figma 的执行角色',
  provider: 'stub-gw',
  modelId: 'stub-model',
  mcpServers: ['figma', 'ctx'],
});
if (![200, 201].includes(capAgentRes.status))
  throw new Error('agent → ' + capAgentRes.status + ' ' + JSON.stringify(capAgentRes.body));
const CAP_AGENT = capAgentRes.body?.id ?? capAgentRes.body?.agentId;

const chiefAgent = await sendJson(SERVER + '/api/teams/' + teamId + '/agents', {
  displayName: '能力闸总管 1251',
  provider: 'stub-gw',
  modelId: 'stub-model',
});
const CHIEF_AGENT_ID = chiefAgent.body?.id ?? chiefAgent.body?.agentId;
const bind = await sendJson(
  SERVER + '/api/teams/' + teamId + '/chief',
  { agent: { agentId: CHIEF_AGENT_ID, thinkingLevel: null } },
  'PATCH',
);
if (bind.status !== 200) throw new Error('chief bind → ' + bind.status);

const proj = await sendJson(SERVER + '/api/projects', { name: 'probe-1251' });
const projectId = proj.body?.id ?? proj.body?.project?.id;
if (!projectId) throw new Error('project 无 id：' + JSON.stringify(proj.body));
const todoRes = await sendJson(SERVER + '/api/projects/' + projectId + '/todos', {
  title: '能力闸探针任务',
  spec: '用于 #1251 能力闸与可见 pending 成因实证。',
});
const TASK_G = todoRes.body?.id;
if (!TASK_G) throw new Error('todo 无 id：' + JSON.stringify(todoRes.body));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 732 } });
await page.route('**/api.dicebear.com/**', (route) =>
  route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#888"/></svg>',
  }),
);
await page.goto(WEB + '/app/resources/agents/' + CAP_AGENT + '?name=cap');
await page.locator('.agent-tab').nth(2).click();
await page.locator('.agent-machine-fit').waitFor({ state: 'visible', timeout: 10_000 });
const figmaSwitch = page.locator('.agent-required-mcp-row', { hasText: 'figma' }).locator('.agent-required-mcp-switch');
await figmaSwitch.waitFor({ state: 'visible', timeout: 10_000 });
await figmaSwitch.click();

let patched = null;
for (let i = 0; i < 20; i++) {
  const rec = await getJson(SERVER + '/api/teams/' + teamId + '/agents/' + CAP_AGENT);
  if ((rec.requiredCapabilities?.mcpServers ?? []).includes('figma')) {
    patched = rec.requiredCapabilities;
    break;
  }
  await new Promise((r) => setTimeout(r, 250));
}
check(
  'G1 权限 tab 机器匹配段真点击「要求安装 figma」→ PATCH requiredCapabilities 落库（写面真用户路径）',
  patched?.mcpServers?.join() === 'figma',
  'required=' + JSON.stringify(patched),
);

const fit1 = await getJson(
  SERVER + '/api/teams/' + teamId + '/agents/' + CAP_AGENT + '/machine-fit',
);
const fitA1 = fit1.machines.find((m) => m.name === 'cap-mbp');
const fitB = fit1.machines.find((m) => m.name === 'cap-legacy');
check(
  'G2 machine-fit 读面：缺项机 canRun=false + missing 点名可读形 + 声明对账缺口；未上报机 fail-open（missing null / canRun true）',
  fitA1?.canRun === false &&
    JSON.stringify(fitA1?.missing) === JSON.stringify(['MCP server "figma"']) &&
    JSON.stringify(fitA1?.mcpGaps) === JSON.stringify(['figma']) &&
    fitB?.missing === null &&
    fitB?.mcpGaps === null &&
    fitB?.canRun === true,
  'A=' + JSON.stringify(fitA1) + ' B=' + JSON.stringify(fitB),
);
await saveJson('g2-machine-fit-blocked.json', fit1);

await page
  .locator('.agent-required-mcp-switch[aria-checked="true"]')
  .first()
  .waitFor({ timeout: 10_000 });
await page.getByText('不可跑').first().waitFor({ timeout: 10_000 });
await shot(page, 'g2-agent-machine-fit-blocked.png');

const thread = await sendJson(SERVER + '/api/teams/' + teamId + '/chief/threads', {
  content: '开始任务「能力闸探针任务」，直接派发执行。',
});
if (thread.status !== 201) throw new Error('chief threads → ' + thread.status);
const chiefClaim = await sendJson(
  SERVER + '/api/machine/tasks/claim',
  {},
  'POST',
  A.token,
  100_000,
);
const chiefPayload = chiefClaim.body?.step;
const chiefStep = chiefPayload?.step ?? chiefPayload;
if (chiefStep?.kind !== 'chief')
  throw new Error('chief claim 非 chief 步：' + JSON.stringify(chiefPayload).slice(0, 200));
const relayRes = await sendJson(
  SERVER + '/api/machine/tool/' + chiefStep.id,
  {
    name: 'run_builds',
    params: {
      todoIds: [TASK_G],
      assignment: { build: { agentId: CAP_AGENT } },
      withPlan: false,
      dispatchReason: '#1251 能力闸探针直修',
    },
  },
  'POST',
  A.token,
);
if (relayRes.status !== 200)
  throw new Error('relay run_builds → ' + relayRes.status + ' ' + JSON.stringify(relayRes.body).slice(0, 300));
const relayOut = JSON.parse(relayRes.body.text);
const BUILD_G = relayOut.builds?.[0]?.id;
if (!BUILD_G) throw new Error('run_builds 无 build：' + relayRes.body.text);
await sendJson(SERVER + '/api/machine/done/' + chiefStep.id, { status: 'success' }, 'POST', A.token);
const buildStep = stepsOf(BUILD_G).find((s) => s.kind === 'build');
check('G3 chief relay run_builds → build 步入队 pending（assignment.build = 被测 Agent）',
  buildStep !== undefined && buildStep.status === 'pending', 'step=' + buildStep?.id);

let emptyHanded = false;
for (let i = 0; i < 6 && !emptyHanded; i++) {
  const claim = await sendJson(
    SERVER + '/api/machine/tasks/claim',
    {},
    'POST',
    A.token,
    5000,
  ).catch((err) => {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return { timedOut: true };
    throw err;
  });
  if (claim?.timedOut === true) {
    emptyHanded = true;
    break;
  }
  const payload = claim.body?.step;
  const claimed = payload?.step ?? payload;
  if (claimed?.id === buildStep.id) {
    throw new Error('G4 前置失败：缺能力机器领到了被闸的 build 步——能力闸未挡');
  }
  if (claimed?.kind === 'chief') {
    await sendJson(
      SERVER + '/api/machine/done/' + claimed.id,
      { status: 'success' },
      'POST',
      A.token,
    );
    continue;
  }
  if (claimed == null) {
    emptyHanded = true;
    break;
  }
  throw new Error('G4 意外认领形：' + JSON.stringify(claimed).slice(0, 200));
}
const stepAfterClaim = stepRow(buildStep.id);
check(
  'G4 缺 figma 的在线机器 claim 空手（5s 截断）→ build 步仍 pending、machineId 空（步留 pending 给能力齐机器）',
  emptyHanded && stepAfterClaim.status === 'pending' && stepAfterClaim.machineId === null,
  'step=' + JSON.stringify({ status: stepAfterClaim.status, machineId: stepAfterClaim.machineId }),
);

const stepsRes = await getJson(SERVER + '/api/builds/' + BUILD_G + '/steps');
const stepsRows = stepsRes.steps ?? stepsRes;
const pendingRow = (Array.isArray(stepsRows) ? stepsRows : []).find((r) => r.id === buildStep.id);
check(
  'G5 steps 读面 queue.blocked = capability-missing + 可读缺项（pending 成因随读面下行）',
  pendingRow?.queue?.blocked?.kind === 'capability-missing' &&
    JSON.stringify(pendingRow?.queue?.blocked?.missing) === JSON.stringify(['MCP server "figma"']),
  'blocked=' + JSON.stringify(pendingRow?.queue?.blocked ?? null),
);
await saveJson('g5-queue-blocked.json', { pendingRow });

await page.goto(WEB + '/app/todo/' + TASK_G);
await page.locator('[data-testid="detail-title"]').waitFor({ state: 'visible', timeout: 10_000 });

let queueRowText = '';
for (let i = 0; i < 40; i++) {
  const row = page.getByText('排队中', { exact: false }).first();
  if ((await row.count()) > 0) {
    queueRowText = (await row.textContent()) ?? '';
    if (queueRowText.includes('能力')) break;
  }
  await new Promise((r) => setTimeout(r, 250));
}
check(
  'G6 详情页排队行文案可见：「没有机器满足能力要求（缺 MCP server "figma"）——装齐后下一拍心跳即解锁」',
  queueRowText.includes('没有机器满足能力要求') && queueRowText.includes('MCP server "figma"'),
  'text=' + JSON.stringify(queueRowText.slice(0, 120)),
);
await shot(page, 'g6-queue-blocked-row.png');

await sendJson(
  SERVER + '/api/machine/presence',
  { cliVersion: '0.1.0', capabilities: { mcpServers: ['figma', 'ctx'], skills: [] } },
  'POST',
  A.token,
);

let claimed2 = null;
for (let i = 0; i < 8 && claimed2 === null; i++) {
  const claim = await sendJson(
    SERVER + '/api/machine/tasks/claim',
    {},
    'POST',
    A.token,
    100_000,
  );
  const payload = claim.body?.step;
  const cand = payload?.step ?? payload;
  if (cand?.id === buildStep.id) {
    claimed2 = cand;
    break;
  }
  if (cand?.kind === 'chief') {
    await sendJson(
      SERVER + '/api/machine/done/' + cand.id,
      { status: 'success' },
      'POST',
      A.token,
    );
    continue;
  }
  throw new Error('G7 意外认领形：' + JSON.stringify(cand).slice(0, 200));
}
check(
  'G7 装齐 figma 后下一拍 presence → 同一机器即领该步（缺能力 = 给修法，修法即时闭环）',
  claimed2?.id === buildStep.id && claimed2?.kind === 'build' && stepRow(buildStep.id).status === 'claimed',
  'claimed=' + JSON.stringify({ id: claimed2?.id, kind: claimed2?.kind }),
);
await sendJson(
  SERVER + '/api/machine/done/' + buildStep.id,
  { status: 'success', hasChanges: true },
  'POST',
  A.token,
);

const fit2 = await getJson(
  SERVER + '/api/teams/' + teamId + '/agents/' + CAP_AGENT + '/machine-fit',
);
const fitA2 = fit2.machines.find((m) => m.name === 'cap-mbp');
check(
  'G8 能力齐后 machine-fit：canRun true + missing [] + 对账缺口清零（声明 figma/ctx 双装）',
  fitA2?.canRun === true &&
    JSON.stringify(fitA2?.missing) === '[]' &&
    JSON.stringify(fitA2?.mcpGaps) === '[]',
  'A=' + JSON.stringify(fitA2),
);
await saveJson('g8-machine-fit-clear.json', fit2);

await page.goto(WEB + '/app/resources/agents/' + CAP_AGENT + '?name=cap');
await page.locator('.agent-tab').nth(2).click();
await page.locator('.agent-machine-fit .agent-fit-row').first().waitFor({ timeout: 10_000 });
await shot(page, 'g8-agent-machine-fit-clear.png');

await page.goto(WEB + '/app/resources/machines');
await page.locator('[data-machine-capabilities]').first().waitFor({ timeout: 10_000 });
const annotations = await page.locator('[data-machine-capabilities]').evaluateAll((els) =>
  els.map((e) => `${e.textContent ?? ''} ${e.getAttribute('title') ?? ''}`),
);
const states = await page.locator('[data-machine-capabilities]').evaluateAll((els) =>
  els.map((e) => e.getAttribute('data-machine-capabilities')),
);
check(
  'G9 机器页能力读标注：上报机 = 「MCP 2 · 本机技能 0」计数形，未上报机 = 「—」（title/读屏「能力清单未上报」）（两态不塌缩）',
  states.includes('reported') &&
    states.includes('unreported') &&
    annotations.some((t) => t.includes('MCP 2')) &&
    annotations.some((t) => t.includes('能力清单未上报')),
  'states=' + JSON.stringify(states) + ' texts=' + JSON.stringify(annotations),
);
await shot(page, 'g9-machines-capability-annotation.png');

const dHome = join(tmpdir(), 'cairn-1251-daemon-' + Date.now());
const dMcp = join(dHome, 'claude.json');
const dSkills = join(dHome, 'skills');
mkdirSync(join(dSkills, 'probe-local-skill'), { recursive: true });
writeFileSync(join(dSkills, 'probe-local-skill', 'SKILL.md'), '# probe-local-skill\n');
writeFileSync(
  dMcp,
  JSON.stringify({
    mcpServers: {
      'Probe-MCP': { type: 'stdio', command: 'true' },
      broken: { type: 'stdio' },
    },
  }),
);
const dKey = await newKey('daemon-1251');
const daemon = spawn(
  'pnpm',
  ['exec', 'tsx', 'src/cli.ts', 'start', '--foreground', '--server', SERVER, '--api-key', dKey, '--team', teamId, '--name', 'd1251-real'],
  {
    cwd: join(REPO, 'apps/daemon'),
    env: {
      ...process.env,
      CAIRN_HOME: dHome,
      CAIRN_MCP_CONFIG: dMcp,
      CAIRN_SKILLS_DIR: dSkills,
      http_proxy: '',
      https_proxy: '',
      all_proxy: '',
      HTTP_PROXY: '',
      HTTPS_PROXY: '',
      ALL_PROXY: '',
      NO_PROXY: '*',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
const daemonLog = [];
daemon.stdout.on('data', (d) => daemonLog.push(String(d)));
daemon.stderr.on('data', (d) => daemonLog.push(String(d)));
let dCaps = null;
const dDeadline = Date.now() + 90_000;
while (Date.now() < dDeadline) {
  dCaps = capsOf('d1251-real');
  if (dCaps !== null && dCaps !== undefined) break;
  await new Promise((r) => setTimeout(r, 1000));
}
check(
  'D1 真 daemon 注册上行：SQLite 机器行 capabilities = 探测实物（slug 小写归一 probe-mcp、坏条目跳过、技能目录名 probe-local-skill）',
  dCaps !== null &&
    dCaps !== undefined &&
    dCaps.mcpServers?.join() === 'probe-mcp' &&
    dCaps.skills?.join() === 'probe-local-skill',
  'caps=' + JSON.stringify(dCaps),
);
daemon.kill('SIGTERM');
await new Promise((r) => setTimeout(r, 2000));
if (daemon.exitCode === null) daemon.kill('SIGKILL');
writeFileSync(join(EVIDENCE, 'd1-daemon-log-tail.txt'), daemonLog.join('').slice(-4000));
artifacts.push('d1-daemon-log-tail.txt');
rmSync(dHome, { recursive: true, force: true });

await browser.close();
const failed = checks.filter((c) => !c.ok);
writeFileSync(
  join(EVIDENCE, 'result.json'),
  JSON.stringify(
    {
      probe: 'drive-1251-capability-gate',
      stack: { server: SERVER, web: WEB, db: DB_PATH },
      teamId,
      machines: { A: A.machineId, B: B.machineId },
      agentId: CAP_AGENT,
      buildId: BUILD_G,
      checks,
      artifacts,
      passed: checks.length - failed.length,
      total: checks.length,
    },
    null,
    2,
  ),
);
process.stdout.write('\n' + (checks.length - failed.length) + '/' + checks.length + ' PASS\n');
process.exit(failed.length > 0 ? 1 : 0);
