// Before (main, the user's dev stack on 5173) and after (this branch, dev
// server on 5174); both proxy to the same live server on 8787, so the board
// shows the same real tasks. Light theme, 1440x900, DPR 2.
// Run: node shots.mjs <outDir>
import { chromium } from '/Users/xmon/Code/AgentProjects/pacman/apps/web/node_modules/@playwright/test/index.mjs';
const out = process.argv[2];
const targets = { before: 'http://127.0.0.1:5173', after: 'http://127.0.0.1:5174' };
const b = await chromium.launch();
const report = {};
for (const [tag, origin] of Object.entries(targets)) {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.addInitScript(() => localStorage.setItem('pacman-theme', 'light'));
  await p.goto(`${origin}/app`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${out}/${tag}-board.png` });
  await p.screenshot({ path: `${out}/${tag}-top-left.png`, clip: { x: 0, y: 0, width: 760, height: 440 } });
  const card = p.locator('[data-todo-id]').first();
  await card.screenshot({ path: `${out}/${tag}-first-card.png` });
  report[tag] = await p.evaluate(() => {
    const cs = (el) => (el ? getComputedStyle(el) : null);
    const card = document.querySelector('.todo-card');
    const nav = [...document.querySelectorAll('aside a svg')].slice(0, 3).map((s) => `${s.getAttribute('class').split(' ')[1]} ${cs(s).color}`);
    const orch = document.querySelector('.todo-card-orchestration');
    return {
      cardShadow: cs(card).boxShadow,
      navIcons: nav,
      metaIcon: cs(document.querySelector('.todo-card-meta svg')).color,
      orchestrationFooter: orch ? orch.textContent : null,
      orchestratingOverlay: document.querySelector('.todo-card-meta [data-orchestrating]')?.textContent ?? null,
    };
  });
  report[tag].pageErrors = errs.length;
  await p.close();
}
console.log(JSON.stringify(report, null, 2));
await b.close();
