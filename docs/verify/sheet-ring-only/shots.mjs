// Sheet edge before (main, fixture build on 28412) and after (this branch, 28411).
// Captures the sheet's top-left corner where the sidebar meets it, light and
// dark, plus the full board in light. Run: node shots.mjs <outDir>
import { chromium } from '/Users/xmon/Code/AgentProjects/pacman/apps/web/node_modules/@playwright/test/index.mjs';
const out = process.argv[2];
const targets = { before: 'http://127.0.0.1:28412', after: 'http://127.0.0.1:28411' };
const b = await chromium.launch();
const report = {};
for (const [tag, origin] of Object.entries(targets)) {
  for (const theme of ['light', 'dark']) {
    const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 3 });
    await p.addInitScript((t) => localStorage.setItem('pacman-theme', t), theme);
    await p.goto(`${origin}/app?scenario=22d`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(500);
    await p.screenshot({ path: `${out}/${tag}-corner-${theme}.png`, clip: { x: 200, y: 0, width: 160, height: 120 } });
    if (theme === 'light') await p.screenshot({ path: `${out}/${tag}-board-light.png`, scale: 'css' });
    report[`${tag}-${theme}`] = await p.locator('.board-sheet').evaluate((el) => getComputedStyle(el).boxShadow);
    await p.close();
  }
}
console.log(JSON.stringify(report, null, 2));
await b.close();
