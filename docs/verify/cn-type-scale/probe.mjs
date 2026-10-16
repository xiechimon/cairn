import { createRequire } from 'node:module';
const require = createRequire(`${process.env.WEB_DIR}/package.json`);
const { chromium } = require('@playwright/test');
const [, , label, port] = process.argv;
const browser = await chromium.launch();
const out = { variant: label };
for (const density of ['comfortable', 'compact']) {
  const page = await browser.newPage();
  await page.addInitScript((d) => localStorage.setItem('pacman-density', d), density);
  await page.goto(`http://127.0.0.1:${port}/app?scenario=board-drag-matrix`);
  const btn = page.locator('[data-todo-id="dm-failed"]').getByRole('button', { name: '重试' });
  await btn.waitFor();
  out[density] = await btn.evaluate((el) => {
    const label = [...el.childNodes].find((n) => n.nodeType === 3 || n.tagName === 'SPAN');
    const labelEl = label?.nodeType === 3 ? el : label;
    return {
      buttonClassHasTextMeta: el.classList.contains('text-meta'),
      buttonClassHasTextXs: el.classList.contains('text-xs'),
      buttonFontSize: getComputedStyle(el).fontSize,
      labelFontSize: getComputedStyle(labelEl).fontSize,
      labelHost: labelEl === el ? 'button' : 'span',
    };
  });
  await page.close();
}
await browser.close();
console.log(JSON.stringify(out));
