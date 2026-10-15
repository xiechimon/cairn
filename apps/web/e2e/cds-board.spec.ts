import { expect, test } from '@playwright/test';

test('CDS board: bare columns, panel cards 10px + panel-shadow', async ({ page }) => {
  await page.goto('/app?scenario=01');
  await page.waitForSelector('.board-column');
  await page.waitForSelector('.todo-card');

  const m = await page.evaluate(() => {
    const col = document.querySelector('.board-column')!;
    const card = document.querySelector('.todo-card')!;
    const csCol = getComputedStyle(col);
    const csCard = getComputedStyle(card);
    const probe = document.createElement('div');
    probe.style.boxShadow = 'var(--panel-shadow)';
    document.body.appendChild(probe);
    const panelShadow = getComputedStyle(probe).boxShadow;
    probe.remove();
    const header = col.querySelector('header')!;
    return {
      colBorder: csCol.borderTopWidth,
      colRadius: csCol.borderTopLeftRadius,
      colShadow: csCol.boxShadow,
      cardRadius: csCard.borderTopLeftRadius,
      cardShadow: csCard.boxShadow,
      panelShadow,
      headerH: Math.round(header.getBoundingClientRect().height),
      radiusPanel: getComputedStyle(document.documentElement)
        .getPropertyValue('--radius-panel')
        .trim(),
    };
  });

  expect(m.colBorder).toBe('0px');
  expect(m.colRadius).toBe('0px');
  expect(m.colShadow).toBe('none');
  expect(m.cardRadius).toBe('10px');
  expect(m.radiusPanel).toBe('10px');
  expect(m.cardShadow).toContain(m.panelShadow);
  expect(m.headerH).toBe(32);
});
