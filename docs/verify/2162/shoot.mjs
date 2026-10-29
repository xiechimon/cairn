import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
const [, , outDir, expectBanner] = process.argv;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 732 } });
const backup = page.waitForResponse((r) => r.url().endsWith('/api/server/backup'));
await page.goto('http://127.0.0.1:8791/app');
const body = await (await backup).json();
await page.waitForSelector('.board-topbar', { timeout: 20000 });
const banner = page.getByTestId('backup-warning');
if (expectBanner === 'yes') await banner.waitFor({ timeout: 10000 });
else await page.waitForTimeout(1500);
const n = await banner.count();
const result = {
  api: body,
  bannerCount: n,
  kind: n ? await banner.getAttribute('data-backup') : null,
  text: n ? await banner.innerText() : null,
};
await page.screenshot({ path: `${outDir}/home.png` });
writeFileSync(`${outDir}/banner.json`, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));
await browser.close();
