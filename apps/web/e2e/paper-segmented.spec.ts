import { expect, type Locator, type Page, test } from '@playwright/test';

const PROJ = '/app/project/ZAQczKCu0MOAzC1ZqcFlX';

interface Control {
  name: string;
  url: string;
  open?: (page: Page) => Promise<void>;
  track: (page: Page) => Locator;
}

const CONTROLS: Control[] = [
  {
    name: 'account density',
    url: '/app/account?scenario=13',
    track: (page) => page.getByRole('radiogroup', { name: '密度' }),
  },
  {
    name: 'agent tabs',
    url: '/app/resources/agents/r3-builder?scenario=agent-detail',
    track: (page) => page.getByRole('tablist', { name: 'Agent' }),
  },
  {
    name: 'team switch',
    url: '/app/team?scenario=12',
    track: (page) => page.getByTestId('page-topbar').getByRole('tablist'),
  },
  {
    name: 'schedules frequency',
    url: '/app/schedules?scenario=r3-92',
    track: (page) => page.getByRole('radiogroup', { name: '频率' }),
  },
  {
    name: 'project tabs',
    url: `${PROJ}?scenario=r2-24b`,
    track: (page) => page.getByRole('banner').getByRole('tablist'),
  },
  {
    name: 'providers runtime',
    url: '/app/resources/providers?scenario=10',
    track: (page) => page.getByRole('tablist', { name: '模型服务' }),
  },
  {
    name: 'user menu theme',
    url: '/app?scenario=01',
    open: (page) => page.click('.sidebar-user'),
    track: (page) => page.getByRole('radiogroup', { name: '外观' }),
  },
  {
    name: 'user menu density',
    url: '/app?scenario=01',
    open: (page) => page.click('.sidebar-user'),
    track: (page) => page.getByRole('radiogroup', { name: '密度' }),
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
    expect(first.value.optionRadius).toBe('6px');
    expect(first.value.selectedRing).toBe(true);
    expect(first.value.selectedWeight).toBe('500');
    expect(first.value.idleBg).toBe('rgba(0, 0, 0, 0)');
    expect(first.value.idleInk).not.toBe(first.value.selectedInk);
    expect(first.value.selectedBg).not.toBe(first.value.trackBg);
    if (theme === 'light') {
      expect(first.value.trackBg).toBe('rgb(239, 230, 208)'); // canvas
      expect(first.value.selectedBg).toBe('rgb(255, 253, 246)'); // card
      expect(first.value.selectedInk).toBe('rgb(27, 43, 36)'); // ink
      expect(first.value.idleInk).toBe('rgb(94, 86, 77)'); // ink-2
    }
    for (const { name, value } of faces.slice(1)) {
      expect({ name, ...value }).toEqual({ name, ...first.value });
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

for (const control of [CONTROLS[1], CONTROLS[3]]) {
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

  await themed(page, 'light', '/app/resources/agents/r3-builder?scenario=agent-detail');
  const memory = page.getByRole('tab', { name: '记忆' });
  await memory.click();
  await expect(memory).toHaveAttribute('aria-selected', 'true');
  expect((await ring(memory)).style).toBe('none');
});

test('radio group: arrow keys move focus and select, roving tabindex follows', async ({ page }) => {
  await themed(page, 'light', '/app/schedules?scenario=r3-92');
  const group = page.getByRole('radiogroup', { name: '频率' });
  const daily = group.getByRole('radio', { name: '每天' });
  await expect(daily).toHaveAttribute('aria-checked', 'true');
  await keyboardFocus(daily);
  await page.keyboard.press('ArrowRight');
  const weekly = group.getByRole('radio', { name: '每周' });
  await expect(weekly).toHaveAttribute('aria-checked', 'true');
  await expect(weekly).toBeFocused();
  await expect(weekly).toHaveAttribute('tabindex', '0');
  await expect(daily).toHaveAttribute('tabindex', '-1');
  await page.keyboard.press('End');
  await expect(group.getByRole('radio', { name: '单次' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(group.getByRole('radio', { name: '每小时' })).toHaveAttribute('aria-checked', 'true');
});
