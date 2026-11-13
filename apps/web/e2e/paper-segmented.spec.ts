import { expect, type Locator, type Page, test } from '@playwright/test';

const PROJ = '/app/project/ZAQczKCu0MOAzC1ZqcFlX/settings';

interface Control {
  name: string;
  url: string;
  open?: (page: Page) => Promise<void>;
  track: (page: Page) => Locator;
}

const CONTROLS: Control[] = [
  {
    name: 'project settings tabs',
    url: `${PROJ}?scenario=r2-24c`,
    track: (page) => page.locator('.page-tabs-group'),
  },
  {
    name: 'settings appearance',
    url: '/app/settings/appearance?scenario=01',
    track: (page) => page.getByRole('radiogroup', { name: '外观' }),
  },
];

async function themed(page: Page, theme: 'light' | 'dark', url: string) {
  await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
  await page.goto(url);
}

async function face(track: Locator) {
  await expect(track).toBeVisible();
  // Dialogs move focus in on open and scale in; a focused selected option
  // trades its 1px ring for the focus ring. Read the settled resting face.
  await track.page().evaluate(async () => {
    (document.activeElement as HTMLElement | null)?.blur();
    await Promise.allSettled(document.getAnimations().map((a) => a.finished));
  });
  return track.evaluate((el) => {
    const selected = el.querySelector('[data-segmented="option"][data-active]');
    const idle = el.querySelector('[data-segmented="option"]:not([data-active])');
    if (selected === null || idle === null) throw new Error('segmented options missing');
    const t = getComputedStyle(el);
    const s = getComputedStyle(selected);
    const i = getComputedStyle(idle);
    return {
      trackBg: t.backgroundColor,
      trackHeight: (el as HTMLElement).offsetHeight,
      trackPadding: t.paddingTop,
      trackRadius: t.borderTopLeftRadius,
      selectedBg: s.backgroundColor,
      selectedRing: s.boxShadow.includes('0px 0px 0px 1px'),
      selectedInk: s.color,
      selectedWeight: s.fontWeight,
      optionHeight: (selected as HTMLElement).offsetHeight,
      optionRadius: s.borderTopLeftRadius,
      idleBg: i.backgroundColor,
      idleInk: i.color,
    };
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: every segmented control wears the same face`, async ({ page }) => {
    const faces: { name: string; value: Awaited<ReturnType<typeof face>> }[] = [];
    for (const control of CONTROLS) {
      await themed(page, theme, control.url);
      await control.open?.(page);
      faces.push({ name: control.name, value: await face(control.track(page)) });
    }
    const [first] = faces;
    expect(first.value.trackHeight).toBe(32);
    expect(first.value.trackPadding).toBe('2px');
    expect(first.value.trackRadius).toBe('8px');
    expect(first.value.optionHeight).toBe(28);
    expect(first.value.optionRadius).toBe('4px');
    expect(first.value.selectedRing).toBe(true);
    expect(first.value.selectedWeight).toBe('500');
    expect(first.value.idleBg).toBe('rgba(0, 0, 0, 0)');
    expect(first.value.idleInk).toBe(first.value.selectedInk);
    expect(first.value.selectedBg).not.toBe(first.value.trackBg);
    if (theme === 'light') {
      expect(first.value.trackBg).toBe('rgb(242, 242, 242)');
      expect(first.value.selectedBg).toBe('rgb(255, 255, 255)');
      expect(first.value.selectedInk).toBe('rgb(10, 10, 10)');
      expect(first.value.idleInk).toBe('rgb(10, 10, 10)');
    }
    for (const { name, value } of faces.slice(1)) {
      const { trackHeight, optionHeight, ...rest } = value;
      const { trackHeight: firstTrack, optionHeight: firstOption, ...firstRest } = first.value;
      expect({ name, ...rest }).toEqual({ name, ...firstRest });
      if (name === 'settings appearance') {
        expect({ trackHeight, optionHeight }).toEqual({ trackHeight: 28, optionHeight: 24 });
      } else {
        expect({ trackHeight, optionHeight }).toEqual({
          trackHeight: firstTrack,
          optionHeight: firstOption,
        });
      }
    }
  });
}

async function keyboardFocus(option: Locator) {
  const page = option.page();
  await option.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect
    .poll(() => option.evaluate((el) => document.activeElement === el && el.matches(':focus-visible')))
    .toBe(true);
}

async function ring(option: Locator) {
  return option.evaluate((el) => {
    const cs = getComputedStyle(el);
    const root = getComputedStyle(document.documentElement);
    const box = el.getBoundingClientRect();
    const track = (el.closest('[data-segmented="track"]') as HTMLElement).getBoundingClientRect();
    const offset = Number.parseFloat(cs.outlineOffset);
    const width = Number.parseFloat(cs.outlineWidth);
    return {
      focusVisible: el.matches(':focus-visible'),
      style: cs.outlineStyle,
      width,
      offset,
      // how far the outline reaches past the option's border box
      overflow: offset + width,
      color: cs.outlineColor,
      focusRing: root.getPropertyValue('--focus-ring').trim(),
      insideTrack:
        box.left >= track.left && box.right <= track.right && box.top >= track.top && box.bottom <= track.bottom,
    };
  });
}

function hexToRgb(hex: string) {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

for (const control of [CONTROLS[1]]) {
  test(`${control.name}: keyboard focus draws the ring inside the option`, async ({ page }) => {
    await themed(page, 'light', control.url);
    const option = control.track(page).locator('[data-segmented="option"][data-active]');
    await keyboardFocus(option);
    const info = await ring(option);
    expect(info.focusVisible).toBe(true);
    expect(info.style).toBe('solid');
    expect(info.width).toBe(2);
    expect(info.offset).toBe(-2);
    expect(info.overflow).toBeLessThanOrEqual(0);
    expect(info.insideTrack).toBe(true);
    expect(info.color).toBe(hexToRgb(info.focusRing));
  });
}

test('pointer click leaves no focus ring', async ({ page }) => {
  await themed(page, 'light', '/app/schedules?scenario=r3-92');
  const weekly = page.getByRole('radio', { name: '每周' });
  await weekly.click();
  await expect(weekly).toHaveAttribute('aria-checked', 'true');
  const info = await ring(weekly);
  expect(info.focusVisible).toBe(false);
  expect(info.style).toBe('none');
});

test('radio group: arrow keys move focus and select, roving tabindex follows', async ({ page }) => {
  await themed(page, 'light', '/app/schedules?scenario=r3-92');
  const group = page.getByRole('radiogroup', { name: '频率' });
  const daily = group.getByRole('radio', { name: '每天' });
  await expect(daily).toHaveAttribute('aria-checked', 'true');
  await keyboardFocus(daily);
  await page.keyboard.press('ArrowRight');
  const weekdays = group.getByRole('radio', { name: 'Weekdays' });
  await expect(weekdays).toHaveAttribute('aria-checked', 'true');
  await expect(weekdays).toBeFocused();
  await expect(weekdays).toHaveAttribute('tabindex', '0');
  await expect(daily).toHaveAttribute('tabindex', '-1');
  await page.keyboard.press('End');
  await expect(group.getByRole('radio', { name: 'Custom cron' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.keyboard.press('ArrowRight');
  await expect(group.getByRole('radio', { name: '单次' })).toHaveAttribute('aria-checked', 'true');
});

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: Tasks panel tabs read in the primary ink, the selected one keeps its fill`, async ({
    page,
  }) => {
    await themed(page, theme, '/app?scenario=home-c&pane=tasks');
    const track = page.locator('[data-segmented="track"]').first();
    await expect(track).toBeVisible();
    await page.mouse.move(0, 0);
    const read = await track.evaluate((el) => {
      const foreground = getComputedStyle(document.documentElement).getPropertyValue('--foreground').trim();
      const probe = document.createElement('span');
      probe.style.color = foreground;
      document.body.appendChild(probe);
      const ink = getComputedStyle(probe).color;
      probe.remove();
      const selected = getComputedStyle(el.querySelector('[data-segmented="option"][data-active]')!);
      const idle = [...el.querySelectorAll('[data-segmented="option"]:not([data-active])')].map(
        (o) => getComputedStyle(o).color,
      );
      return { ink, selectedBg: selected.backgroundColor, selectedInk: selected.color, idle };
    });
    expect(read.idle).toHaveLength(3);
    for (const ink of read.idle) expect(ink).toBe(read.ink);
    expect(read.selectedInk).toBe(read.ink);
    expect(read.selectedBg).not.toBe('rgba(0, 0, 0, 0)');
  });
}
