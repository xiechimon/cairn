import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(join(process.cwd(), 'apps/web/package.json'));
const { chromium } = require('@playwright/test');

const API = `http://127.0.0.1:${process.env.VERIFY_PORT ?? 8791}`;
const WEB = `http://127.0.0.1:${process.env.VERIFY_WEB_PORT ?? 5273}`;
const OUT = new URL('.', import.meta.url).pathname;

async function call(method, path, body, token) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text === '' ? null : JSON.parse(text) };
}

const [team] = (await call('GET', '/api/teams')).body;
await call('POST', `/api/teams/${team.id}/providers`, {
  providerId: 'stub-gw',
  label: 'Stub Gateway',
  baseUrl: 'http://127.0.0.1:9/v1',
  api: 'openai-completions',
  authHeader: true,
  compat: { supportsDeveloperRole: false },
  models: [{ id: 'stub-model', name: 'stub-model' }],
});
const key = await call('POST', `/api/teams/${team.id}/api-keys`, {
  name: 'home-c-walk',
  gitAccess: false,
  mcpAccess: false,
  machineAccess: true,
  toolGrants: { read: [], write: [] },
});
const enroll = await call(
  'POST',
  '/api/machine/enroll',
  { teamId: team.id, name: 'home-c-walk-machine', cliVersion: '0.1.0' },
  key.body.plaintext,
);
const agent = await call('POST', `/api/teams/${team.id}/agents`, {
  displayName: 'Coordinator',
  provider: 'stub-gw',
  modelId: 'stub-model',
  machineId: enroll.body.machineId ?? enroll.body.id,
});
await call('PATCH', `/api/teams/${team.id}/chief`, { agent: { agentId: agent.body.id } });
const cairn = (await call('POST', '/api/projects', { name: 'cairn', teamId: team.id })).body;
const relay = (await call('POST', '/api/projects', { name: 'relay', teamId: team.id })).body;
await call('POST', `/api/projects/${cairn.id}/todos`, { title: 'Fold finished turns', spec: 'x' });
await call('POST', `/api/projects/${relay.id}/todos`, { title: 'Rerun the relay probe', spec: 'x' });

const out = {};
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => localStorage.setItem('cairn.locale', 'en'));
await page.goto(`${WEB}/app`);
await page.getByTestId('home-c-hero').waitFor();
await page.screenshot({ path: join(OUT, '1-first-run.png') });

const composer = page.getByTestId('home-c').getByTestId('chief-composer-input');
await composer.fill('Plan the week across both projects.');
await page.getByTestId('home-c').getByRole('button', { name: 'Send' }).click();
await page.getByTestId('chief-stream').getByText('Plan the week across both projects.').waitFor();
await page.waitForTimeout(1500);
await page.screenshot({ path: join(OUT, '2-sent.png') });

await page.locator('[data-slot="sidebar-project-row"]', { hasText: 'cairn' }).click();
await page.waitForURL(/project=/);
await composer.waitFor();
out.filteredUrl = new URL(page.url()).search;
out.placeholder = await composer.getAttribute('placeholder');
await composer.fill('Fold turns first.');
await page.getByTestId('home-c').getByRole('button', { name: 'Send' }).click();
await page.getByTestId('home-c').getByText('Fold turns first.').first().waitFor();
await page.waitForTimeout(1500);
await page.screenshot({ path: join(OUT, '3-filtered-send.png') });

await page.goto(`${WEB}/app/project/${relay.id}`);
await page.waitForURL(/\/app\?.*project=/);
out.projectRedirect = new URL(page.url()).search;
await browser.close();

const threads = (await call('GET', `/api/teams/${team.id}/chief/threads`)).body;
out.threadCount = threads.length;
const messages = (await call('GET', `/api/conversations/${threads[0].id}/messages`)).body.messages;
out.userMessages = messages.filter((m) => m.role === 'user').map((m) => m.content);
out.cairnId = cairn.id;
out.relayId = relay.id;
writeFileSync(join(OUT, 'home-c-live.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify(out));
