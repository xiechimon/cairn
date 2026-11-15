import { expect, type Locator, type Page, test } from '@playwright/test';
import { settleTransitions } from './helpers.js';

const SETTINGS = '/app/project/ZAQczKCu0MOAzC1ZqcFlX/settings?scenario=r2-24c';

const CARD_DARK = 'rgb(48, 48, 48)';
const CARD_LIGHT = 'rgb(255, 255, 255)';
const CLEAR = 'rgba(0, 0, 0, 0)';

const bg = (loc: Locator) => loc.evaluate((el) => getComputedStyle(el).backgroundColor);
const ink = (loc: Locator) => loc.evaluate((el) => getComputedStyle(el).color);

async function expectSharedInk(idle: Locator, selected: Locator) {
  await idle.page().mouse.move(0, 0);
  await expect.poll(() => idle.evaluate((el) => el.matches(':hover'))).toBe(false);
  await settleTransitions(idle.page());
  const rest = await ink(idle);
  const target = await ink(selected);
  expect(rest).toBe(target);
  expect(await bg(idle)).toBe(CLEAR);
  await idle.hover();
  await settleTransitions(idle.page());
  expect(await ink(idle)).toBe(target);
  expect(await bg(idle)).toBe(CLEAR);
}

const pageTab = (page: Page, name: string) =>
  page.getByRole('dialog').getByRole('tab', { name, exact: true });

async function themed(page: Page, theme: 'dark' | 'light', url: string) {
  await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
  await page.goto(url);
}

test('page tabs: unselected chip reads in the selected ink, hover keeps it — dark + light', async ({ page }) => {
  await page.goto(SETTINGS);
  await expectSharedInk(pageTab(page, '仓库'), pageTab(page, '基本信息'));

  await themed(page, 'light', SETTINGS);
  await expectSharedInk(pageTab(page, '仓库'), pageTab(page, '基本信息'));
});

test('page tabs: selected chip keeps its fill under hover, same geometry as the rest state', async ({
  page,
}) => {
  await page.goto(SETTINGS);
  const selected = pageTab(page, '基本信息');
  const plain = pageTab(page, '仓库');
  await expect(selected).toHaveAttribute('aria-selected', 'true');
  await settleTransitions(page);
  const rest = await bg(selected);
  await selected.hover();
  await settleTransitions(page);
  expect(await bg(selected)).toBe(rest);

  expect(await plain.evaluate((el) => getComputedStyle(el).borderRadius)).toBe(
    await selected.evaluate((el) => getComputedStyle(el).borderRadius),
  );
  const round = (b: NonNullable<Awaited<ReturnType<typeof plain.boundingBox>>>) => ({
    x: Math.round(b.x),
    y: Math.round(b.y),
    width: Math.round(b.width),
    height: Math.round(b.height),
  });
  const restBox = round((await plain.boundingBox())!);
  await plain.hover();
  await settleTransitions(page);
  expect(round((await plain.boundingBox())!)).toEqual(restBox);
});

test('sched freq: the chosen radio reads against the track, hover keeps the rest ink', async ({
  page,
}) => {
  await page.goto('/app/schedules?scenario=r3-92');
  const group = page.getByRole('radiogroup', { name: '频率' });
  const active = group.getByRole('radio', { checked: true });
  const weekly = group.getByRole('radio', { name: '每周' });

  expect(await bg(active)).toBe(CARD_DARK);
  expect(await bg(group)).not.toBe(CARD_DARK);
  await expectSharedInk(weekly, active);

  await themed(page, 'light', '/app/schedules?scenario=r3-92');
  const lightGroup = page.getByRole('radiogroup', { name: '频率' });
  const lightActive = lightGroup.getByRole('radio', { checked: true });
  expect(await bg(lightActive)).toBe(CARD_LIGHT);
  await expectSharedInk(lightGroup.getByRole('radio', { name: '每周' }), lightActive);
});

test('chief tabs: hover keeps the ink, click swaps the view', async ({ page }) => {
  await themed(page, 'light', '/app?scenario=101');
  const charter = page.getByRole('tab', { name: '章程' });
  await page.mouse.move(0, 0);
  const idleInk = await ink(charter);
  await charter.hover();
  await settleTransitions(page);
  expect(await ink(charter)).toBe(idleInk);
  expect(await bg(charter)).toBe(CLEAR);
  await charter.click();
  await expect(charter).toHaveAttribute('aria-selected', 'true');
});

// #644: the chief-tab selected face rides a sliding pill (SegmentedTabs
// slide; Base UI TabsIndicator under the tabs, z0 vs chip z1). Motion values are
// the 2026-10-02 todos.dev live capture: the pill transitions
// left/top/width/height over 0.15s ease (CSSTransition records observed on
// left+width when switching). Pins: pill geometry tracks the active chip,
// chips paint no own fill, transition carries the measured values, and a
// switch really runs the slide instead of jumping.
test('chief tabs: indicator pill slides between chips — 150ms ease on left/top/width/height', async ({
  page,
}) => {
  await themed(page, 'light', '/app?scenario=101');
  const pill = page.locator('[data-segmented="indicator"]');
  const routing = page.getByRole('tab', { name: '模型与执行机' });
  const charter = page.getByRole('tab', { name: '章程' });

  const box = (loc: Locator) =>
    loc.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
  const aligned = async (chip: Locator) => {
    const [p, c] = await Promise.all([box(pill), box(chip)]);
    expect(Math.abs(p.x - c.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(p.y - c.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(p.w - c.w)).toBeLessThanOrEqual(1);
    expect(Math.abs(p.h - c.h)).toBeLessThanOrEqual(1);
  };

  await aligned(routing);
  expect(await bg(routing)).toBe('rgba(0, 0, 0, 0)');
  const layering = await pill.evaluate((el) => {
    const cs = getComputedStyle(el);
    const tabCs = getComputedStyle(document.querySelector('[role="tab"]')!);
    return { pillZ: cs.zIndex, pillPe: cs.pointerEvents, tabZ: tabCs.zIndex };
  });
  expect(layering).toEqual({ pillZ: '0', pillPe: 'none', tabZ: '1' });

  const trans = await pill.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      prop: cs.transitionProperty,
      dur: cs.transitionDuration,
      ease: cs.transitionTimingFunction,
    };
  });
  expect(trans.prop).toBe('left, top, width, height');
  expect(trans.dur).toBe('0.15s, 0.15s, 0.15s, 0.15s');
  expect(trans.ease).toBe('ease, ease, ease, ease');

  await page.evaluate(() => {
    (window as unknown as Record<string, string[]>).__pillRuns = [];
    document.addEventListener(
      'transitionrun',
      (e) => {
        const el = e.target as HTMLElement;
        if (el.getAttribute?.('data-segmented') === 'indicator') {
          (window as unknown as Record<string, string[]>).__pillRuns.push(
            (e as TransitionEvent).propertyName,
          );
        }
      },
      true,
    );
  });
  await charter.click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...new Set((window as unknown as Record<string, string[]>).__pillRuns)].sort(),
      ),
    )
    .toEqual(['left', 'width']);
  await expect(charter).toHaveAttribute('aria-selected', 'true');

  await expect
    .poll(async () => {
      const [p, c] = await Promise.all([box(pill), box(charter)]);
      return Math.max(
        Math.abs(p.x - c.x),
        Math.abs(p.y - c.y),
        Math.abs(p.w - c.w),
        Math.abs(p.h - c.h),
      );
    })
    .toBeLessThanOrEqual(1);
});

test('chief tabs: reduced motion freezes the pill slide (#644)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await themed(page, 'light', '/app?scenario=101');
  const dur = await page
    .locator('[data-segmented="indicator"]')
    .evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(dur.split(', ').every((d) => d === '0s')).toBe(true);
});
