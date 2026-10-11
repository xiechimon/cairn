import { chromium } from '@playwright/test';

const BASE = 'http://127.0.0.1:8399';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(`${BASE}/app/resources/machines?scenario=06`);
await page.waitForSelector('div[data-kind="local"]');

// 1. rest state: row without the resident hint line
await page.screenshot({ path: 'docs/verify/1175/rest.png', fullPage: false });

// 2. hover the shell switch cluster -> tooltip
await page.locator('div[data-kind="local"] [data-slot="tooltip-trigger"]').hover();
await page.waitForSelector('[data-slot="tooltip-content"]', { state: 'visible' });
await page.waitForTimeout(300); // let the pop animation land
await page.screenshot({ path: 'docs/verify/1175/hover.png', fullPage: false });

await browser.close();
console.log('shots done');
