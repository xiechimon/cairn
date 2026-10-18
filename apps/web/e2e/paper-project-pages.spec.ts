import { expect, type Page, test } from '@playwright/test';

// Project settings and new project on the Paper page patterns (DESIGN.md
// 「页面模式」: settings list + form layout).
//
// Failure modes, each pinned below:
//  P1 the project identity goes back into the card as a centered avatar block
//     instead of the 56px header circle above the card
//  P2 the settings card leaves --radius-card (registry rounded-xl 14px)
//  P3 rows drift to per-row heights, or a divider lands on the card edge
//  P4 删除 sits inside the settings card again, or the button turns back into
//     a pill / a non-32px box
//  P5 目标分支 becomes a real control (button / Select) with nothing behind it
//  N1 the avatar placeholder is a beige tile again instead of a white ring circle
//  N2 inputs span the whole column instead of the 520px form stack
//  N3 创建项目 is a full-width bar instead of a right-aligned 32px default button

const SETTINGS = '/app/project/ZAQczKCu0MOAzC1ZqcFlX/settings?scenario=r2-24c';
const NEW_PROJECT = '/app/project/new?scenario=01';

test.use({ deviceScaleFactor: 2, viewport: { width: 1440, height: 900 } });

function setTheme(page: Page, theme: 'light' | 'dark') {
  return page.addInitScript((t) => localStorage.setItem('pacman-theme', t), theme);
}

for (const theme of ['light', 'dark'] as const) {
  test(`project settings: header, one card of equal rows, danger zone card (${theme})`, async ({
    page,
  }) => {
    await setTheme(page, theme);
    await page.goto(SETTINGS);

    const header = page.locator('.settings-header');
    await expect(header.getByRole('heading', { name: 'r3-lifecycle' })).toBeVisible();
    const avatar = header.locator('.prj-set-avatar');
    const avatarBox = await avatar.boundingBox();
    expect(avatarBox?.width, 'P1').toBe(56);
    expect(avatarBox?.height, 'P1').toBe(56);

    const card = page.locator('.prj-set-card');
    await expect(card.locator('.prj-set-avatar'), 'P1').toHaveCount(0);
    const radius = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--radius-card').trim(),
    );
    await expect(card, 'P2').toHaveCSS('border-top-left-radius', radius);

    const rows = card.locator('> .settings-row');
    await expect(rows).toHaveCount(4);
    const faces = await rows.evaluateAll((els) =>
      els.map((el) => ({
        h: el.getBoundingClientRect().height,
        top: getComputedStyle(el).borderTopWidth,
        bottom: getComputedStyle(el).borderBottomWidth,
      })),
    );
    expect(
      faces.map((f) => f.h),
      'P3',
    ).toEqual([52, 52, 52, 52]);
    expect(
      faces.map((f) => f.top),
      'P3',
    ).toEqual(['0px', '0px', '0px', '0px']);
    expect(
      faces.map((f) => f.bottom),
      'P3',
    ).toEqual(['1px', '1px', '1px', '0px']);

    const del = page.getByRole('button', { name: '删除', exact: true });
    await expect(card.getByRole('button', { name: '删除', exact: true }), 'P4').toHaveCount(0);
    await expect(
      page.locator('.prj-set-danger').getByRole('button', { name: '删除', exact: true }),
      'P4',
    ).toHaveCount(1);
    await expect(page.locator('.prj-set-danger'), 'P4').toHaveCSS('border-top-left-radius', radius);
    const delBox = await del.boundingBox();
    expect(delBox?.height, 'P4').toBe(32);
    await expect(del, 'P4').toHaveCSS('border-top-left-radius', '8px');

    const branch = card.locator('span.prj-set-branch');
    await expect(branch, 'P5').toHaveText('main');
    expect((await branch.boundingBox())?.height, 'P5').toBe(32);
    await expect(page.getByRole('button', { name: /main/ }), 'P5').toHaveCount(0);
    await expect(page.getByRole('combobox'), 'P5').toHaveCount(0);
  });

  test(`new project: ring avatar, 520px form stack, right-aligned create (${theme})`, async ({
    page,
  }) => {
    await setTheme(page, theme);
    await page.goto(NEW_PROJECT);

    const avatar = page.locator('.prj-new-avatar');
    const avatarBox = await avatar.boundingBox();
    expect(avatarBox?.width, 'N1').toBe(56);
    const avatarRadius = await avatar.evaluate((el) =>
      Number.parseFloat(getComputedStyle(el).borderTopLeftRadius),
    );
    expect(avatarRadius, 'N1: a circle, not a rounded tile').toBeGreaterThanOrEqual(28);
    const avatarBg = await avatar.evaluate((el) => getComputedStyle(el).backgroundColor);
    const cardBg = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.className = 'bg-card';
      document.body.append(probe);
      const bg = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return bg;
    });
    expect(avatarBg, 'N1').toBe(cardBg);

    const name = page.locator('#prj-new-name');
    const repo = page.locator('#prj-new-repo');
    const nameBox = await name.boundingBox();
    const repoBox = await repo.boundingBox();
    expect(nameBox?.width, 'N2').toBeLessThanOrEqual(520);
    expect(nameBox?.height, 'N2').toBe(32);
    expect(repoBox?.height, 'N2').toBe(32);
    await expect(name, 'N2').toHaveCSS('border-top-left-radius', '8px');

    const create = page.getByRole('button', { name: '创建项目' });
    await expect(create).toBeDisabled();
    const createBox = await create.boundingBox();
    expect(createBox?.height, 'N3').toBe(32);
    expect(createBox?.width ?? 0, 'N3').toBeLessThan(200);
    const right = (b: { x: number; width: number } | null) => (b ? b.x + b.width : 0);
    expect(Math.abs(right(createBox) - right(nameBox)), 'N3').toBeLessThanOrEqual(1);
  });
}
