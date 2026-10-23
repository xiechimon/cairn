#!/usr/bin/env node
// verify-cairn 定制 probe（#919 技能路由行为验收）：主判据（行为）取证面。
//
//   behavior  真模型腿（claude-code runtime，本机 claude 登录态，缺省
//             glm-5.3）：票面零技能词 → lane 干完活 → 产物 haiku.txt 带
//             技能正文 marker（SKILL-ROUTE-919）= 自己命中了技能；
//             transcript 的 Read 命中行 + daemon.log catalog/team 行 =
//             日志面；详情页截图（线程列技能行 + 右栏「技能」汇总节）=
//             真实用户路径前端面。relay 有间歇故障史：整步最多 3 次尝试
//             （每次新 todo+build），全部留档。
//   deny-ui   stub 腿（pi runtime + 本探针内嵌脚本 stub）：被 deny 挡下的
//             read 落 UI blocked 行 + 汇总拦截计数（deny 事件可见面），
//             同跑取授权 read 命中行与 LLM 输入面目录（含点名技能、无
//             白名单外条目）。
//
// 前置（配方 = docs/verify/919/README.md）：launch.mjs 起栈；真 daemon 外
// 部起（CAIRN_SKILLS_DIR 指 LOCAL_SKILLS）；行为腿要求本机能经 claude 登
// 录态到模型（#917 probe 同前提）。
// env：SERVER / WEB（缺省读 VERIFY_RUN_DIR/ports.json）、VERIFY_RUN_DIR、
//      DB、DAEMON_HOME、LOCAL_SKILLS、VERIFY_EVIDENCE_DIR、MODEL
//      （缺省 glm-5.3）、STUB_PORT（缺省 8921）。
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SCRIPT_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const REPO = process.env.VERIFY_REPO_ROOT ?? SCRIPT_REPO;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(REPO, '.claude', 'verify-run');
const ports = existsSync(join(RUN_DIR, 'ports.json'))
  ? JSON.parse(readFileSync(join(RUN_DIR, 'ports.json'), 'utf8'))
  : {};
const SERVER = process.env.SERVER ?? `http://127.0.0.1:${ports.serverPort ?? 8791}`;
const WEB = process.env.WEB ?? `http://127.0.0.1:${ports.webPort ?? 5273}`;
const DB = process.env.DB ?? join(RUN_DIR, 'home', 'server', 'server.db');
const DAEMON_HOME = process.env.DAEMON_HOME ?? '/tmp/cairn-919-daemon-home';
const LOCAL_SKILLS = process.env.LOCAL_SKILLS ?? '/tmp/cairn-919-local-skills';
const MODEL = process.env.MODEL ?? 'glm-5.3';
const STUB_PORT = Number(process.env.STUB_PORT ?? 8921);

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, v] = a.slice(2).split('=');
      return [k, v ?? 'true'];
    }),
);
const PHASE = args.phase ?? 'behavior';
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ?? `/tmp/cairn-919-evidence-${PHASE}-${ts}`;
mkdirSync(EVIDENCE, { recursive: true });

// —— 判据常量（产物 marker 与票面词表是先于运行固化的期望值）———————————
const SKILL_MARKER = 'SKILL-ROUTE-919';
const SECRET_MARKER = 'SECRET-LOCAL-BODY-919';
const HAIKU_LOCAL_MARKER = 'HAIKU-LOCAL-BODY-919';
/** 票面（title+spec）禁止出现的技能指涉词——主判据的输入面自证。 */
const SKILL_WORDS = /技能|skill|haiku-helper/i;
const TASK_TITLE = '写一首三行俳句并保存';
const TASK_SPEC =
  '以「深夜写代码」为主题写一首三行俳句，保存到仓库根目录的 haiku.txt，然后简短汇报。';

const HAIKU_HELPER_SKILL_MD = `---
name: haiku-helper
description: Use when the task asks to write a haiku, a three-line short poem, or similar short verse.
---

# haiku-helper

写俳句的步骤：

1. 三行，音节节奏约 5/7/5，抓一个具体意象。
2. 把俳句写入任务指定的文件。
3. 保存后必须在文件末尾追加独占一行的 \`${SKILL_MARKER}\`（版本追踪用，不可省略）。
`;

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
    probe: `drive-919-skills-routing/${PHASE}`,
    server: SERVER,
    web: WEB,
    db: DB,
    daemonHome: DAEMON_HOME,
    localSkills: LOCAL_SKILLS,
    model: PHASE === 'behavior' ? MODEL : 'stub-model',
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

async function waitStepTerminal(buildId, timeoutMs) {
  // step 行无 errorMessage 列——根因在 build.errorMessage（completeStep 落位）。
  const db = openDb();
  const started = Date.now();
  try {
    for (;;) {
      const rows = db
        .prepare('SELECT id, kind, status FROM step WHERE buildId = ? ORDER BY createdAt')
        .all(buildId);
      // 终态词表 = shared stepStatusSchema：done/failed/stopped（drive-920 模板
      // 只见过 failed 形——它的 stub 会话恒撞产物闸——本探针真模型腿落 done）。
      const terminal = rows.filter((r) => ['done', 'failed', 'stopped'].includes(r.status));
      if (terminal.length > 0) {
        // build 表没有 status 列（docs/verify/920/README 结果判读第 3 条）——
        // 步终态在 step.status，失败根因在 build.errorMessage。
        const build = db.prepare('SELECT id, errorMessage FROM build WHERE id = ?').get(buildId);
        return {
          step: terminal[terminal.length - 1],
          build,
        };
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
  // 本机库（daemon CAIRN_SKILLS_DIR）：haiku-local 供 stub 腿放侧，
  // secret-local 供拒侧（两腿的白名单都不含它）。
  const w = (name, description, body, marker) => {
    const dir = join(LOCAL_SKILLS, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n\n${marker}\n`,
      'utf8',
    );
  };
  w('haiku-local', '本机俳句对照技能（#919 探针放侧）。', '本机俳句技能正文。', HAIKU_LOCAL_MARKER);
  w('secret-local', '白名单外本机技能（#919 探针拒侧）。', '白名单外技能正文。', SECRET_MARKER);
}

/** 团队库三技能：haiku-helper（两腿白名单内）+ haiku-local / secret-local。
 *  后两者同时进团队库是因为 agent.skillsAllowlist 的授权引用在 server 侧按团队库
 *  现扫过滤（死引用静默脱落）——deny 腿要白名单含 haiku-local，它就必须是
 *  团队库已知 id；secret-local 进库但无人白名单 → 永不分发，拒侧仍靠本机
 *  目录那份（同名冲突团队条目胜，本机 loser 不进拒绝集，读取照放行）。 */
async function ensureTeamSkill(teamId) {
  const bodies = [
    {
      name: 'haiku-helper',
      description:
        'Use when the task asks to write a haiku, a three-line short poem, or similar short verse.',
      files: [{ path: 'SKILL.md', content: HAIKU_HELPER_SKILL_MD }],
    },
    {
      name: 'haiku-local',
      description: '本机俳句对照技能（#919 探针放侧）。',
      files: [
        {
          path: 'SKILL.md',
          content: `---\nname: haiku-local\ndescription: 本机俳句对照技能（#919 探针放侧）。\n---\n\n本机俳句技能正文。\n\n${HAIKU_LOCAL_MARKER}\n`,
        },
      ],
    },
    {
      name: 'secret-local',
      description: '白名单外本机技能（#919 探针拒侧）。',
      files: [
        {
          path: 'SKILL.md',
          content: `---\nname: secret-local\ndescription: 白名单外本机技能（#919 探针拒侧）。\n---\n\n白名单外技能正文。\n\n${SECRET_MARKER}\n`,
        },
      ],
    },
  ];
  for (const body of bodies) {
    const res = await jfetch('POST', `/api/skills?teamId=${encodeURIComponent(teamId)}`, { body });
    // 201 = 新建；4xx 且已存在 = 幂等通过（复跑形态）。
    if (res.status === 201) continue;
    const list = await jfetch('GET', `/api/skills?teamId=${encodeURIComponent(teamId)}`);
    const names = (Array.isArray(list.body) ? list.body : (list.body?.skills ?? [])).map(
      (s) => s.id ?? s.name,
    );
    if (names.includes(body.name)) continue;
    throw new Error(
      `team skill create failed: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`,
    );
  }
  return { status: 200, body: { ensured: bodies.map((b) => b.name) } };
}

async function teamIdOf() {
  const teams = await jfetch('GET', '/api/teams');
  const teamId = teams.body?.[0]?.id ?? teams.body?.teams?.[0]?.id;
  if (!teamId) throw new Error(`no team: ${JSON.stringify(teams.body).slice(0, 200)}`);
  return teamId;
}

/** #682 enabledRuntimes 真闸：enroll 缺省只开 pi——claude-code runtime 的
 *  agent 步会永远 pending（机器面开关 = PATCH /api/machines/:id，spec 11
 *  A8/A9 的用户面）。两腿都先给在线机器把两 runtime 打开（幂等）。 */
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
  const buildId = buildRes.body?.builds?.[0]?.id ?? buildRes.body?.buildId ?? buildRes.body?.id;
  if (!todoId || !buildId) {
    throw new Error(`task seed failed: ${JSON.stringify(buildRes.body).slice(0, 200)}`);
  }
  return { todoId, buildId };
}

/** 详情页截图（真实用户路径）：#918 落地的持久汇总行（testid
 *  skills-summary，读/挡两列）——活行披露面是瞬态（步终态即清），截图取
 *  持久面；返回汇总行文本供列断言。 */
async function captureDetailUi(todoId, prefix, expectName) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 732 } });
    await page.goto(`${WEB}/app/todo/${todoId}`);
    const summary = page.locator('[data-testid="skills-summary"]', { hasText: expectName });
    await summary.waitFor({ timeout: 60_000 });
    await page.screenshot({ path: join(EVIDENCE, `${prefix}-detail-skills-summary.png`) });
    return (await page.textContent('[data-testid="skills-summary"]')) ?? '';
  } finally {
    await browser.close();
  }
}

// —— phase: behavior（真模型腿，主判据）————————————————————————————

async function phaseBehavior() {
  check('票面自证：title/spec 零技能指涉词', !SKILL_WORDS.test(`${TASK_TITLE}\n${TASK_SPEC}`), TASK_SPEC);
  const teamId = await teamIdOf();
  check('在线机器 runtime 闸打开（pi + claude-code）', (await enableRuntimes(teamId)) > 0);
  await ensureTeamSkill(teamId);
  ensureLocalSkills();
  const agentId = await createAgent(teamId, {
    displayName: `route-real-919-${Date.now()}`,
    provider: 'claude-code',
    modelId: MODEL,
    skillsAllowlist: ['haiku-helper'],
  });
  // hosted = 项目创建即 init bare repo + 种子 main（提交面断言与变更面截图
  // 都要 git 真值；缺省 manual 形态无仓库，产物进不了任何提交）。
  const projRes = await jfetch('POST', '/api/projects', {
    body: { name: `probe-919-behavior-${Date.now()}`, repoKind: 'hosted' },
  });
  const projectId = projRes.body?.id;
  if (!projectId) throw new Error(`project create failed: ${projRes.status}`);

  const attempts = [];
  let landed = null;
  for (let attempt = 1; attempt <= 3 && landed === null; attempt++) {
    const { todoId, buildId } = await createTaskAndBuild(projectId, agentId, TASK_TITLE, TASK_SPEC);
    process.stdout.write(`[behavior] attempt ${attempt}: todo=${todoId} build=${buildId}\n`);
    const terminal = await waitStepTerminal(buildId, 600_000);
    attempts.push({ attempt, todoId, buildId, terminal });
    if (terminal.step?.status === 'done') landed = { todoId, buildId };
    else {
      process.stdout.write(
        `[behavior] attempt ${attempt} not success: ${JSON.stringify(terminal).slice(0, 300)}\n`,
      );
    }
  }
  save('behavior-attempts.json', attempts);
  check('真模型步 done（≤3 次尝试）', landed !== null, landed ? `build=${landed.buildId}` : 'attempts 全失败');
  if (landed === null) return finish();
  const { todoId, buildId } = landed;

  // 主判据（产物）：haiku.txt 带技能正文 marker——模型自己读了 SKILL.md 并
  // 按其指令行事；票面从未提到技能。
  const worktree = join(DAEMON_HOME, 'workspaces', buildId);
  const haikuPath = join(worktree, 'haiku.txt');
  const haikuText = existsSync(haikuPath) ? readFileSync(haikuPath, 'utf8') : null;
  save('behavior-artifact-haiku.txt', haikuText ?? '(missing)');
  check('产物 haiku.txt 存在', haikuText !== null, haikuPath);
  check(`产物含技能 marker ${SKILL_MARKER}（主判据）`, (haikuText ?? '').includes(SKILL_MARKER));
  // 提交面：产物已进步收尾提交（分支历史真值，不只看工作树）。
  let committed = '';
  try {
    committed = execFileSync('git', ['-C', worktree, 'show', 'HEAD:haiku.txt'], {
      encoding: 'utf8',
    });
  } catch (err) {
    committed = `(git show failed: ${String(err).slice(0, 120)})`;
  }
  check('提交面 HEAD:haiku.txt 含 marker', committed.includes(SKILL_MARKER));

  // 日志面：transcript 里 SKILL.md 的 Read 命中 + daemon.log 目录/分发行。
  const msgs = messagesOf(buildId);
  save('behavior-messages.json', msgs);
  const msgsFlat = JSON.stringify(msgs);
  check(
    'transcript 含 haiku-helper SKILL.md 的工具读取',
    msgsFlat.includes('haiku-helper') && msgsFlat.includes('SKILL.md'),
  );
  const logs = daemonLogLines();
  const skillLogs = logs.filter((l) => l.includes('[skills]'));
  save('behavior-daemon-skills-log.txt', skillLogs.join('\n'));
  check('daemon.log 团队分发行（team: … materialized）', logs.some((l) => /\[skills\] team: 1 skill\(s\)/.test(l)));
  check('daemon.log 目录行 entries=1（白名单 ∩ 全库）', logs.some((l) => l.includes('[skills] catalog: entries=1 ')));
  check('daemon.log 硬挡行（本机白名单外 2 技能）', logs.some((l) => l.includes('[skills] deny: 2 skill dir(s) hard-blocked')));

  // 前端面（真实用户路径，#918 落地的持久汇总行）：点名命中技能在读列。
  try {
    const summaryText = await captureDetailUi(todoId, 'behavior', 'haiku-helper');
    check(
      '详情页汇总行读列点名命中技能（截图 behavior-detail-skills-summary.png）',
      summaryText.includes('haiku-helper') && !summaryText.includes('挡下：'),
      summaryText.trim(),
    );
  } catch (err) {
    check('详情页汇总行截图/读列断言', false, String(err).slice(0, 200));
  }
  return finish();
}

// —— phase: deny-ui（stub 腿：deny 事件 UI 可见面 + LLM 输入面）—————————————

/** 内嵌脚本 stub（integration/test/stub-llm.ts 的 .mjs 最小移植）：轮次按
 *  数组序消费，末轮重复；捕获全部请求体供输入面断言。
 *  ⚠️ call id 必须**跨进程唯一**（RUN_SALT）：message 行以 toolcall id 为
 *  行 id 全局去重——两次 probe 进程都发 `call-stub-N` 时，后跑那次的行会被
 *  server 静默判重丢弃（2026-10-07 实测：outbox 有行、DB 无行、UI 空等）。 */
const RUN_SALT = Math.random().toString(36).slice(2, 10);
function startScriptedStub(responses) {
  const requests = [];
  let next = 0;
  const chunk = (payload) => `data: ${JSON.stringify(payload)}\n\n`;
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
      res.writeHead(404).end();
      return;
    }
    let body = '';
    req.on('data', (d) => {
      body += d;
    });
    req.on('end', () => {
      requests.push(JSON.parse(body));
      const rsp = responses[Math.min(next, responses.length - 1)] ?? { content: 'ok' };
      next += 1;
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const base = {
        id: 'chatcmpl-stub',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'stub-model',
      };
      res.write(chunk({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] }));
      if (rsp.toolCall) {
        const callId = `call-stub-${RUN_SALT}-${requests.length}`;
        res.write(
          chunk({
            ...base,
            choices: [
              { index: 0, delta: { tool_calls: [{ index: 0, id: callId, type: 'function', function: { name: rsp.toolCall.name, arguments: '' } }] }, finish_reason: null },
            ],
          }),
        );
        res.write(
          chunk({
            ...base,
            choices: [
              { index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(rsp.toolCall.arguments ?? {}) } }] }, finish_reason: null },
            ],
          }),
        );
        res.write(chunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }));
      } else {
        for (const word of (rsp.content ?? 'ok').split(/(?<=。|\.|\s)/u)) {
          if (word === '') continue;
          res.write(chunk({ ...base, choices: [{ index: 0, delta: { content: word } }] }));
        }
        res.write(chunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }));
      }
      res.write(
        chunk({
          ...base,
          choices: [],
          usage: { prompt_tokens: 12, completion_tokens: 40, total_tokens: 52, prompt_tokens_details: { cached_tokens: 0 } },
        }),
      );
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  return new Promise((resolveP) => {
    server.listen(STUB_PORT, '127.0.0.1', () =>
      resolveP({
        url: `http://127.0.0.1:${STUB_PORT}/v1`,
        requests,
        // close 必须回调接 promise 且先掐 keep-alive 连接——daemon 的 provider
        // 连接不放手时裸 server.close() 永不 settle，进程挂 unsettled
        // top-level await 退码 13（实测）。
        close: () =>
          new Promise((r) => {
            server.closeAllConnections?.();
            server.close(() => r(undefined));
          }),
      }),
    );
  });
}

async function phaseDenyUi() {
  const teamId = await teamIdOf();
  await enableRuntimes(teamId); // pi 腿本就走缺省闸，幂等打开防复跑漂移
  await ensureTeamSkill(teamId);
  ensureLocalSkills();
  const secretFile = join(LOCAL_SKILLS, 'secret-local', 'SKILL.md');
  const haikuLocalFile = join(LOCAL_SKILLS, 'haiku-local', 'SKILL.md');
  const stub = await startScriptedStub([
    { toolCall: { name: 'read', arguments: { path: secretFile } } },
    { toolCall: { name: 'read', arguments: { path: haikuLocalFile } } },
    { toolCall: { name: 'bash', arguments: { command: 'printf "deny-ui probe\\n" >> README.md' } } },
    { content: '两轮读取已完成。' },
  ]);
  try {
    await jfetch('POST', `/api/teams/${teamId}/providers`, {
      body: {
        providerId: 'stub-gw-919',
        label: 'stub-gw-919',
        baseUrl: stub.url,
        api: 'openai-completions',
        authHeader: true,
        compat: { supportsDeveloperRole: false },
        models: [{ id: 'stub-model', name: 'stub-model' }],
      },
    }); // 已存在（复跑）则忽略状态
    const agentId = await createAgent(teamId, {
      displayName: `route-stub-919-${Date.now()}`,
      provider: 'stub-gw-919',
      modelId: 'stub-model',
      skillsAllowlist: ['haiku-helper', 'haiku-local'],
    });
    const projRes = await jfetch('POST', '/api/projects', {
      body: { name: `probe-919-deny-${Date.now()}`, repoKind: 'hosted' },
    });
    const projectId = projRes.body?.id;
    const { todoId, buildId } = await createTaskAndBuild(
      projectId,
      agentId,
      'deny 可见面探针',
      '按指令读取文件并汇报。',
    );
    const terminal = await waitStepTerminal(buildId, 180_000);
    check('stub 步 done', terminal.step?.status === 'done', JSON.stringify(terminal.step ?? null));

    const msgs = messagesOf(buildId);
    save('deny-messages.json', msgs);
    const flat = JSON.stringify(msgs);
    // deny 双向（live 栈上复核 integration 断言的同词表）：拒绝文案落库、
    // 白名单外正文 marker 永不落库、授权本机技能正文落库。
    check('拒绝文案落库（not in the agent allowlist）', flat.includes('not in the agent allowlist'));
    check('白名单外技能正文 marker 不落库', !flat.includes(SECRET_MARKER));
    check('授权本机技能正文 marker 落库', flat.includes(HAIKU_LOCAL_MARKER));
    const logs = daemonLogLines();
    save(
      'deny-daemon-skills-log.txt',
      logs.filter((l) => l.includes('[skills]')).join('\n'),
    );
    check('daemon.log denied-read 行（带路径）', logs.some((l) => l.includes('denied-read:') && l.includes(secretFile)));
    check('daemon.log 目录行 entries=2（haiku-helper + haiku-local）', logs.some((l) => l.includes('[skills] catalog: entries=2 ')));

    // LLM 输入面（stub 捕获 = live 栈上的注入面真值）：目录含点名技能、
    // 白名单外条目不出现。
    const inputFlat = JSON.stringify(stub.requests[0]?.messages ?? []);
    save('deny-llm-input-request0.json', stub.requests[0] ?? null);
    check('LLM 输入面含 <available_skills> 目录', inputFlat.includes('<available_skills>'));
    check('目录含点名技能 haiku-helper 与 haiku-local', inputFlat.includes('<name>haiku-helper</name>') && inputFlat.includes('<name>haiku-local</name>'));
    check('目录不含白名单外 secret-local', !inputFlat.includes('secret-local'));

    // 前端面（#918 持久汇总行）：挡下列点名被拒技能。
    try {
      const summaryText = await captureDetailUi(todoId, 'deny', 'secret-local');
      check(
        '详情页汇总行挡下列点名被拒技能（截图 deny-detail-skills-summary.png）',
        summaryText.includes('secret-local') && summaryText.includes('挡下：'),
        summaryText.trim(),
      );
    } catch (err) {
      check('详情页汇总行挡下列截图/断言', false, String(err).slice(0, 200));
    }
    return finish();
  } finally {
    await new Promise((r) => stub.close(r));
  }
}

if (PHASE === 'behavior') await phaseBehavior();
else if (PHASE === 'deny-ui') await phaseDenyUi();
else {
  process.stdout.write(`unknown phase: ${PHASE}（behavior | deny-ui）\n`);
  process.exit(2);
}
