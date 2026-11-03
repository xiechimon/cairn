import { expect, test } from '@playwright/test';
import { keyboardFocus, readRing, settleTransitions } from './helpers.js';

test('api key permission checkboxes keep whole focus rings while the list scrolls', async ({
  page,
}) => {
  await page.goto('/app/api-keys');
  await page.getByRole('button', { name: '新建密钥' }).first().click();
  const boxes = page.getByRole('dialog').getByRole('checkbox', { name: /^(读|写) / });
  const count = await boxes.count();
  expect(count).toBeGreaterThan(8);
  await keyboardFocus(page, boxes.first());
  for (let i = 0; i < count; i += 1) {
    const box = boxes.nth(i);
    const label = await box.getAttribute('aria-label');
    expect({ label, ...(await readRing(box)) }).toEqual({
      label,
      focused: true,
      outline: 'solid 2px',
      clippedBy: [],
    });
    await page.keyboard.press('Tab');
    await settleTransitions(page);
  }
});
