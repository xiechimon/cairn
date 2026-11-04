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
  name: 'project-home-walk',
  gitAccess: false,
  mcpAccess: false,
  machineAccess: true,
  toolGrants: { read: [], write: [] },
});
const enroll = await call(
  'POST',
  '/api/machine/enroll',
  { teamId: team.id, name: 'project-home-walk-machine', cliVersion: '0.1.0' },
  key.body.plaintext,
);
const agent = await call('POST', `/api/teams/${team.id}/agents`, {
  displayName: 'Coordinator',
  provider: 'stub-gw',
  modelId: 'stub-model',
  machineId: enroll.body.machineId ?? enroll.body.id,
});
await call('PATCH', `/api/teams/${team.id}/chief`, { agent: { agentId: agent.body.id } });
const project = await call('POST', '/api/projects', { name: 'api-latency', teamId: team.id });
const pid = project.body.id;
await call('PATCH', `/api/projects/${pid}`, {
  description: 'Bring p95 latency under 200 ms across the whole API, without new infrastructure.',
});

const api = {};
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => localStorage.setItem('cairn.locale', 'en'));
await page.goto(`${WEB}/app/project/${pid}`);
await page.getByTestId('project-home-hero').waitFor();
await page.screenshot({ path: join(OUT, '1-empty.png') });
api.beforeSend = (await call('GET', `/api/projects/${pid}/coordinator`)).body;

await page.getByTestId('project-starter-chips').getByRole('button', { name: 'Make a plan' }).click();
await page.getByTestId('project-home').getByRole('button', { name: 'Send' }).click();
await page.getByTestId('chief-stream').getByText('Make a plan').waitFor();
await page.screenshot({ path: join(OUT, '2-sent.png') });
api.afterSend = (await call('GET', `/api/projects/${pid}/coordinator`)).body;

await page.getByTestId('project-home-header').getByRole('button', { name: 'api-latency' }).click();
await page.getByRole('menuitem', { name: /Archive/ }).click();
await page.getByRole('alertdialog').waitFor();
await page.screenshot({ path: join(OUT, '3-archive-confirm.png') });
await page.getByRole('alertdialog').getByRole('button', { name: 'Archive' }).click();
await page.getByTestId('project-archived-banner').waitFor();
await page.screenshot({ path: join(OUT, '4-archived.png') });
api.archived = (await call('GET', '/api/projects')).body.find((p) => p.id === pid);
api.sendWhileArchived = await call('POST', `/api/projects/${pid}/coordinator/messages`, {
  content: 'still there?',
});

await page.getByTestId('project-archived-banner').getByRole('button', { name: 'Unarchive' }).click();
await page.getByTestId('project-home').getByTestId('chief-composer-input').waitFor();
api.unarchived = (await call('GET', '/api/projects')).body.find((p) => p.id === pid);
await browser.close();

const pick = (record) => ({ id: record.id, name: record.name, archivedAt: record.archivedAt });
writeFileSync(
  join(OUT, 'project-home-live.json'),
  `${JSON.stringify(
    {
      beforeSend: api.beforeSend,
      afterSend: {
        threadId: api.afterSend.thread?.id,
        projectId: api.afterSend.thread?.projectId,
      },
      archived: pick(api.archived),
      sendWhileArchived: api.sendWhileArchived,
      unarchived: pick(api.unarchived),
    },
    null,
    2,
  )}\n`,
);
console.log('done');
