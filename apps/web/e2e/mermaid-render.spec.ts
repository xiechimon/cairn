import { expect, type Page, test } from '@playwright/test';
import { mockLive, type Row, THREAD } from './chief-home-mock';
import { evidencePanelShot } from './evidence';

declare global {
  interface Window {
    __notices?: number;
  }
}

const ROUTE = '/app?scenario=chief-mermaid';
const STREAM_URL = `/api/conversations/${THREAD.id}/stream`;

const emit = (page: Page, ev: unknown) =>
  page.evaluate(
    ([u, e]) => window.__es.find((es) => es.url.includes(u as string))?.emit(e),
    [STREAM_URL, ev] as const,
  );

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

test('a streaming reply keeps an unfinished mermaid fence as code with no notice', async ({
  page,
}) => {
  const messages: Row[] = [{ id: 'ask', role: 'user', content: '画一下登录流程', createdAt: 10 }];
  let running = true;
  await mockLive(page, { threads: [THREAD], messages }, (path, _route, json) =>
    path === '/api/teams/t1/chief/threads'
      ? json([{ ...THREAD, activeRun: running ? { phase: 'chief' } : null }])
      : undefined,
  );
  await page.goto('/app');
  const home = page.getByTestId('home-c');
  await page.waitForFunction((u) => window.__es.some((es) => es.url.includes(u)), STREAM_URL);
  await page.evaluate(() => {
    window.__notices = 0;
    new MutationObserver(() => {
      if (document.querySelector('[data-testid="md-mermaid-notice"]') !== null)
        window.__notices = (window.__notices ?? 0) + 1;
    }).observe(document.body, { childList: true, subtree: true, attributes: true });
  });
  const blocks = home.getByTestId('md-mermaid');

  const closed = '```mermaid\nflowchart LR\n  a[开始] --> b[结束]\n```\n\n';
  await emit(page, { type: 'text_delta', text: `先看总览：\n\n${closed}再看细节：\n\n` });
  await emit(page, { type: 'text_delta', text: '```mermaid\nflowchart LR\n  open[打开 Cairn' });
  await expect(blocks).toHaveCount(2);
  await expect(blocks.nth(0)).toHaveAttribute('data-state', 'drawn');
  const open = blocks.nth(1);
  await expect(open).toHaveAttribute('data-state', 'streaming');
  await expect(open.getByTestId('md-code')).toContainText('open[打开 Cairn');
  await evidencePanelShot(page, 'mermaid-streaming-open-fence.png', open);

  await emit(page, { type: 'text_delta', text: '] --> home[进入首页' });
  await expect(open.getByTestId('md-code')).toContainText('home[进入首页');
  await expect(open).toHaveAttribute('data-state', 'streaming');

  const content = `先看总览：\n\n${closed}再看细节：\n\n\`\`\`mermaid\nflowchart LR\n  open[打开 Cairn] --> home[进入首页]`;
  const answer: Row = { id: 'answer', role: 'assistant', content, createdAt: 40 };
  messages.push(answer);
  running = false;
  await emit(page, { type: 'message', message: answer });
  await emit(page, { type: 'step', step: { id: 'ask', status: 'done' } });
  await expect(home.getByTestId('typing-dots')).toHaveCount(0);
  await expect(blocks.nth(1)).toHaveAttribute('data-state', 'drawn');
  expect(await page.evaluate(() => window.__notices)).toBe(0);
});
