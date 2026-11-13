import { expect, test } from '@playwright/test';

test('CDS sidebar: 220px on the sheet surface, no seam, rounded rows, scroll-fade', async ({
  page,
}) => {
  await page.goto('/app?scenario=01');
  await page.waitForSelector('.board-sidebar');

  const m = await page.evaluate(() => {
    const sidebar = document.querySelector('.board-sidebar')!;
    const nav = document.querySelector('.board-sidebar nav')!;
    const row = document.querySelector('.board-sidebar [data-slot="sidebar-nav-row"]')!;
    const ss = getComputedStyle(sidebar);
    return {
      width: Math.round(sidebar.getBoundingClientRect().width),
      bg: ss.backgroundColor,
      sheet: ss.getPropertyValue('--background').trim(),
      surface: ss.getPropertyValue('--sidebar-surface').trim(),
      borderRightW: ss.borderRightWidth,
      shadow: ss.boxShadow,
      navHasScrollFade: nav.classList.contains('scroll-fade'),
      rowRadius: getComputedStyle(row).borderRadius,
      cdsRadiusMd: ss.getPropertyValue('--cds-radius-md').trim(),
    };
  });

  expect(m.width).toBe(220);
  expect(m.borderRightW).toBe('0px');
  // Paper board sheet (PR 7): the sheet's own ring is the edge; a sidebar
  // hairline would only show as a stub in the 10px canvas gaps
  expect(m.shadow).toBe('none');
  expect(m.navHasScrollFade).toBe(true);
  expect(m.rowRadius).toBe('6px');
  expect(m.cdsRadiusMd).toBe('6px');
  expect(m.surface).toBe(m.sheet);
});
