// verify-cairn 定制 probe（#918 活行与详情显示「读了哪些技能」，含被 deny
// 挡下的事件）：真 daemon + stub LLM + Playwright 浏览器面全链取证。
//
// 票面验收 seam 对照：
//   真实用户路径   起一个任务，stub LLM 按 catalog 指引 read 授权 SKILL.md——
//                  活行披露面出现 `▶ skill: demo-skill` 条目（运行中截图），
//                  步终态后详情页出现汇总行（技能：demo-skill）。
//   deny 事件      同一步先 read 白名单外技能的 SKILL.md（#917 门控 read 以
//                  tool error 拒绝）——同一条线出现 `✕ skill: extra-skill
//                  （已挡下）`，与「看不见」可区分；SQLite 落库拒绝文案对拍。
//   对照组         第二个任务（另一 agent + 另一 stub，脚本零技能读取）：
//                  全程 activity 事件不带 skills 字段、详情页无汇总行、无
//                  技能条目——「无技能命中的步骤不出现空条目」。
//   stepId 过滤    wire 面证据：activity 事件 skills 载荷只出现在本步事件上
//                  （server 盖 stepId；mapper 消费侧按在跑步过滤已有单测
//                  W8 钉住，probe 取 wire 真值）。
//
// 用法（栈须先 launch；配方见 docs/verify/918/README.md）：
//   node drive-918-skill-facts.mjs
// env：VERIFY_REPO_ROOT / VERIFY_RUN_DIR / VERIFY_EVIDENCE_DIR、
//      SKILLS_DIR（缺省 /tmp/cairn-918-skills，探针自动落 fixture）、
//      DAEMON_HOME（缺省 /tmp/cairn-918-daemon-home）。
// 探针自 spawn：stub LLM ×2（ephemeral 端口）+ 真 daemon（--server 指向本
// 栈、CAIRN_SKILLS_DIR 指向 fixture）；收尾全部回收（finally kill）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SCRIPT_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const REPO = process.env.VERIFY_REPO_ROOT ?? SCRIPT_REPO;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(REPO, '.claude', 'verify-run');
const stack = JSON.parse(readFileSync(join(RUN_DIR, 'ports.json'), 'utf8'));
const SERVER = `http://127.0.0.1:${stack.serverPort}`;
const WEB = `http://127.0.0.1:${stack.webPort}`;
const DB = join(stack.homeDir, 'server', 'server.db');
const SKILLS_DIR = process.env.SKILLS_DIR ?? '/tmp/cairn-918-skills';
const DAEMON_HOME = process.env.DAEMON_HOME ?? '/tmp/cairn-918-daemon-home';

const ts = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE = process.env.VERIFY_EVIDENCE_DIR ?? join(SCRIPT_REPO, `.claude/verify-evidence/${ts}-918-skill-facts`);
mkdirSync(EVIDENCE, { recursive: true });

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail: detail ?? null });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}\n`);
}
function save(name, data) {
  writeFileSync(join(EVIDENCE, name), typeof data === 'string' ? data : `${JSON.stringify(data, null, 2)}\n`);
}
function finish(extra = {}) {
  const passed = checks.filter((c) => c.ok).length;
  save('result.json', {
    probe: 'drive-918-skill-facts',
    server: SERVER,
    web: WEB,
    db: DB,
    skillsDir: SKILLS_DIR,
    daemonHome: DAEMON_HOME,
    passed,
    total: checks.length,
    checks,
    ...extra,
  });
  process.stdout.write(`\n${passed}/${checks.length} checks passed → ${EVIDENCE}\n`);
  if (passed !== checks.length) process.exitCode = 1;
}

async function jfetch(method, path, opts = {}) {
  const headers = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${SERVER}${path}`, {
    method,
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    signal: AbortSignal.timeout(15_000),
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

// —— stub LLM（integration/test/stub-llm.ts 的 .mjs 最小移植：脚本轮次 +
//    delayMs 门控——延迟撑开运行窗口，给浏览器面留拍摄时间）————————————

function startStubLlm(responses) {
  const requests = [];
  let next = 0;
  // call id 每次运行唯一：message 表主键 = call id，而 upsert 的冲突更新不动
  // conversationId——跨运行复用同 id 会把本轮工具行「钉」进上一轮的会话
  // （第四跑实测：汇总行因本轮会话缺工具行而永不出现）。
  const runId = Date.now().toString(36);
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
      const send = () => {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        const base = {
          id: 'chatcmpl-stub',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'stub-model',
        };
        const chunk = (payload) => `data: ${JSON.stringify(payload)}\n\n`;
        res.write(chunk({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] }));
        if (rsp.toolCall) {
          const callId = `call-stub-${runId}-${requests.length}`;
          res.write(
            chunk({
              ...base,
              choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: callId, type: 'function', function: { name: rsp.toolCall.name, arguments: '' } }] }, finish_reason: null }],
            }),
          );
          res.write(
            chunk({
              ...base,
              choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(rsp.toolCall.arguments ?? {}) } }] }, finish_reason: null }],
            }),
          );
          res.write(chunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }));
        } else {
          for (const word of (rsp.content ?? 'ok').split(/(?<=。|\.|\s)/u)) {
            if (word !== '') res.write(chunk({ ...base, choices: [{ index: 0, delta: { content: word } }] }));
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
      };
      if (rsp.delayMs) setTimeout(send, rsp.delayMs);
      else send();
    });
  });
  return new Promise((resolve2) => {
    server.listen(0, '127.0.0.1', () => {
      resolve2({
        url: `http://127.0.0.1:${server.address().port}/v1`,
        requests,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

// —— conversation stream activity 收集器（integration 同款判据的 probe 形）——

function collectActivities(buildId) {
  const ctrl = new AbortController();
  const events = [];
  void (async () => {
    const res = await fetch(`${SERVER}/api/conversations/${buildId}/stream`, { signal: ctrl.signal });
    if (!res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buf += decoder.decode(value, { stream: true });
      let idx = buf.indexOf('\n\n');
      while (idx >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue;
          try {
            const ev = JSON.parse(line.slice(5).trim());
            if (ev.type === 'activity') events.push(ev.activity);
          } catch {
            // 半帧防御
          }
        }
        idx = buf.indexOf('\n\n');
      }
    }
  })().catch(() => {});
  return {
    events,
    latestSkills: () => {
      for (let i = events.length - 1; i >= 0; i--) {
        const a = events[i];
        if (a && Array.isArray(a.skills)) return a.skills;
      }
      return null;
    },
    stop: () => ctrl.abort(),
  };
}

// —— fixture / seed / daemon / SQLite ————————————————————————————————

const DENIED_SKILL = 'extra-skill';
const ALLOWED_SKILL = 'demo-skill';
const SKILL_MARKER = 'SKILL-FACTS-MARKER-918';

function buildSkillFixtures() {
  rmSync(SKILLS_DIR, { recursive: true, force: true });
  const files = [
    [
      `${ALLOWED_SKILL}/SKILL.md`,
      `---\nname: ${ALLOWED_SKILL}\ndescription: 演示技能（#918 探针，读到正文即证路径可达）。\n---\n\n# ${ALLOWED_SKILL}\n\n正文 marker：${SKILL_MARKER}\n`,
    ],
    [
      `${DENIED_SKILL}/SKILL.md`,
      `---\nname: ${DENIED_SKILL}\ndescription: 白名单外对照技能（#918 探针）。\n---\n\nextra body.\n`,
    ],
  ];
  // 双落点：① daemon 本地 CAIRN_SKILLS_DIR（stub 脚本按固定绝对路径 read，
  // 门控/deny 判定的目标面）；② server 端技能目录——agent 白名单写入走
  // filterKnownSkillIds(ctx.skillsDir) 现扫校验，server 目录里没有的名字会被
  // 静默丢弃（首跑实测：skills=[] → 双技能全 deny，授权读也变成拒绝）。
  const roots = [SKILLS_DIR, join(stack.homeDir, 'skills')];
  for (const root of roots) {
    for (const [rel, content] of files) {
      const p = join(root, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content, 'utf8');
    }
  }
}

let uniq = 0;
async function seed(stubSkillUrl, stubCtlUrl) {
  const teams = await jfetch('GET', '/api/teams');
  const teamId = teams.body[0]?.id ?? teams.body.teams?.[0]?.id;
  if (!teamId) throw new Error(`no team: ${JSON.stringify(teams.body).slice(0, 200)}`);
  const provider = async (id, baseUrl) => {
    const r = await jfetch('POST', `/api/teams/${teamId}/providers`, {
      body: {
        providerId: id,
        label: id,
        baseUrl,
        api: 'openai-completions',
        authHeader: true,
        compat: { supportsDeveloperRole: false },
        models: [{ id: 'stub-model', name: 'stub-model' }],
      },
    });
    if (r.status >= 400) throw new Error(`provider create failed: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  };
  // provider id 每次运行唯一：stub 是 ephemeral 端口，同 id 复跑会撞上一轮
  // 的死 baseUrl（create-if-absent 不更新）。
  const runTag = Date.now().toString(36);
  const skillProvider = `stub-918-${runTag}`;
  const ctlProvider = `stub-918-ctl-${runTag}`;
  await provider(skillProvider, stubSkillUrl);
  await provider(ctlProvider, stubCtlUrl);
  const agent = async (name, providerId, skills) => {
    const r = await jfetch('POST', `/api/teams/${teamId}/agents`, {
      body: { displayName: `${name}-${++uniq}`, provider: providerId, modelId: 'stub-model', skills },
    });
    const id = r.body?.id ?? r.body?.agent?.id;
    if (!id) throw new Error(`agent create failed: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    return id;
  };
  const agentId = await agent('probe-918-builder', skillProvider, [ALLOWED_SKILL]);
  const ctlAgentId = await agent('probe-918-control', ctlProvider, []);
  const keyRes = await jfetch('POST', `/api/teams/${teamId}/api-keys`, {
    body: { name: `probe-918-${Date.now()}`, gitAccess: false, mcpAccess: false, toolGrants: { read: [], write: [] } },
  });
  const plaintext = keyRes.body?.plaintext ?? keyRes.body?.key;
  if (!plaintext) throw new Error(`api-key create failed: ${keyRes.status}`);
  const projRes = await jfetch('POST', '/api/projects', { body: { name: `probe-918-${Date.now()}` } });
  return { teamId, agentId, ctlAgentId, apiKey: plaintext, projectId: projRes.body?.id };
}

async function makeTask(projectId, agentId, title) {
  const todoRes = await jfetch('POST', `/api/projects/${projectId}/todos`, {
    body: { title, spec: '按 stub 脚本跑一步（#918 探针任务）' },
  });
  const todoId = todoRes.body?.id;
  const buildRes = await jfetch('POST', `/api/projects/${projectId}/builds`, {
    body: { todoIds: [todoId], assignment: { plan: null, build: { agentId } }, withPlan: false },
  });
  const buildId = buildRes.body?.builds?.[0]?.id;
  if (!todoId || !buildId) throw new Error(`task seed failed: ${JSON.stringify(buildRes.body).slice(0, 200)}`);
  return { todoId, buildId };
}

function spawnDaemon(apiKey, teamId) {
  const env = { ...process.env };
  for (const k of ['http_proxy', 'https_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']) delete env[k];
  env.NO_PROXY = '*';
  env.CAIRN_HOME = DAEMON_HOME;
  env.CAIRN_SKILLS_DIR = SKILLS_DIR;
  const out = join(EVIDENCE, 'daemon-console.log');
  writeFileSync(out, '');
  const child = spawn('pnpm', ['exec', 'tsx', 'src/cli.ts', 'start', '--foreground', '--server', SERVER, '--api-key', apiKey, '--team', teamId, '--name', 'verify-918'], {
    cwd: join(REPO, 'apps/daemon'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => appendFileSync(out, d));
  child.stderr.on('data', (d) => appendFileSync(out, d));
  child.on('exit', (code) => appendFileSync(out, `\n[probe] daemon exited code=${code}\n`));
  return child;
}

function daemonLogLines() {
  const p = join(DAEMON_HOME, 'daemon.log');
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').filter(Boolean);
}

async function waitFor(pred, timeoutMs, label) {
  const started = Date.now();
  for (;;) {
    const v = await pred();
    if (v) return v;
    if (Date.now() - started > timeoutMs) throw new Error(`waitFor timeout: ${label}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

function openDb() {
  const require2 = createRequire(join(REPO, 'apps/server/package.json'));
  const Database = require2('better-sqlite3');
  return new Database(DB, { readonly: true });
}

async function waitStepTerminal(buildId, timeoutMs = 180_000) {
  return waitFor(
    () => {
      const db = openDb();
      try {
        const rows = db.prepare('SELECT id, kind, status FROM step WHERE buildId = ? ORDER BY createdAt').all(buildId);
        // 状态词表 = shared stepStatusSchema：成功终态是 'done'（920 探针里
        // 写 'success' 是它的失败步形态碰不到成功分支的潜伏笔误，勿抄）。
        const terminal = rows.filter((r) => ['done', 'failed', 'stopped'].includes(r.status));
        if (terminal.length === 0) return null;
        const build = db.prepare('SELECT id, errorMessage FROM build WHERE id = ?').get(buildId);
        return { rows, terminal: { ...terminal[terminal.length - 1], buildErrorMessage: build?.errorMessage ?? null } };
      } finally {
        db.close();
      }
    },
    timeoutMs,
    `step terminal for ${buildId}`,
  );
}

// —— main ———————————————————————————————————————————————————————————

buildSkillFixtures();
check('fixture 技能库落盘（1 授权 + 1 白名单外）', existsSync(join(SKILLS_DIR, ALLOWED_SKILL, 'SKILL.md')) && existsSync(join(SKILLS_DIR, DENIED_SKILL, 'SKILL.md')), SKILLS_DIR);

rmSync(DAEMON_HOME, { recursive: true, force: true });

// stub A（技能任务）：拒读 → 授读 → 写改动（过产物闸）→ 收尾。delayMs 撑开
// 运行窗口给浏览器拍摄；stub B（对照任务）：零技能读取。
const stubSkill = await startStubLlm([
  { toolCall: { name: 'read', arguments: { path: join(SKILLS_DIR, DENIED_SKILL, 'SKILL.md') } }, delayMs: 4_000 },
  { toolCall: { name: 'read', arguments: { path: join(SKILLS_DIR, ALLOWED_SKILL, 'SKILL.md') } }, delayMs: 4_000 },
  { toolCall: { name: 'bash', arguments: { command: 'printf "918 probe\\n" >> README.md' } }, delayMs: 25_000 },
  { content: '已读取演示技能。', delayMs: 5_000 },
]);
const stubCtl = await startStubLlm([
  { toolCall: { name: 'bash', arguments: { command: 'printf "918 control\\n" >> README.md' } }, delayMs: 3_000 },
  { content: '对照任务完成。' },
]);

const seeded = await seed(stubSkill.url, stubCtl.url);
const daemon = spawnDaemon(seeded.apiKey, seeded.teamId);
const browser = await chromium.launch();
let collectorA = null;
let collectorB = null;

try {
  // vite dev 首访冷编译可达数十秒——先暖机再建任务，否则详情页落地时步已
  // 终态（activity 单槽即清），活行面板永远拍不到（第三跑实测踩中）。
  const warm = await browser.newPage();
  await warm.goto(`${WEB}/app`, { waitUntil: 'networkidle', timeout: 90_000 });
  await warm.close();
  // daemon.log 行带 wall-clock 前缀（#735）——子串判定，不整行相等。
  await waitFor(() => daemonLogLines().some((l) => l.includes('[wake] push channel connected')), 60_000, 'daemon online');
  check('真 daemon 上线（--server 指本栈，CAIRN_SKILLS_DIR 指 fixture）', true, DAEMON_HOME);

  // ——— 任务 A：技能读取 + deny 事件 ———
  const taskA = await makeTask(seeded.projectId, seeded.agentId, '918 技能事实探针');
  collectorA = collectActivities(taskA.buildId);

  const page = await browser.newPage({ viewport: { width: 1440, height: 732 } });
  await page.goto(`${WEB}/app/todo/${taskA.todoId}`);
  const liveRow = page.getByTestId('live-row');
  await liveRow.first().waitFor({ timeout: 90_000 });
  // 运行中：技能条目逐条冒出来（拒读在前、授读在后；累计集）。披露面展开态
  // 是 LiveRow 组件内 state——transcript 条目增减会重挂载把面板合上（#905
  // 面板同款既有行为，非本票范围）——故轮询里反复重展开，直到两条条目同框。
  const expand = page.getByRole('button', { name: '展开实时步骤' });
  await expand.waitFor({ timeout: 30_000 });
  const skillLines = page.getByTestId('skill-line');
  let lineTexts = [];
  const panelDeadline = Date.now() + 120_000;
  while (Date.now() < panelDeadline) {
    if ((await expand.count()) > 0 && (await expand.getAttribute('aria-expanded')) === 'false') {
      await expand.click().catch(() => {});
    }
    if ((await skillLines.count()) >= 2) {
      lineTexts = await skillLines.allTextContents();
      break;
    }
    await page.waitForTimeout(800);
  }
  check('活行披露面出现「▶ skill: demo-skill」（运行中，实时）', lineTexts.some((t) => t.includes('▶ skill: demo-skill')), JSON.stringify(lineTexts));
  check('deny 事件同线可见「✕ skill: extra-skill（已挡下）」', lineTexts.some((t) => t.includes('✕ skill: extra-skill') && t.includes('已挡下')), JSON.stringify(lineTexts));
  // 头标签增强（best-effort 拍摄，不作 check：tool 相位窗口秒级）——把头行
  // 文本原样存档供判读。
  const headLabel = await liveRow.first().innerText().catch(() => null);
  save('live-head-label.txt', headLabel ?? '(capture failed)');
  await page.screenshot({ path: join(EVIDENCE, 'live-panel.png') });

  // wire 真值：activity 事件累计集含双事实 + 工具相位显示名 skill: 前缀。
  await waitFor(
    () => {
      const skills = collectorA.latestSkills();
      return (
        skills !== null &&
        skills.some((s) => s.name === ALLOWED_SKILL && !s.denied) &&
        skills.some((s) => s.name === DENIED_SKILL && s.denied)
      );
    },
    30_000,
    'wire skills facts',
  );
  const wireSkills = collectorA.latestSkills();
  const skillToolPhase = collectorA.events.find((a) => typeof a.tool === 'string' && a.tool.startsWith('skill: '));
  check('wire：activity 事件 skills 累计集 = 读到 + 挡下双事实', Array.isArray(wireSkills) && wireSkills.length === 2, JSON.stringify(wireSkills));
  check('wire：技能入口调用的 tool 相位显示名带 skill: 前缀', Boolean(skillToolPhase), JSON.stringify(skillToolPhase ?? null));
  save('activity-wire.json', collectorA.events);

  // 步终态 → 详情页汇总行（持久面）。
  const terminalA = await waitStepTerminal(taskA.buildId);
  check('任务 A 步以 done 收尾（产物闸被 bash 写改动满足）', terminalA.terminal?.status === 'done', JSON.stringify(terminalA.terminal));
  const summary = page.getByTestId('skills-summary');
  await summary.waitFor({ timeout: 60_000 });
  const summaryText = await summary.innerText();
  check('步终态后详情页汇总行在位：技能：demo-skill · 挡下：extra-skill', summaryText.includes('技能：demo-skill') && summaryText.includes('挡下：extra-skill'), summaryText);
  await page.screenshot({ path: join(EVIDENCE, 'summary.png') });

  // SQLite 真值：拒绝文案落库（deny 事件不是活行专属的瞬态）。
  const db = openDb();
  let dbRows;
  try {
    dbRows = db.prepare('SELECT id, role, content FROM message WHERE conversationId = ?').all(taskA.buildId);
  } finally {
    db.close();
  }
  const flat = JSON.stringify(dbRows);
  check('SQLite：拒绝文案落库（not in the agent allowlist）且授权正文 marker 落库', flat.includes('not in the agent allowlist') && flat.includes(SKILL_MARKER), `messages=${dbRows.length}`);
  save('messages-918a.json', dbRows);

  // ——— 任务 B：对照组（零技能命中 → 零条目） ———
  const taskB = await makeTask(seeded.projectId, seeded.ctlAgentId, '918 对照探针（零技能）');
  collectorB = collectActivities(taskB.buildId);
  const terminalB = await waitStepTerminal(taskB.buildId);
  check('对照任务步以 done 收尾', terminalB.terminal?.status === 'done', JSON.stringify(terminalB.terminal));
  const pageB = await browser.newPage({ viewport: { width: 1440, height: 732 } });
  await pageB.goto(`${WEB}/app/todo/${taskB.todoId}`);
  await pageB.getByTestId('transcript-note').first().waitFor({ timeout: 30_000 }).catch(() => {});
  await pageB.waitForTimeout(2_000);
  check('对照组：详情页无技能汇总行', (await pageB.getByTestId('skills-summary').count()) === 0);
  check('对照组：详情页无技能条目行', (await pageB.getByTestId('skill-line').count()) === 0);
  await pageB.screenshot({ path: join(EVIDENCE, 'control.png') });
  const sawActivity = collectorB.events.length > 0;
  const anySkills = collectorB.events.some((a) => a && Array.isArray(a.skills));
  check('对照组：wire 有 activity 事件但零事件携带 skills 字段', sawActivity && !anySkills, `events=${collectorB.events.length}`);
  save('activity-wire-control.json', collectorB.events);

  finish({ taskA, taskB });
} catch (err) {
  check(`探针异常：${err instanceof Error ? err.message : String(err)}`, false);
  // 失败路径诊断（第五跑实测：冷栈下面板等待超时但无现场——补拍）。
  try {
    for (const p of browser.contexts().flatMap((c) => c.pages())) {
      await p.screenshot({ path: join(EVIDENCE, `fail-${Date.now()}.png`) }).catch(() => {});
    }
    save('fail-activity-wire.json', collectorA?.events ?? []);
  } catch {
    // 诊断失败不掩盖原始异常
  }
  finish({ error: err instanceof Error ? err.stack : String(err) });
} finally {
  collectorA?.stop();
  collectorB?.stop();
  daemon.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 2_000));
  if (daemon.exitCode === null) daemon.kill('SIGKILL');
  await stubSkill.close();
  await stubCtl.close();
  await browser.close();
}
