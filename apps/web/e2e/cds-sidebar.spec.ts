import { expect, test } from '@playwright/test';

test('CDS sidebar: 288px tier-1 surface, soft hairline, rounded row pills, scroll-fade', async ({
  page,
}) => {
  await page.goto('/app?scenario=01');
  await page.waitForSelector('.board-sidebar');

  const m = await page.evaluate(() => {
    const sidebar = document.querySelector('.board-sidebar')!;
    const nav = document.querySelector('.board-sidebar nav')!;
    const row = document.querySelector('.board-sidebar .sidebar-row')!;
    const ss = getComputedStyle(sidebar);
    const before = getComputedStyle(row, '::before');
    return {
      width: Math.round(sidebar.getBoundingClientRect().width),
      bg: ss.backgroundColor,
      surface1: ss.getPropertyValue('--surface-1').trim(),
      borderRightW: ss.borderRightWidth,
      shadow: ss.boxShadow,
      navHasScrollFade: nav.classList.contains('scroll-fade'),
      pillRadius: before.borderRadius,
      cdsRadiusLg: ss.getPropertyValue('--cds-radius-lg').trim(),
    };
  });

  expect(m.width).toBe(288);
  expect(m.borderRightW).toBe('0px');
  expect(m.shadow).not.toBe('none');
  expect(m.navHasScrollFade).toBe(true);
  expect(m.pillRadius).toContain('8px');
  expect(m.cdsRadiusLg).toBe('8px');
});
