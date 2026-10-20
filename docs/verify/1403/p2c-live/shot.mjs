// Screenshots each seeded todo's detail page on the verify stack.
import { createRequire } from 'node:module';
const require = createRequire('/home/user/pacman/.claude/worktrees/p2/package.json');
const { chromium } = require('@playwright/test');
const [out, ...ids] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
for (const id of ids) {
  await page.goto(`http://127.0.0.1:5273/app/todo/${id}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/${id}.png` });
  console.log('shot', id);
}
await browser.close();
