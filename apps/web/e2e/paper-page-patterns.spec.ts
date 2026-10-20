import { expect, type Page, test } from '@playwright/test';

// Paper page patterns (DESIGN.md「页面模式」): one card radius, the shared
// EmptyState (adopted on API keys) and the settings list card.
//
// Failure modes, each pinned below:
//  R1 --radius-card drifts off the DESIGN.md card value (10px)
//  R2 the board task card stops reading the token
//  R3 the settings card goes back to its own corner (12px in #1386) or the
//     registry Card's rounded-xl (14px)
//  E1 the empty-state icon sits on a tinted tile again (orange or beige fill)
//  E2 the icon is painted in ink or accent instead of ink-3
//  E3 the action is not the shadcn default button at 32px / 8px corners
//     (size sm, an outline variant, a pill or a full-width bar)
//  E4 title / description leave the type keys (14px 500 / 12px ink-3) or the
//     description runs the full column width
//  S1 settings rows drift to per-row heights
//  S2 a divider lands on the card top or under the last row, doubling the
//     card outline there
//  S3 clickable rows (a Button per row) lose the divider: the button's own
//     transparent border outranks the card's zero-specificity divide rule

test.use({ deviceScaleFactor: 2, viewport: { width: 1440, height: 900 } });

function setTheme(page: Page, theme: 'light' | 'dark') {
  return page.addInitScript((t) => localStorage.setItem('pacman-theme', t), theme);
}

async function tokenRadius(page: Page) {
  return page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--radius-card').trim(),
  );
}

test('board task card and account settings card share --radius-card (R1–R3)', async ({ page }) => {
  await setTheme(page, 'light');
  await page.goto('/app?scenario=01');
  await expect(page.locator('.todo-card').first()).toBeVisible();
  expect(await tokenRadius(page), 'R1').toBe('10px');
  await expect(page.locator('.todo-card').first(), 'R2').toHaveCSS('border-top-left-radius', '10px');

  await page.goto('/app/account?scenario=13');
  const card = page.locator('.account-card');
  await expect(card).toBeVisible();
  await expect(card, 'R3').toHaveCSS('border-top-left-radius', await tokenRadius(page));
  await expect(card).toHaveClass(/settings-card/);
});

test('account settings rows are equal 52px with no doubled edge divider (S1, S2)', async ({
  page,
}) => {
  await setTheme(page, 'light');
  await page.goto('/app/account?scenario=13');
  const rows = page.locator('.account-card > .settings-row');
  await expect(rows).toHaveCount(3);
  const faces = await rows.evaluateAll((els) =>
    els.map((el) => {
      const cs = getComputedStyle(el);
      return {
        h: el.getBoundingClientRect().height,
        top: cs.borderTopWidth,
        bottom: cs.borderBottomWidth,
      };
    }),
  );
  expect(
    faces.map((f) => f.h),
    'S1',
  ).toEqual([52, 52, 52]);
  expect(
    faces.map((f) => f.top),
    'S2: no row draws a top divider',
  ).toEqual(['0px', '0px', '0px']);
  expect(
    faces.map((f) => f.bottom),
    'S2: dividers between rows only',
  ).toEqual(['1px', '1px', '0px']);
});

for (const theme of ['light', 'dark'] as const) {
  test(`API keys empty state: bare ink-3 icon, default primary, type keys (${theme}) (E1–E4)`, async ({
    page,
  }) => {
    await setTheme(page, theme);
    await page.goto('/app/api-keys');
    const empty = page.getByTestId('keys-empty');
    await expect(empty).toBeVisible();
    await expect(page.locator('.empty-state')).toHaveCount(1);
    const m = await empty.evaluate((el) => {
      const swatch = document.createElement('div');
      swatch.style.color = 'var(--text-tertiary)';
      document.body.append(swatch);
      const ink3 = getComputedStyle(swatch).color;
      swatch.remove();
      const svg = el.querySelector('svg');
      const tile = svg?.parentElement;
      const title = el.querySelector('h2');
      const desc = el.querySelector('p');
      const button = el.querySelector('button');
      if (!svg || !tile || !title || !desc || !button) throw new Error('empty state parts missing');
      const bcs = getComputedStyle(button);
      return {
        ink3,
        iconColor: getComputedStyle(svg).color,
        iconSize: svg.getBoundingClientRect().width,
        tileBg: getComputedStyle(tile).backgroundColor,
        tileShadow: getComputedStyle(tile).boxShadow,
        title: [getComputedStyle(title).fontSize, getComputedStyle(title).fontWeight],
        desc: [getComputedStyle(desc).fontSize, getComputedStyle(desc).color],
        descWidth: desc.getBoundingClientRect().width,
        emptyWidth: el.getBoundingClientRect().width,
        button: {
          variant: button.dataset.variant,
          size: button.dataset.size,
          h: button.getBoundingClientRect().height,
          w: button.getBoundingClientRect().width,
          radius: bcs.borderTopLeftRadius,
        },
      };
    });
    expect(m.tileBg, 'E1: no tinted tile behind the icon').toBe('rgba(0, 0, 0, 0)');
    expect(m.tileShadow, 'E1: no ring tile either').toBe('none');
    expect(m.iconColor, 'E2: icon in ink-3').toBe(m.ink3);
    expect(m.iconSize).toBe(24);
    expect(m.button.variant, 'E3').toBe('default');
    expect(m.button.size, 'E3').toBe('default');
    expect(m.button.h, 'E3: 32px').toBe(32);
    expect(m.button.radius, 'E3: 8px corners, not a pill').toBe('8px');
    expect(m.button.w, 'E3: not a full-width bar').toBeLessThan(m.emptyWidth / 2);
    expect(m.title, 'E4').toEqual(['14px', '500']);
    expect(m.desc, 'E4').toEqual(['12px', m.ink3]);
    expect(m.descWidth, 'E4: description capped near 44ch').toBeLessThanOrEqual(320);
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`clickable resource rows keep the card divider between rows only (${theme}) (S3)`, async ({
    page,
  }) => {
    await setTheme(page, theme);
    await page.goto('/app/resources/skills?scenario=skills-list');
    const rows = page.getByTestId('resource-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.first(), 'S3: rows are buttons').toHaveJSProperty('tagName', 'BUTTON');
    const border = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--border)';
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    });
    const faces = await rows.evaluateAll((els) =>
      els.map((el) => {
        const cs = getComputedStyle(el);
        return {
          top: cs.borderTopWidth,
          bottom: cs.borderBottomWidth,
          color: cs.borderBottomColor,
        };
      }),
    );
    expect(
      faces.map((f) => f.top),
      'S3: no top edge',
    ).toEqual(['0px', '0px', '0px']);
    expect(
      faces.map((f) => f.bottom),
      'S3: divider between rows, none under the last',
    ).toEqual(['1px', '1px', '0px']);
    expect(faces[0]?.color, 'S3: divider in --border').toBe(border);
    expect(faces[1]?.color, 'S3: divider in --border').toBe(border);
  });
}
