#!/usr/bin/env node
// verify-pacman 定制 probe（#1171 团队技能原生插件通道）：两相位。
//
//   wire      零 LLM（假 claude CLI 捕获 argv）：四腿——
//             A 版本 2.1.294 + allowlist [marker-alpha]：native-plugin 行 /
//               插件目录形状（manifest + 只含 allowed）/ hardlink 同 inode /
//               `--plugin-dir` 进 CLI argv / deny 规则同 argv（Skill(marker-beta)）/
//               白名单外零文件 / worktree `.claude` 零残留；
//             B 版本 2.0.5 → `native-plugin: skipped` 行 + argv 无 --plugin-dir
//               （版本闸 fail-closed，catalog 通道照常）；
//             C allowlist [] → team-manifest-empty 行 + 无 native-plugin 行 +
//               argv 无 --plugin-dir（server 空清单 = 无 view = 无插件）；
//             D allowlist null（不限制）→ 团队 2 技能全量进插件 + 本机
//               PACMAN_SKILLS_DIR 技能不混入 + 零 deny 行。
//             daemon 由探针自 spawn 自回收（PACMAN_CLAUDE_BIN 注入假 CLI；
//             腿间换 daemon 时等 80s 僵尸 claim 窗口，#1025 gotcha）。
//   behavior  真模型腿（本机 claude 登录态，MODEL 缺省 glm-5.3；relay 间歇
//             故障按 ≤3 次整步重试，#919 同律）：allowlist [haiku-native-1171]、
//             任务文本不点名技能 → 原生 Skill 发现自命中。硬判据 = transcript
//             的 Skill 工具调用行（input 含技能名）+ marker 复述 + 步 done；
//             收尾面 = worktree git status 零残留、仓库预植
//             .claude/skills/repo-native 逐字节保留（验收 3 的不覆盖面）。
//
// env：SERVER / WEB（缺省读 VERIFY_RUN_DIR/ports.json）、VERIFY_RUN_DIR、DB、
//      VERIFY_EVIDENCE_DIR、MODEL（缺省 glm-5.3）。
// 前置：live 栈已 launch（VERIFY_PORT=8797 VERIFY_WEB_PORT=5279）。daemon 由
//      本探针自起自收，不需要外部 daemon。
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const REPO = process.env.VERIFY_REPO_ROOT ?? SCRIPT_REPO;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(REPO, '.claude', 'verify-run');
const ports = existsSync(join(RUN_DIR, 'ports.json'))
  ? JSON.parse(readFileSync(join(RUN_DIR, 'ports.json'), 'utf8'))
  : {};
const SERVER = process.env.SERVER ?? `http://127.0.0.1:${ports.serverPort ?? 8797}`;
const WEB = process.env.WEB ?? `http://127.0.0.1:${ports.webPort ?? 5279}`;
const DB = process.env.DB ?? join(RUN_DIR, 'home', 'server', 'server.db');
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
const PHASE = args.phase ?? 'wire';
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE = process.env.VERIFY_EVIDENCE_DIR ?? `/tmp/pacman-1171-evidence-${PHASE}-${ts}`;
mkdirSync(EVIDENCE, { recursive: true });

// —— 判据常量（先于运行固化）———————————————————————————————
const MARKER_ALPHA = 'PINEAPPLE-1171-ALPHA';
const MARKER_BETA = 'DURIAN-1171-BETA';
const HAIKU_MARKER = 'HAIKU-NATIVE-1171';
const REPO_SKILL_MARKER = 'REPO-NATIVE-1171';
const PLUGIN_NAME = 'pacman-team-skills';
const MIN_VERSION = '2.1.74';

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
    probe: `drive-1171-native-plugin/${PHASE}`,
    server: SERVER,
    web: WEB,
    db: DB,
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// —— daemon 自 spawn 自回收（925/929 同律；--server 显式命令行 = cleanup 端口钉选可回收）——

function daemonEnv(home, skillsDir, extra) {
  const env = { ...process.env };
  for (const k of [
    'http_proxy',
    'https_proxy',
    'all_proxy',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'ALL_PROXY',
  ]) {
    delete env[k];
  }
  return {
    ...env,
    NO_PROXY: '*',
    PACMAN_HOME: home,
    PACMAN_SKILLS_DIR: skillsDir,
    ...extra,
  };
}

async function spawnDaemon({ home, name, apiKey, teamId, extraEnv }) {
  // 每次 spawn 全新 home：device.json 持久 machineId——复用旧 home 会以旧
  // 身份重 enroll（--name 不覆盖存储名），machines 轮询按新名字永远等不到
  // （run 2 实测 90s 超时的根因）。
  rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
  const logPath = join(EVIDENCE, `daemon-${name}.log`);
  const logFd = openSync(logPath, 'a');
  const child = spawn(
    'pnpm',
    [
      'exec',
      'tsx',
      'src/cli.ts',
      'start',
      '--foreground',
      '--server',
      SERVER,
      '--api-key',
      apiKey,
      '--team',
      teamId,
      '--name',
      name,
    ],
    {
      cwd: join(REPO, 'apps', 'daemon'),
      env: daemonEnv(home, LOCAL_SKILLS, extraEnv),
      detached: true,
      stdio: ['ignore', logFd, logFd],
    },
  );
  child.unref();
  const stop = async () => {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {}
    for (let i = 0; i < 20; i++) {
      await sleep(250);
      try {
        process.kill(-child.pid, 0);
      } catch {
        closeSync(logFd);
        return;
      }
    }
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {}
    closeSync(logFd);
  };
  // 等 enroll 上线（machines 列表点名）+ 打开 runtime 闸（#682 claim 真闸）。
  const started = Date.now();
  for (;;) {
    const res = await jfetch('GET', `/api/teams/${teamId}/machines`);
    const rows = Array.isArray(res.body) ? res.body : [];
    const me = rows.find((m) => m.name === name);
    if (me?.online) {
      await jfetch('PATCH', `/api/machines/${me.id}`, {
        body: { enabledRuntimes: ['pi', 'claude-code'] },
      });
      break;
    }
    if (Date.now() - started > 90_000) {
      await stop();
      throw new Error(`daemon ${name} did not come online (log: ${logPath})`);
    }
    await sleep(1000);
  }
  return { pid: child.pid, logPath, stop };
}

function logLinesAfter(logPath, offset) {
  if (!existsSync(logPath)) return { lines: [], offset: 0 };
  const text = readFileSync(logPath, 'utf8');
  return { lines: text.slice(offset).split('\n').filter(Boolean), offset: text.length };
}

function capturesAfter(file, offset) {
  if (!existsSync(file)) return { entries: [], offset: 0 };
  const text = readFileSync(file, 'utf8');
  const entries = text
    .slice(offset)
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  return { entries, offset: text.length };
}

// —— 假 claude CLI（wire 相位）：--version / auth status 应答，其余 spawn 捕获 argv 后 exit 1 ——

const LOCAL_SKILLS = process.env.LOCAL_SKILLS ?? '/tmp/pacman-1171-local-skills';

function writeFakeClaude(versionCapture) {
  const p = join(EVIDENCE, 'fake-claude.mjs');
  writeFileSync(
    p,
    `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
const a = process.argv.slice(2);
if (a[0] === '--version') {
  console.log(\`\${process.env.FAKE_CLAUDE_VERSION ?? '2.1.294'} (Claude Code)\`);
  process.exit(0);
}
if (a[0] === 'auth' && a[1] === 'status') {
  console.log(JSON.stringify({ loggedIn: true, authMethod: 'fake', apiProvider: 'firstParty' }));
  process.exit(0);
}
if (process.env.FAKE_CLAUDE_CAPTURE) {
  appendFileSync(
    process.env.FAKE_CLAUDE_CAPTURE,
    JSON.stringify({ time: new Date().toISOString(), cwd: process.cwd(), argv: a }) + '\\n',
  );
}
process.exit(1);
`,
    'utf8',
  );
  chmodSync(p, 0o755);
  return p;
}

function ensureLocalSkill() {
  const dir = join(LOCAL_SKILLS, 'local-only-1171');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    '---\nname: local-only-1171\ndescription: daemon-local probe skill (must never enter the plugin)\n---\n\nlocal body.\n',
    'utf8',
  );
}

// —— 铺底（REST，1169 同形）———————————————————————————————

async function ensureTeamSkill(teamId, name, description, bodyLines) {
  const content = `---\nname: ${name}\ndescription: ${description}\n---\n\n${bodyLines}\n`;
  const res = await jfetch('POST', `/api/skills?teamId=${encodeURIComponent(teamId)}`, {
    body: { name, description, files: [{ path: 'SKILL.md', content }] },
  });
  if (res.status !== 201 && res.status !== 409) {
    throw new Error(`team skill seed ${name} failed: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
  }
  return content;
}

async function createAgent(teamId, body) {
  const res = await jfetch('POST', `/api/teams/${teamId}/agents`, { body });
  const agentId = res.body?.id ?? res.body?.agent?.id;
  if (!agentId) {
    throw new Error(`agent create failed: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
  }
  return agentId;
}

async function createProject(name) {
  const res = await jfetch('POST', '/api/projects', {
    body: { name, repoKind: 'hosted' },
  });
  const id = res.body?.id;
  if (!id) throw new Error(`project create failed: ${res.status}`);
  return id;
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
      await sleep(2000);
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

/** hosted bare repo 定位（RUN_DIR/home/server/repos/<teamId>/ 下最新 .git）。 */
function findBareRepo(teamId, afterMs) {
  const root = join(RUN_DIR, 'home', 'server', 'repos', teamId);
  if (!existsSync(root)) return null;
  const candidates = readdirSync(root)
    .map((name) => ({ name, mtimeMs: statSync(join(root, name)).mtimeMs }))
    .filter((e) => e.name.endsWith('.git') && e.mtimeMs >= afterMs)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0] ? join(root, candidates[0].name) : null;
}

function git(args2, opts = {}) {
  return execFileSync('git', args2, { encoding: 'utf8', ...opts });
}

function logOffsetOf(logPath) {
  return existsSync(logPath) ? statSync(logPath).size : 0;
}

/** 向 hosted bare repo 预植一个提交（.claude/skills/repo-native）。 */
function seedRepoSkill(bareRepo, branch) {
  const clone = join(EVIDENCE, 'repo-seed-clone');
  if (existsSync(clone)) execFileSync('rm', ['-r', clone]);
  git(['clone', bareRepo, clone]);
  const head = git(['-C', clone, 'symbolic-ref', '--short', 'HEAD']).trim() || branch;
  const dir = join(clone, '.claude', 'skills', 'repo-native');
  mkdirSync(dir, { recursive: true });
  const content = `---\nname: repo-native\ndescription: pre-existing repo skill that must survive untouched (${REPO_SKILL_MARKER})\n---\n\nDo nothing. Marker: ${REPO_SKILL_MARKER}\n`;
  writeFileSync(join(dir, 'SKILL.md'), content, 'utf8');
  git(['-C', clone, 'config', 'user.email', 'probe-1171@pacman.local']);
  git(['-C', clone, 'config', 'user.name', 'probe-1171']);
  git(['-C', clone, 'add', '.claude']);
  git(['-C', clone, 'commit', '-m', 'seed: pre-existing repo skill (probe 1171)']);
  git(['-C', clone, 'push', 'origin', `HEAD:${head}`]);
  return { content, branch: head };
}

async function apiKeyFor(teamId, name) {
  const res = await jfetch('POST', `/api/teams/${teamId}/api-keys`, {
    body: { name, gitAccess: true, mcpAccess: false, toolGrants: { read: [], write: [] } },
  });
  const key = res.body?.plaintext;
  if (!key) throw new Error(`api key create failed: ${res.status}`);
  return key;
}

// —— phase: wire（假 CLI，零 LLM）————————————————————————————

async function phaseWire() {
  const teamId = await teamIdOf();
  const fake = writeFakeClaude();
  ensureLocalSkill();
  const alphaContent = await ensureTeamSkill(
    teamId,
    'marker-alpha',
    'Probe marker skill alpha for issue 1171 (wire leg).',
    `When invoked, reply with exactly: ${MARKER_ALPHA}`,
  );
  await ensureTeamSkill(
    teamId,
    'marker-beta',
    'Probe marker skill beta for issue 1171 (wire leg, deny side).',
    `When invoked, reply with exactly: ${MARKER_BETA}`,
  );

  // —— daemon 1（版本 2.1.294 假 CLI）：腿 A / C / D ——
  const home1 = '/tmp/pacman-1171-wire-home1';
  const capture1 = join(EVIDENCE, 'fake-cli-capture-1.jsonl');
  const d1 = await spawnDaemon({
    home: home1,
    name: `probe-1171-wire1-${Date.now()}`,
    apiKey: await apiKeyFor(teamId, `probe-1171-wire1-${Date.now()}`),
    teamId,
    extraEnv: {
      PACMAN_CLAUDE_BIN: fake,
      FAKE_CLAUDE_VERSION: '2.1.294',
      FAKE_CLAUDE_CAPTURE: capture1,
    },
  });
  save('wire-daemon1-version-line.txt', logLinesAfter(d1.logPath, 0).lines.filter((l) => l.includes('claude binary')).join('\n'));
  try {
    // —— 腿 A：allowlist [marker-alpha]（部分授权）——
    let offset = logOffsetOf(d1.logPath);
    const cap = capturesAfter(capture1, 0);
    let capOffset = cap.offset;
    const agentA = await createAgent(teamId, {
      displayName: `wire-a-${Date.now()}`,
      provider: 'claude-code',
      modelId: MODEL,
      skillsAllowlist: ['marker-alpha'],
    });
    const projA = await createProject(`probe-1171-wire-a-${Date.now()}`);
    const stepA = await createTaskAndBuild(projA, agentA, 'wire A 腿', '读一个文件并汇报。');
    const termA = await waitStepTerminal(stepA.buildId, 180_000);
    check('A0 步到终态（假 CLI 必 failed——判据在日志/argv/目录面）', termA.step !== null, JSON.stringify(termA.step));
    const logA = logLinesAfter(d1.logPath, offset);
    offset = logA.offset;
    save('wire-a-daemon-skills-log.txt', logA.lines.filter((l) => l.includes('[skills]')).join('\n'));
    const nativeLine = logA.lines.find((l) => l.includes('native-plugin:') && l.includes('skill(s)'));
    check('A1 daemon.log native-plugin 交付行（1 skill）', Boolean(nativeLine?.includes('1 skill(s)')), nativeLine ?? '(missing)');
    const pluginDir = nativeLine?.match(/→ (\S+)/)?.[1] ?? null;
    check('A1 插件目录在 daemon 缓存 plugins/ 分区', Boolean(pluginDir?.startsWith(join(home1, 'team-skills', 'plugins'))), pluginDir ?? '(missing)');
    if (pluginDir) {
      const manifest = JSON.parse(readFileSync(join(pluginDir, '.claude-plugin', 'plugin.json'), 'utf8'));
      check('A2 plugin.json name = pacman-team-skills、无 mcpServers', manifest.name === PLUGIN_NAME && !('mcpServers' in manifest), JSON.stringify(manifest));
      const skillDirs = readdirSync(join(pluginDir, 'skills')).sort();
      check('A2 skills/ 只含 allowed（marker-alpha），白名单外零条目', skillDirs.length === 1 && skillDirs[0] === 'marker-alpha', JSON.stringify(skillDirs));
      const pluginSkill = readFileSync(join(pluginDir, 'skills', 'marker-alpha', 'SKILL.md'), 'utf8');
      check('A2 SKILL.md 内容逐字节 = server 分发源', pluginSkill === alphaContent, `${pluginSkill.length}B vs ${alphaContent.length}B`);
      check('A2 marker-beta 在插件目录零文件（deny 面零回退）', !existsSync(join(pluginDir, 'skills', 'marker-beta')));
      check('A2 本机技能 local-only-1171 不混入插件', !existsSync(join(pluginDir, 'skills', 'local-only-1171')));
      // A7 hardlink 同 inode（与 view 共享 blob，非复制）
      const viewsRoot = join(home1, 'team-skills', 'views');
      const viewDirs = existsSync(viewsRoot) ? readdirSync(viewsRoot) : [];
      let inodeOk = false;
      let inodeDetail = 'no view found';
      for (const v of viewDirs) {
        const vp = join(viewsRoot, v, 'marker-alpha', 'SKILL.md');
        if (existsSync(vp)) {
          inodeOk = statSync(vp).ino === statSync(join(pluginDir, 'skills', 'marker-alpha', 'SKILL.md')).ino;
          inodeDetail = `view=${v} sameInode=${inodeOk}`;
          break;
        }
      }
      check('A7 插件文件与 view 文件同 inode（hardlink 装配）', inodeOk, inodeDetail);
    }
    const capA = capturesAfter(capture1, capOffset);
    capOffset = capA.offset;
    const spawnEntry = capA.entries.find((e) => e.argv.includes('--plugin-dir'));
    save('wire-a-cli-argv.json', capA.entries);
    check('A3 CLI argv 含 --plugin-dir 且指向该插件目录', Boolean(spawnEntry && spawnEntry.argv.includes(pluginDir)), spawnEntry ? spawnEntry.argv.filter((a) => a.includes('plugin')).join(' ') : 'no capture');
    const argvFlat = JSON.stringify(capA.entries);
    check('A4 deny 规则同 argv：白名单外本机技能 Skill(local-only-1171) 在 settings 面', argvFlat.includes('Skill(local-only-1171)'), '');
    check('A4 deny 规则同 argv：白名单内 marker-alpha 不在 deny 面', !argvFlat.includes('Skill(marker-alpha)'), '');
    // marker-beta 的 deny 面在 server 侧就更早收口：白名单 ∩ 现扫 = 分发面，
    // 它根本没进 manifest → 本机无 view 目录 → 插件/扫描/deny 三面都无它。
    const viewsRootA = join(home1, 'team-skills', 'views');
    const viewDirsA = existsSync(viewsRootA) ? readdirSync(viewsRootA) : [];
    const betaOnMachine = viewDirsA.some((v) => existsSync(join(viewsRootA, v, 'marker-beta')));
    check('A4 marker-beta 未被 server 分发（本机 view 零落盘 = 授权面最早收口）', !betaOnMachine, `views=${viewDirsA.length}`);
    // A5 worktree 零残留（失败步收尾后）：无 .claude 条目；插件路径不在 workspaces 下
    const wtA = join(home1, 'workspaces', stepA.buildId);
    let porcelain = '(worktree absent)';
    if (existsSync(wtA)) porcelain = git(['-C', wtA, 'status', '--porcelain']);
    save('wire-a-worktree-status.txt', porcelain);
    check('A5 worktree git status 无 .claude 残留（失败收尾同样干净）', !porcelain.includes('.claude'), porcelain.slice(0, 160) || '(clean)');
    check('A5 插件落点不在任何任务 worktree 下', Boolean(pluginDir) && !pluginDir.includes(join(home1, 'workspaces')), pluginDir ?? '');
    const denyLineA = logA.lines.find((l) => l.includes('[skills] deny:'));
    check('A6 deny 汇总行在位（1 dir = local-only-1171；团队 view 已被 server 白名单过滤）', Boolean(denyLineA?.includes('1 skill dir(s)')), denyLineA ?? '(missing)');

    // —— 腿 C：allowlist []（显式全拒 → server 空清单 → 无插件）——
    const agentC = await createAgent(teamId, {
      displayName: `wire-c-${Date.now()}`,
      provider: 'claude-code',
      modelId: MODEL,
      skillsAllowlist: [],
    });
    const projC = await createProject(`probe-1171-wire-c-${Date.now()}`);
    const stepC = await createTaskAndBuild(projC, agentC, 'wire C 腿', '读一个文件并汇报。');
    const termC = await waitStepTerminal(stepC.buildId, 180_000);
    check('C0 步到终态', termC.step !== null, JSON.stringify(termC.step));
    const logC = logLinesAfter(d1.logPath, offset);
    offset = logC.offset;
    save('wire-c-daemon-skills-log.txt', logC.lines.filter((l) => l.includes('[skills]')).join('\n'));
    check('C1 team-manifest-empty 行（server 空清单 = 配置事实）', logC.lines.some((l) => l.includes('team-manifest-empty')), '');
    check('C1 无 native-plugin 交付行（无 view = 无插件）', !logC.lines.some((l) => l.includes('native-plugin:') && l.includes('skill(s)')), '');
    const capC = capturesAfter(capture1, capOffset);
    capOffset = capC.offset;
    save('wire-c-cli-argv.json', capC.entries);
    check('C2 CLI argv 无 --plugin-dir', capC.entries.length > 0 && !capC.entries.some((e) => e.argv.includes('--plugin-dir')), `${capC.entries.length} capture(s)`);

    // —— 腿 D：allowlist null（不限制 → 团队全量进插件；本机技能不混入）——
    const agentD = await createAgent(teamId, {
      displayName: `wire-d-${Date.now()}`,
      provider: 'claude-code',
      modelId: MODEL,
    });
    const projD = await createProject(`probe-1171-wire-d-${Date.now()}`);
    const stepD = await createTaskAndBuild(projD, agentD, 'wire D 腿', '读一个文件并汇报。');
    const termD = await waitStepTerminal(stepD.buildId, 180_000);
    check('D0 步到终态', termD.step !== null, JSON.stringify(termD.step));
    const logD = logLinesAfter(d1.logPath, offset);
    offset = logD.offset;
    save('wire-d-daemon-skills-log.txt', logD.lines.filter((l) => l.includes('[skills]')).join('\n'));
    const nativeLineD = logD.lines.find((l) => l.includes('native-plugin:') && l.includes('skill(s)'));
    check('D1 native-plugin 交付行（2 skills = 团队全量）', Boolean(nativeLineD?.includes('2 skill(s)')), nativeLineD ?? '(missing)');
    const pluginDirD = nativeLineD?.match(/→ (\S+)/)?.[1] ?? null;
    if (pluginDirD) {
      const skillDirs = readdirSync(join(pluginDirD, 'skills')).sort();
      check('D1 skills/ = marker-alpha + marker-beta（本机 local-only-1171 不混入）', skillDirs.length === 2 && skillDirs[0] === 'marker-alpha' && skillDirs[1] === 'marker-beta', JSON.stringify(skillDirs));
    }
    check('D2 零 deny 行（null = 不限制）', !logD.lines.some((l) => l.includes('[skills] deny:')), '');
    const capD = capturesAfter(capture1, capOffset);
    capOffset = capD.offset;
    save('wire-d-cli-argv.json', capD.entries);
    check('D2 argv 含 --plugin-dir（null 面同样交付）', capD.entries.some((e) => e.argv.includes('--plugin-dir')), '');
    const catalogD = logD.lines.find((l) => l.includes('[skills] catalog: entries='));
    const filteredD = logD.lines.filter((l) => l.includes('[skills] filtered:'));
    check('D3 catalog 通道照常并存（扫描 3 技能全命中 filtered 行；entries=0 = 任务文本零命中的 #1106 选择语义，非故障）', Boolean(catalogD) && filteredD.length === 3, `${catalogD ?? '(missing)'} filtered=${filteredD.length}`);
    check('D3 P3 活体演示：injected 选择零命中而 native 面照交付全量授权集', Boolean(catalogD?.includes('entries=0')) && Boolean(nativeLineD?.includes('2 skill(s)')), '');
  } finally {
    await d1.stop();
  }

  // —— daemon 2（版本 2.0.5）：腿 B 版本闸。先等 80s 僵尸 claim 窗口（#1025）。
  process.stdout.write('[wire] waiting 80s for zombie claim window before daemon 2…\n');
  await sleep(80_000);
  const home2 = '/tmp/pacman-1171-wire-home2';
  const capture2 = join(EVIDENCE, 'fake-cli-capture-2.jsonl');
  const d2 = await spawnDaemon({
    home: home2,
    name: `probe-1171-wire2-${Date.now()}`,
    apiKey: await apiKeyFor(teamId, `probe-1171-wire2-${Date.now()}`),
    teamId,
    extraEnv: {
      PACMAN_CLAUDE_BIN: fake,
      FAKE_CLAUDE_VERSION: '2.0.5',
      FAKE_CLAUDE_CAPTURE: capture2,
    },
  });
  save('wire-daemon2-version-line.txt', logLinesAfter(d2.logPath, 0).lines.filter((l) => l.includes('claude binary')).join('\n'));
  try {
    const offset0 = logOffsetOf(d2.logPath);
    const agentB = await createAgent(teamId, {
      displayName: `wire-b-${Date.now()}`,
      provider: 'claude-code',
      modelId: MODEL,
      skillsAllowlist: ['marker-alpha'],
    });
    const projB = await createProject(`probe-1171-wire-b-${Date.now()}`);
    const stepB = await createTaskAndBuild(projB, agentB, 'wire B 腿', '读一个文件并汇报。');
    const termB = await waitStepTerminal(stepB.buildId, 180_000);
    check('B0 步到终态', termB.step !== null, JSON.stringify(termB.step));
    const logB = logLinesAfter(d2.logPath, offset0);
    save('wire-b-daemon-skills-log.txt', logB.lines.filter((l) => l.includes('[skills]')).join('\n'));
    const skipLine = logB.lines.find((l) => l.includes('native-plugin: skipped'));
    check(`B1 skipped 行点名版本与下限（2.0.5 < ${MIN_VERSION}）`, Boolean(skipLine?.includes('2.0.5') && skipLine?.includes(MIN_VERSION)), skipLine ?? '(missing)');
    const capB = capturesAfter(capture2, 0);
    save('wire-b-cli-argv.json', capB.entries);
    check('B2 argv 无 --plugin-dir（版本闸 fail-closed）', capB.entries.length > 0 && !capB.entries.some((e) => e.argv.includes('--plugin-dir')), `${capB.entries.length} capture(s)`);
    check('B2 无插件目录创建', !existsSync(join(home2, 'team-skills', 'plugins')), '');
    const catalogB = logB.lines.find((l) => l.includes('[skills] catalog: entries='));
    const filteredB = logB.lines.filter((l) => l.includes('[skills] filtered:'));
    check('B3 catalog 通道照常（版本闸只关插件面；扫描 filtered 行在位 = 通道活）', Boolean(catalogB) && filteredB.length >= 1, `${catalogB ?? '(missing)'} filtered=${filteredB.length}`);
  } finally {
    await d2.stop();
  }
  return finish();
}

// —— phase: behavior（真模型腿）—————————————————————————————

async function phaseBehavior() {
  const teamId = await teamIdOf();
  ensureLocalSkill();
  await ensureTeamSkill(
    teamId,
    'haiku-native-1171',
    'Use when the task asks to write a haiku or any three-line short poem.',
    `写俳句的步骤：\n\n1. 三行，音节节奏约 5/7/5。\n2. 把俳句写入任务指定的文件。\n3. 汇报时必须复述本文件的 marker 行：${HAIKU_MARKER}`,
  );
  const agentId = await createAgent(teamId, {
    displayName: `behavior-1171-${Date.now()}`,
    provider: 'claude-code',
    modelId: MODEL,
    skillsAllowlist: ['haiku-native-1171'],
  });
  const home = '/tmp/pacman-1171-behavior-home';
  const daemon = await spawnDaemon({
    home,
    name: `probe-1171-behavior-${Date.now()}`,
    apiKey: await apiKeyFor(teamId, `probe-1171-behavior-${Date.now()}`),
    teamId,
    extraEnv: {}, // 真 claude（PATH 解析），无 PACMAN_CLAUDE_BIN
  });
  try {
    const projectId = await createProject(`probe-1171-behavior-${Date.now()}`);
    const created = Date.now() - 5000;
    const bare = findBareRepo(teamId, created);
    check('E0 hosted bare repo 定位（预植面前提）', Boolean(bare), bare ?? '(missing)');
    let seed = null;
    if (bare) seed = seedRepoSkill(bare, 'main');

    const TASK_SPEC =
      '以「深夜调试」为主题写一首三行俳句，保存到仓库根目录的 haiku.txt。' +
      '写作方法遵循你的可用技能中与写俳句相关的那一个，并在汇报里逐字复述该技能正文中的 marker 行。';
    const attempts = [];
    let landed = null;
    for (let attempt = 1; attempt <= 3 && landed === null; attempt++) {
      const { todoId, buildId } = await createTaskAndBuild(projectId, agentId, 'behavior 腿', TASK_SPEC);
      process.stdout.write(`[behavior] attempt ${attempt}: todo=${todoId} build=${buildId}\n`);
      const logOffset = existsSync(daemon.logPath) ? statSync(daemon.logPath).size : 0;
      const terminal = await waitStepTerminal(buildId, 600_000);
      attempts.push({ attempt, todoId, buildId, terminal });
      if (terminal.step?.status === 'done') landed = { todoId, buildId, logOffset };
      else process.stdout.write(`[behavior] attempt ${attempt} not done: ${JSON.stringify(terminal).slice(0, 300)}\n`);
    }
    save('behavior-attempts.json', attempts);
    check('E1 真模型步 done（≤3 次尝试）', landed !== null, landed ? `build=${landed.buildId}` : 'attempts 全失败');
    if (landed === null) return finish();
    const { todoId, buildId } = landed;

    // E2/E3 主判据：原生 Skill 工具调用 + marker 复述（不依赖 brief XML 文字）
    const msgs = messagesOf(buildId);
    save('behavior-messages.json', msgs);
    const msgsFlat = JSON.stringify(msgs);
    let skillCall = null;
    for (const m of msgs) {
      // 工具调用有两种落库形：内容块 tool_use 与段行 kind:'toolcall'
      // （ADR 0011 第五形——claude 后端的 toolcall_end 走段行帧）。
      const blocks = Array.isArray(m.content) ? m.content : [];
      for (const b of blocks) {
        if (
          b &&
          b.type === 'tool_use' &&
          b.name === 'Skill' &&
          JSON.stringify(b.input ?? {}).includes('haiku-native-1171')
        ) {
          skillCall = b;
        }
      }
      const c = m.content;
      if (
        c &&
        !Array.isArray(c) &&
        typeof c === 'object' &&
        c.kind === 'toolcall' &&
        c.call?.name === 'Skill' &&
        JSON.stringify(c.call?.arguments ?? {}).includes('haiku-native-1171')
      ) {
        skillCall = c.call;
      }
    }
    save('behavior-skill-toolcall.json', skillCall);
    check('E2 transcript 有 Skill 工具调用（原生发现面，点名 haiku-native-1171）', skillCall !== null, skillCall ? JSON.stringify(skillCall.arguments ?? skillCall.input) : '(no Skill toolcall found)');
    check('E3 transcript 复述了技能 marker 行', msgsFlat.includes(HAIKU_MARKER), '');

    // E4 日志面：native-plugin 交付行指向 plugins/ 分区
    const logAll = logLinesAfter(daemon.logPath, landed.logOffset);
    const skillLogs = logAll.lines.filter((l) => l.includes('[skills]'));
    save('behavior-daemon-skills-log.txt', skillLogs.join('\n'));
    const nativeLine = skillLogs.find((l) => l.includes('native-plugin:') && l.includes('skill(s)'));
    check('E4 daemon.log native-plugin 交付行', Boolean(nativeLine), nativeLine ?? '(missing)');
    const pluginDir = nativeLine?.match(/→ (\S+)/)?.[1] ?? null;
    if (pluginDir && existsSync(pluginDir)) {
      const skillDirs = readdirSync(join(pluginDir, 'skills'));
      save('behavior-plugin-dir.json', { pluginDir, skillDirs });
      check('E4 插件 skills/ 只含 allowed（haiku-native-1171）', skillDirs.length === 1 && skillDirs[0] === 'haiku-native-1171', JSON.stringify(skillDirs));
    } else {
      check('E4 插件目录在盘', false, pluginDir ?? '(missing line)');
    }

    // E5 收尾面：worktree git status 零残留（done 收尾 = brief 擦除 + 提交完成）
    const wt = join(home, 'workspaces', buildId);
    let porcelain = '(worktree absent)';
    if (existsSync(wt)) porcelain = git(['-C', wt, 'status', '--porcelain']);
    save('behavior-worktree-status.txt', porcelain);
    check('E5 done 收尾后 worktree git status 干净（验收 2）', porcelain === '', porcelain.slice(0, 200) || '(clean)');

    // E6 预植仓技能不被覆盖/改名（验收 3）
    if (seed && existsSync(wt)) {
      const headContent = git(['-C', wt, 'show', 'HEAD:.claude/skills/repo-native/SKILL.md']).toString();
      save('behavior-repo-skill-head.txt', headContent);
      check('E6 预植 .claude/skills/repo-native 在 HEAD 逐字节保留', headContent === seed.content, `${headContent.length}B vs ${seed.content.length}B`);
      const onDisk = existsSync(join(wt, '.claude', 'skills', 'repo-native', 'SKILL.md'));
      check('E6 预植技能目录未被改名/删除（盘上在位）', onDisk, '');
      const haiku = git(['-C', wt, 'show', 'HEAD:haiku.txt']).toString();
      save('behavior-artifact-haiku.txt', haiku);
      check('E7 产物面 HEAD:haiku.txt 在（真会话真产出）', haiku.length > 0, haiku.slice(0, 80));
    } else {
      check('E6 预植仓技能保留', false, 'seed or worktree missing');
    }
  } finally {
    await daemon.stop();
  }
  return finish();
}

if (PHASE === 'wire') {
  await phaseWire();
} else if (PHASE === 'behavior') {
  await phaseBehavior();
} else {
  process.stderr.write(`unknown --phase=${PHASE} (wire | behavior)\n`);
  process.exit(2);
}
