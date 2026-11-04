// #1346 Bugbot fix real-env probe: + clicked 3x while PATCH /api/machines/* is in flight.
// The browser delays each PATCH 800 ms before forwarding it to the real server, and logs every request.
// Usage (repo root, stack from verify-pacman launch.mjs): VERIFY_RUN_DIR=... node docs/verify/1346-fix/drive-1346-fix.mjs <outDir>
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
const k = await j('POST', `/api/teams/${teamId}/api-keys`, { body: { name: 'k-1346', gitAccess: false, mcpAccess: false, toolGrants: { read: [], write: [] } } });
const key = k.body?.plaintext ?? k.body?.record?.plaintext ?? k.body?.key ?? k.body?.token;
const HW = { cpuCores: 12, memoryTotalMb: 16384, memoryAvailableMb: 8192, loadAvg1: 0.5, diskFreeMb: 102400 };
await j('POST', '/api/machine/enroll', { token: key, body: { teamId, name: 'fix1346', cliVersion: '0.1.0', capabilities: { mcpServers: [], skills: [], hardware: HW } } });
const machines = async () => { const b = (await j('GET', `/api/teams/${teamId}/machines`)).body; return Array.isArray(b) ? b : b.machines; };
const mid = (await machines()).find((m) => m.name === 'fix1346').id;
await j('PATCH', `/api/machines/${mid}`, { body: { maxConcurrent: 3 } });
const row = async () => { const { maxConcurrent, maxConcurrentOverridden, concurrencySource, concurrencyRange } = (await machines()).find((m) => m.id === mid); return { maxConcurrent, maxConcurrentOverridden, concurrencySource, concurrencyRange }; };
writeFileSync(join(OUT, 'api-t0.json'), JSON.stringify(await row(), null, 2));

const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1440, height: 732 } });
const t0 = Date.now(); const patches = [];
await page.route('**/api/machines/*', async (route) => {
  if (route.request().method() !== 'PATCH') return route.fallback();
  const entry = { sentAtMs: Date.now() - t0, body: route.request().postDataJSON() };
  patches.push(entry);
  await new Promise((r) => setTimeout(r, 800));
  const res = await route.fetch(); entry.status = res.status(); entry.serverMaxConcurrent = (await res.json()).maxConcurrent; entry.doneAtMs = Date.now() - t0;
  await route.fulfill({ response: res });
});
const trig = page.locator(`button[aria-label^="并发上限"][data-machine-id="${mid}"]`);
const input = page.getByTestId('machine-concurrency-input');
const inc = page.getByTestId('machine-concurrency-inc');
await page.goto(`${W}/app/resources/machines`); await trig.waitFor();
await trig.click(); await input.waitFor();
await page.screenshot({ path: join(OUT, '01-open-at-3.png') });
await inc.click(); await page.waitForTimeout(150); await inc.click(); await page.waitForTimeout(150); await inc.click(); await page.waitForTimeout(150);
const draftInFlight = await input.inputValue();
await page.screenshot({ path: join(OUT, '02-after-3-clicks-in-flight.png') });
await page.waitForTimeout(3500);
const draftSettled = await input.inputValue();
await page.screenshot({ path: join(OUT, '03-settled.png') });
await browser.close();
const final = await row(); writeFileSync(join(OUT, 'api-final.json'), JSON.stringify(final, null, 2));
check('1 PATCH 在途时输入框显示 6（不停在旧值）', draftInFlight === '6', `draft=${draftInFlight}`);
check('2 PATCH 序列 = 4,5,6', JSON.stringify(patches.map((p) => p.body.maxConcurrent)) === '[4,5,6]', JSON.stringify(patches.map((p) => p.body)));
check('3 API 最终 maxConcurrent=6 手动', final.maxConcurrent === 6 && final.maxConcurrentOverridden === true, JSON.stringify(final));
check('4 落定后输入框 = 6', draftSettled === '6', `draft=${draftSettled}`);
writeFileSync(join(OUT, 'patches.json'), JSON.stringify(patches, null, 2));
writeFileSync(join(OUT, 'result.json'), JSON.stringify(results, null, 2));
console.log(`${results.filter((r) => r.ok).length}/${results.length} checks passed`);
