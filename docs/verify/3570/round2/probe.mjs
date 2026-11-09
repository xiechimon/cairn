import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
const root = process.cwd();
const require = createRequire(`${root}/package.json`);
const { chromium } = require('@playwright/test');
const Database = createRequire(`${root}/apps/server/package.json`)('better-sqlite3');
const scratch = `${process.env.HOME}/.cache/codex-scratch/pi-168`;
const phase = process.argv[2] ?? 'before';
const out = `${scratch}/${phase}`;
mkdirSync(out, { recursive: true });
const api = 'http://127.0.0.1:18868';
const web = 'http://127.0.0.1:18869';
async function request(path, body, method = body === undefined ? 'GET' : 'POST') {
  const res = await fetch(`${api}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json();
  assert.ok(res.ok, `${method} ${path}: ${res.status} ${JSON.stringify(data)}`);
  return data;
}
const db = new Database(`${scratch}/stack/home/server/server.db`);
let ids;
if (existsSync(`${scratch}/${phase}-ids.json`)) ids = JSON.parse(readFileSync(`${scratch}/${phase}-ids.json`, 'utf8'));
else {
  const [team] = await request('/api/teams');
  await request(`/api/teams/${team.id}/providers`, { providerId: 'stub-gw', label: 'Offline fake', baseUrl: 'http://127.0.0.1:9/v1', api: 'openai-completions', authHeader: true, models: [{ id: 'stub-model', name: 'Offline fake' }] });
  await request(`/api/teams/${team.id}/routing-rules/coordinator`, { provider: 'stub-gw', modelId: 'stub-model' }, 'PATCH');
  await request(`/api/teams/${team.id}/routing-rules/session`, { provider: 'stub-gw', modelId: 'stub-model' }, 'PATCH');
  const first = await request(`/api/teams/${team.id}/chief/threads`, { content: 'Offline verification begins', clientMessageId: 'probe-initial' });
  const project = await request('/api/projects', { name: 'Message visibility verification', teamId: team.id });
  const task = await request(`/api/projects/${project.id}/todos`, { title: 'Message visibility task', spec: 'Offline verification only' });
  db.prepare('INSERT INTO build (id,todoId,withPlan,triggerSource,createdAt) VALUES (?,?,0,?,?)').run('visibility-build', task.id, 'user', Date.now());
  db.prepare('INSERT INTO step (id,buildId,kind,status,createdAt) VALUES (?,?,?,?,?)').run('visibility-step','visibility-build','build','done',Date.now());
  db.prepare('UPDATE todo SET phase=?, latestBuildId=? WHERE id=?').run('done','visibility-build',task.id);
  ids = { team: team.id, chief: first.thread.id, task: task.id, build: 'visibility-build' };
  writeFileSync(`${scratch}/${phase}-ids.json`, JSON.stringify(ids));
}
const browser = await chromium.launch();
const results = [];
try {
  for (const surface of ['home', 'shortcut', 'thread']) {
    if (surface === 'thread') {
      db.prepare('UPDATE todo SET phase=? WHERE id=?').run('done', ids.task);
      db.prepare('UPDATE step SET status=? WHERE buildId=?').run('done', ids.build);
    }
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark', locale: 'zh-CN' });
    const text = `Visibility ${phase} ${surface}`;
    let clicked = 0;
    let postResponseMs = null;
    let sseMessageMs = null;
    let delayReads = false;
    let posts = 0;
    await page.addInitScript(() => {
      window.__messageTimes = [];
      const Native = window.EventSource;
      window.EventSource = class extends Native {
        constructor(...args) {
          super(...args);
          this.addEventListener('message', (e) => {
            try { const value = JSON.parse(e.data); if (value.type === 'message') window.__messageTimes.push({ time: Date.now(), message: value.message }); } catch {}
          });
        }
      };
    });
    await page.route('**/api/**', async (route) => {
      const req = route.request();
      const path = new URL(req.url()).pathname;
      if (req.method() === 'POST' && path.endsWith('/messages')) { posts++; delayReads = true; }
      if (delayReads && req.method() === 'GET' && (path.includes('/messages') || path.endsWith('/chief/threads'))) {
        const response = await route.fetch();
        await new Promise((resolve) => setTimeout(resolve, 3000));
        await route.fulfill({ response });
      } else await route.continue();
    });
    page.on('response', (res) => { if (res.request().method() === 'POST' && res.url().endsWith('/messages')) postResponseMs = Date.now() - clicked; });
    await page.goto(`${web}${surface === 'thread' ? `/app/todo/${ids.task}` : surface === 'shortcut' ? '/app/schedules' : '/app'}`);
    if (surface === 'shortcut') await page.keyboard.press('Meta+j');
    const scope = surface !== 'thread' ? page.getByTestId('home-c') : page.getByTestId('composer-card');
    const input = surface === 'thread' ? scope.getByRole('textbox') : scope.getByTestId('chief-composer-input');
    await input.waitFor({ state: 'visible', timeout: 15000 });
    await input.fill(text);
    await page.evaluate(({ text, surface }) => {
      window.__visibleAt = null;
      const selector = surface === 'thread' ? '[data-testid="user-bubble"], [data-testid="queued-message"]' : '[data-testid="home-c"] [data-testid="chief-bubble"], [data-testid="home-c"] [data-testid="queued-message"]';
      const observe = () => {
        const el = [...document.querySelectorAll(selector)].find((node) => node.textContent.includes(text));
        if (el && el.getBoundingClientRect().height > 0 && el.getBoundingClientRect().bottom > 0 && el.getBoundingClientRect().top < innerHeight) window.__visibleAt = Date.now();
        else requestAnimationFrame(observe);
      };
      requestAnimationFrame(observe);
    }, { text, surface });
    clicked = Date.now();
    await scope.getByRole('button', { name: '发送', exact: true }).click();
    const bubble = page.locator(surface === 'thread' ? '[data-testid="user-bubble"], [data-testid="queued-message"]' : '[data-testid="home-c"] [data-testid="chief-bubble"], [data-testid="home-c"] [data-testid="queued-message"]').filter({ hasText: text });
    await new Promise((resolve) => setTimeout(resolve, 400));
    const visibleAt400 = await bubble.isVisible();
    await page.screenshot({ path: `${out}/${surface}-400ms.png` });
    await bubble.waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForFunction(() => window.__visibleAt !== null);
    const visibleMs = (await page.evaluate(() => window.__visibleAt)) - clicked;
    const events = await page.evaluate(() => window.__messageTimes);
    const event = events.find((e) => e.message.content === text);
    if (event) sseMessageMs = event.time - clicked;
    const rows = await request(`/api/conversations/${surface === 'thread' ? ids.build : ids.chief}/messages`);
    assert.equal(rows.messages.filter((row) => row.content === text).length, 1);
    const table = surface === 'thread' ? 'message' : 'chief_message';
    const persisted = db.prepare(`SELECT id, role, content, createdAt FROM ${table}`).all().filter((row) => { try { return JSON.parse(row.content) === text; } catch { return row.content === text; } });
    assert.equal(persisted.length, 1);
    await page.screenshot({ path: `${out}/${surface}-settled.png` });
    await page.evaluate(() => localStorage.setItem('cairn-theme', 'light'));
    await page.reload();
    await bubble.waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
    await page.screenshot({ path: `${out}/${surface}-light.png` });
    const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(horizontalOverflow, false);
    results.push({ surface, injectedReadDelayMs: 3000, persistedMs: persisted[0].createdAt - clicked, postResponseMs, sseMessageMs, visibleAt400, visibleMs, posts, dbRows: persisted, apiRowCount: 1, horizontalOverflow });
    await page.close();
  }
  if (phase.startsWith('after')) {
    for (const result of results) assert.ok(result.visibleMs < 1000, `${result.surface}: confirmed message exceeded one second`);
    for (const surface of ['home', 'thread']) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark', locale: 'zh-CN' });
      const path = surface === 'home' ? '/app' : `/app/todo/${ids.task}`;
      const text = `Preserved after rejected ${surface}`;
      let posts = 0;
      let delayQueueReads = false;
      const keys = [];
      await page.addInitScript(() => {
        window.__queueEvents = [];
        const Native = window.EventSource;
        window.EventSource = class extends Native {
          constructor(...args) {
            super(...args);
            this.addEventListener('message', (event) => {
              try {
                const value = JSON.parse(event.data);
                if (value.deliveredQueue) window.__queueEvents.push(value);
              } catch {}
            });
          }
        };
      });
      await page.route('**/api/**', async (route) => {
        const req = route.request();
        if (req.method() === 'POST' && new URL(req.url()).pathname.endsWith('/messages')) {
          posts++;
          keys.push(req.postDataJSON().clientMessageId);
          if (posts === 1) {
            await new Promise((r) => setTimeout(r, 1200));
            return route.fulfill({ status: 503, json: { error: 'Offline test: submission unavailable' } });
          }
        }
        if (delayQueueReads && req.method() === 'GET' && new URL(req.url()).pathname.includes('/messages')) {
          const response = await route.fetch();
          await new Promise((r) => setTimeout(r, 3000));
          return route.fulfill({ response });
        }
        return route.continue();
      });
      await page.goto(`${web}${path}`);
      const scope = surface === 'home' ? page.getByTestId('home-c') : page.getByTestId('composer-card');
      const input = surface === 'home' ? scope.getByTestId('chief-composer-input') : scope.getByRole('textbox');
      await input.fill(text);
      await scope.getByRole('button', { name: '发送', exact: true }).click();
      await input.press('Enter');
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(posts, 1);
      assert.equal(await input.inputValue(), text);
      const sentBubble = page.locator(surface === 'home' ? '[data-testid="home-c"] [data-testid="chief-bubble"], [data-testid="home-c"] [data-testid="queued-message"]' : '[data-testid="user-bubble"], [data-testid="queued-message"]').filter({ hasText: text });
      await page.screenshot({ path: `${out}/${surface}-slow-post.png` });
      assert.equal(await sentBubble.count(), 0);
      await page.getByText(surface === 'home' ? '发送失败，请重试。' : 'Offline test: submission unavailable', { exact: true }).first().waitFor();
      assert.equal(await input.inputValue(), text);
      await page.screenshot({ path: `${out}/${surface}-failure.png` });
      if (surface === 'home') assert.equal(await page.evaluate(() => localStorage.getItem('cairn.chief-draft')), text);
      await input.press('Enter');
      await sentBubble.first().waitFor();
      assert.equal(posts, 2);
      assert.equal(keys[0], keys[1]);
      const rows = await request(`/api/conversations/${surface === 'home' ? ids.chief : ids.build}/messages`);
      assert.equal([...rows.messages, ...(rows.queuedMessages ?? [])].filter((r) => r.content === text).length, 1);
      await page.reload();
      await sentBubble.first().waitFor();
      assert.equal(await sentBubble.count(), 1);
      await page.screenshot({ path: `${out}/${surface}-reconnected.png` });
      results.push({ surface, scenario: 'slow rejection, double submit, explicit retry, reload/reconnect', posts, sameClientMessageId: keys[0] === keys[1], authoritativeRows: 1, visibleCopiesAfterReconnect: 1 });
      if (surface === 'thread') {
        const queued = scope.getByTestId('queued-message').filter({ hasText: text });
        assert.equal(await queued.count(), 1);
        db.prepare('UPDATE step SET status=? WHERE buildId=? AND status=?').run('claimed', ids.build, 'pending');
        db.prepare('UPDATE todo SET phase=? WHERE id=?').run('building', ids.task);
        delayQueueReads = true;
        const started = Date.now();
        const responsePromise = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/messages'));
        await queued.getByTestId('steer-queued-message').click();
        const response = await responsePromise;
        writeFileSync(`${out}/queue-delivery-response.json`, JSON.stringify({ status: response.status(), body: await response.json() }, null, 2));
        assert.equal(response.status(), 201);
        await page.screenshot({ path: `${out}/queue-delivery-response.png` });
        await page.getByTestId('user-bubble').filter({ hasText: text }).waitFor({ state: 'visible', timeout: 1000 });
        assert.equal(await queued.count(), 0);
        const deliveredMs = Date.now() - started;
        const delivered = await request(`/api/conversations/${ids.build}/messages`);
        assert.equal(delivered.messages.filter((r) => r.content === text).length, 1);
        assert.equal((delivered.queuedMessages ?? []).filter((r) => r.content === text).length, 0);
        await page.screenshot({ path: `${out}/thread-queue-delivered.png` });
        results.push({ surface, scenario: 'send queued now with a 3000ms reconciliation read delay', workerState: 'seeded claimed step, no daemon or model execution', deliveredMs, visibleDeliveredCopies: 1, staleCapsules: 0, apiDeliveredRows: 1, apiQueuedRows: 0 });
        const queuedText = 'Automatic queue visibility';
        await input.fill(queuedText);
        await input.press('Control+Enter');
        const automaticCapsule = scope.getByTestId('queued-message').filter({ hasText: queuedText });
        await automaticCapsule.waitFor({ state: 'visible' });
        const queueBefore = await request(`/api/conversations/${ids.build}/messages`);
        const queueId = queueBefore.queuedMessages.find((row) => row.content === queuedText).id;
        const key = await request(`/api/teams/${ids.team}/api-keys`, { name: 'Synthetic queue worker', gitAccess: false, mcpAccess: false, machineAccess: true, toolGrants: { read: [], write: [] } });
        const enrollment = await fetch(`${api}/api/machine/enroll`, { method: 'POST', headers: { authorization: `Bearer ${key.plaintext}`, 'content-type': 'application/json' }, body: JSON.stringify({ teamId: ids.team, name: 'Synthetic queue worker', cliVersion: '0.1.0' }) });
        assert.ok(enrollment.ok, `Synthetic enrollment status ${enrollment.status}`);
        const machine = await enrollment.json();
        const claimed = db.prepare('SELECT id FROM step WHERE buildId=? AND status=? ORDER BY createdAt DESC LIMIT 1').get(ids.build, 'claimed');
        assert.ok(claimed);
        db.prepare('UPDATE step SET machineId=?, sessionId=? WHERE id=?').run(machine.machineId, 'visibility-session', claimed.id);
        const autoStart = Date.now();
        const finished = await fetch(`${api}/api/machine/done/${claimed.id}`, { method: 'POST', headers: { authorization: `Bearer ${machine.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ status: 'success', sessionId: 'visibility-session', hasChanges: true }) });
        assert.equal(finished.status, 200);
        await page.getByTestId('user-bubble').filter({ hasText: queuedText }).waitFor({ state: 'visible', timeout: 1000 });
        assert.equal(await automaticCapsule.count(), 0);
        const automaticVisibleMs = Date.now() - autoStart;
        const wire = await page.evaluate(() => window.__queueEvents);
        const event = wire.find((event) => event.message.content === queuedText);
        assert.deepEqual(event.deliveredQueue, { conversationId: ids.build, messageId: queueId });
        const after = await request(`/api/conversations/${ids.build}/messages`);
        assert.equal(after.messages.filter((row) => row.content === queuedText).length, 1);
        assert.equal((after.queuedMessages ?? []).filter((row) => row.id === queueId).length, 0);
        writeFileSync(`${out}/automatic-delivery-event.json`, JSON.stringify(event, null, 2));
        await page.screenshot({ path: `${out}/thread-automatic-delivery.png` });
        results.push({ surface, scenario: 'automatic drain via synthetic machine-done protocol and 3000ms held GET', automaticVisibleMs, visibleDeliveredCopies: 1, staleCapsules: 0, apiDeliveredRows: 1, apiQueuedRows: 0, correlatedEvent: true, providerMode: 'stateful fake worker; seeded claim; no daemon or model execution' });
      }
      await page.close();
    }
    for (const surface of ['home', 'thread']) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, colorScheme: 'dark', locale: 'zh-CN' });
      await page.goto(`${web}${surface === 'home' ? '/app' : `/app/todo/${ids.task}`}`);
      await page.getByText(`Preserved after rejected ${surface}`, { exact: true }).first().waitFor();
      for (const theme of ['dark', 'light']) {
        await page.evaluate((value) => localStorage.setItem('cairn-theme', value), theme);
        await page.reload();
        await page.getByText(`Preserved after rejected ${surface}`, { exact: true }).first().waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
        assert.equal(overflow, false);
        await page.screenshot({ path: `${out}/${surface}-390-${theme}.png` });
        results.push({ surface, scenario: 'phone', width: 390, theme, horizontalOverflow: overflow });
      }
      await page.close();
    }
  }
} finally {
  await browser.close();
  db.close();
  writeFileSync(`${out}/result.json`, JSON.stringify({ providerMode: 'Provider not exercised: offline machine, no daemon or worker; synthetic local data only', results }, null, 2));
}
console.log(JSON.stringify(results.map(({dbRows, ...rest}) => rest), null, 2));
