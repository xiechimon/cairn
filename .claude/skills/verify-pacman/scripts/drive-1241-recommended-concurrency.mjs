// verify-pacman 定制 probe（#1241 机器推荐并发）：真 daemon 上报真实核数/内存，
// 服务端算推荐值落机器行，机器页并发控件呈现「推荐 / 手动 / 估算」三态与依据弹层。
// 同一脚本两相位：--expect=new 打本分支栈（五断言族）；--expect=old 打 origin/main
// 基线栈（只取 before 读数：固定默认 3、无来源标注、API 无推荐字段）。
// 断言面（new）：#1241 设计 A 起行内触发面只有 数值 + chevron，来源词不上屏
// ——来源语义的判别面 = 触发钮 aria-label（「并发上限 N，来源」）+ 钮自身的
// data-concurrency-source 载体 + 弹层来源行。
//   A 推荐态：真 daemon 指纹上报后，触发钮 data-concurrency-source=measured、
//     aria-label 带「推荐」，API recommendedConcurrent = 公式(os 实测核数/内存)，
//     硬件字段与 os 值逐项相等。
//   B 依据：弹层「推荐 R」行 + 核数/总内存/负载 标签行，N/X 与 os 一致（总内存，非可用内存）。
//   C 手动：UI 选 4 → aria-label 带「手动」、API/SQLite maxConcurrent=4 overridden=1 source=manual，
//     推荐值仍为公式值；等一个心跳周期（30s）后仍为 4（心跳不覆盖用户值）。
//   D 恢复推荐：UI 点「恢复推荐」→ aria-label 带「推荐」、回到公式值、overridden=0（API+SQLite）。
//   E 估算：无指纹假机器（enroll + 只带 cliVersion 的心跳）→「估算」、值 3、依据「保守默认 3」，
//     API capabilities 缺失、recommendedConcurrent=3。
// 失败方式清单（先固化判别面）：
//   1. 公式漂移（如 floor 换 ceil、内存口径错）→ A2 红；
//   2. 依据吃可用内存（旧口径）→ B1 显示的 GiB 与总内存不符；
//   3. 心跳覆盖手动值 → C4 红（30s 后 maxConcurrent 回到 7）；
//   4. 恢复推荐后 overridden 残留 → D2/D3 红（来源仍为手动）；
//   5. 无指纹机被说成推荐 → E1 红（来源 measured）。
// 用法（栈须先 launch；--expect=old 时 VERIFY_REPO_ROOT 指向 origin/main 基线树）：
//   node drive-1241-recommended-concurrency.mjs --expect=new|old
// env：VERIFY_REPO_ROOT / VERIFY_RUN_DIR / VERIFY_EVIDENCE_DIR、
//      DAEMON_HOME（缺省 /tmp/pacman-1241-<expect>-daemon-home）。
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { cpus, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const EXPECT = process.argv.includes('--expect=old') ? 'old' : 'new';
const SCRIPT_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const REPO = process.env.VERIFY_REPO_ROOT ?? SCRIPT_REPO;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(REPO, '.claude', 'verify-run');
const stack = JSON.parse(readFileSync(join(RUN_DIR, 'ports.json'), 'utf8'));
const SERVER = `http://127.0.0.1:${stack.serverPort}`;
const WEB = `http://127.0.0.1:${stack.webPort}`;
const DB = join(stack.homeDir, 'server', 'server.db');
const DAEMON_HOME = process.env.DAEMON_HOME ?? `/tmp/pacman-1241-${EXPECT}-daemon-home`;
const REAL_NAME = 'verify-1241-real';
const EST_NAME = 'verify-1241-estimate';
const HEARTBEAT_WAIT_MS = 35_000;

const ts = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE = process.env.VERIFY_EVIDENCE_DIR ?? join(SCRIPT_REPO, `.claude/verify-evidence/${ts}-1241-${EXPECT}`);
mkdirSync(EVIDENCE, { recursive: true });

// 公式与服务端同源口径：每槽 2 GiB 总内存，夹到 1..16（ADR 0020）。
function formula(cores, memoryTotalMb) {
  const byMemory = Math.floor(memoryTotalMb / (1024 * 2));
  return Math.min(16, Math.max(1, Math.min(cores, byMemory)));
}
const OS_CORES = cpus().length;
const OS_MEM_MB = Math.floor(totalmem() / (1024 * 1024));
const EXPECTED_RECOMMENDED = formula(OS_CORES, OS_MEM_MB);

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail: detail ?? null });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}\n`);
}
function save(name, data) {
  writeFileSync(join(EVIDENCE, name), typeof data === 'string' ? data : `${JSON.stringify(data, null, 2)}\n`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 弹层入场是 zoom/opacity 动画：截图前等动画落定，否则底层行透出、像素不可判读。
const settle = (page) =>
  page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));

async function jfetch(method, path, { body, token } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(SERVER + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

async function waitFor(label, fn, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await sleep(500);
  }
  throw new Error(`timeout waiting for ${label}`);
}

// —— daemon / 假机器 ——————————————————————————————————————————

function spawnDaemon(apiKey, teamId) {
  const env = { ...process.env };
  for (const k of ['http_proxy', 'https_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']) delete env[k];
  env.NO_PROXY = '*';
  env.PACMAN_HOME = DAEMON_HOME;
  const out = join(EVIDENCE, 'daemon-console.log');
  writeFileSync(out, '');
  const child = spawn(
    'pnpm',
    ['exec', 'tsx', 'src/cli.ts', 'start', '--foreground', '--server', SERVER, '--api-key', apiKey, '--team', teamId, '--name', REAL_NAME],
    { cwd: join(REPO, 'apps/daemon'), env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  child.stdout.on('data', (d) => appendFileSync(out, d));
  child.stderr.on('data', (d) => appendFileSync(out, d));
  child.on('exit', (code) => appendFileSync(out, `\n[probe] daemon exited code=${code}\n`));
  return child;
}

function daemonOnline() {
  const p = join(DAEMON_HOME, 'daemon.log');
  return existsSync(p) && readFileSync(p, 'utf8').includes('Online (machineId=');
}

async function newApiKey(teamId, name) {
  const res = await jfetch('POST', `/api/teams/${teamId}/api-keys`, {
    body: { name, gitAccess: false, mcpAccess: false, toolGrants: { read: [], write: [] } },
  });
  const plain = res.body?.plaintext ?? res.body?.record?.plaintext ?? res.body?.key ?? res.body?.token;
  if (!plain) throw new Error(`api-key create failed: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
  return plain;
}

// 假机器：enroll 不带能力清单，随后一拍只带 cliVersion 的心跳——「缺指纹」态的真 wire 形。
async function enrollBlankMachine(teamId, name) {
  const key = await newApiKey(teamId, `enroll-${name}`);
  const res = await jfetch('POST', '/api/machine/enroll', { token: key, body: { teamId, name, cliVersion: '0.1.0' } });
  const token = res.body?.token ?? res.body?.machine?.token;
  if (res.status !== 200 || !token) throw new Error(`enroll ${name} → ${res.status}`);
  const beat = await jfetch('POST', '/api/machine/presence', { token, body: { cliVersion: '0.1.0' } });
  if (beat.status !== 200) throw new Error(`presence ${name} → ${beat.status}`);
  return token;
}

// —— 读面：API 与 SQLite 双真值 ——————————————————————————————————

const require = createRequire(join(REPO, 'apps/server/package.json'));
const Database = require('better-sqlite3');

async function readMachines(teamId) {
  const res = await jfetch('GET', `/api/teams/${teamId}/machines`);
  return Array.isArray(res.body) ? res.body : res.body?.machines ?? [];
}

function readDbMachines() {
  const db = new Database(DB, { readonly: true });
  try {
    return db.prepare('SELECT * FROM machine ORDER BY name').all().map((row) => ({
      ...row,
      capabilities: row.capabilities == null ? null : JSON.parse(row.capabilities),
    }));
  } finally {
    db.close();
  }
}

async function snapshot(stage, teamId) {
  const api = await readMachines(teamId);
  const db = readDbMachines();
  save(`api-machines-${stage}.json`, api);
  save(`db-machine-${stage}.json`, db);
  return { api, db };
}

const byName = (rows, name) => rows.find((r) => r.name === name);

// —— 浏览器面 ————————————————————————————————————————————————

const triggerFor = (page, id) => page.locator(`button[aria-label^="并发上限"][data-machine-id="${id}"]`);
const labelOf = async (page, id) => (await triggerFor(page, id).getAttribute('aria-label')) ?? '';

// ============ 主流程 ============================================================

const teams = await jfetch('GET', '/api/teams');
const teamId = teams.body?.[0]?.id ?? teams.body?.teams?.[0]?.id;
if (!teamId) throw new Error(`no team: ${JSON.stringify(teams.body).slice(0, 200)}`);

rmSync(DAEMON_HOME, { recursive: true, force: true });
const daemonKey = await newApiKey(teamId, `daemon-1241-${EXPECT}`);
const daemon = spawnDaemon(daemonKey, teamId);

let browser;
try {
  await waitFor('daemon online', daemonOnline, 90_000);
  const realRow = await waitFor('real machine row', async () => {
    const rows = await readMachines(teamId);
    const row = rows.find((r) => r.name === REAL_NAME);
    if (!row) return null;
    if (EXPECT === 'new' && !row.capabilities?.hardware) return null;
    return row;
  }, 60_000);
  const realId = realRow.id;

  await enrollBlankMachine(teamId, EST_NAME);
  const estRow = await waitFor('estimate machine row', async () => {
    const rows = await readMachines(teamId);
    return byName(rows, EST_NAME) ?? null;
  });
  const estId = estRow.id;

  const t0 = await snapshot('t0', teamId);

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 732 } });
  await page.goto(`${WEB}/app/resources/machines`);
  await triggerFor(page, realId).waitFor({ timeout: 30_000 });
  await triggerFor(page, estId).waitFor({ timeout: 30_000 });

  if (EXPECT === 'old') {
    // 基线：origin/main 无来源标注、固定默认 3、API 无推荐字段。
    const realText = (await triggerFor(page, realId).textContent()) ?? '';
    const estText = (await triggerFor(page, estId).textContent()) ?? '';
    const realApi = byName(t0.api, REAL_NAME);
    check(
      'O1 before：真机器控件值为固定默认 3，无推荐/手动/估算标注',
      realText.includes('3') && !/推荐|手动|估算/.test(realText),
      `text=${realText.replace(/\s+/g, ' ').trim()}`,
    );
    check(
      'O2 before：估算机同样固定 3、无标注（无指纹与有指纹不可区分）',
      estText.includes('3') && !/推荐|手动|估算/.test(estText),
      `text=${estText.replace(/\s+/g, ' ').trim()}`,
    );
    check(
      'O3 before：API 无 recommendedConcurrent / concurrencySource 字段',
      realApi && realApi.recommendedConcurrent === undefined && realApi.concurrencySource === undefined,
      `keys=${Object.keys(realApi ?? {}).filter((k) => /concurr|recommend/i.test(k)).join(',') || '(none)'}`,
    );
    await triggerFor(page, realId).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(EVIDENCE, '00-before-machines-page.png') });
  } else {
    const realApi0 = byName(t0.api, REAL_NAME);
    const hw = realApi0.capabilities?.hardware ?? {};

    // —— A 推荐态 ——
    await expectAttr(page, realId, 'measured', 'A0');
    const a1Label = await labelOf(page, realId);
    check(
      'A1 真 daemon 指纹上报后触发钮 aria-label 标「推荐」（measured）',
      a1Label.includes('推荐') && a1Label.includes(String(EXPECTED_RECOMMENDED)),
      `aria-label=${a1Label}`,
    );
    const realTextNew = ((await triggerFor(page, realId).textContent()) ?? '').replace(/\s+/g, ' ').trim();
    check(
      'A1b 行内可见面 = 仅数值（#1241 设计 A：无「并发」标签词、无来源词，语义走 aria-label）',
      realTextNew === String(EXPECTED_RECOMMENDED) && !/并发|推荐|手动|估算/.test(realTextNew),
      `text=${realTextNew}`,
    );
    check(
      'A2 API recommendedConcurrent = 公式(os 核数, os 总内存)',
      realApi0.recommendedConcurrent === EXPECTED_RECOMMENDED,
      `api=${realApi0.recommendedConcurrent} formula=min(${OS_CORES}, floor(${OS_MEM_MB}/2048))→${EXPECTED_RECOMMENDED}`,
    );
    check(
      'A3 daemon 上报核数 = os.cpus().length',
      hw.cpuCores === OS_CORES,
      `daemon=${hw.cpuCores} os=${OS_CORES}`,
    );
    check(
      'A4 daemon 上报总内存 = floor(os.totalmem()/MiB)',
      hw.memoryTotalMb === OS_MEM_MB,
      `daemon=${hw.memoryTotalMb} os=${OS_MEM_MB}`,
    );
    check(
      'A5 初始态未覆盖：overridden=false，maxConcurrent 跟随推荐值',
      realApi0.maxConcurrentOverridden === false && realApi0.maxConcurrent === EXPECTED_RECOMMENDED,
      `overridden=${realApi0.maxConcurrentOverridden} maxConcurrent=${realApi0.maxConcurrent}`,
    );
    await triggerFor(page, realId).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(EVIDENCE, '01-recommended-tag.png') });

    // —— B 依据弹层 ——
    await triggerFor(page, realId).click();
    const basis = page.getByTestId('machine-concurrency-basis');
    await basis.waitFor({ timeout: 10_000 });
    await settle(page);
    const basisText = ((await basis.textContent()) ?? '').replace(/\s+/g, ' ').trim();
    const gib = (OS_MEM_MB / 1024).toFixed(1);
    check(
      'B1 依据弹层：推荐值与核数/总内存/负载行与 os 一致（总内存口径，非可用内存）',
      basisText.includes(`推荐${EXPECTED_RECOMMENDED}`) &&
        basisText.includes(`核数${OS_CORES}`) &&
        basisText.includes(`总内存${gib} GiB`) &&
        /负载\d+\.\d{2}/.test(basisText),
      `text=${basisText}`,
    );
    await page.screenshot({ path: join(EVIDENCE, '02-basis-popover.png') });
    await page.keyboard.press('Escape');
    await basis.waitFor({ state: 'hidden', timeout: 10_000 });

    // —— C 手动覆盖 ——
    await triggerFor(page, realId).click();
    await page.getByTestId('machine-concurrency-option').filter({ hasText: /^4$/ }).click();
    await expectAttr(page, realId, 'manual', 'C0');
    const c1Label = await labelOf(page, realId);
    check(
      'C1 选数即 aria-label 标「手动」（UI）',
      c1Label.includes('手动') && c1Label.includes('4'),
      `aria-label=${c1Label}`,
    );
    const t1 = await snapshot('after-manual', teamId);
    const apiC = byName(t1.api, REAL_NAME);
    const dbC = byName(t1.db, REAL_NAME);
    check(
      'C2 API：maxConcurrent=4、overridden=true、推荐值仍为公式值',
      apiC.maxConcurrent === 4 && apiC.maxConcurrentOverridden === true && apiC.recommendedConcurrent === EXPECTED_RECOMMENDED,
      `maxConcurrent=${apiC.maxConcurrent} overridden=${apiC.maxConcurrentOverridden} recommended=${apiC.recommendedConcurrent}`,
    );
    check(
      'C3 SQLite 行：maxConcurrent=4、maxConcurrentOverridden=1',
      dbC.maxConcurrent === 4 && dbC.maxConcurrentOverridden === 1,
      `maxConcurrent=${dbC.maxConcurrent} overridden=${dbC.maxConcurrentOverridden}`,
    );
    await triggerFor(page, realId).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(EVIDENCE, '03-manual-override.png') });

    // 等一个心跳周期（30s）+ 余量：心跳带着指纹回来，覆盖值不得被改回推荐值。
    const seenBefore = dbC.lastSeenAt;
    await sleep(HEARTBEAT_WAIT_MS);
    const t2 = await snapshot('after-heartbeat', teamId);
    const dbC2 = byName(t2.db, REAL_NAME);
    const apiC2 = byName(t2.api, REAL_NAME);
    check(
      'C4 心跳后覆盖值保持：maxConcurrent 仍为 4（心跳已到达：lastSeenAt 前进）',
      apiC2.maxConcurrent === 4 && apiC2.maxConcurrentOverridden === true && dbC2.lastSeenAt > seenBefore,
      `maxConcurrent=${apiC2.maxConcurrent} lastSeenAt ${seenBefore}→${dbC2.lastSeenAt}`,
    );

    // —— D 恢复推荐 ——
    await triggerFor(page, realId).click();
    await page.getByTestId('machine-concurrency-reset').waitFor({ timeout: 10_000 });
    await settle(page);
    await page.screenshot({ path: join(EVIDENCE, '03b-manual-popover-reset.png') });
    await page.getByTestId('machine-concurrency-reset').click();
    await expectAttr(page, realId, 'measured', 'D0');
    const d1Label = await labelOf(page, realId);
    check(
      'D1 恢复推荐后 aria-label 标「推荐」，值回到公式值（UI）',
      d1Label.includes('推荐') && d1Label.includes(String(EXPECTED_RECOMMENDED)),
      `aria-label=${d1Label}`,
    );
    const t3 = await snapshot('after-reset', teamId);
    const apiD = byName(t3.api, REAL_NAME);
    const dbD = byName(t3.db, REAL_NAME);
    check(
      'D2 API：overridden=false、maxConcurrent 回到公式值',
      apiD.maxConcurrentOverridden === false && apiD.maxConcurrent === EXPECTED_RECOMMENDED,
      `overridden=${apiD.maxConcurrentOverridden} maxConcurrent=${apiD.maxConcurrent}`,
    );
    check(
      'D3 SQLite 行：maxConcurrentOverridden=0、maxConcurrent 回到公式值',
      dbD.maxConcurrentOverridden === 0 && dbD.maxConcurrent === EXPECTED_RECOMMENDED,
      `overridden=${dbD.maxConcurrentOverridden} maxConcurrent=${dbD.maxConcurrent}`,
    );
    await triggerFor(page, realId).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(EVIDENCE, '04-after-reset.png') });

    // —— E 估算（无指纹机）——
    await triggerFor(page, estId).waitFor({ timeout: 10_000 });
    await expectAttr(page, estId, 'estimate', 'E0');
    const estApi = byName(t3.api, EST_NAME);
    const estDb = byName(t3.db, EST_NAME);
    check(
      'E2 无指纹机：API 无 capabilities、recommendedConcurrent=3、maxConcurrent=3',
      estApi.capabilities == null && estApi.recommendedConcurrent === 3 && estApi.maxConcurrent === 3,
      `capabilities=${JSON.stringify(estApi.capabilities)} recommended=${estApi.recommendedConcurrent} maxConcurrent=${estApi.maxConcurrent}`,
    );
    check(
      'E3 SQLite 行：capabilities 为 NULL，未覆盖',
      estDb.capabilities === null && estDb.maxConcurrentOverridden === 0,
      `capabilities=${JSON.stringify(estDb.capabilities)} overridden=${estDb.maxConcurrentOverridden}`,
    );
    await triggerFor(page, estId).click();
    const estBasis = page.getByTestId('machine-concurrency-basis');
    await estBasis.waitFor({ timeout: 10_000 });
    await settle(page);
    const estBasisText = ((await estBasis.textContent()) ?? '').replace(/\s+/g, ' ').trim();
    check(
      'E4 估算依据：「未收到能力指纹，按保守默认 3 估算」',
      estBasisText.includes('未收到能力指纹，按保守默认 3 估算'),
      `text=${estBasisText}`,
    );
    await page.screenshot({ path: join(EVIDENCE, '05-estimate-basis.png') });
    await page.keyboard.press('Escape');
  }
} catch (err) {
  check('probe completed without exception', false, String(err?.message ?? err));
} finally {
  await browser?.close();
  daemon.kill('SIGTERM');
  await sleep(1500);
  const passed = checks.filter((c) => c.ok).length;
  save('result.json', {
    probe: 'drive-1241-recommended-concurrency',
    expect: EXPECT,
    server: SERVER,
    web: WEB,
    host: { cpuCores: OS_CORES, memoryTotalMb: OS_MEM_MB, expectedRecommended: EXPECTED_RECOMMENDED },
    passed,
    total: checks.length,
    checks,
  });
  process.stdout.write(`\n${passed}/${checks.length} checks passed — evidence ${EVIDENCE}\n`);
  process.exit(passed === checks.length ? 0 : 1);
}

async function expectAttr(page, id, want, label) {
  const deadline = Date.now() + 15_000;
  let got = null;
  while (Date.now() < deadline) {
    got = await triggerFor(page, id).getAttribute('data-concurrency-source').catch(() => null);
    if (got === want) break;
    await sleep(250);
  }
  check(`${label} data-concurrency-source = ${want}`, got === want, `got ${got}`);
}
