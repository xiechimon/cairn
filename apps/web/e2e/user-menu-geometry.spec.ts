import { expect, type Locator, type Page, test } from '@playwright/test';

const BOARD = '/app?scenario=01';
const ACCOUNT = '/app/account?scenario=01';

const LOCALES = [
  { locale: 'zh', language: '语言' },
  { locale: 'en', language: 'Language' },
] as const;

async function seed(page: Page, locale: string, theme: string) {
  await page.addInitScript(
    ([l, t]) => {
      localStorage.setItem('cairn.locale', l);
      localStorage.setItem('cairn-locale', l);
      localStorage.setItem('cairn-theme', t);
    },
    [locale, theme] as const,
  );
}

async function settle(surface: Locator) {
  await expect(surface).toBeVisible();
  await surface.evaluate((el) =>
    Promise.all(
      (el.parentElement ?? el).getAnimations({ subtree: true }).map((a) => a.finished),
    ),
  );
}

async function overflowingDescendants(surface: Locator) {
  return surface.evaluate((panel) => {
    const box = panel.getBoundingClientRect();
    const out: string[] = [];
    for (const el of panel.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (
        r.left < box.left - 0.5 ||
        r.right > box.right + 0.5 ||
        r.top < box.top - 0.5 ||
        r.bottom > box.bottom + 0.5
      ) {
        out.push(`${el.tagName.toLowerCase()}.${el.className} "${el.textContent?.trim()}"`);
      }
    }
    return out;
  });
}

async function geometry(surface: Locator, item: string) {
  return surface.evaluate((panel, itemSelector) => {
    const cs = getComputedStyle(panel);
    const rows = [...panel.querySelectorAll(itemSelector)].map((el) => {
      const r = el.getBoundingClientRect();
      return { radius: Number.parseFloat(getComputedStyle(el).borderTopLeftRadius), r };
    });
    const box = panel.getBoundingClientRect();
    const first = rows[0]?.r;
    const last = rows.at(-1)?.r;
    return {
      outer: Number.parseFloat(cs.borderTopLeftRadius),
      pad: Number.parseFloat(cs.paddingLeft),
      padBottom: Number.parseFloat(cs.paddingBottom),
      radii: rows.map((row) => row.radius),
      gapLeft: first === undefined ? -1 : first.left - box.left,
      gapRight: first === undefined ? -1 : box.right - first.right,
      gapBottom: last === undefined ? -1 : box.bottom - last.bottom,
      clipped: panel.scrollHeight > panel.clientHeight + 0.5,
    };
  }, item);
}

for (const theme of ['light', 'dark'] as const) {
  for (const { locale, language } of LOCALES) {
    test(`user menu: every control stays inside the panel, nested radii are concentric (${theme}, ${locale})`, async ({
      page,
    }) => {
      await seed(page, locale, theme);
      await page.goto(BOARD);
      await page.getByRole('complementary').getByRole('button', { name: 'Xmon Dai' }).click();
      const menu = page.locator('.user-menu');
      await settle(menu);

      expect(await overflowingDescendants(menu)).toEqual([]);

      const g = await geometry(menu, 'a.user-menu-row');
      expect(g.clipped).toBe(false);
      expect(g.radii).toHaveLength(3);
      for (const radius of g.radii) expect(radius).toBe(g.outer - g.pad);
      expect(g.gapLeft).toBeCloseTo(g.pad, 0);
      expect(g.gapRight).toBeCloseTo(g.pad, 0);
      expect(g.gapBottom).toBeCloseTo(g.padBottom, 0);

      const tracks = menu.locator('[data-segmented="track"]');
      await expect(tracks).toHaveCount(2);
      const [appearance, density] = await Promise.all([
        tracks.nth(0).boundingBox(),
        tracks.nth(1).boundingBox(),
      ]);
      expect(density!.x).toBe(appearance!.x);
      expect(density!.width).toBe(appearance!.width);
    });

    test(`language select: padded list, pill rows concentric with the popup (${theme}, ${locale})`, async ({
      page,
    }) => {
      await seed(page, locale, theme);
      await page.goto(ACCOUNT);
      await page.getByRole('combobox', { name: language }).click();
      const popup = page.locator('[data-slot="select-content"]');
      await settle(popup);

      expect(await overflowingDescendants(popup)).toEqual([]);

      const g = await geometry(popup, '[data-slot="select-item"]');
      expect(g.clipped).toBe(false);
      expect(g.pad).toBeGreaterThan(0);
      expect(g.radii).toHaveLength(2);
      for (const radius of g.radii) expect(radius).toBe(g.outer - g.pad);
      expect(g.gapLeft).toBeCloseTo(g.pad, 0);
      expect(g.gapBottom).toBeCloseTo(g.padBottom, 0);
    });
  }
}

test('menu tokens: --radius-menu-item resolves to --radius-popover minus --menu-pad', async ({
  page,
}) => {
  await page.goto(BOARD);
  const t = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.borderRadius = 'var(--radius-menu-item)';
    probe.style.padding = 'var(--menu-pad)';
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    const out = {
      item: Number.parseFloat(cs.borderTopLeftRadius),
      pad: Number.parseFloat(cs.paddingLeft),
      outer: Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--radius-popover'),
      ),
    };
    probe.remove();
    return out;
  });
  expect(t.pad).toBeGreaterThan(0);
  expect(t.item).toBe(t.outer - t.pad);
});
