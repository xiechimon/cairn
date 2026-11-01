import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(join(process.cwd(), 'apps/web/package.json'));
const { chromium } = require('@playwright/test');

const API = `http://127.0.0.1:${process.env.VERIFY_PORT ?? 8791}`;
const WEB = `http://127.0.0.1:${process.env.VERIFY_WEB_PORT ?? 5273}`;
const OUT = new URL('.', import.meta.url).pathname;

async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text === '' ? null : JSON.parse(text) };
}

const [team] = (await call('GET', '/api/teams')).body;
const project = await call('POST', '/api/projects', { name: 'api-latency', teamId: team.id });
const pid = project.body.id;
const titles = ['Profile the slowest endpoints', 'Cache the auth lookup', 'Batch the audit writes'];
const todos = [];
for (const title of titles) {
  todos.push((await call('POST', `/api/projects/${pid}/todos`, { title, spec: title })).body);
}
const state = async () =>
  (await call('GET', `/api/todos?teamId=${team.id}`)).body
    .filter((t) => t.projectId === pid)
    .map((t) => ({ title: t.title, phase: t.phase, archivedAt: t.archivedAt ?? null, snoozeMode: t.snoozeMode ?? null }));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => localStorage.setItem('cairn.locale', 'en'));
await page.goto(`${WEB}/app/project/${pid}`);
const inbox = page.getByTestId('threads-inbox');
await inbox.locator('[data-slot="thread-row"]').first().waitFor();
await page.screenshot({ path: join(OUT, '1-idle-group.png') });
const out = { before: await state() };

const pick = async (title) => {
  const row = inbox.locator('[data-slot="thread-row"]').filter({ hasText: title });
  await row.hover();
  await row.getByRole('checkbox').check();
};
await pick('Cache the auth lookup');
await pick('Batch the audit writes');
await page.screenshot({ path: join(OUT, '2-selected.png') });
await page.getByRole('toolbar', { name: 'Bulk actions' }).getByRole('button', { name: 'Archive' }).click();
await page.getByRole('button', { name: 'Undo' }).waitFor();
await inbox.locator('[data-slot="thread-row"]').filter({ hasText: 'Cache the auth lookup' }).waitFor({ state: 'detached' });
await page.screenshot({ path: join(OUT, '3-archived-undo.png') });
out.afterArchive = await state();

await page.getByRole('button', { name: 'Undo' }).click();
await inbox.locator('[data-slot="thread-row"]').filter({ hasText: 'Cache the auth lookup' }).waitFor();
out.afterUndo = await state();

await pick('Profile the slowest endpoints');
await page.getByRole('toolbar', { name: 'Bulk actions' }).getByRole('button', { name: 'Snooze' }).click();
await inbox.locator('[data-slot="thread-row"]').filter({ hasText: 'Profile the slowest endpoints' }).getByLabel('Snoozed').waitFor();
out.afterSnooze = await state();

await pick('Batch the audit writes');
await page.getByRole('toolbar', { name: 'Bulk actions' }).getByRole('button', { name: 'Resolve' }).click();
await inbox.locator('[data-slot="stone-group"][data-tone="resolved"]').waitFor();
await page.screenshot({ path: join(OUT, '4-resolved.png') });
out.afterResolve = await state();
await browser.close();

writeFileSync(join(OUT, 'threads-inbox-live.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log('done');
