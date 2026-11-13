import { expect, test } from '@playwright/test';
import { mockLive, THREAD } from './chief-home-mock';

const MINUTE = 60_000;

test('the jump-to-latest button is 36px', async ({ page }) => {
  const now = Date.now();
  const messages = Array.from({ length: 40 }, (_, index) => ({
    id: `m${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `message ${index} ${'filler '.repeat(30)}`,
    createdAt: now - (40 - index) * MINUTE,
  }));
  await mockLive(page, { threads: [THREAD], messages: [] }, (path, route, json) => {
    if (path !== `/api/conversations/${THREAD.id}/messages`) return undefined;
    if (route.request().method() !== 'GET') return undefined;
    return json({ messages, nextCursor: null });
  });
  await page.goto('/app');
  const home = page.getByTestId('home-c');
  await expect(home.getByTestId('chief-msg').last()).toBeVisible();
  await home.getByTestId('chief-body').evaluate((node) => node.scrollTo({ top: 0 }));
  const jump = home.getByTestId('jump-to-latest');
  await expect(jump).toHaveAttribute('data-active', 'true');
  const box = await jump.boundingBox();
  expect(box?.width).toBe(36);
  expect(box?.height).toBe(36);
});

test('reply headings are 15px and 600 like the body, not larger', async ({ page }) => {
  await mockLive(page, { threads: [THREAD], messages: [] }, (path, route, json) => {
    if (path !== `/api/conversations/${THREAD.id}/messages`) return undefined;
    if (route.request().method() !== 'GET') return undefined;
    return json({
      messages: [
        { id: 'u', role: 'user', content: 'report', createdAt: 1 },
        { id: 'a', role: 'assistant', content: '## Findings\n\nBody text.\n\n### Detail\n\nMore.', createdAt: 2 },
      ],
      nextCursor: null,
    });
  });
  await page.goto('/app');
  for (const level of ['h2', 'h3']) {
    const face = await page
      .getByTestId('home-c')
      .locator(`${level}.chat-md-head`)
      .evaluate((node) => {
        const style = getComputedStyle(node);
        return { size: style.fontSize, weight: style.fontWeight };
      });
    expect(face).toEqual({ size: '15px', weight: '600' });
  }
});
