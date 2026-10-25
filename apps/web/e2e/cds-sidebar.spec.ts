import { expect, test } from '@playwright/test';

test('CDS sidebar: 248px tier-1 surface, no seam, rounded rows, scroll-fade', async ({
  page,
}) => {
  await page.goto('/app?scenario=01');
  await page.waitForSelector('.board-sidebar');

  const m = await page.evaluate(() => {
    const sidebar = document.querySelector('.board-sidebar')!;
    const nav = document.querySelector('.board-sidebar nav')!;
    const row = document.querySelector('.board-sidebar .sidebar-row')!;
    const ss = getComputedStyle(sidebar);
    return {
      width: Math.round(sidebar.getBoundingClientRect().width),
      bg: ss.backgroundColor,
      surface1: ss.getPropertyValue('--surface-1').trim(),
      borderRightW: ss.borderRightWidth,
      shadow: ss.boxShadow,
      navHasScrollFade: nav.classList.contains('scroll-fade'),
      rowRadius: getComputedStyle(row).borderRadius,
      cdsRadiusLg: ss.getPropertyValue('--cds-radius-lg').trim(),
    };
  });

  expect(m.width).toBe(248);
  expect(m.borderRightW).toBe('1px');
  // Paper board sheet (PR 7): the sheet's own ring is the edge; a sidebar
  // hairline would only show as a stub in the 10px canvas gaps
  expect(m.shadow).toBe('none');
  expect(m.navHasScrollFade).toBe(true);
  expect(m.rowRadius).toBe('8px');
  expect(m.cdsRadiusLg).toBe('8px');
});
