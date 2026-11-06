import { chromium } from '/home/ian/Code/AgentProjects/cairn/.claude/worktrees/ui-click-flash/node_modules/@playwright/test/index.mjs';
import fs from 'node:fs';
const base = process.env.BASE ?? 'http://127.0.0.1:5274';
const tag = process.env.TAG;
const out = `/tmp/flash/ev-${tag}`;
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1440, height: 732 } })).newPage();
await p.goto(base + '/app', { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
const sels = { omarchy: '[data-testid=machines-button]', tasksPill: '[aria-label=Tasks]', sidebarCoordinator: 'a[href*="/app"]' };
const clip = { x: 1100, y: 8, width: 332, height: 48 };
const shots = [];
const summary = {};
for (const [name, sel] of Object.entries(sels)) {
  const loc = p.locator(sel).first();
  const bb = await loc.boundingBox();
  await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await p.waitForTimeout(300);
  const h = await loc.elementHandle();
  await p.evaluate((el) => { window.__op = []; const t0 = performance.now(); const tick = () => { window.__op.push(+getComputedStyle(el).opacity); if (performance.now() - t0 < 600) requestAnimationFrame(tick); }; requestAnimationFrame(tick); }, h);
  await p.mouse.down();
  const c = name === 'sidebarCoordinator' ? { x: 8, y: 60, width: 232, height: 48 } : clip;
  const strip = [];
  for (const ms of [0, 50, 100]) { if (ms) await p.waitForTimeout(50); strip.push(await p.screenshot({ clip: c })); }
  await p.mouse.move(0, 400); await p.mouse.up();
  await p.waitForTimeout(400);
  const op = await p.evaluate(() => window.__op);
  summary[name] = { minOpacity: Math.min(...op), framesBelow1: op.filter((x) => x < 0.999).length, frames: op.length };
  shots.push({ name, strip });
  await p.goto(base + '/app', { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
}
fs.writeFileSync(`${out}/summary.json`, JSON.stringify(summary, null, 2));
const html = `<body style="margin:0;background:#fff;font:12px sans-serif">${shots.map((s) => `<div style="margin:6px">${s.name}: press +0ms / +50ms / +100ms (held)<br>${s.strip.map((b) => `<img style="margin-right:4px;border:1px solid #999" src="data:image/png;base64,${b.toString('base64')}">`).join('')}</div>`).join('')}</body>`;
const p2 = await (await b.newContext({ viewport: { width: 1100, height: 330 } })).newPage();
await p2.setContent(html);
await p2.screenshot({ path: `${out}/strip.png` });
console.log(tag, JSON.stringify(summary));
await b.close();
