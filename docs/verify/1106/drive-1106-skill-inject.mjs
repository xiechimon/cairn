import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SCRIPT_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const REPO = process.env.VERIFY_REPO_ROOT ?? SCRIPT_REPO;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(REPO, '.claude', 'verify-run');
const ports = existsSync(join(RUN_DIR, 'ports.json'))
  ? JSON.parse(readFileSync(join(RUN_DIR, 'ports.json'), 'utf8'))
  : {};
const SERVER =
  process.env.SERVER ?? `http://127.0.0.1:${ports.serverPort ?? ports.server ?? 8791}`;
const WEB_URL = process.env.WEB_URL ?? `http://127.0.0.1:${ports.webPort ?? 5273}`;
const SKILLS_DIR = process.env.SKILLS_DIR ?? join(RUN_DIR, 'home', 'skills');
const DB = process.env.DB ?? join(RUN_DIR, 'home', 'server', 'server.db');
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ?? join(SCRIPT_REPO, `.claude/verify-evidence/${ts}-1106-claim`);
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
function finish(exitOnFail = true) {
  const passed = checks.filter((c) => c.ok).length;
  save('result.json', {
    probe: 'drive-1106-skill-inject/claim',
    server: SERVER,
    webUrl: WEB_URL,
    skillsDir: SKILLS_DIR,
    db: DB,
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

const SKILLS = [
  ['tdd', 'Test-driven development: red-green-refactor, integration tests'],
  ['better-typography', '产品 UI 排版工程：字号阶梯、字距、换行与截断'],
  ['better-colors', '颜色系统：ramp 生成、语义 token、对比度实测'],
  ['better-layout', '布局工艺：分组、对齐、阅读顺序、渐进披露'],
  ['diagnosing-bugs', 'Diagnosis loop for hard bugs and regressions'],
  ['ask-matt', 'Ask which skill or flow fits your situation'],
  ['great-resume', '中文求职经历提升：岗位定位、简历要点、HR 开场白'],
  ['offer', '中文秋招求职进度管理：投递、筛选、面试进度表'],
  ['kami', '用 Kami 模板排版专业文档：简历、白皮书、信函，产出 PDF'],
  ['interview', '中文简历驱动的面试预测、模拟追问和复练技能'],
  ['wiki', '个人知识沉淀库：存进 wiki、处理 inbox、体检 wiki'],
  ['aihot', '查 AIHOT 中文 AI 资讯、热点、日报'],
  ['archify', '出架构/流程/时序/数据流/状态图，独立 HTML'],
  ['job-apply', '中文求职申请自动填写：读取简历逐项填写招聘网站'],
  ['job-match', '中文岗位匹配分析：JD 对比简历、投递建议'],
  ['evidence-recap', '把 AI 编程对话复盘为九段证据链'],
  ['project-guide', '中文项目导学、源码课程与项目面经'],
  ['writing-dna-skill', '从完整文章蒸馏可复用写作 DNA'],
  ['humanizer-zh', '编辑中文文章的空话与模板化表达'],
  ['make-resume', '中文可编辑简历制作：ASu 模板 HTML/PDF'],
  ['scaffold-exercises', '生成课程练习目录结构并通过 lint'],
];
const GRANTED = SKILLS.map(([id]) => id);

const IRRELEVANT = [
  'great-resume',
  'offer',
  'interview',
  'job-apply',
  'job-match',
  'make-resume',
  'wiki',
  'aihot',
  'project-guide',
  'evidence-recap',
  'writing-dna-skill',
  'humanizer-zh',
];

function buildFixtureLibrary() {
  mkdirSync(SKILLS_DIR, { recursive: true });
  for (const [id, description] of SKILLS) {
    const dir = join(SKILLS_DIR, id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'SKILL.md'),
      `---\nname: ${id}\ndescription: ${description}\n---\n\n# ${id}\n\n${id} 技能正文（#1106 注入探针）。\n`,
    );
  }
}

const STUB_BASE = 'http://127.0.0.1:8919/v1';
let uniq = 0;

async function seed() {
  const teams = await jfetch('GET', '/api/teams');
  const teamId = teams.body[0]?.id ?? teams.body.teams?.[0]?.id;
  if (!teamId) throw new Error(`no team: ${JSON.stringify(teams.body).slice(0, 200)}`);
  await jfetch('POST', `/api/teams/${teamId}/providers`, {
    body: {
      providerId: 'stub-gw',
      label: 'stub-gw',
      baseUrl: STUB_BASE,
      api: 'openai-completions',
      authHeader: true,
      compat: { supportsDeveloperRole: false },
      models: [{ id: 'stub-model', name: 'stub-model' }],
    },
  });
  const agentRes = await jfetch('POST', `/api/teams/${teamId}/agents`, {
    body: {
      displayName: `probe-1106-builder-${++uniq}`,
      provider: 'stub-gw',
      modelId: 'stub-model',
      skills: GRANTED,
    },
  });
  const agentId = agentRes.body?.id ?? agentRes.body?.agent?.id;
  if (!agentId)
    throw new Error(`agent create failed: ${agentRes.status} ${JSON.stringify(agentRes.body).slice(0, 200)}`);
  const keyRes = await jfetch('POST', `/api/teams/${teamId}/api-keys`, {
    body: {
      name: `probe-1106-${Date.now()}`,
      gitAccess: false,
      mcpAccess: false,
      toolGrants: { read: [], write: [] },
    },
  });
  const plaintext = keyRes.body?.plaintext ?? keyRes.body?.key;
  if (!plaintext) throw new Error(`api-key create failed: ${keyRes.status}`);
  const projRes = await jfetch('POST', '/api/projects', { body: { name: `probe-1106-${Date.now()}` } });
  const projectId = projRes.body?.id;
  return { teamId, agentId, apiKey: plaintext, projectId };
}

async function dispatchTask(projectId, agentId, spec) {
  const todoRes = await jfetch('POST', `/api/projects/${projectId}/todos`, {
    body: { title: '', spec },
  });
  const todoId = todoRes.body?.id;
  const buildRes = await jfetch('POST', `/api/projects/${projectId}/builds`, {
    body: { todoIds: [todoId], assignment: { plan: null, build: { agentId } }, withPlan: false },
  });
  const buildId = buildRes.body?.builds?.[0]?.id;
  if (!todoId || !buildId)
    throw new Error(`dispatch failed: ${JSON.stringify(buildRes.body).slice(0, 200)}`);
  return { todoId, buildId, dispatchStatus: buildRes.status };
}

function openDb() {
  const require2 = createRequire(join(REPO, 'apps/server/package.json'));
  const Database = require2('better-sqlite3');
  return new Database(DB, { readonly: true });
}

buildFixtureLibrary();
const seeded = await seed();
const enrollRes = await jfetch('POST', '/api/machine/enroll', {
  bearer: seeded.apiKey,
  body: { teamId: seeded.teamId, name: `probe-1106-${Date.now()}`, cliVersion: '0.2.0' },
});
const token = enrollRes.body?.token;
check('enroll 机器凭证', Boolean(token), `status=${enrollRes.status}`);
if (!token) finish();

async function claimOnce() {
  const res = await jfetch('POST', '/api/machine/tasks/claim', { bearer: token, body: {} });
  return { status: res.status, claimed: res.body?.step ?? null };
}

const domainTask = await dispatchTask(
  seeded.projectId,
  seeded.agentId,
  '修复看板卡片的字号过小与换行溢出',
);
save('task-domain.json', domainTask);
const domainClaim = await claimOnce();
const domainStep = domainClaim.claimed;
check('明确域任务 claim 成功（正常派发）', Boolean(domainStep?.step?.id), `status=${domainClaim.status}`);
const injected = domainStep?.agent?.injectedSkills ?? [];
const granted = domainStep?.agent?.skills ?? [];
save('claim-domain.json', domainClaim.claimed);
check(
  'claim 载荷携带授权全集（agent.skills = 21，授权不收窄）',
  granted.length === GRANTED.length,
  `skills=${granted.length}`,
);
check(
  '验收 1：注入只含相关技能（非空、求职/知识库族零注入）',
  injected.length > 0 && IRRELEVANT.every((id) => !injected.includes(id)),
  `injected=${JSON.stringify(injected)}`,
);
check(
  '注入 ⊆ 授予（选择不越权）',
  injected.every((id) => granted.includes(id)),
  `injected=${injected.length}/granted=${granted.length}`,
);

const domainSteps = await jfetch('GET', `/api/builds/${domainTask.buildId}/steps`);
save('steps-domain.json', domainSteps.body);
const domainRestStep = (domainSteps.body ?? []).find((s) => s.id === domainStep?.step?.id);
const hits = domainRestStep?.skillInjection?.hits ?? [];
check(
  '验收 4：steps REST 透出选择记录（条数 = 载荷 ids，逐条含规则与原因）',
  hits.length === injected.length &&
    hits.every((h) => h.reason && h.reason.length > 0 && (h.rule === 'domain' || h.rule === 'explicit-mention')),
  `hits=${hits.length}`,
);
check(
  'steps REST hits 与 claim 载荷 ids 一致（持久正本 = 投递事实）',
  JSON.stringify(hits.map((h) => h.id).sort()) === JSON.stringify([...injected].sort()),
  `rest=${JSON.stringify(hits.map((h) => h.id))}`,
);
const db = openDb();
try {
  const row = db
    .prepare('SELECT skillInjection FROM step WHERE id = ?')
    .get(domainStep?.step?.id);
  const rowHits = row?.skillInjection ? JSON.parse(row.skillInjection).hits : null;
  check(
    'SQLite step 行 skillInjection 与 REST 一致（正本落库）',
    JSON.stringify(rowHits?.map((h) => h.id).sort()) === JSON.stringify(injected.slice().sort()),
    `db=${JSON.stringify(rowHits?.map((h) => h.id))}`,
  );
  const hitDomains = (rowHits ?? []).filter((h) => h.rule === 'domain');
  check(
    '命中原因含域与关键词（可解释性：至少规则命中原因一条）',
    hitDomains.length > 0 && hitDomains.every((h) => h.reason.includes('前端')),
    JSON.stringify(hitDomains.map((h) => h.reason)),
  );
} catch (err) {

  check('SQLite step 行 skillInjection 与 REST 一致（正本落库）', false, String(err));
  check('命中原因含域与关键词（可解释性：至少规则命中原因一条）', false, 'no column on main');
} finally {
  db.close();
}

const zeroTask = await dispatchTask(seeded.projectId, seeded.agentId, '把首页轮播图换成静态图');
save('task-zero.json', zeroTask);
const zeroClaim = await claimOnce();
const zeroStep = zeroClaim.claimed;
check(
  '验收 3：零命中任务 claim 成功（不报错）',
  Boolean(zeroStep?.step?.id) && zeroStep?.step?.buildId === zeroTask.buildId,
  `status=${zeroClaim.status}`,
);
check(
  '验收 3：零命中 → injectedSkills=[]（已计算零命中，不保底全量）',
  JSON.stringify(zeroStep?.agent?.injectedSkills) === '[]',
  JSON.stringify(zeroStep?.agent?.injectedSkills),
);
check(
  '验收 3：零命中任务授权集仍全量（零注入 ≠ 收权）',
  (zeroStep?.agent?.skills ?? []).length === GRANTED.length,
  `skills=${(zeroStep?.agent?.skills ?? []).length}`,
);
const zeroSteps = await jfetch('GET', `/api/builds/${zeroTask.buildId}/steps`);
save('steps-zero.json', zeroSteps.body);
const zeroRestStep = (zeroSteps.body ?? []).find((s) => s.id === zeroStep?.step?.id);
check(
  '验收 3：零命中 step 行 hits=[]（配置事实落库）',
  JSON.stringify(zeroRestStep?.skillInjection) === JSON.stringify({ hits: [] }),
  JSON.stringify(zeroRestStep?.skillInjection),
);

const mentionTask = await dispatchTask(
  seeded.projectId,
  seeded.agentId,
  '用 tdd 给购物车模块补测试',
);
save('task-mention.json', mentionTask);
const mentionClaim = await claimOnce();
const mentionStep = mentionClaim.claimed;
save('claim-mention.json', mentionClaim.claimed);
const mentionInjected = mentionStep?.agent?.injectedSkills ?? [];
check(
  '显式点名：任务文本点名 tdd → 注入含 tdd',
  mentionInjected.includes('tdd'),
  `injected=${JSON.stringify(mentionInjected)}`,
);
const mentionSteps = await jfetch('GET', `/api/builds/${mentionTask.buildId}/steps`);
const mentionRestStep = (mentionSteps.body ?? []).find((s) => s.id === mentionStep?.step?.id);
const tddHit = (mentionRestStep?.skillInjection?.hits ?? []).find((h) => h.id === 'tdd');
check(
  '显式点名：tdd 命中 rule=explicit-mention 且原因点名任务文本',
  tddHit?.rule === 'explicit-mention' && tddHit?.reason?.includes('tdd'),
  JSON.stringify(tddHit),
);

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${WEB_URL}/app/todo/${domainTask.todoId}`);
  const row = page.locator('[data-testid="injected-skills"]');
  let text = null;
  try {
    await row.waitFor({ state: 'visible', timeout: 15_000 });
    text = await row.textContent();
  } catch (err) {

    check('验收 4（详情面）：injected-skills 行渲染且含注入技能与原因', false, String(err));
  }
  if (text !== null) {
    check(
      '验收 4（详情面）：injected-skills 行渲染且含注入技能与原因',
      injected.some((id) => text.includes(id)) && text.includes('注入技能'),
      text.slice(0, 160),
    );
  }
  await page.screenshot({ path: join(EVIDENCE, 'detail-domain.png'), fullPage: false });

  await page.goto(`${WEB_URL}/app/todo/${zeroTask.todoId}`);
  let zeroText = null;
  try {
    await row.waitFor({ state: 'visible', timeout: 15_000 });
    zeroText = await row.textContent();
  } catch {
    check('验收 4（详情面）：零命中任务显示「未注入技能」占位', false, 'row absent');
  }
  if (zeroText !== null) {
    check(
      '验收 4（详情面）：零命中任务显示「未注入技能」占位',
      zeroText.includes('未注入技能'),
      zeroText.slice(0, 120),
    );
  }
  await page.screenshot({ path: join(EVIDENCE, 'detail-zero.png'), fullPage: false });
} finally {
  await browser.close();
}

finish();
