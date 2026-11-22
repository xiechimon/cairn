import { expect, type Locator, type Page, test } from '@playwright/test';

const HOME = '/app?scenario=home-c';

const panel = (page: Page) => page.getByRole('complementary', { name: '任务' });

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

async function painted(el: Locator, prop: 'color' | 'background-color') {
  return el.evaluate((node, key) => {
    const ctx = document.createElement('canvas').getContext('2d');
    if (ctx === null) throw new Error('no 2d context');
    ctx.fillStyle = getComputedStyle(node).getPropertyValue(key);
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return [r as number, g as number, b as number];
  }, prop);
}

async function backplate(el: Locator) {
  return el.evaluate((node) => {
    const layers: number[][] = [];
    for (let cur: HTMLElement | null = node; cur !== null; cur = cur.parentElement) {
      const match = /rgba?\(([^)]+)\)/.exec(getComputedStyle(cur).backgroundColor);
      if (match === null) continue;
      const parts = match[1]!.split(/[\s,/]+/).filter(Boolean).map(Number);
      const alpha = parts.length === 4 ? (parts[3] as number) : 1;
      if (alpha === 0) continue;
      layers.push([parts[0] as number, parts[1] as number, parts[2] as number, alpha]);
      if (alpha === 1) break;
    }
    let r = 255;
    let g = 255;
    let b = 255;
    for (const [lr, lg, lb, la] of layers.reverse()) {
      r = (lr as number) * (la as number) + r * (1 - (la as number));
      g = (lg as number) * (la as number) + g * (1 - (la as number));
      b = (lb as number) * (la as number) + b * (1 - (la as number));
    }
    return [Math.round(r), Math.round(g), Math.round(b)];
  });
}

async function expectTip(page: Page, button: Locator, label: string) {
  await button.hover();
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText(label);
  await page.mouse.move(0, 0);
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveCount(0);
}

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: the waiting-section count meets AA contrast`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
    await page.goto(`${HOME}&pane=tasks`);
    const count = panel(page).locator('[data-section="ready_for_review"] h3 span').first();
    await expect(count).toHaveText('1');
    expect(ratio(await painted(count, 'color'), await backplate(count))).toBeGreaterThanOrEqual(4.5);
  });

  test(`${theme}: the selected provider's secondary text meets AA contrast`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
    await page.goto('/app/settings/routing?scenario=model-routing');
    const status = page.locator('[data-instance-id][aria-current="true"] .line-clamp-2').first();
    await expect(status).toBeVisible();
    expect(ratio(await painted(status, 'color'), await backplate(status))).toBeGreaterThanOrEqual(
      4.5,
    );
  });
}

test('closing the add field returns focus to the button that opened it', async ({ page }) => {
  await page.goto(`${HOME}&pane=tasks`);
  const plus = panel(page).getByTestId('tasks-new');
  const input = panel(page).getByTestId('tasks-add-input');
  await plus.click();
  await expect(input).toBeFocused();
  await input.press('Escape');
  await expect(input).toHaveCount(0);
  await expect(plus).toBeFocused();
  await plus.click();
  await input.fill('Check the relay probe');
  await input.press('Enter');
  await expect(input).toHaveCount(0);
  await expect(plus).toBeFocused();
});

test('the panel close and the chief send show their names on hover', async ({ page }) => {
  await page.goto('/app?scenario=01&pane=tasks');
  await expectTip(page, panel(page).locator('[data-panel-close]'), '关闭');
  await expectTip(page, page.getByRole('button', { name: '发送' }), '发送');
});
