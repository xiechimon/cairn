import { chromium } from '@playwright/test';
const base = 'http://localhost:5300';
const browser = await chromium.launch();
const out = {};
for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ colorScheme: theme });
  const page = await ctx.newPage();
  await page.goto(`${base}/app?scenario=01`, { waitUntil: 'networkidle' });
  await page.evaluate((t) => localStorage.setItem('pacman-theme', t), theme);
  await page.reload({ waitUntil: 'networkidle' });
  const cdp = await ctx.newCDPSession(page);
  const m = await cdp.send('Page.getAppManifest');
  const parsed = m.data ? JSON.parse(m.data) : null;
  out[theme] = {
    chromium: browser.version(),
    manifestUrl: m.url,
    manifestErrors: m.errors,
    manifest: parsed ? { theme_color: parsed.theme_color, background_color: parsed.background_color, display: parsed.display, name: parsed.name } : null,
    themeColorMetas: await page.evaluate(() => [...document.querySelectorAll('meta[name="theme-color"]')].map(m => ({ content: m.content, media: m.getAttribute('media') }))),
    canvasToken: await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim()),
    dataTheme: await page.evaluate(() => document.documentElement.dataset.theme),
  };
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(out, null, 2));
