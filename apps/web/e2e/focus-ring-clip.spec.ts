import { expect, test } from '@playwright/test';
import { keyboardFocus, readRing, settleTransitions, stubLiveApiKeys } from './helpers.js';

test('api key permission checkboxes keep whole focus rings while the dialog scrolls', async ({
  page,
}) => {
  await stubLiveApiKeys(page);
  await page.goto('/app/api-keys');
  await page.getByRole('button', { name: '新建密钥' }).first().click();
  await page.getByRole('dialog').getByRole('radio', { name: '只读', exact: true }).click();
  await page.getByRole('dialog').getByRole('radio', { name: '自定义', exact: true }).click();
  const boxes = page
    .getByRole('dialog')
    .getByRole('group', { name: /^(读取|写入)$/ })
    .getByRole('checkbox');
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
