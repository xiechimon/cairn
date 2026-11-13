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

test('text gaps match the reference recording (39px between turns either way) and hidden actions take no height', async ({
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
    const target = 39;
    expect(Math.abs(gap - target), `gap after ${TEXTS[index]} is ${gap}`).toBeLessThanOrEqual(5);
  }
  const older = page.getByTestId('home-c').getByTestId('chief-msg').first();
  const tools = older
    .locator('[data-testid="chief-msg-tools"], [data-testid="chief-msg-foot"]')
    .first();
  expect(await tools.evaluate((el) => getComputedStyle(el).position)).toBe('absolute');
});

test('actions take no height on any message, the latest included', async ({ page }) => {
  await mockHistory(page);
  await page.goto('/app');
  const messages = page.getByTestId('home-c').getByTestId('chief-msg');
  await expect(messages).toHaveCount(TEXTS.length);
  for (const index of [0, 1, TEXTS.length - 1]) {
    const message = messages.nth(index);
    const tools = message
      .locator('[data-testid="chief-msg-tools"], [data-testid="chief-msg-foot"]')
      .first();
    expect(await tools.evaluate((el) => getComputedStyle(el).position)).toBe('absolute');
    const body = message.locator('[data-testid="chief-bubble"], [data-slot="reply-blocks"]');
    const messageBox = await message.boundingBox();
    const bodyBox = await body.boundingBox();
    if (messageBox === null || bodyBox === null) throw new Error('no box');
    expect(Math.abs(messageBox.height - bodyBox.height), `message ${index}`).toBeLessThanOrEqual(1);
  }
});
