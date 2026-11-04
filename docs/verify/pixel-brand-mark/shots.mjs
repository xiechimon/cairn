// Screenshots for the pixel brand mark: before = main (P tile, live preview on
// 28400), after = this branch (preview on 28410). Run: node shots.mjs <outDir>
import { chromium } from '/Users/xmon/Code/AgentProjects/pacman/apps/web/node_modules/@playwright/test/index.mjs';
const out = process.argv[2];
const targets = { before: 'http://127.0.0.1:28400', after: 'http://127.0.0.1:28410' };
const b = await chromium.launch();
const report = {};
for (const [tag, origin] of Object.entries(targets)) {
  for (const theme of ['light', 'dark']) {
    const p = await b.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 3 });
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    await p.addInitScript((t) => localStorage.setItem('pacman-theme', t), theme);
    await p.goto(`${origin}/app?scenario=22d`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(500);
    const row = p.getByTestId('team-row');
    await row.screenshot({ path: `${out}/${tag}-head-${theme}.png` });
    const mark = p.getByTestId('brand-mark');
    const info = await mark.evaluate((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return { text: el.textContent, w: r.width, h: r.height, mask: cs.getPropertyValue('mask-image'), paint: cs.backgroundColor };
    });
    if (tag === 'after' && theme === 'light') {
      await p.getByRole('complementary').screenshot({ path: `${out}/after-sidebar-light.png` });
      await p.getByRole('link', { name: 'Pacman' }).click();
      await p.waitForURL('**/app/team**');
      info.afterClickUrl = new URL(p.url()).pathname;
      await p.waitForTimeout(500);
      await p.getByTestId('team-row').screenshot({ path: `${out}/after-team-active-light.png` });
    }
    report[`${tag}-${theme}`] = { ...info, pageErrors: errs.length };
    await p.close();
  }
}
console.log(JSON.stringify(report, null, 2));
await b.close();
