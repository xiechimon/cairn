import { expect, type Page, test } from '@playwright/test';
import { mockLive, THREAD } from './chief-home-mock';

const MINUTE = 60_000;
const TEXTS = ['q1', 'a1 answer', 'q2', 'a2 answer', 'q3', 'a3 answer'];

async function mockHistory(page: Page) {
  const now = Date.now();
  const rows = TEXTS.map((text, index) => ({
    id: `m${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: text,
    createdAt: now - (TEXTS.length - index) * MINUTE,
  }));
  await mockLive(page, { threads: [THREAD], messages: [] }, (path, route, json) => {
    if (path !== `/api/conversations/${THREAD.id}/messages`) return undefined;
    if (route.request().method() !== 'GET') return undefined;
    return json({ messages: rows, nextCursor: null });
  });
}

const textBox = async (page: Page, text: string) => {
  const box = await page.getByTestId('home-c').getByText(text, { exact: true }).boundingBox();
  if (box === null) throw new Error(`no box for ${text}`);
  return box;
};

test('text gaps match Claude.ai (52px after a user message, 36px after a reply) and hidden actions take no height', async ({
  page,
}) => {
  await mockHistory(page);
  await page.goto('/app');
  await expect(page.getByTestId('home-c').getByText('a3 answer', { exact: true })).toBeVisible();
  const gaps: number[] = [];
  for (let index = 0; index < TEXTS.length - 2; index++) {
    const a = await textBox(page, TEXTS[index] as string);
    const b = await textBox(page, TEXTS[index + 1] as string);
    gaps.push(b.y - (a.y + a.height));
  }
  for (const [index, gap] of gaps.entries()) {
    expect(gap, `gap after ${TEXTS[index]}`).toBeLessThanOrEqual(index % 2 === 0 ? 60 : 36);
  }
  const older = page.getByTestId('home-c').getByTestId('chief-msg').first();
  const tools = older.locator('[data-testid="chief-msg-tools"], [data-testid="chief-msg-foot"]');
  expect(await tools.evaluate((el) => getComputedStyle(el).position)).toBe('absolute');
});

test('the latest message keeps its actions in the flow', async ({ page }) => {
  await mockHistory(page);
  await page.goto('/app');
  const latest = page.getByTestId('home-c').getByTestId('chief-msg').last();
  const tools = latest.locator('[data-testid="chief-msg-tools"], [data-testid="chief-msg-foot"]');
  await expect(tools).toBeVisible();
  expect(await tools.evaluate((el) => getComputedStyle(el).position)).not.toBe('absolute');
});
