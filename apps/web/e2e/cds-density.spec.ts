import { expect, test } from '@playwright/test';

test('CDS density: comfortable default; compact rem-scale 0.9375 + data-density', async ({
  page,
}) => {
  await page.goto('/app/account?scenario=01');
  await page.waitForSelector('.account-density-row');

  const before = await page.evaluate(() => {
    const root = document.documentElement;
    const cs = getComputedStyle(root);
    return {
      density: root.dataset.density ?? null,
      remScale: cs.getPropertyValue('--rem-scale').trim(),
      padCard: cs.getPropertyValue('--pad-card').trim(),
    };
  });
  expect(before.density).toBeNull();
  // comfortable keeps :root calc(16/17)
  expect(before.remScale).toMatch(/calc|0\.94/);
  expect(before.padCard).toBe('16px');

  await page.getByTestId('account-density-compact').click();
  await page.waitForFunction(() => document.documentElement.dataset.density === 'compact');

  const after = await page.evaluate(() => {
    const root = document.documentElement;
    const cs = getComputedStyle(root);
    return {
      density: root.dataset.density ?? null,
      remScale: cs.getPropertyValue('--rem-scale').trim(),
      padCard: cs.getPropertyValue('--pad-card').trim(),
      stored: localStorage.getItem('pacman-density'),
    };
  });
  expect(after.density).toBe('compact');
  expect(['0.9375', '.9375']).toContain(after.remScale);
  expect(after.padCard).toBe('8px');
  expect(after.stored).toBe('compact');

  await page.getByTestId('account-density-comfortable').click();
  await page.waitForFunction(() => !document.documentElement.dataset.density);
  const back = await page.evaluate(() => ({
    density: document.documentElement.dataset.density ?? null,
    stored: localStorage.getItem('pacman-density'),
    padCard: getComputedStyle(document.documentElement).getPropertyValue('--pad-card').trim(),
  }));
  expect(back.density).toBeNull();
  expect(back.stored).toBe('comfortable');
  expect(back.padCard).toBe('16px');
});
