// Sheet left edge below the top bar. Before = main (5173), after = this
// branch (5174); both proxy to the live server on 8787. Light, DPR 2.
// Also checks the detail page below 816px keeps no ring. Run: node shots.mjs <outDir>
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
  await p.screenshot({ path: `${out}/${tag}-left-edge.png`, clip: { x: 225, y: 0, width: 70, height: 160 } });
  await p.screenshot({ path: `${out}/${tag}-board.png` });
  report[tag] = await p.evaluate(() => {
    const sheet = document.querySelector('.board-sheet');
    const r = sheet.getBoundingClientRect();
    const cover = [];
    for (const y of [40, 300, 700]) {
      let el = document.elementFromPoint(r.x + 0.5, y);
      while (el && el !== sheet) { if (getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)') cover.push(`${y}:${String(el.className).split(' ')[0]}`); el = el.parentElement; }
    }
    return { sheetShadow: getComputedStyle(sheet).boxShadow, ringLayer: getComputedStyle(sheet, '::after').boxShadow, ringZ: getComputedStyle(sheet, '::after').zIndex, opaqueChildrenOnEdge: cover };
  });
  await p.setViewportSize({ width: 600, height: 800 });
  await p.goto(`${origin}/app`, { waitUntil: 'networkidle' });
  await p.locator('[data-todo-id] a').first().click();
  await p.waitForURL(/\/app\/todo\//); await p.waitForTimeout(800);
  report[tag].detailNarrowRing = await p.evaluate(() => { const s = document.querySelector('.group\\/detail-main'); return s ? { self: getComputedStyle(s).boxShadow, after: getComputedStyle(s, '::after').display } : null; });
  await p.close();
}
console.log(JSON.stringify(report, null, 2));
await b.close();
