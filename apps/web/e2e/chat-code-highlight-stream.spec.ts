import { expect, type Page, test } from '@playwright/test';
import { mockLive, type Row, THREAD } from './chief-home-mock';

declare global {
  interface Window {
    __plainAfterColor?: string[];
  }
}

const STREAM_URL = `/api/conversations/${THREAD.id}/stream`;

const emit = (page: Page, ev: unknown) =>
  page.evaluate(
    ([u, e]) => window.__es.find((es) => es.url.includes(u as string))?.emit(e),
    [STREAM_URL, ev] as const,
  );

function watchHighlight(page: Page) {
  return page.evaluate(() => {
    window.__plainAfterColor = [];
    const colored = new Set<string>();
    const check = () => {
      const blocks = document.querySelectorAll('[data-testid="home-c"] [data-testid="md-code"]');
      blocks.forEach((block, n) => {
        const key = String(n);
        const hasColor = block.querySelector('span[style]') !== null;
        if (hasColor) colored.add(key);
        else if (colored.has(key)) window.__plainAfterColor?.push(key);
      });
    };
    new MutationObserver(check).observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
}

test('a streaming code block stays highlighted while new text arrives', async ({ page }) => {
  const messages: Row[] = [{ id: 'ask', role: 'user', content: '写个加法函数', createdAt: 10 }];
  let running = true;
  await mockLive(page, { threads: [THREAD], messages }, (path, _route, json) =>
    path === '/api/teams/t1/chief/threads'
      ? json([{ ...THREAD, activeRun: running ? { phase: 'chief' } : null }])
      : undefined,
  );
  await page.goto('/app');
  const home = page.getByTestId('home-c');
  await page.waitForFunction((u) => window.__es.some((es) => es.url.includes(u)), STREAM_URL);
  await watchHighlight(page);
  const codes = home.getByTestId('md-code');

  const closed = '```ts\nexport const one: number = 1;\n```\n\n';
  let content = `先看常量：\n\n${closed}再看函数：\n\n\`\`\`ts\nexport function add(a: number`;
  await emit(page, { type: 'text_delta', text: content });
  await expect(codes).toHaveCount(2);
  await expect(codes.nth(0).locator('span[style]').first()).toBeVisible();
  await expect(codes.nth(1).locator('span[style]').first()).toBeVisible();

  const deltas = [
    ', b: number',
    '): number {\n',
    '  const sum = a + b;\n',
    '  return sum;\n',
    '}\n',
    '```\n\n',
    '这样就能',
    '相加了。',
  ];
  for (const delta of deltas) {
    content += delta;
    await emit(page, { type: 'text_delta', text: delta });
    await expect(home).toContainText(delta.replace(/```|\n/g, '').trim().slice(0, 6));
  }
  await expect(codes.nth(1)).toContainText('return sum;');
  await expect(codes.nth(1).getByText('return', { exact: true })).toHaveAttribute('style', /color/);

  const answer: Row = { id: 'answer', role: 'assistant', content, createdAt: 40 };
  messages.push(answer);
  running = false;
  await emit(page, { type: 'message', message: answer });
  await emit(page, { type: 'step', step: { id: 'ask', status: 'done' } });
  await expect(home.getByTestId('typing-dots')).toHaveCount(0);
  await expect(codes.nth(1).locator('span[style]').first()).toBeVisible();
  expect(await page.evaluate(() => window.__plainAfterColor)).toEqual([]);
});
