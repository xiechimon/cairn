import { expect, type Page, test } from '@playwright/test';
import { evidenceShot } from './evidence';

const ROUTE = '/app?scenario=chief-md-ref';

const reply = (page: Page) =>
  page
    .getByTestId('home-c')
    .getByTestId('chief-msg')
    .filter({ hasText: '这是一段测试用的 Markdown' });

test('one reply is one grey bubble with loose paragraph spacing inside; tables and code are bordered surfaces', async ({
  page,
}) => {
  await page.goto(ROUTE);
  const message = reply(page);
  const blocks = message.locator('[data-slot="reply-block"]');
  await expect(blocks).toHaveCount(5);
  await expect(message.getByTestId('chief-reply-bubble')).toHaveCount(3);
  const bubble = message.getByTestId('chief-reply-bubble').first();
  await expect(bubble).toHaveCSS('border-top-left-radius', '16px');
  await expect(bubble).toHaveCSS('padding-left', '14px');
  await expect(bubble).toHaveCSS('padding-top', '7px');
  const inner = await bubble
    .locator('.chat-md-block')
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect()));
  expect(inner.length).toBe(4);
  for (let i = 1; i < inner.length; i++) {
    const prev = inner[i - 1];
    const next = inner[i];
    if (prev === undefined || next === undefined) continue;
    expect(Math.round(next.top - prev.bottom), `loose gap before inner block ${i}`).toBe(10);
  }
  const boxes = await blocks.evaluateAll((els) => els.map((el) => el.getBoundingClientRect()));
  for (let i = 1; i < boxes.length; i++) {
    const prev = boxes[i - 1];
    const next = boxes[i];
    if (prev === undefined || next === undefined) continue;
    expect(Math.round(next.top - prev.bottom), `gap before block ${i}`).toBe(4);
  }
  const widest = Math.max(...boxes.map((box) => box.width));
  expect(widest).toBeLessThanOrEqual(512);
  const table = message.getByTestId('md-table');
  await expect(table).toHaveCSS('border-top-width', '1px');
  await expect(table.locator('xpath=ancestor::*[@data-slot="reply-bubble"]')).toHaveCount(0);
  await expect(table.locator('td').nth(1)).toHaveCSS('text-align', 'right');
  await expect(message.getByTestId('md-code-block')).toHaveCount(1);
  await evidenceShot(page, 'chief-reply-bubbles.png');
});

test('headings, inline styles, quote and a task list with the dashed-circle and filled-check glyphs render through the parser', async ({ page }) => {
  await page.goto(ROUTE);
  const message = reply(page);
  await expect(message.locator('h1.chat-md-head')).toHaveCSS('font-size', '18px');
  await expect(message.locator('h2.chat-md-head')).toHaveCSS('font-size', '15px');
  await expect(message.locator('em')).toHaveText('斜体');
  await expect(message.locator('del')).toHaveText('删除线');
  await expect(message.getByTestId('md-quote')).toHaveCSS('border-left-width', '3px');
  const boxes = message.getByTestId('md-checkbox');
  await expect(boxes).toHaveCount(2);
  await expect(boxes.nth(0)).not.toBeChecked();
  await expect(boxes.nth(1)).toBeChecked();
  await expect(boxes.nth(1)).toBeDisabled();
  await expect(boxes.nth(0)).toHaveCSS('border-top-style', 'dashed');
  await expect(boxes.nth(0)).toHaveCSS('border-top-left-radius', /e\+\d+px$|^8px$/);
  await expect(boxes.nth(1).locator('svg')).toHaveCount(1);
  await expect(message.getByTestId('md-item-task').nth(1)).toHaveCSS('text-decoration-line', 'line-through');
  await expect(message.getByTestId('md-tasks')).toHaveCount(0);
  const linkInk = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--chat-link)';
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  });
  expect(['rgb(47, 86, 176)', 'rgb(122, 165, 224)']).toContain(linkInk);
  await expect(message.getByRole('link', { name: '链接示例' })).toHaveCSS('color', linkInk);
  await expect(message.getByRole('link', { name: '链接示例' })).toHaveCSS('text-decoration-line', 'underline');
  await expect(message.getByRole('link', { name: '链接示例' })).toHaveAttribute(
    'href',
    'https://example.com',
  );
  await expect(message).not.toContainText('**');
  await expect(message).not.toContainText('~~');
});
