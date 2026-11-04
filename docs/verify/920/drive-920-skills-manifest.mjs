import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const REPO = process.env.VERIFY_REPO_ROOT ?? SCRIPT_REPO;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(REPO, '.claude', 'verify-run');
const ports = existsSync(join(RUN_DIR, 'ports.json'))
  ? JSON.parse(readFileSync(join(RUN_DIR, 'ports.json'), 'utf8'))
  : {};
const SERVER =
  process.env.SERVER ?? `http://127.0.0.1:${ports.serverPort ?? ports.server ?? 8791}`;
const SKILLS_DIR = process.env.SKILLS_DIR ?? join(RUN_DIR, 'home', 'skills');
const DB = process.env.DB ?? join(RUN_DIR, 'home', 'server', 'server.db');
const DAEMON_HOME = process.env.DAEMON_HOME ?? '/tmp/cairn-920-daemon-home';
const STUB_BASE = process.env.STUB_BASE ?? 'http://127.0.0.1:8919/v1';

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
const EXPECT = args.expect ?? 'new';
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ??
  join(SCRIPT_REPO, `.claude/verify-evidence/${ts}-920-${PHASE}`);
mkdirSync(EVIDENCE, { recursive: true });

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail: detail ?? null });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}\n`
  );
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
    probe: `drive-920-skills-manifest/${PHASE}`,
    expect: EXPECT,
    server: SERVER,
    skillsDir: SKILLS_DIR,
    db: DB,
    daemonHome: DAEMON_HOME,
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
  if (opts.raw) return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()), headers: res.headers };
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

const FAT_FILE_BYTES = 727_976;
const HEAVY_PART_BYTES = 450_000;
const WHITELIST = ['alpha', 'bin', 'fat', 'heavy'];

function skillMd(name, description) {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\n${name} 技能正文（#920 分发探针）。\n`;
}

function buildFixtureLibrary() {
  mkdirSync(SKILLS_DIR, { recursive: true });
  const w = (rel, content) => {
    const p = join(SKILLS_DIR, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  };
  w('alpha/SKILL.md', skillMd('alpha', '基础技能（#920 探针）'));
  w('alpha/notes.md', `ALPHA-NOTES-920 首版\n${'y'.repeat(1000)}\n`);
  w('beta/SKILL.md', skillMd('beta', '白名单外技能（#920 负面探针）'));
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([0x00, 0xff, 0xfe, 0xfd, 0x80, 0xd3, 0x20]),
  ]);
  w('bin/SKILL.md', skillMd('bin', '二进制资产技能（#920 探针）'));
  const pngPath = join(SKILLS_DIR, 'bin', 'assets', 'logo.png');
  mkdirSync(dirname(pngPath), { recursive: true });
  writeFileSync(pngPath, png);
  w('fat/SKILL.md', skillMd('fat', '超限资产技能（#920 根因形态）'));
  const prefix = '<!DOCTYPE html>\n<html><body>\n';
  const suffix = '\n</body></html>\n';
  w('fat/assets/template.html', `${prefix}${'x'.repeat(FAT_FILE_BYTES - prefix.length - suffix.length)}${suffix}`);
  w('heavy/SKILL.md', skillMd('heavy', '超总量技能（#920 根因形态）'));
  for (let i = 0; i < 5; i++) w(`heavy/p${i}.txt`, 'x'.repeat(HEAVY_PART_BYTES));
  return png;
}

function fixtureFiles() {

  const out = new Map();
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) out.set(relative(SKILLS_DIR, full).split(sep).join('/'), readFileSync(full));
    }
  };
  walk(SKILLS_DIR);
  return out;
}

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
      displayName: `probe-920-builder-${++uniq}`,
      provider: 'stub-gw',
      modelId: 'stub-model',
      skills: WHITELIST,
    },
  });
  const agentId = agentRes.body?.id ?? agentRes.body?.agent?.id;
  if (!agentId) throw new Error(`agent create failed: ${agentRes.status} ${JSON.stringify(agentRes.body).slice(0, 200)}`);
  const keyRes = await jfetch('POST', `/api/teams/${teamId}/api-keys`, {
    body: { name: `probe-920-${Date.now()}`, gitAccess: false, mcpAccess: false, toolGrants: { read: [], write: [] } },
  });
  const plaintext = keyRes.body?.plaintext ?? keyRes.body?.key;
  if (!plaintext) throw new Error(`api-key create failed: ${keyRes.status}`);
  const projRes = await jfetch('POST', '/api/projects', { body: { name: `probe-920-${Date.now()}` } });
  const projectId = projRes.body?.id;
  return { teamId, agentId, apiKey: plaintext, projectId };
}

async function makeTask(projectId, agentId, label) {
  const todoRes = await jfetch('POST', `/api/projects/${projectId}/todos`, {
    body: { title: `技能分发探针 ${label}`, spec: '跑一步（#920 探针任务）' },
  });
  const todoId = todoRes.body?.id;
  const buildRes = await jfetch('POST', `/api/projects/${projectId}/builds`, {
    body: { todoIds: [todoId], assignment: { plan: null, build: { agentId } }, withPlan: false },
  });
  const buildId = buildRes.body?.builds?.[0]?.id ?? buildRes.body?.buildId ?? buildRes.body?.id;
  if (!todoId || !buildId) throw new Error(`task seed failed: ${JSON.stringify(buildRes.body).slice(0, 200)}`);
  return { todoId, buildId };
}

function openDb() {
  const require2 = createRequire(join(REPO, 'apps/server/package.json'));
  const Database = require2('better-sqlite3');
  return new Database(DB, { readonly: true });
}

async function waitStepTerminal(buildId, timeoutMs = 120_000) {

  const db = openDb();
  const started = Date.now();
  try {
    for (;;) {
      const rows = db
        .prepare('SELECT id, kind, status FROM step WHERE buildId = ? ORDER BY createdAt')
        .all(buildId);
      const terminal = rows.filter((r) => ['success', 'failed', 'stopped'].includes(r.status));
      if (terminal.length > 0) {
        const build = db.prepare('SELECT id, errorMessage FROM build WHERE id = ?').get(buildId);
        return { rows, terminal: { ...terminal[terminal.length - 1], buildErrorMessage: build?.errorMessage ?? null } };
      }
      if (Date.now() - started > timeoutMs) return { rows, terminal: null };
      await new Promise((r) => setTimeout(r, 1000));
    }
  } finally {
    db.close();
  }
}

function sessionRanToCompletion(terminal) {
  return (
    terminal?.status === 'success' ||
    (terminal?.status === 'failed' && terminal?.buildErrorMessage === '构建零改动')
  );
}

function daemonLogLines() {
  const p = join(DAEMON_HOME, 'daemon.log');
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').filter(Boolean);
}

function walkTree(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else out.push(full);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

const MATERIALIZED_RE =
  /\[skills\] team: (\d+) skill\(s\), (\d+) file\(s\) materialized → (\S+) \(fetched (\d+) file\(s\) \/ (\d+) byte\(s\), reused (\d+)\)/;

async function phaseWire(pngBytes) {
  const seeded = await seed();
  const enrollRes = await jfetch('POST', '/api/machine/enroll', {
    bearer: seeded.apiKey,
    body: { teamId: seeded.teamId, name: `probe-920-wire-${Date.now()}`, cliVersion: '0.2.0' },
  });
  const token = enrollRes.body?.token;
  check('enroll 机器凭证', Boolean(token), `status=${enrollRes.status}`);
  const { todoId, buildId } = await makeTask(seeded.projectId, seeded.agentId, 'wire');
  const claimRes = await jfetch('POST', '/api/machine/tasks/claim', { bearer: token, body: {} });
  const claimed = claimRes.body?.step;
  const stepId = claimed?.step?.id;
  check('claim 到 build 步', Boolean(stepId), `todo=${todoId} build=${buildId}`);
  if (!stepId) return finish();

  const manifestRes = await jfetch('GET', `/api/machine/skills/${stepId}`, { bearer: token });
  if (EXPECT === 'old') {

    const text = typeof manifestRes.body === 'string' ? manifestRes.body : JSON.stringify(manifestRes.body);
    check('旧 server 整包端点 400（根因复现）', manifestRes.status === 400, `status=${manifestRes.status}`);
    check('400 点名旧单文件闸 512000', text.includes('512000') && text.includes('template.html'), text.slice(0, 160));
    save('manifest-old-400.json', { status: manifestRes.status, body: manifestRes.body, buildId, stepId });
    return finish();
  }

  check('清单端点 200（旧闸已撤）', manifestRes.status === 200, `status=${manifestRes.status}`);
  const manifest = manifestRes.body;
  save('manifest-new.json', { stepId, buildId, manifest });
  check('selection=whitelist', manifest?.selection === 'whitelist', JSON.stringify(manifest?.selection));
  const ids = (manifest?.skills ?? []).map((s) => s.id);
  check('白名单交集出清单（4 技能，beta 不列）', JSON.stringify(ids) === JSON.stringify([...WHITELIST].sort()), JSON.stringify(ids));

  const fatFile = manifest?.skills?.find((s) => s.id === 'fat')?.files?.find((f) => f.path === 'assets/template.html');
  check('超限文件（727,976B > 512,000）真实 size 入清单', fatFile?.sizeBytes === FAT_FILE_BYTES, JSON.stringify(fatFile));

  const totalBytes = (manifest?.skills ?? []).flatMap((s) => s.files).reduce((n, f) => n + f.sizeBytes, 0);
  check('库总量 > 旧整包闸 2,000,000 且清单完整', totalBytes > 2_000_000, `total=${totalBytes}`);
  const fileCount = (manifest?.skills ?? []).flatMap((s) => s.files).length;
  check('清单文件数 = 12（alpha2+bin2+fat2+heavy6）', fileCount === 12, `count=${fileCount}`);

  const disk = fixtureFiles();
  let shaOk = 0;
  for (const s of manifest?.skills ?? []) {
    for (const f of s.files) {
      const bytes = disk.get(`${s.dirName}/${f.path}`);
      if (bytes && bytes.byteLength === f.sizeBytes && sha256(bytes) === f.sha256) shaOk++;
    }
  }
  check('逐文件 sizeBytes/sha256 = 盘上真值', shaOk === fileCount, `${shaOk}/${fileCount}`);

  const fileResults = [];
  let filesOk = 0;
  for (const s of manifest?.skills ?? []) {
    for (const f of s.files) {
      const q = new URLSearchParams({ dirName: s.dirName, path: f.path });
      const r = await jfetch('GET', `/api/machine/skills/${stepId}/file?${q}`, { bearer: token, raw: true });
      const shaOkFile = r.status === 200 && sha256(r.bytes) === f.sha256 && r.bytes.byteLength === f.sizeBytes;
      if (shaOkFile) filesOk++;
      fileResults.push({ skill: s.dirName, path: f.path, status: r.status, sizeBytes: r.bytes.byteLength, sha256Ok: shaOkFile });
    }
  }
  save('files-verify-new.json', fileResults);
  check('file 端点 12/12 字节级校验通过', filesOk === 12, `${filesOk}/12`);
  const pngQ = new URLSearchParams({ dirName: 'bin', path: 'assets/logo.png' });
  const pngRes = await jfetch('GET', `/api/machine/skills/${stepId}/file?${pngQ}`, { bearer: token, raw: true });
  check('二进制资产逐字节诚实（非 utf8 不损坏）', pngRes.status === 200 && pngRes.bytes.equals(pngBytes), `status=${pngRes.status}`);
  check('file 响应 content-type = application/octet-stream', (pngRes.headers.get('content-type') ?? '').includes('application/octet-stream'), pngRes.headers.get('content-type'));

  const key2 = await jfetch('POST', `/api/teams/${seeded.teamId}/api-keys`, {
    body: { name: `probe-920-neg-${Date.now()}`, gitAccess: false, mcpAccess: false, toolGrants: { read: [], write: [] } },
  });
  const enroll2 = await jfetch('POST', '/api/machine/enroll', {
    bearer: key2.body?.plaintext ?? key2.body?.key,
    body: { teamId: seeded.teamId, name: `probe-920-neg-${Date.now()}`, cliVersion: '0.2.0' },
  });
  const token2 = enroll2.body?.token;
  const negatives = {};
  const neg = async (label, method, path, bearer) => {
    const r = await jfetch(method, path, { bearer });
    negatives[label] = { status: r.status, body: typeof r.body === 'string' ? r.body.slice(0, 200) : r.body };
    return r.status;
  };
  const n1 = await neg('他机凭证取清单', 'GET', `/api/machine/skills/${stepId}`, token2);
  const n2 = await neg('未知步取清单', 'GET', '/api/machine/skills/no-such-step', token);
  const n3 = await neg('他机凭证取文件', 'GET', `/api/machine/skills/${stepId}/file?dirName=alpha&path=SKILL.md`, token2);
  const n4 = await neg('白名单外技能（beta）', 'GET', `/api/machine/skills/${stepId}/file?dirName=beta&path=SKILL.md`, token);
  const n5 = await neg('逃逸 path（../alpha）', 'GET', `/api/machine/skills/${stepId}/file?dirName=fat&path=../alpha/SKILL.md`, token);
  const n6 = await neg('逃逸 dirName（../）', 'GET', `/api/machine/skills/${stepId}/file?dirName=..&path=SKILL.md`, token);
  const n7 = await neg('清单外路径（目录）', 'GET', `/api/machine/skills/${stepId}/file?dirName=fat&path=assets`, token);
  const n8 = await neg('清单外路径（未知文件）', 'GET', `/api/machine/skills/${stepId}/file?dirName=alpha&path=ghost.md`, token);
  save('negatives-new.json', negatives);
  check('负面 8 面全部 404', [n1, n2, n3, n4, n5, n6, n7, n8].every((s) => s === 404), JSON.stringify([n1, n2, n3, n4, n5, n6, n7, n8]));

  await jfetch('POST', `/api/machine/done/${stepId}`, { bearer: token, body: { status: 'failed', errorMessage: 'probe-920 wire leg released' } });
  return finish();
}

async function phaseDaemonSuccess() {
  const seeded = await seed();
  const { buildId } = await makeTask(seeded.projectId, seeded.agentId, 'daemon-success');
  const { terminal } = await waitStepTerminal(buildId);
  check('daemon 步会话完整跑完（stub LLM；产物闸「构建零改动」不算阻断）', sessionRanToCompletion(terminal), JSON.stringify(terminal));
  const lines = daemonLogLines();
  const mat = lines.map((l) => l.match(MATERIALIZED_RE)).filter(Boolean);
  check('daemon.log 出现 materialized 行', mat.length >= 1, `${mat.length} 行`);
  const m = mat[mat.length - 1];
  save('daemon-success-log.txt', lines.filter((l) => l.includes('[skills]')).join('\n'));
  if (!m) return finish();

  const loaded = lines.find((l) => l.includes('[skills] loaded:') && l.includes(join(DAEMON_HOME, 'team-skills', 'views')));
  check('catalog loaded 行指向物化视图（运行时读得到）', Boolean(loaded) && loaded.includes('loaded: 4 skills'), (loaded ?? '').slice(0, 200));
  const [, skills, files, dir, fetched, fetchedBytes, reused] = m;
  check('materialized 行计数 = 4 技能 / 12 文件', skills === '4' && files === '12', `${skills}/${files}`);

  const diskNow = fixtureFiles();
  const whitelisted = [...diskNow.entries()].filter(([rel]) => WHITELIST.includes(rel.split('/')[0]));
  const uniqShas = new Set(whitelisted.map(([, bytes]) => sha256(bytes)));
  check(
    `首拉 fetched=${uniqShas.size}（唯一内容） / reused=${whitelisted.length - uniqShas.size}（同内容去重）`,
    Number(fetched) === uniqShas.size && Number(reused) === whitelisted.length - uniqShas.size,
    `fetched=${fetched} reused=${reused}`,
  );
  const viewDir = dir;
  check('视图目录在 daemon home team-skills/views 下', viewDir.startsWith(join(DAEMON_HOME, 'team-skills', 'views')), viewDir);
  const tree = walkTree(viewDir);
  check('落盘文件数与清单一致（12）', tree.length === 12, `tree=${tree.length}`);
  const disk = fixtureFiles();
  let match = 0;
  const perFile = [];
  for (const p of tree) {
    const rel = relative(viewDir, p).split(sep).join('/');
    const want = disk.get(rel);
    const got = readFileSync(p);
    const ok = Boolean(want) && got.equals(want);
    if (ok) match++;
    perFile.push({ path: rel, bytes: got.byteLength, sha256: sha256(got), bytesIdenticalToServer: ok });
  }
  save('daemon-success-files.json', { viewDir, perFile });
  check('落盘内容逐字节 = server 侧真值（12/12）', match === 12, `${match}/12}`);
  const skillMdText = readFileSync(join(viewDir, 'alpha', 'SKILL.md'), 'utf8');
  check('运行时可读：alpha/SKILL.md frontmatter 完整', skillMdText.startsWith('---\nname: alpha'), skillMdText.slice(0, 40));
  const blobs = readdirSync(join(DAEMON_HOME, 'team-skills', 'blobs')).filter((e) => !e.startsWith('.tmp-'));
  check('blobs 内容库 = 唯一内容数（文件级内容寻址去重）', blobs.length === uniqShas.size, `blobs=${blobs.length} uniq=${uniqShas.size}`);
  save('daemon-success-bytes.json', { fetchedBytes: Number(fetchedBytes) });
  return finish();
}

async function phaseDaemonIncremental() {
  const before = daemonLogLines().filter((l) => MATERIALIZED_RE.test(l)).length;

  const notesPath = join(SKILLS_DIR, 'alpha', 'notes.md');
  const notesBefore = readFileSync(notesPath);
  appendFileSync(notesPath, '\nINCREMENTAL-920 第二版增补行\n');
  const notesAfter = readFileSync(notesPath);
  const seeded = await seed();
  const { buildId } = await makeTask(seeded.projectId, seeded.agentId, 'daemon-incremental');
  const { terminal } = await waitStepTerminal(buildId);
  check('增量步会话完整跑完', sessionRanToCompletion(terminal), JSON.stringify(terminal));
  const lines = daemonLogLines();
  const mat = lines.map((l) => l.match(MATERIALIZED_RE)).filter(Boolean);
  check('新增 materialized 行', mat.length > before, `${before} → ${mat.length}`);
  const m = mat[mat.length - 1];
  save('daemon-incremental-log.txt', lines.filter((l) => l.includes('[skills]')).join('\n'));
  if (!m) return finish();
  const [, skills, files, dir, fetched, fetchedBytes, reused] = m;
  check('增量：fetched=1（只传变化文件）', fetched === '1', `fetched=${fetched}`);
  check('增量：reused=11（其余命中 blobs 零传输）', reused === '11', `reused=${reused}`);
  check('增量传输字节 = 变化文件的新尺寸', Number(fetchedBytes) === notesAfter.byteLength, `fetchedBytes=${fetchedBytes} notes=${notesAfter.byteLength}（改前 ${notesBefore.byteLength}）`);
  check('新视图目录（清单 digest 变化）', existsSync(join(dir, 'alpha', 'notes.md')), dir);
  check('新视图内容 = 第二版', readFileSync(join(dir, 'alpha', 'notes.md'), 'utf8').includes('INCREMENTAL-920 第二版增补行'));
  return finish();
}

async function phaseDaemonFail() {
  const seeded = await seed();
  const { buildId } = await makeTask(seeded.projectId, seeded.agentId, 'daemon-fail');
  const { terminal } = await waitStepTerminal(buildId);
  check('旧 server 400 → 步按 failed 收尾（不再静默降级）', terminal?.status === 'failed', JSON.stringify(terminal));
  const msg = terminal?.buildErrorMessage ?? '';
  check('errorMessage 点名 team skills 分发失败', msg.includes('team skills distribution failed'), msg.slice(0, 200));
  check('errorMessage 带旧闸根因（skill file too large / 512000）', msg.includes('skill file too large') && msg.includes('512000'), msg.slice(0, 200));
  const lines = daemonLogLines();
  save('daemon-fail-log.txt', lines.filter((l) => l.includes('[skills]') || l.includes('failed')).join('\n'));
  check('daemon.log 出现 team-skills-failed 行', lines.some((l) => l.includes('[skills] team-skills-failed:') && l.includes('machine api 400')));
  check('零物化（无 materialized 行）', !lines.some((l) => MATERIALIZED_RE.test(l)));
  check('[step] failed 根因直报行（failStep 路径）', lines.some((l) => l.includes('[step] failed: team skills distribution failed')));
  const db = openDb();
  try {
    const stepRow = db.prepare('SELECT id, status FROM step WHERE id = ?').get(terminal?.id);
    const buildRow = db.prepare('SELECT id, errorMessage FROM build WHERE id = ?').get(buildId);
    save('daemon-fail-step-row.json', { step: stepRow, build: buildRow });
    check('SQLite step/build 行 = failed + 根因在库（UI 可观测）', stepRow?.status === 'failed' && (buildRow?.errorMessage ?? '').includes('team skills distribution failed'));
  } finally {
    db.close();
  }
  return finish();
}

const pngBytes = buildFixtureLibrary();
check('fixture 技能库落盘（5 技能 / 13 文件）', statSync(join(SKILLS_DIR, 'fat', 'assets', 'template.html')).size === FAT_FILE_BYTES, SKILLS_DIR);
if (PHASE === 'wire') await phaseWire(pngBytes);
else if (PHASE === 'daemon-success') await phaseDaemonSuccess();
else if (PHASE === 'daemon-incremental') await phaseDaemonIncremental();
else if (PHASE === 'daemon-fail') await phaseDaemonFail();
else {
  process.stderr.write(`unknown phase: ${PHASE}\n`);
  process.exit(2);
}
