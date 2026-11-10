import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../../apps/web/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const { default: AxeBuilder } = require('@axe-core/playwright');
const output = process.env.MEMORY_INPLACE_SCREEN_DIR ?? `${homedir()}/.cache/ui-refs/memory-inplace-2026-11-09`;
await mkdir(output, { recursive: true });
const states = ['input', 'working', 'applied', 'error'];
const url = (state, theme) => `http://127.0.0.1:8796/docs/design/memory-inplace-prototype/index.html?state=${state}&theme=${theme}`;
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const width of [1440, 390]) {
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', isMobile: width === 390, hasTouch: width === 390 });
      await context.route('**/*', (route) => {
        const target = new URL(route.request().url());
        assert.equal(`${target.hostname}:${target.port}`, '127.0.0.1:8796', 'fixture must not reach any product server or main thread');
        assert.doesNotMatch(target.pathname, /^\/api\//, 'fixture must not post to an API');
        return route.continue();
      });
      for (const state of states) {
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        const label = `${state} ${theme} ${width}`;
        await page.goto(url(state, theme));
        await expect(page.locator('h1')).toHaveText('Coordinator 设置');
        await page.evaluate(() => document.fonts.ready);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${label}: R1 horizontal overflow`);
        const card = page.getByTestId('memory-edit-card');
        if (state === 'input') await expect(card).toHaveCount(0);
        else {
          await expect(card).toBeVisible();
          await expect(card.getByRole('button')).toHaveCount(0);
        }
        for (const banned of ['应用修改', '放弃', '撤销', '提升为团队记忆', '删除…']) await expect(page.getByRole('button', { name: banned })).toHaveCount(0);
        assert.doesNotMatch(await page.locator('body').innerText(), /上限|\d+\s*\/\s*\d+\s*(条|行)|KB/, `${label}: no owner-facing size limit or counter`);
        await expect(page.getByRole('heading', { name: '每个线程都会读' })).toBeVisible();
        await expect(page.getByRole('heading', { name: '记忆文件' })).toBeVisible();
        if (state === 'working') await expect(page.getByRole('button', { name: '停止 Coordinator 这次修改' })).toBeVisible();
        if (state === 'applied') {
          await expect(page.locator('[data-slot=memory-change]')).toHaveCount(2);
          assert.equal(await page.locator('[data-slot=memory-diff] ins').count() > 0, true);
          await expect(page.getByText('刚刚更新')).toHaveCount(2);
        }
        if (state === 'error') await expect(page.getByRole('alert')).toContainText('记忆没有变');
        if (width === 390) {
          for (const button of await page.getByRole('button').all()) {
            if (!(await button.isVisible()) || (await button.getAttribute('data-chrome')) != null) continue;
            const box = await button.boundingBox();
            const name = (await button.getAttribute('aria-label')) ?? (await button.innerText());
            assert(box.width >= 44 && box.height >= 44, `${label}: A1 touch target ${name} ${box.width}x${box.height}`);
          }
        }
        const a11y = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        assert.deepEqual(a11y.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })), [], `${label}: A3 axe`);
        assert.deepEqual(errors, [], `${label}: page errors`);
        const name = `${state}-${theme}-${width}.png`;
        await page.screenshot({ path: `${output}/${name}`, fullPage: false });
        results.push({ state, theme, width, image: name, axeViolations: 0, overflow: false });
        await page.close();
      }
      await context.close();
    }
  }
  await writeFile(`${output}/results.json`, `${JSON.stringify(results, null, 2)}\n`);
  console.log(`${results.length} memory in-place fixture captures passed`);
} finally {
  await browser.close();
}
