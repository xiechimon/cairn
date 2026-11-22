import { expect, type Page, test } from '@playwright/test';
import { evidencePanelShot } from './evidence';

const ROUTE = '/app?scenario=chief-mermaid';

function peleScripts(page: Page): string[] {
  const hits: string[] = [];
  page.on('response', async (response) => {
    if (response.request().resourceType() !== 'script') return;
    const body = await response.text().catch(() => '');
    if (body.includes('--pele-bg')) hits.push(response.url());
  });
  return hits;
}

for (const scheme of ['light', 'dark'] as const) {
  for (const width of [1440, 390]) {
    test(`mermaid fences in chat render as diagrams (${scheme}, ${width}px)`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(ROUTE);
      const blocks = page.getByTestId('home-c').getByTestId('md-mermaid');
      await expect(blocks).toHaveCount(6);
      for (const [n, name] of ['flowchart', 'sequence', 'state', 'long-labels'].entries()) {
        const block = blocks.nth(n);
        await expect(block).toHaveAttribute('data-state', 'drawn');
        const svg = block.getByTestId('md-mermaid-diagram').locator('svg');
        await expect(svg).toBeVisible();
        await expect(block.getByTestId('md-code')).toHaveCount(0);
        await block.scrollIntoViewIfNeeded();
        await evidencePanelShot(page, `mermaid-${name}-${scheme}-${width}.png`, block);
      }
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, 'R1: no horizontal scroll').toBeLessThanOrEqual(width);
    });
  }
}

test('a broken or unsupported mermaid fence keeps its code block with one notice', async ({
  page,
}) => {
  await page.goto(ROUTE);
  const blocks = page.getByTestId('home-c').getByTestId('md-mermaid');
  await expect(blocks).toHaveCount(6);
  for (const [n, state, notice] of [
    [4, 'syntax', '图表语法有误，显示源码'],
    [5, 'unsupported', '暂不支持这种图表，显示源码'],
  ] as const) {
    const block = blocks.nth(n);
    await expect(block).toHaveAttribute('data-state', state);
    await expect(block.getByTestId('md-code')).toBeVisible();
    await expect(block.getByTestId('md-mermaid-notice')).toHaveText(notice);
    await expect(block.getByTestId('md-mermaid-diagram')).toBeHidden();
    await block.scrollIntoViewIfNeeded();
    await evidencePanelShot(page, `mermaid-fallback-${state}.png`, block);
  }
});

test('a chat without a mermaid fence loads no diagram code', async ({ page }) => {
  const hits = peleScripts(page);
  await page.goto('/app?scenario=chief-code');
  await expect(page.getByTestId('home-c').getByTestId('md-code')).toHaveCount(2);
  await page.waitForLoadState('networkidle');
  expect(hits).toEqual([]);
  const peleLoaded = peleScripts(page);
  await page.goto(ROUTE);
  await expect(
    page.getByTestId('home-c').getByTestId('md-mermaid').first(),
  ).toHaveAttribute('data-state', 'drawn');
  await page.waitForLoadState('networkidle');
  expect(peleLoaded.length).toBeGreaterThan(0);
});
