// Outline thickness on a 2x screen. Before = main (the user's dev stack on
// 5173), after = this branch (dev server on 5174); both proxy to the live
// server on 8787. Light theme, 1440x900, DPR 2. Run: node shots.mjs <outDir>
import { chromium } from '/Users/xmon/Code/AgentProjects/pacman/apps/web/node_modules/@playwright/test/index.mjs';
const out = process.argv[2];
const targets = { before: 'http://127.0.0.1:5173', after: 'http://127.0.0.1:5174' };
const b = await chromium.launch();
const report = {};
for (const [tag, origin] of Object.entries(targets)) {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await p.addInitScript(() => localStorage.setItem('pacman-theme', 'light'));
  await p.goto(`${origin}/app`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${out}/${tag}-top-left.png`, clip: { x: 0, y: 0, width: 760, height: 440 } });
  await p.locator('.todo-card').first().screenshot({ path: `${out}/${tag}-card.png` });
  report[tag] = await p.evaluate(() => ({
    sheet: getComputedStyle(document.querySelector('.board-sheet')).boxShadow,
    card: getComputedStyle(document.querySelector('.todo-card')).boxShadow.replace(/rgba\(0, 0, 0, 0\) 0px 0px 0px 0px, /g, ''),
    activeRow: getComputedStyle(document.querySelector('aside [aria-current=page]')).boxShadow.replace(/rgba\(0, 0, 0, 0\) 0px 0px 0px 0px, /g, ''),
  }));
  await p.close();
}
console.log(JSON.stringify(report, null, 2));
await b.close();
