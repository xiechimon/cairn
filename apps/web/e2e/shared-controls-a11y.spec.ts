import { expect, test, type Page } from '@playwright/test';

const toLinear = (v: number) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: number[]) =>
  0.2126 * toLinear(r as number) + 0.7152 * toLinear(g as number) + 0.0722 * toLinear(b as number);
const ratio = (a: number[], b: number[]) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => (y as number) - (x as number));
  return ((hi as number) + 0.05) / ((lo as number) + 0.05);
};

async function rgb(el: import('@playwright/test').Locator, prop: string) {
  return el.evaluate((node, key) => {
    const ctx = document.createElement('canvas').getContext('2d');
    if (ctx === null) throw new Error('no 2d context');
    ctx.fillStyle = getComputedStyle(node).getPropertyValue(key);
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return [r as number, g as number, b as number];
  }, prop);
}

async function openGallery(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
  await page.goto('/design.html#checkbox-and-switch');
}

const switchSpecimen = (page: Page) => page.locator('[data-specimen="checkbox-and-switch"]');

test('light: the off switch track stands at least 3:1 from the card (#5202)', async ({ page }) => {
  await openGallery(page, 'light');
  const specimen = switchSpecimen(page);
  const track = specimen.getByRole('switch', { checked: false }).first();
  await expect(track).toBeVisible();
  const value = ratio(
    await rgb(track, 'background-color'),
    await rgb(specimen, 'background-color'),
  );
  expect(value).toBeGreaterThanOrEqual(3);
});

test('dark: the switch thumb stands at least 3:1 from the on track (#5202)', async ({ page }) => {
  await openGallery(page, 'dark');
  const specimen = switchSpecimen(page);
  const track = specimen.getByRole('switch', { checked: true }).first();
  await expect(track).toBeVisible();
  const thumb = track.locator('[data-slot="switch-thumb"]');
  const value = ratio(await rgb(thumb, 'background-color'), await rgb(track, 'background-color'));
  expect(value).toBeGreaterThanOrEqual(3);
});

test.describe('at phone width on a touch device', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('dialog foot buttons reach the 44px touch target (#5202)', async ({ page }) => {
    await page.goto('/app/resources/mcp-servers?scenario=mcp-manage-needs-auth');
    const foot = page.getByRole('dialog').getByTestId('dialog-foot');
    await expect(foot).toBeVisible();
    for (const button of await foot.getByRole('button').all()) {
      const height = await button.evaluate(
        (el) => parseFloat(getComputedStyle(el).getPropertyValue('height')),
      );
      expect(height).toBeGreaterThanOrEqual(44);
    }
  });

  test('dialog head, body and foot spacing stays on the 4px grid (#5202)', async ({ page }) => {
    await page.goto('/app/resources/mcp-servers?scenario=mcp-manage-needs-auth');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const values = await dialog.evaluate((el) => {
      const pick = (node: Element | null, props: string[]) =>
        node === null
          ? []
          : props.map((prop) => parseFloat(getComputedStyle(node).getPropertyValue(prop)));
      return [
        ...pick(el.querySelector('[data-testid="dialog-head"]'), [
          'padding-top',
          'padding-bottom',
        ]),
        ...pick(el.querySelector('[data-testid="dialog-body"]'), [
          'padding-top',
          'padding-bottom',
        ]),
        ...pick(el.querySelector('[data-testid="dialog-foot"]'), [
          'padding-top',
          'padding-bottom',
        ]),
        ...pick(el.querySelector('[data-testid="dialog-head"] p'), ['margin-top']),
      ];
    });
    for (const value of values) {
      expect(value % 4).toBe(0);
    }
  });
});
