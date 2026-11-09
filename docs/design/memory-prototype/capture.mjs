import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../../apps/web/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const { default: AxeBuilder } = require('@axe-core/playwright');
const output = process.env.B1_SCREEN_DIR;
assert(output, 'Set B1_SCREEN_DIR to an output directory');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
const states = ['empty', 'loading', 'error', 'populated', 'long', 'offline', 'detail', 'promote', 'promote-pending', 'promote-error', 'delete', 'delete-pending', 'delete-error'];
try {
  for (const width of [1440, 390]) {
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', isMobile: width === 390, hasTouch: width === 390 });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('**/*', (route) => {
        const url = new URL(route.request().url());
        assert.equal(url.hostname, '127.0.0.1', 'Prototype must not contact external or live services');
        assert.equal(url.port, '8791', 'Prototype must not contact the live server');
        return route.continue();
      });
      for (const state of states) {
        await page.goto(`http://127.0.0.1:8791/docs/design/memory-prototype/index.html?state=${state}&theme=${theme}`);
        await expect(page.locator('h1')).toHaveText('Coordinator settings');
        await page.evaluate(() => document.fonts.ready);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${state} ${width}: horizontal overflow`);
        if (state === 'empty') await expect(page.getByText('No saved memories yet.')).toBeVisible();
        if (state === 'loading') assert.equal(await page.locator('[data-slot="skeleton"]').count(), 6);
        if (state === 'error') await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
        if (state === 'populated') {
          const row = page.getByRole('button', { name: /Open memory: Verification commands/ });
          const before = await row.evaluate((el) => ({ shadow: getComputedStyle(el).boxShadow, x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y }));
          await row.hover();
          const after = await row.evaluate((el) => ({ shadow: getComputedStyle(el).boxShadow, x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y, delay: getComputedStyle(el).transitionDelay }));
          assert.equal(after.shadow, before.shadow);
          assert.equal(after.x, before.x);
          assert.equal(after.y, before.y);
          assert.equal(after.delay, '0s');
          await row.focus();
          await page.keyboard.press('Enter');
          await expect(page.getByRole('dialog')).toBeVisible();
          await page.keyboard.press('Escape');
          await expect(row).toBeFocused();
          await row.evaluate((element) => element.blur());
          await page.mouse.move(0, 0);
        }
        if (state === 'delete' || state === 'promote') await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused();
        if (width === 390) {
          for (const button of await page.getByRole('button').all()) {
            if (!(await button.isVisible())) continue;
            const box = await button.boundingBox();
            assert(box && box.width >= 44 && box.height >= 44, `${state}: touch target below 44px`);
          }
        }
        const a11y = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        assert.deepEqual(a11y.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target) })), [], `${state} ${theme} ${width}: axe`);
        assert.deepEqual(errors, []);
        const name = `${state}-${theme}-${width}.png`;
        await page.screenshot({ path: `${output}/${name}`, fullPage: true });
        results.push({ state, theme, width, image: name, axeViolations: 0, overflow: false });
      }
      await context.close();
    }
  }
  await writeFile(`${output}/results.json`, `${JSON.stringify(results, null, 2)}\n`);
  console.log(`${results.length} real-component fixture captures and accessibility/overflow checks passed`);
} finally {
  await browser.close();
}
