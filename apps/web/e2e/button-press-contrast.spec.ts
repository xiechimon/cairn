import { expect, type Locator, type Page, test } from '@playwright/test';

type Rgba = [number, number, number, number];

function channel(value: number): number {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]: Rgba): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi as number) + 0.05) / ((lo as number) + 0.05);
}

async function pressedColors(page: Page, control: Locator) {
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  if (box === null) throw new Error('control has no box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(300);
  await page.mouse.down();
  expect(await control.evaluate((el) => el.matches(':active')), 'the control is pressed').toBe(true);
  const pressed = await control.evaluate((el) => {
    const toRgba = (css: string): [number, number, number, number] => {
      const probe = document.createElement('canvas').getContext('2d');
      if (probe === null) throw new Error('no 2d context');
      probe.clearRect(0, 0, 1, 1);
      probe.fillStyle = css;
      probe.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
      return [r as number, g as number, b as number, (a as number) / 255];
    };
    const blend = (top: [number, number, number, number], under: [number, number, number, number]) => {
      const a = top[3] + under[3] * (1 - top[3]);
      if (a === 0) return [0, 0, 0, 0] as [number, number, number, number];
      const mix = (i: 0 | 1 | 2) => (top[i] * top[3] + under[i] * under[3] * (1 - top[3])) / a;
      return [mix(0), mix(1), mix(2), a] as [number, number, number, number];
    };
    let base: [number, number, number, number] = [255, 255, 255, 1];
    const chain: Element[] = [];
    for (let node: Element | null = el; node !== null; node = node.parentElement) chain.unshift(node);
    for (const node of chain) {
      const style = getComputedStyle(node);
      const bg = toRgba(style.backgroundColor);
      if (bg[3] > 0) base = blend(bg, base);
      if (node === el) {
        const overlay = /(rgba?\([^)]*\)|oklab\([^)]*\)|oklch\([^)]*\)|color\([^)]*\))\s+0px 0px 0px \d+(?:\.\d+)?px inset/.exec(
          style.boxShadow,
        );
        if (overlay?.[1] !== undefined) base = blend(toRgba(overlay[1]), base);
      }
    }
    return { fg: toRgba(getComputedStyle(el).color), bg: base };
  });
  await page.mouse.move(0, 0);
  await page.mouse.up();
  return pressed;
}

async function expectReadable(page: Page, control: Locator, label: string, min = 4.5) {
  const { fg, bg } = await pressedColors(page, control);
  const ratio = contrast([fg[0], fg[1], fg[2], 1], [bg[0], bg[1], bg[2], 1]);
  expect(ratio, `${label} pressed contrast`).toBeGreaterThanOrEqual(min);
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(theme, () => {
    test.use({ colorScheme: theme });

    test('the Coordinator answer send icon keeps non-text contrast while pressed', async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
      await page.goto('/app?scenario=chief-question');
      await page.getByTestId('home-c').locator('.chief-composer textarea, .chief-composer [contenteditable]').first().fill('hello');
      await expectReadable(page, page.getByTestId('chief-question-primary'), 'chief answer icon', 3);
    });

    test('the thread composer Send button stays readable while pressed', async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
      await page.goto('/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=16');
      await page.getByTestId('composer-card').first().waitFor();
      await page.getByTestId('composer-toolbar').locator('xpath=ancestor::*[1]').locator('textarea, [contenteditable]').first().fill('hello');
      await expectReadable(page, page.locator('.composer-send').first(), 'thread send');
    });

    test('the bulk bar actions stay readable while pressed', async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
      await page.goto('/design.html');
      await page.getByRole('checkbox').first().check();
      const bar = page.locator('[data-slot="bulk-bar"]');
      await expect(bar).toBeVisible();
      for (const name of ['Resolve', 'Snooze', 'Archive', 'Clear selection']) {
        await expectReadable(page, bar.getByRole('button', { name }), `bulk ${name}`);
      }
    });
  });
}
