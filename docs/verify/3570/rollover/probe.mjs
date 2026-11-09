import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(`${process.cwd()}/package.json`);
const { chromium } = require('@playwright/test');
const Database = createRequire(`${process.cwd()}/apps/server/package.json`)('better-sqlite3');
const scratch = `${process.env.HOME}/.cache/codex-scratch/pi-168`;
const out = `${scratch}/rollover-evidence`;
mkdirSync(out, { recursive: true });
const api = 'http://127.0.0.1:18868';
const web = 'http://127.0.0.1:18869';
async function request(path, body) {
  const response = await fetch(`${api}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  assert.ok(response.ok, `${path}: ${response.status} ${JSON.stringify(data)}`);
  return data;
}
const [team] = await request('/api/teams');
const project = await request('/api/projects', { teamId: team.id, name: 'Rollover verification' });
const task = await request(`/api/projects/${project.id}/todos`, { title: 'Continue after a local merge', spec: 'Synthetic worker; no model execution' });
const key = await request(`/api/teams/${team.id}/api-keys`, { name: 'Rollover test worker', gitAccess: false, mcpAccess: false, machineAccess: true, toolGrants: { read: [], write: [] } });
const enrolled = await fetch(`${api}/api/machine/enroll`, { method: 'POST', headers: { authorization: `Bearer ${key.plaintext}`, 'content-type': 'application/json' }, body: JSON.stringify({ teamId: team.id, name: 'Rollover test worker', cliVersion: '0.1.0' }) });
assert.equal(enrolled.status, 200);
const machine = await enrolled.json();
const db = new Database(`${scratch}/rollover-stack/home/server/server.db`);
const now = Date.now();
db.prepare('UPDATE project SET repoKind=?, localPath=? WHERE id=?').run('local', '/tmp/rollover-verification-no-worker', project.id);
db.prepare('INSERT INTO build (id,todoId,withPlan,triggerSource,createdAt) VALUES (?,?,0,?,?)').run('rollover-source', task.id, 'user', now);
db.prepare('INSERT INTO step (id,buildId,kind,status,createdAt,checkpointCommit) VALUES (?,?,?,?,?,?)').run('rollover-merge', 'rollover-source', 'merge', 'done', now, 'a'.repeat(40));
db.prepare('INSERT INTO step (id,buildId,kind,status,createdAt,claimedAt,machineId,sessionId) VALUES (?,?,?,?,?,?,?,?)').run('rollover-running', 'rollover-source', 'build', 'claimed', now + 1, now + 1, machine.machineId, 'rollover-session');
db.prepare('UPDATE todo SET latestBuildId=?,phase=? WHERE id=?').run('rollover-source', 'building', task.id);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark', locale: 'zh-CN' });
  await page.addInitScript(() => {
    window.__wire = [];
    window.__subscriptions = [];
    const Native = window.EventSource;
    window.EventSource = class extends Native {
      constructor(...args) {
        super(...args);
        window.__subscriptions.push({ url: String(args[0]), at: Date.now() });
        this.addEventListener('message', (event) => {
          const frame = JSON.parse(event.data);
          if (frame.deliveredQueue) window.__wire.push({ url: String(args[0]), frame, at: Date.now() });
        });
      }
    };
  });
  let hold = false;
  let releasedReads = 0;
  await page.route('**/api/conversations/*/messages*', async (route) => {
    if (!hold || route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 3000));
    releasedReads++;
    try { await route.fulfill({ response }); } catch {}
  });
  await page.goto(`${web}/app/todo/${task.id}`);
  const input = page.getByTestId('composer-card').getByRole('textbox');
  await input.fill('Continue on the replacement branch');
  await input.press('Control+Enter');
  await page.getByTestId('queued-message').waitFor({ state: 'visible' });
  const before = await request('/api/conversations/rollover-source/messages');
  const queueId = before.queuedMessages[0].id;
  await page.screenshot({ path: `${out}/before-delivery.png` });
  hold = true;
  const started = Date.now();
  const finished = await fetch(`${api}/api/machine/done/rollover-running`, { method: 'POST', headers: { authorization: `Bearer ${machine.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ status: 'success', sessionId: 'rollover-session', hasChanges: true }) });
  assert.equal(finished.status, 200, await finished.text());
  const target = db.prepare('SELECT latestBuildId FROM todo WHERE id=?').get(task.id).latestBuildId;
  assert.notEqual(target, 'rollover-source');
  await page.waitForFunction((target) => window.__subscriptions.some((sub) => sub.url.includes(`/conversations/${target}/stream`)), target, { timeout: 1000 });
  await page.getByTestId('user-bubble').filter({ hasText: 'Continue on the replacement branch' }).waitFor({ state: 'visible', timeout: 1000 });
  const visibleMs = Date.now() - started;
  assert.equal(await page.getByTestId('queued-message').count(), 0);
  assert.equal(await page.getByTestId('user-bubble').filter({ hasText: 'Continue on the replacement branch' }).count(), 1);
  assert.equal(releasedReads, 0);
  const wire = await page.evaluate(() => ({ events: window.__wire, subscriptions: window.__subscriptions }));
  const sourceFrame = wire.events.find((event) => event.frame.message.content === 'Continue on the replacement branch' && event.url.includes('/conversations/rollover-source/stream'));
  assert.ok(sourceFrame);
  assert.equal(sourceFrame.frame.conversationId, target);
  assert.deepEqual(sourceFrame.frame.deliveredQueue, { conversationId: 'rollover-source', messageId: queueId });
  assert.ok(sourceFrame.at <= wire.subscriptions.find((sub) => sub.url.includes(`/conversations/${target}/stream`)).at);
  const after = await request(`/api/conversations/${target}/messages`);
  assert.equal(after.messages.filter((row) => row.content === 'Continue on the replacement branch').length, 1);
  assert.equal(after.queuedMessages.length, 0);
  const persisted = db.prepare('SELECT id,conversationId,content FROM message WHERE conversationId=? AND role=?').all(target, 'user');
  assert.equal(persisted.length, 1);
  await page.screenshot({ path: `${out}/during-held-get.png` });
  hold = false;
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => localStorage.setItem('cairn-theme', theme), theme);
    await page.reload();
    await page.getByTestId('user-bubble').filter({ hasText: 'Continue on the replacement branch' }).waitFor();
    await page.screenshot({ path: `${out}/after-delivery-${theme}.png` });
  }
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'zh-CN' });
  const mobile = await phone.newPage();
  await mobile.goto(`${web}/app/todo/${task.id}`);
  await mobile.getByTestId('user-bubble').filter({ hasText: 'Continue on the replacement branch' }).waitFor();
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(overflow, false);
  await mobile.screenshot({ path: `${out}/after-delivery-phone.png` });
  writeFileSync(`${out}/result.json`, JSON.stringify({ scenario: 'local-merge automatic rollover; real API, SSE and browser; synthetic claimed worker; no daemon or model execution', visibleMs, heldGetMs: 3000, releasedReadsBeforeVisible: 0, deliveredBubbles: 1, staleCapsules: 0, phoneOverflow: overflow, wire, persisted, apiMessages: after.messages, apiQueue: after.queuedMessages }, null, 2));
  console.log(JSON.stringify({ visibleMs, target, deliveredBubbles: 1, staleCapsules: 0, releasedReadsBeforeVisible: 0, sourceFrame: sourceFrame.frame, phoneOverflow: overflow }));
} finally {
  await browser.close();
  db.close();
}
