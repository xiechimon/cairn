// #1241 backfill real-env verify: main-seeded DB → branch server (0043 + startup backfill).
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const OUT = process.argv[2];
const HOME = '/tmp/bf-1241-home';
const PORT = 8801, WEBPORT = 5281 + 10;
const MAIN = '/tmp/wt-1241-before', BR = '/workspace/wt-1241';
const S = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function j(method, path, { token, body } = {}) {
  const r = await fetch(S + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let b = null; try { b = await r.json(); } catch {}
  return { status: r.status, body: b };
}
function server(root, log) {
  return spawn('pnpm', ['exec', 'tsx', 'src/index.ts'], { cwd: join(root, 'apps/server'), env: { ...process.env, PORT: String(PORT), PACMAN_HOME: HOME, PACMAN_SKILLS_DIR: join(HOME, 'skills') }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    .on('exit', () => {}), log;
}
async function up() { for (let i = 0; i < 120; i++) { try { const r = await fetch(S + '/api/auth/session'); if (r.ok) return; } catch {} await sleep(500); } throw new Error('server not up'); }
async function down(p) { try { process.kill(-p.pid, 'SIGTERM'); } catch {} for (let i = 0; i < 40; i++) { try { await fetch(S + '/api/auth/session'); } catch { return; } await sleep(250); } }
const pick = (rows) => rows.filter((r) => r.name.startsWith('bf-')).map(({ name, maxConcurrent, maxConcurrentOverridden, recommendedConcurrent, concurrencySource }) => ({ name, maxConcurrent, maxConcurrentOverridden, recommendedConcurrent, concurrencySource }));

rmSync(HOME, { recursive: true, force: true }); mkdirSync(join(HOME, 'skills'), { recursive: true });
// 1) main server, seed machines
let p = spawn('pnpm', ['exec', 'tsx', 'src/index.ts'], { cwd: join(MAIN, 'apps/server'), env: { ...process.env, PORT: String(PORT), PACMAN_HOME: HOME, PACMAN_SKILLS_DIR: join(HOME, 'skills') }, detached: true, stdio: 'ignore' });
await up();
const teams = await j('GET', '/api/teams'); const teamId = teams.body?.[0]?.id ?? teams.body?.teams?.[0]?.id;
const ids = {};
for (const name of ['bf-legacy-fingerprinted', 'bf-legacy-blank', 'bf-manual-5']) {
  const k = await j('POST', `/api/teams/${teamId}/api-keys`, { body: { name: `k-${name}`, gitAccess: false, mcpAccess: false, toolGrants: { read: [], write: [] } } });
  const key = k.body?.plaintext ?? k.body?.record?.plaintext ?? k.body?.key ?? k.body?.token;
  const e = await j('POST', '/api/machine/enroll', { token: key, body: { teamId, name, cliVersion: '0.1.0' } });
  if (e.status !== 200) throw new Error('enroll ' + e.status);
}
let rows = (await j('GET', `/api/teams/${teamId}/machines`)).body;
rows = Array.isArray(rows) ? rows : rows.machines;
for (const r of rows) ids[r.name] = r.id;
const pt = await j('PATCH', `/api/machines/${ids['bf-manual-5']}`, { body: { maxConcurrent: 5 } });
let before = (await j('GET', `/api/teams/${teamId}/machines`)).body; before = Array.isArray(before) ? before : before.machines;
writeFileSync(join(OUT, 'api-before-main.json'), JSON.stringify({ patchStatus: pt.status, machines: pick(before) }, null, 2));
await down(p);
// 2) simulate a stored hardware fingerprint on one legacy row (main never stored hardware; a current daemon's first beat would)
const db = join(HOME, 'server', 'server.db');
execFileSync('node', ['-e', `const D=require('better-sqlite3');const d=new D(${JSON.stringify(db)});d.prepare("UPDATE machine SET capabilities=? WHERE name='bf-legacy-fingerprinted'").run(JSON.stringify({mcpServers:[],skills:[],hardware:{cpuCores:12,memoryTotalMb:36864,memoryAvailableMb:20480,loadAvg1:0.5,diskFreeMb:102400}}));`], { cwd: join(BR, 'apps/server') });
// 3) branch server on same DB (migration 0043 + startup backfill), twice for idempotency
const snap = async (tag) => { let a = (await j('GET', `/api/teams/${teamId}/machines`)).body; a = Array.isArray(a) ? a : a.machines; writeFileSync(join(OUT, `api-after-${tag}.json`), JSON.stringify(pick(a), null, 2)); return pick(a); };
p = spawn('pnpm', ['exec', 'tsx', 'src/index.ts'], { cwd: join(BR, 'apps/server'), env: { ...process.env, PORT: String(PORT), PACMAN_HOME: HOME, PACMAN_SKILLS_DIR: join(HOME, 'skills') }, detached: true, stdio: 'ignore' });
await up();
const after1 = await snap('branch-start1');
// screenshot via vite
const web = spawn('node', [join('node_modules', 'vite', 'bin', 'vite.js'), '--port', String(WEBPORT), '--strictPort', '--host', '127.0.0.1'], { cwd: join(BR, 'apps/web'), env: { ...process.env, PACMAN_DEV_SERVER_PORT: String(PORT) }, detached: true, stdio: 'ignore' });
const { createRequire } = await import('node:module'); const { chromium } = createRequire(join(BR, '.claude/skills/verify-pacman/scripts/x.mjs'))('@playwright/test');
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${WEBPORT}/app`)).ok) break; } catch {} await sleep(500); }
const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1440, height: 732 } });
await pg.goto(`http://127.0.0.1:${WEBPORT}/app/resources/machines`); await pg.locator('[data-machine-id]').first().waitFor(); await sleep(1500);
await pg.screenshot({ path: join(OUT, '01-after-backfill-rows.png') });
const fpId = ids['bf-legacy-fingerprinted'];
await pg.locator(`button[aria-label^="并发上限"][data-machine-id="${fpId}"]`).click(); await sleep(600);
await pg.screenshot({ path: join(OUT, '02-backfilled-popover.png') });
await b.close(); try { process.kill(-web.pid, 'SIGTERM'); } catch {}
await down(p);
p = spawn('pnpm', ['exec', 'tsx', 'src/index.ts'], { cwd: join(BR, 'apps/server'), env: { ...process.env, PORT: String(PORT), PACMAN_HOME: HOME, PACMAN_SKILLS_DIR: join(HOME, 'skills') }, detached: true, stdio: 'ignore' });
await up();
const after2 = await snap('branch-start2');
await down(p);
console.log(JSON.stringify({ before: pick(before), after1, idempotent: JSON.stringify(after1) === JSON.stringify(after2) }, null, 1));
