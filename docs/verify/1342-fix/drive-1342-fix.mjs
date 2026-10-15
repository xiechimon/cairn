// #1342 Bugbot fix real-env probe: counts PATCH /api/machines/* requests from the browser.
// Usage (repo root, stack from verify-pacman launch.mjs): node docs/verify/1342-fix/drive-1342-fix.mjs <outDir>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const { chromium } = createRequire(join(ROOT, '.claude/skills/verify-pacman/scripts/x.mjs'))('@playwright/test');
const OUT = process.argv[2]; mkdirSync(OUT, { recursive: true });
const stack = JSON.parse(readFileSync(join(process.env.VERIFY_RUN_DIR, 'ports.json'), 'utf8'));
const S = `http://127.0.0.1:${stack.serverPort}`, W = `http://127.0.0.1:${stack.webPort}`;
const results = []; const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  — ${detail}`); };
async function j(method, path, { token, body } = {}) {
  const r = await fetch(S + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let b = null; try { b = await r.json(); } catch {} return { status: r.status, body: b };
}
const teamId = (await j('GET', '/api/teams')).body[0].id;
async function enroll(name, caps) {
  const k = await j('POST', `/api/teams/${teamId}/api-keys`, { body: { name: `k-${name}`, gitAccess: false, mcpAccess: false, toolGrants: { read: [], write: [] } } });
  const key = k.body?.plaintext ?? k.body?.record?.plaintext ?? k.body?.key ?? k.body?.token;
  const e = await j('POST', '/api/machine/enroll', { token: key, body: { teamId, name, cliVersion: '0.1.0', capabilities: caps } });
  return e.body?.machine?.id ?? e.body?.machineId;
}
const machines = async () => { const b = (await j('GET', `/api/teams/${teamId}/machines`)).body; return Array.isArray(b) ? b : b.machines; };
const HW = { cpuCores: 12, memoryTotalMb: 36864, memoryAvailableMb: 20480, loadAvg1: 0.5, diskFreeMb: 102400 };
await enroll('fix-manual', { mcpServers: [], skills: [], hardware: HW });
await enroll('fix-out-of-range', { mcpServers: [], skills: [] });
const id = async (n) => (await machines()).find((m) => m.name === n).id;
const manualId = await id('fix-manual'), oorId = await id('fix-out-of-range');
await j('PATCH', `/api/machines/${manualId}`, { body: { maxConcurrent: 5 } });
await j('PATCH', `/api/machines/${oorId}`, { body: { maxConcurrent: 12 } });
const snap = async (tag) => { const rows = (await machines()).filter((m) => m.name.startsWith('fix-')).map(({ name, maxConcurrent, maxConcurrentOverridden, concurrencySource, concurrencyRange }) => ({ name, maxConcurrent, maxConcurrentOverridden, concurrencySource, concurrencyRange })); writeFileSync(join(OUT, `api-${tag}.json`), JSON.stringify(rows, null, 2)); return rows; };
await snap('t0');

const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1440, height: 732 } });
const patches = []; page.on('request', (r) => { if (r.method() === 'PATCH' && r.url().includes('/api/machines/')) patches.push({ url: new URL(r.url()).pathname, body: r.postDataJSON() }); });
const trig = (mid) => page.locator(`button[aria-label^="并发上限"][data-machine-id="${mid}"]`);
const input = () => page.getByTestId('machine-concurrency-input');
await page.goto(`${W}/app/resources/machines`); await trig(manualId).waitFor();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A: edit 7, then 恢复推荐 → exactly one PATCH {maxConcurrent:null}
await trig(manualId).click(); await input().fill('7'); await sleep(300);
await page.screenshot({ path: join(OUT, '01-edited-draft-before-reset.png') });
let n0 = patches.length; await page.getByTestId('machine-concurrency-reset').click(); await sleep(1500);
const a = patches.slice(n0); const rowsA = await snap('after-reset');
check('A1 编辑后点 恢复推荐：只发 1 次 PATCH，body = {maxConcurrent:null}', a.length === 1 && a[0].body.maxConcurrent === null, JSON.stringify(a));
const mA = rowsA.find((r) => r.name === 'fix-manual');
check('A2 API：overridden=false、maxConcurrent=推荐 12、source=measured', mA.maxConcurrentOverridden === false && mA.maxConcurrent === 12 && mA.concurrencySource === 'measured', JSON.stringify(mA));
await page.screenshot({ path: join(OUT, '02-after-reset.png') });

// C: edit then + → single PATCH draft+1
await trig(manualId).click(); await input().fill('7'); n0 = patches.length;
await page.getByTestId('machine-concurrency-inc').click(); await sleep(1500);
const c = patches.slice(n0);
check('C1 编辑 7 后点 +：只发 1 次 PATCH，body = {maxConcurrent:8}', c.length === 1 && c[0].body.maxConcurrent === 8, JSON.stringify(c));
await page.keyboard.press('Escape'); await sleep(500);

// B: out-of-range 12 (range 1–8), focus + blur untouched → zero PATCH
await trig(oorId).click(); await page.getByTestId('machine-concurrency-out-of-range').waitFor();
n0 = patches.length; await input().focus(); await sleep(200); await input().blur(); await sleep(300);
await page.screenshot({ path: join(OUT, '03-out-of-range-focus-blur.png') });
await page.keyboard.press('Escape'); await sleep(1200);
const b = patches.slice(n0); const rowsB = await snap('after-blur');
const mB = rowsB.find((r) => r.name === 'fix-out-of-range');
check('B1 未编辑的超区间值 12：聚焦+失焦+Esc 不发 PATCH', b.length === 0, JSON.stringify(b));
check('B2 API 仍为 12 手动（未被夹到 8）', mB.maxConcurrent === 12 && mB.maxConcurrentOverridden === true, JSON.stringify(mB));
await browser.close();
writeFileSync(join(OUT, 'patches.json'), JSON.stringify(patches, null, 2));
writeFileSync(join(OUT, 'result.json'), JSON.stringify(results, null, 2));
console.log(`${results.filter((r) => r.ok).length}/${results.length} checks passed`);
