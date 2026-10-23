import { expect, type Page, test } from '@playwright/test';

// Elevation ladder (#1428, tokens.css): three resting tiers, each rung =
// its pool + one outer 1 CSS px ring, and --top, the dark-only inset top
// highlight baked into the e2/e3 pools. Failure modes pinned here:
// 1. a rung loses its ring, or the ring is not the last shadow in the list
// 2. --top leaks into e1 (cards stay flat) or is missing from dark e2/e3
// 3. light --top stops being a composable no-op (a `none` comma-joined into
//    a rung voids the whole box-shadow, so a light rung would compute to none)
// 4. .light stops redefining a rung, so light surfaces inherit the dark pool
// 5. an old slot name stops aliasing its rung, or a pool stops being its
//    rung minus the ring
// 6. double ring: a surface that draws its own --edge-ring (notify banner,
//    chief window, FAB) also gets the rung's outer ring through its token
// 7. the composer loses its inset ring
// 8. a dark pool drifts from the pre-ladder darkness (#1396 owns dark retune)
// The slot probes read the token on a bare div; the surface probes read the
// rendered element, where the ring count is the double-ring guard.

const DETAIL = '/app/todo/7ve0iOkQ-JBpSL98zSiGc';

async function slot(page: Page, name: string): Promise<string> {
  return page.evaluate((n) => {
    const el = document.createElement('div');
    el.style.boxShadow = `var(--${n})`;
    document.body.append(el);
    const out = getComputedStyle(el).boxShadow;
    el.remove();
    return out;
  }, name);
}

/** The computed form of a 1px ring in `--<color>`, for endsWith checks. */
async function ringIn(page: Page, color: string): Promise<string> {
  return page.evaluate((c) => {
    const el = document.createElement('div');
    el.style.boxShadow = `0 0 0 1px var(--${c})`;
    document.body.append(el);
    const out = getComputedStyle(el).boxShadow;
    el.remove();
    return out;
  }, color);
}

async function surfaceShadow(page: Page, selector: string): Promise<string> {
  return page.locator(selector).first().evaluate((el) => getComputedStyle(el).boxShadow);
}

/** Rings in a computed box-shadow list: 1px spread, zero offset, zero blur. */
function rings(shadow: string): number {
  return (shadow.match(/0px 0px 0px 1px/g) ?? []).length;
}

const POOLS = {
  light: {
    'cds-shadow-sm': 'rgba(80, 60, 30, 0.04) 0px 1px 2px 0px',
    'cds-shadow-md': 'rgba(31, 27, 24, 0.1) 0px 8px 24px 0px, rgba(31, 27, 24, 0.05) 0px 2px 6px 0px',
    'cds-shadow-lg':
      'rgba(31, 27, 24, 0.16) 0px 16px 40px 0px, rgba(31, 27, 24, 0.06) 0px 2px 6px 0px',
  },
  dark: {
    'cds-shadow-sm': 'rgba(0, 0, 0, 0.4) 0px 1px 2px 0px, rgba(0, 0, 0, 0.4) 0px 2px 8px 0px',
    'cds-shadow-md': 'rgba(0, 0, 0, 0.65) 0px 8px 28px 0px, rgba(0, 0, 0, 0.45) 0px 2px 8px 0px',
    'cds-shadow-lg': 'rgba(0, 0, 0, 0.5) 0px 16px 40px 0px, rgba(0, 0, 0, 0.3) 0px 2px 6px 0px',
  },
} as const;

const TOP_DARK = 'rgba(255, 255, 255, 0.08) 0px 1px 0px 0px inset';
// light: a zero-alpha no-op that still composes inside a comma list (`none`
// there would void the whole box-shadow of any consumer that joins it)
const TOP_LIGHT = 'rgba(255, 255, 255, 0) 0px 1px 0px 0px inset';

const RUNGS = [
  ['e1', 'cds-shadow-sm'],
  ['e2', 'cds-shadow-md'],
  ['e3', 'cds-shadow-lg'],
] as const;

for (const theme of ['light', 'dark'] as const) {
  test.describe(`elevation ladder (${theme})`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
    });

    test('each rung is its pool plus one ring, ring last', async ({ page }) => {
      await page.goto('/app?scenario=01');
      await page.waitForSelector('.board-sidebar');
      const ringColor = theme === 'light' ? 'border' : 'ring-inset-highlight';
      const borderRing = await ringIn(page, 'border');
      const tierRing = await ringIn(page, ringColor);
      for (const [rung, poolName] of RUNGS) {
        const value = await slot(page, rung);
        const pool = await slot(page, poolName);
        expect(value, rung).not.toBe('none');
        expect(value.startsWith(`${pool}, `), `${rung} starts with its pool`).toBe(true);
        expect(rings(value), `${rung} ring count`).toBe(1);
        // e1 rings in --border on both sides; e2/e3 ring in the light-side
        // --border and the dark-side --ring-inset-highlight (the dialog's
        // pre-ladder ring colour).
        const want = rung === 'e1' ? borderRing : tierRing;
        expect(value.endsWith(want), `${rung} ends with its ring`).toBe(true);
      }
    });

    test('pools hold the pre-ladder darkness; --top only in dark e2/e3', async ({ page }) => {
      await page.goto('/app?scenario=01');
      await page.waitForSelector('.board-sidebar');
      const top = await slot(page, 'top');
      const e1 = await slot(page, 'e1');
      const e2 = await slot(page, 'e2');
      const e3 = await slot(page, 'e3');
      for (const [name, want] of Object.entries(POOLS[theme])) {
        const got = await slot(page, name);
        if (theme === 'dark' && name !== 'cds-shadow-sm') {
          expect(got, name).toBe(`${want}, ${TOP_DARK}`);
        } else {
          expect(got, name).toBe(want);
        }
      }
      expect(e1).not.toContain('inset');
      if (theme === 'light') {
        expect(top).toBe(TOP_LIGHT);
        expect(e2).not.toContain('inset');
        expect(e3).not.toContain('inset');
      } else {
        expect(top).toBe(TOP_DARK);
        expect(e2).toContain(TOP_DARK);
        expect(e3).toContain(TOP_DARK);
      }
    });

    test('old slot names alias the ladder', async ({ page }) => {
      await page.goto('/app?scenario=01');
      await page.waitForSelector('.board-sidebar');
      const pairs: Array<[string, string]> = [
        ['panel-shadow', 'e1'],
        ['shadow-popover', 'e2'],
        ['dialog-shadow', 'e3'],
        ['edge-shadow', 'e2'],
        ['fab-shadow', 'e2'],
        ['plate-shadow', 'e2'],
        ['chief-shadow', 'e2'],
        // pools, not rungs: their consumers draw their own --edge-ring
        ['card-shadow', 'cds-shadow-sm'],
        ['floating-shadow', 'cds-shadow-lg'],
        // a state, not a tier: the lift follows the e1 hover value
        ['card-lift', 'panel-shadow-hover'],
      ];
      for (const [alias, target] of pairs) {
        // boolean on purpose: the hover slot starts with an oklab() ring,
        // and probe-dump's #411 notation contract flags oklab-leading
        // assertion values as VIOLATION
        const same = (await slot(page, alias)) === (await slot(page, target));
        expect(same, `${alias} aliases ${target}`).toBe(true);
      }
      // state slots keep their inset ring (the composer draws no --edge-ring)
      for (const name of ['shadow-composer', 'shadow-composer-hover', 'shadow-composer-focus']) {
        const value = await slot(page, name);
        expect(value, name).toContain('0px 0px 0px 1px inset');
        expect(value, name).not.toContain(TOP_DARK);
      }
    });

    test('one ring per edge on the rendered surfaces', async ({ page }) => {
      const edgeRing = await (async () => {
        await page.goto('/app?scenario=01');
        await page.waitForSelector('.board-sidebar');
        return slot(page, 'edge-ring');
      })();

      // e1: the card rings once, flat, no inset
      const card = await surfaceShadow(page, '.todo-card');
      expect(rings(card)).toBe(1);
      expect(card).not.toContain('inset');

      // pool + own --edge-ring: exactly one ring, and it is the inset one
      await page.goto('/app?scenario=notify-banner');
      const banner = await surfaceShadow(page, '.board-notify-banner');
      expect(rings(banner)).toBe(1);
      expect(banner.startsWith(edgeRing)).toBe(true);

      await page.goto('/app?scenario=111');
      const drawer = await surfaceShadow(page, '.chief-drawer');
      expect(rings(drawer)).toBe(1);
      expect(drawer).toContain(edgeRing);

      await page.goto(`${DETAIL}?scenario=detail-unread`);
      const fab = await surfaceShadow(page, '.chief-fab');
      expect(rings(fab)).toBe(1);
      expect(fab).toContain(edgeRing);

      // e2: the menu rings once
      await page.goto(`${DETAIL}?scenario=17`);
      const menu = await surfaceShadow(page, '.user-menu');
      expect(rings(menu)).toBe(1);

      // the composer keeps its inset ring, and only that ring
      await page.goto(`${DETAIL}?scenario=16`);
      const composer = await surfaceShadow(page, '[data-testid="composer-card"]');
      expect(rings(composer)).toBe(1);
      expect(composer).toContain('0px 0px 0px 1px inset');

      // e3: the dialog rings once
      await page.goto('/app/resources/secrets?scenario=01');
      await page.getByRole('button', { name: '新建', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '添加密钥' });
      await expect(dialog).toBeVisible();
      const dialogShadow = await dialog.evaluate((el) => getComputedStyle(el).boxShadow);
      expect(rings(dialogShadow)).toBe(1);
      if (theme === 'dark') {
        expect(menu).toContain(TOP_DARK);
        expect(dialogShadow).toContain(TOP_DARK);
        expect(drawer).toContain(TOP_DARK);
      }
    });
  });
}
