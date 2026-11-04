import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const W = '/Users/xmon/Code/AgentProjects/cairn/.claude/worktrees/bui-snooze-fix';
const require = createRequire(`${W}/apps/web/package.json`);
const { chromium } = require('@playwright/test');
const API = 'http://127.0.0.1:8791';
const OUT = `${W}/docs/verify/2229/live`;
const j = async (method, path, body) => {
  const res = await fetch(`${API}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
};
const teamId = (await j('GET', '/api/teams'))[0].id;
const project = (await j('GET', '/api/projects')).find((p) => p.name === 'snooze-live');
const c = await j('POST', `/api/projects/${project.id}/todos`, { title: 'Short timed snooze', spec: 'live walk' });
const until = Date.now() + 5000;
const snoozed = await j('POST', `/api/todos/${c.id}/snooze`, { until });
const started = Date.now();
let back = null;
while (Date.now() - started < 180_000) {
  await new Promise((r) => setTimeout(r, 3000));
  const t = (await j('GET', '/api/todos')).find((x) => x.id === c.id);
  if (t.snoozeMode === null) { back = t; break; }
}
if (!back) throw new Error('timed snooze did not return within 180s');
const notes = await j('GET', `/api/teams/${teamId}/notifications`);
writeFileSync(`${OUT}/4-timed-return.json`, `${JSON.stringify({ snoozedResponse: { id: snoozed.id, snoozeMode: snoozed.snoozeMode, snoozedUntil: snoozed.snoozedUntil }, returnedAfterMs: Date.now() - started, after: { id: back.id, snoozeMode: back.snoozeMode, snoozedUntil: back.snoozedUntil }, unread: notes.unreadThreadIds.includes(c.id) }, null, 2)}\n`);
if (!notes.unreadThreadIds.includes(c.id)) throw new Error('timed return should be unread');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 732 } });
await page.goto('http://127.0.0.1:5273/app');
await page.getByTestId('sidebar-thread-row').filter({ hasText: 'Short timed snooze' }).waitFor();
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/5-timed-returned-unread.png` });
await browser.close();
console.log('timed ok', Date.now() - started);
