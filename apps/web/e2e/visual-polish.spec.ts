import { expect, type Page, test } from '@playwright/test';

async function edgeContract(page: Page, selector: string) {
  return page.locator(selector).first().evaluate((el) => {
    const ringProbe = document.createElement('div');
    ringProbe.style.boxShadow = 'var(--edge-ring)';
    const colorProbe = document.createElement('div');
    colorProbe.style.backgroundColor = 'var(--border)';
    const cardShadowProbe = document.createElement('div');
    cardShadowProbe.style.boxShadow = 'var(--cds-shadow-sm)';
    const cardLiftProbe = document.createElement('div');
    cardLiftProbe.style.boxShadow = 'var(--card-lift)';
    const panelShadowProbe = document.createElement('div');
    panelShadowProbe.style.boxShadow = 'var(--panel-shadow)';
    const borderTokenProbe = document.createElement('div');
    borderTokenProbe.style.backgroundColor = 'var(--border)';
    document.body.append(
      ringProbe,
      colorProbe,
      cardShadowProbe,
      cardLiftProbe,
      panelShadowProbe,
      borderTokenProbe,
    );
    const cs = getComputedStyle(el);
    const out = {
      shadow: cs.boxShadow,
      ring: getComputedStyle(ringProbe).boxShadow,
      borderColor: getComputedStyle(colorProbe).backgroundColor,
      borderToken: getComputedStyle(borderTokenProbe).backgroundColor,
      borderColorOwn: cs.borderTopColor,
      cardShadow: getComputedStyle(cardShadowProbe).boxShadow,
      cardLift: getComputedStyle(cardLiftProbe).boxShadow,
      panelShadow: getComputedStyle(panelShadowProbe).boxShadow,
      radius: cs.borderTopLeftRadius,
      border: cs.borderTopWidth,
    };
    ringProbe.remove();
    colorProbe.remove();
    cardShadowProbe.remove();
    cardLiftProbe.remove();
    panelShadowProbe.remove();
    borderTokenProbe.remove();
    return out;
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`notify banner rides the same edge ring and no drop shadow (${theme})`, async ({
    page,
  }) => {
    await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
    await page.goto('/app?scenario=notify-banner');

    const banner = await edgeContract(page, '.board-notify-banner');

    expect(banner.border).toBe('0px');
    expect(banner.radius).toBe('12px');
    expect(banner.shadow.endsWith(`${banner.borderColor} 0px 0px 0px 1px`)).toBe(true);
    expect(banner.shadow).not.toContain(banner.cardShadow);
  });

  test(`sidebar shares the sheet surface, no seam of its own (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
    await page.goto('/app?scenario=01');

    const probe = await page.evaluate(() => {
      const sidebar = document.querySelector('.board-sidebar');
      const main = document.querySelector('.board-sheet');
      if (!sidebar || !main) throw new Error('home layout missing');
      const cs = getComputedStyle(sidebar);
      return {
        sidebarBg: cs.backgroundColor,
        mainBg: getComputedStyle(main).backgroundColor,
        borderRight: cs.borderRightWidth,
        shadow: cs.boxShadow,
      };
    });
    expect(probe.sidebarBg).toBe(probe.mainBg);
    expect(probe.borderRight).toBe('0px');
    expect(probe.shadow).toBe('none');
  });
}

test('collapsed rail draws no seam either (Paper PR 7)', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('cairn-theme', 'dark');
    localStorage.setItem('cairn.sidebar-collapsed', '1');
  });
  await page.goto('/app/schedules?scenario=01');

  const rail = await page.locator('.board-sidebar--collapsed').evaluate((el) => {
    const cs = getComputedStyle(el);
    return { borderRight: cs.borderRightWidth, shadow: cs.boxShadow };
  });
  expect(rail.borderRight).toBe('0px');
  expect(rail.shadow).toBe('none');
});
