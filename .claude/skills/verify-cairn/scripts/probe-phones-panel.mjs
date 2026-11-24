#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SCRIPT_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const REPO = process.env.VERIFY_REPO_ROOT ?? SCRIPT_REPO;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(REPO, '.claude/verify-run');
const stack = JSON.parse(readFileSync(join(RUN_DIR, 'ports.json'), 'utf8'));
const WEB = `http://127.0.0.1:${stack.webPort ?? process.env.VERIFY_WEB_PORT ?? 5273}`;
const DB_PATH = join(stack.homeDir ?? join(RUN_DIR, 'home'), 'server', 'server.db');
const EVIDENCE = process.env.VERIFY_EVIDENCE_DIR ?? join(REPO, '.claude/verify-evidence/phones-panel');
mkdirSync(EVIDENCE, { recursive: true });

const require2 = createRequire(join(REPO, 'apps/server/package.json'));
const Database = require2('better-sqlite3');
const db = new Database(DB_PATH);
const teamId = db.prepare('SELECT id FROM team LIMIT 1').get()?.id;
const now = Date.now();
const capabilities = JSON.stringify({
  osPlatform: 'darwin',
  mcpServers: [],
  skills: [],
  phoneHost: true,
  phones: [
    { deviceId: 'dev-new', platform: 'android', name: 'Pixel 8a (new)', link: 'seen' },
    { deviceId: 'dev-locked', platform: 'android', name: 'Pixel 8a (locked)', link: 'locked' },
    { deviceId: 'dev-ready', platform: 'android', name: 'Pixel 8a (ready)', link: 'ready' },
  ],
});
db.prepare(
  `INSERT INTO machine (id, teamId, name, online, kind, capabilities, lastSeenAt)
   VALUES ('verify-mac', ?, 'verify-mac', 1, 'local', ?, ?)
   ON CONFLICT(id) DO UPDATE SET capabilities = excluded.capabilities, online = 1, lastSeenAt = excluded.lastSeenAt`,
).run(teamId, capabilities, now);
db.prepare(`DELETE FROM phone WHERE machineId = 'verify-mac'`).run();
const insertPhone = db.prepare(
  `INSERT INTO phone (id, teamId, machineId, platform, deviceId, name, consentAt, executionFence, createdAt, updatedAt)
   VALUES (?, ?, 'verify-mac', 'android', ?, ?, ?, 0, ?, ?)`,
);
insertPhone.run('ph-locked', teamId, 'dev-locked', 'Pixel 8a (locked)', now, now, now);
insertPhone.run('ph-ready', teamId, 'dev-ready', 'Pixel 8a (ready)', now, now, now);
db.close();

const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}\n`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 732 } });
await page.goto(`${WEB}/app/settings/machines`, { waitUntil: 'networkidle' });

await page.getByTestId('phone-row').first().waitFor();
await page.screenshot({ path: join(EVIDENCE, 'phones-rows.png') });

const states = await page
  .getByTestId('phone-row')
  .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-state')));
check('three seeded phone states render', states.join(',') === 'not_paired,locked,ready', states.join(','));

await page.getByTestId('phone-pair').first().click();
await page.getByTestId('phone-pair-dialog').waitFor();
await page.screenshot({ path: join(EVIDENCE, 'phone-pair-dialog.png') });
check('pair submit starts disabled', await page.getByTestId('phone-pair-submit').isDisabled());

await page.getByTestId('phone-pair-endpoint').fill('192.168.1.20:37001');
await page.getByTestId('phone-pair-code').fill('123456');
await page.getByTestId('phone-pair-consent').click();
check('pair submit enables with endpoint+code+consent', await page.getByTestId('phone-pair-submit').isEnabled());
await page.screenshot({ path: join(EVIDENCE, 'phone-pair-dialog-filled.png') });
await page.keyboard.press('Escape');
await page.getByTestId('phone-pair-dialog').waitFor({ state: 'detached' });

await page.getByTestId('phone-forget').first().click();
const confirmDialog = page.getByRole('alertdialog');
await confirmDialog.waitFor();
await page.screenshot({ path: join(EVIDENCE, 'phone-forget-confirm.png') });
await confirmDialog.getByRole('button', { name: /取消|Cancel/ }).click();

const apiPhones = await page.evaluate(async () => {
  const res = await fetch('/api/machines/verify-mac/phones');
  return res.ok ? res.json() : res.status;
});
check('GET /api/machines/:id/phones answers', typeof apiPhones === 'object');
const activity = await page.evaluate(async () => {
  const res = await fetch('/api/machines/verify-mac/phones/activity');
  return res.ok ? res.json() : res.status;
});
check('GET /api/machines/:id/phones/activity answers', typeof activity === 'object');

await browser.close();
writeFileSync(join(EVIDENCE, 'result.json'), JSON.stringify({ checks, apiPhones, activity }, null, 2));
process.exit(checks.every((c) => c.ok) ? 0 : 1);
