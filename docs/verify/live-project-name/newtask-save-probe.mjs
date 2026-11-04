// Live new-task save while GET /api/projects is held: records every write
// the page sends and the toast it shows.
// Usage: node newtask-save-probe.mjs <baseURL> <webAppDir>
import { createRequire } from 'node:module';
import { join } from 'node:path';

const [base, webDir] = process.argv.slice(2);
const { chromium } = createRequire(join(webDir, 'package.json'))('@playwright/test');

const TEAM = { id: 'team-1', name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null };
const USER = { id: 'user-1', displayName: '我', avatarUrl: null };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 732 } });
const writes = [];
await page.route('**/api/**', (route, request) => {
  if (request.method() !== 'GET') {
    writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
    return route.fulfill({ status: 404, json: { error: 'not found' } });
  }
  return route.fulfill({ status: 500, json: { error: 'stub' } });
});
await page.route('**/api/teams', (route) => route.fulfill({ json: [TEAM] }));
await page.route('**/api/user/me', (route) => route.fulfill({ json: USER }));
await page.route('**/api/todos?*', (route) => route.fulfill({ json: [] }));
await page.route('**/api/projects?*', () => {});

await page.goto(`${base}/app`);
await page.locator('.sidebar-new-task').click();
const dialog = page.getByRole('dialog', { name: '新建任务' });
await dialog.waitFor();
const chip = dialog.getByTestId('new-task-project-chip');
const chipText = (await chip.count()) > 0 ? await chip.innerText() : '(no chip)';
await dialog.getByTestId('new-task-spec').fill('pending save probe');
await dialog.getByRole('button', { name: '保存', exact: true }).click();
const toast = page.locator('[data-sonner-toast]').first();
await toast.waitFor({ timeout: 5000 });
console.log(JSON.stringify({ base, chip: chipText.replace(/\s+/g, ' '), writes, toast: await toast.innerText() }));
await browser.close();
