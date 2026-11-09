import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(`${process.cwd()}/package.json`);
const { chromium } = require('@playwright/test');
const Database = createRequire(`${process.cwd()}/apps/server/package.json`)('better-sqlite3');
const scratch = `${process.env.HOME}/.cache/codex-scratch/pi-168`;
const out = `${scratch}/atomicity-evidence`;
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
const project = await request('/api/projects', { teamId: team.id, name: 'Commit confirmation verification' });
const task = await request(`/api/projects/${project.id}/todos`, { title: 'Keep failed sends honest', spec: 'Synthetic running step; no provider execution' });
const db = new Database(`${scratch}/atomicity-stack/home/server/server.db`);
const now = Date.now();
db.prepare('INSERT INTO build (id,todoId,withPlan,triggerSource,createdAt) VALUES (?,?,0,?,?)').run('commit-build', task.id, 'user', now);
db.prepare('INSERT INTO step (id,buildId,kind,status,createdAt,claimedAt,sessionId) VALUES (?,?,?,?,?,?,?)').run('commit-running', 'commit-build', 'build', 'claimed', now, now, 'commit-session');
db.prepare('UPDATE todo SET latestBuildId=?,phase=? WHERE id=?').run('commit-build', 'building', task.id);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark', locale: 'zh-CN' });
  await page.addInitScript(() => {
    window.__userEvents = [];
    const Native = window.EventSource;
    window.EventSource = class extends Native {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', (event) => {
          const frame = JSON.parse(event.data);
          if (frame.message?.role === 'user') window.__userEvents.push(frame);
        });
      }
    };
  });
  let hold = false;
  let releasedReads = 0;
  const keys = [];
  page.on('request', (req) => { if (req.method() === 'POST' && new URL(req.url()).pathname.endsWith('/messages')) keys.push(req.postDataJSON().clientMessageId ?? null); });
  await page.route('**/api/conversations/*/messages*', async (route) => {
    if (!hold || route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 5000));
    releasedReads++;
    try { await route.fulfill({ response }); } catch {}
  });
  await page.goto(`${web}/app/todo/${task.id}`);
  const input = page.getByTestId('composer-card').getByRole('textbox');
  const results = [];
  for (const mode of ['thread', 'queued']) {
    hold = true;
    const text = mode === 'thread' ? 'Preserve my rejected draft' : 'Keep my rejected queue capsule';
    await input.fill(text);
    if (mode === 'queued') {
      await input.press('Control+Enter');
      await page.getByTestId('queued-message').filter({ hasText: text }).waitFor();
    }
    db.exec("CREATE TRIGGER reject_steer BEFORE INSERT ON steer_pending BEGIN SELECT RAISE(ABORT, 'post-insert verification failure'); END");
    const failed = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/messages'));
    if (mode === 'thread') await input.press('Enter');
    else await page.getByTestId('steer-queued-message').click();
    assert.equal((await failed).status(), 500);
    await page.waitForTimeout(700);
    assert.equal(await page.getByTestId('user-bubble').filter({ hasText: text }).count(), 0);
    if (mode === 'thread') assert.equal(await input.inputValue(), text);
    else assert.equal(await page.getByTestId('queued-message').filter({ hasText: text }).count(), 1);
    const wireBeforeRetry = await page.evaluate((text) => window.__userEvents.filter((event) => event.message.content === text && event.message.deliverAfterStop === undefined), text);
    assert.deepEqual(wireBeforeRetry, []);
    const persistedBefore = db.prepare('SELECT id,role,content FROM message WHERE role=?').all('user').filter((row) => row.content === JSON.stringify(text));
    assert.equal(persistedBefore.length, 0);
    const before = await request('/api/conversations/commit-build/messages');
    assert.equal(before.messages.filter((row) => row.content === text).length, 0);
    assert.equal(before.queuedMessages.filter((row) => row.content === text).length, mode === 'queued' ? 1 : 0);
    await page.screenshot({ path: `${out}/${mode}-rolled-back.png` });
    db.exec('DROP TRIGGER reject_steer');
    const started = Date.now();
    const retried = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/messages'));
    if (mode === 'thread') await input.press('Enter');
    else await page.getByTestId('steer-queued-message').click();
    assert.equal((await retried).status(), 201);
    await page.getByTestId('user-bubble').filter({ hasText: text }).waitFor({ timeout: 1500 });
    const visibleMs = Date.now() - started;
    assert.equal(await page.getByTestId('queued-message').filter({ hasText: text }).count(), 0);
    assert.equal(await page.getByTestId('user-bubble').filter({ hasText: text }).count(), 1);
    const after = await request('/api/conversations/commit-build/messages');
    assert.equal(after.messages.filter((row) => row.content === text).length, 1);
    const events = await page.evaluate((text) => window.__userEvents.filter((event) => event.message.content === text && event.message.deliverAfterStop === undefined), text);
    assert.equal(events.length, 1);
    assert.equal(releasedReads, 0);
    await page.screenshot({ path: `${out}/${mode}-committed.png` });
    results.push({ mode, rejectedStatus: 500, rollbackRows: 0, rollbackDeliveredEvents: 0, falseBubbles: 0, retainedDraft: mode === 'thread', retainedCapsule: mode === 'queued', retryStatus: 201, retryVisibleMs: visibleMs, committedApiRows: 1, deliveredEvents: events, releasedHeldReads: 0 });
  }
  assert.equal(keys[0], keys[1]);
  writeFileSync(`${out}/result.json`, JSON.stringify({ providerMode: 'No daemon/model execution; seeded claimed step; real server/REST/SSE/browser/SQLite; SQLite trigger injects failure after transcript insert', heldGetMs: 5000, sameKeyThreadRetry: keys[0] === keys[1], results }, null, 2));
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
  db.close();
}
