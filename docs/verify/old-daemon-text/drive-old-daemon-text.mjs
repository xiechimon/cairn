// Real-env probe: agent permissions tab, machine-fit section, with a machine that never reported a capability snapshot.
// Usage (repo root, stack from verify-pacman launch.mjs): VERIFY_RUN_DIR=... node docs/verify/old-daemon-text/drive-old-daemon-text.mjs <outDir>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const { chromium } = createRequire(join(ROOT, '.claude/skills/verify-pacman/scripts/x.mjs'))('@playwright/test');
const OUT = process.argv[2]; mkdirSync(OUT, { recursive: true });
const stack = JSON.parse(readFileSync(join(process.env.VERIFY_RUN_DIR, 'ports.json'), 'utf8'));
const S = `http://127.0.0.1:${stack.serverPort}`, W = `http://127.0.0.1:${stack.webPort}`;
async function j(method, path, { token, body } = {}) {
  const r = await fetch(S + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let b = null; try { b = await r.json(); } catch {} return { status: r.status, body: b };
}
const teamId = (await j('GET', '/api/teams')).body[0].id;
await j('POST', `/api/teams/${teamId}/providers`, { body: { providerId: 'stub-gw', label: 'Stub Gateway', baseUrl: 'http://127.0.0.1:9/v1', api: 'openai-completions', authHeader: true, compat: { supportsDeveloperRole: false }, models: [{ id: 'stub-model', name: 'stub-model' }] } });
const k = await j('POST', `/api/teams/${teamId}/api-keys`, { body: { name: 'k-legacy', gitAccess: false, mcpAccess: false, toolGrants: { read: [], write: [] } } });
const key = k.body?.plaintext ?? k.body?.record?.plaintext ?? k.body?.token;
const e = await j('POST', '/api/machine/enroll', { token: key, body: { teamId, name: 'no-snapshot-box', cliVersion: '0.1.0' } });
const mtoken = e.body?.token ?? e.body?.machine?.token;
const beat = () => j('POST', '/api/machine/presence', { token: mtoken, body: { cliVersion: '0.1.0' } });
await beat(); const hb = setInterval(beat, 3000);
const a = await j('POST', `/api/teams/${teamId}/agents`, { body: { displayName: '文案验证 Agent', description: 'wording probe', provider: 'stub-gw', modelId: 'stub-model', machineId: e.body?.machineId ?? e.body?.machine?.machineId ?? e.body?.machine?.id } });
const agentId = a.body?.id ?? a.body?.agentId;
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.route('**/api.dicebear.com/**', (r) => r.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#888"/></svg>' }));
await page.goto(`${W}/app/resources/agents/${agentId}?name=x`);
await page.locator('.agent-tab').nth(2).click();
const sec = page.locator('.agent-machine-fit');
await sec.waitFor({ state: 'visible', timeout: 15000 });
await page.getByText('no-snapshot-box').first().waitFor({ timeout: 15000 });
await sec.scrollIntoViewIfNeeded(); await page.waitForTimeout(400);
await page.screenshot({ path: join(OUT, '01-permissions-tab.png') });
await sec.screenshot({ path: join(OUT, '02-machine-fit-section.png') });
const text = await sec.innerText();
await browser.close(); clearInterval(hb);
const res = { enroll: e.status, agent: a.status, hasOldDaemon: /旧版|新版/.test(text), text };
writeFileSync(join(OUT, 'result.json'), JSON.stringify(res, null, 2));
console.log(JSON.stringify({ enroll: e.status, agent: a.status, hasOldDaemon: res.hasOldDaemon }));
console.log(text);
