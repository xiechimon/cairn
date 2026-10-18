// Page shell geometry probe (paper-redesign-plan PR 6): top bar height,
// title size and family, content column width, back arrow presence and the
// main panel inset, per route family, from a fixture bundle.
//   node docs/verify/paper-shell-merge/probe.mjs <baseUrl>
import { chromium } from '@playwright/test';

const [base] = process.argv.slice(2);
if (!base) throw new Error('usage: probe.mjs <baseUrl>');

const routes = [
  ['pages', '/app/schedules?scenario=11'],
  ['resources', '/app/resources/skills?scenario=06'],
  ['secondary', '/app/team?scenario=12'],
  ['machine detail', '/app/resources/machines/Kd8fG2hJ4mN9pQ1rStUvWx3?scenario=06'],
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => localStorage.setItem('pacman-theme', 'light'));
for (const [family, url] of routes) {
  await page.goto(`${base}${url}`);
  await page.getByRole('complementary').waitFor();
  await page.waitForTimeout(300);
  const m = await page.evaluate(() => {
    const aside = document.querySelector('aside');
    const header = [...document.querySelectorAll('header')].find(
      (h) => !aside?.contains(h) && h.getBoundingClientRect().width > 600,
    );
    const title = header?.querySelector('h1') ?? header?.querySelector('div.text-center, div.justify-center');
    const titleCs = title ? getComputedStyle(title) : null;
    const main = header?.parentElement?.parentElement;
    const mainBox = main?.getBoundingClientRect();
    const col = main?.querySelector('[class*="mx-auto"]');
    return {
      topbarH: header?.getBoundingClientRect().height,
      titleSize: titleCs?.fontSize,
      titleFont: titleCs?.fontFamily.split(',')[0].trim(),
      colW: col?.getBoundingClientRect().width,
      back: document.querySelectorAll('[aria-label="返回"]').length,
      mainInset: mainBox ? { top: mainBox.top, right: 1440 - mainBox.right } : null,
      mainBg: main ? getComputedStyle(main).backgroundColor : null,
    };
  });
  console.log(family.padEnd(15), JSON.stringify(m));
}
await browser.close();
