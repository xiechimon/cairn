import { expect, type Locator, type Page, test } from '@playwright/test';
import { settleTransitions } from './helpers.js';

const PROJ = '/app/project/ZAQczKCu0MOAzC1ZqcFlX';

const CARD_DARK = 'rgb(47, 42, 38)'; // --card dark
const CARD_LIGHT = 'rgb(255, 253, 246)'; // --card light
const CANVAS_LIGHT = 'rgb(239, 230, 208)'; // --canvas light
const CLEAR = 'rgba(0, 0, 0, 0)';

const bg = (loc: Locator) => loc.evaluate((el) => getComputedStyle(el).backgroundColor);
const ink = (loc: Locator) => loc.evaluate((el) => getComputedStyle(el).color);

/** Unselected option: no box at rest or under hover, ink steps to the
 *  selected option's ink. The pointer moves off first: after `themed()`
 *  reloads, it still rests where the previous leg hovered, so the option
 *  would start :hover and read the hover ink as its rest ink (#1427). */
async function expectInkStep(idle: Locator, selected: Locator) {
  await idle.page().mouse.move(0, 0);
  await expect.poll(() => idle.evaluate((el) => el.matches(':hover'))).toBe(false);
  await settleTransitions(idle.page());
  const rest = await ink(idle);
  const target = await ink(selected);
  expect(rest).not.toBe(target);
  expect(await bg(idle)).toBe(CLEAR);
  await idle.hover();
  await expect.poll(() => ink(idle)).toBe(target);
  expect(await bg(idle)).toBe(CLEAR);
}

async function themed(page: Page, theme: 'dark' | 'light', url: string) {
  await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
  await page.goto(url);
}

test('page-tab: unselected hover steps the chip ink — dark + light', async ({ page }) => {
  await page.goto(`${PROJ}?scenario=r2-24b`);
  const files = page.locator('.page-tab', { hasText: '文件' });
  const tasks = page.locator('.page-tab', { hasText: '任务' });
  await expectInkStep(files, tasks);

  await themed(page, 'light', `${PROJ}?scenario=r2-24b`);
  await expectInkStep(
    page.locator('.page-tab', { hasText: '文件' }),
    page.locator('.page-tab', { hasText: '任务' }),
  );
});

test('page-tab: selected chip keeps its fill under hover, same geometry as the rest state', async ({
  page,
}) => {
  await page.goto(`${PROJ}?scenario=r2-24b`);
  const tasks = page.locator('.page-tab', { hasText: '任务' });
  const files = page.locator('.page-tab', { hasText: '文件' });

  expect(await bg(tasks)).toBe(CARD_DARK);
  await tasks.hover();
  await page.waitForTimeout(250); // past the transition step
  expect(await bg(tasks)).toBe(CARD_DARK); // hover must not wash the chip

  // one geometry for both states: same radius, and the hover ink step
  // paints no box (no layout shift under hover)
  const geo = await page.evaluate(() => {
    const [active, plain] = [
      document.querySelector('.page-tab[aria-selected="true"]')!,
      document.querySelector('.page-tab[aria-selected="false"]')!,
    ];
    return {
      activeRadius: getComputedStyle(active).borderRadius,
      plainRadius: getComputedStyle(plain).borderRadius,
    };
  });
  expect(geo.plainRadius).toBe(geo.activeRadius);
  const round = (b: NonNullable<Awaited<ReturnType<typeof files.boundingBox>>>) => ({
    x: Math.round(b.x),
    y: Math.round(b.y),
    width: Math.round(b.width),
    height: Math.round(b.height),
  });
  const restBox = round((await files.boundingBox())!);
  await files.hover();
  await page.waitForTimeout(250);
  expect(round((await files.boundingBox())!)).toEqual(restBox);
});

test('page-tab group rides the segmented track (canvas, 32px, 2px inset)', async ({ page }) => {
  await themed(page, 'light', `${PROJ}?scenario=r2-24b`);
  const ring = await page.evaluate(() => {
    const group = document.querySelector('.page-tabs-group')!;
    const tab = document.querySelector('.page-tab')!;
    const cs = getComputedStyle(group);
    const g = group.getBoundingClientRect();
    const t = tab.getBoundingClientRect();
    return {
      border: cs.borderTopWidth,
      groupBg: cs.backgroundColor,
      groupH: Math.round(g.height),
      insetTop: Math.round(t.top - g.top),
      insetLeft: Math.round(t.left - g.left),
    };
  });
  expect(ring.border).toBe('0px');
  expect(ring.groupBg).toBe(CANVAS_LIGHT);
  expect(ring.groupH).toBe(32);
  expect(ring.insetTop).toBe(2);
  expect(ring.insetLeft).toBe(2);
});

test('page-tab click swaps the active chip and the pane', async ({ page }) => {
  await page.goto(`${PROJ}?scenario=r2-24b`);
  const files = page.locator('.page-tab', { hasText: '文件' });

  await files.click();
  await expect(files).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.prj-files')).toBeVisible();

  await page.locator('.page-tab', { hasText: '任务' }).click();
  await expect(files).toHaveAttribute('aria-selected', 'false');
  await expect(page.locator('.prj-files')).toBeHidden();
});

test('sched freq: the chosen radio reads against the track, hover steps the rest ink', async ({
  page,
}) => {
  await page.goto('/app/schedules?scenario=r3-92');
  const group = page.getByRole('radiogroup', { name: '频率' });
  const active = page.locator('.sched-form-freq-tab[aria-checked="true"]');
  const weekly = page.locator('.sched-form-freq-tab', { hasText: '每周' });

  expect(await bg(active)).toBe(CARD_DARK);
  expect(await bg(group)).not.toBe(CARD_DARK);
  await expectInkStep(weekly, active);

  await themed(page, 'light', '/app/schedules?scenario=r3-92');
  const lightActive = page.locator('.sched-form-freq-tab[aria-checked="true"]');
  expect(await bg(lightActive)).toBe(CARD_LIGHT);
  await expectInkStep(page.locator('.sched-form-freq-tab', { hasText: '每周' }), lightActive);
});

test('files seg + tasks view toggle: hover steps the unselected ink (dark)', async ({ page }) => {
  await page.goto(`${PROJ}?scenario=r2-24`);
  await expectInkStep(
    page.locator('.prj-files-seg-tab', { hasText: '历史' }),
    page.locator('.prj-files-seg-tab[aria-selected="true"]'),
  );

  await page.goto(`${PROJ}?scenario=prj-tasks`);
  await expectInkStep(
    page.locator('.prj-tasks-view-btn[aria-label="网格视图"]'),
    page.locator('.prj-tasks-view-btn[aria-selected="true"]'),
  );
});

test('user-menu appearance segment: hover steps the ink, click switches the theme', async ({ page }) => {
  await themed(page, 'light', '/app?scenario=01');
  await page.click('.sidebar-user');
  const group = page.getByRole('radiogroup', { name: '外观' });
  const dark = group.getByRole('radio', { name: '深色' });

  await expectInkStep(dark, group.getByRole('radio', { name: '浅色' }));

  await dark.click();
  await expect(dark).toHaveAttribute('aria-checked', 'true');

  await expect(page.locator('html')).not.toHaveClass(/light/);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(group.getByRole('radio', { name: '浅色' })).toHaveAttribute('aria-checked', 'false');
});

test('branch-dialog seg: hover steps the Git ink, click swaps the tab body', async ({ page }) => {
  // #366: the detail route no longer opens the branch dialog (the surface
  // is a static right-pane section there) — the board card icon remains
  // the dialog's live trigger.
  await page.goto('/app?scenario=01');
  await page.locator('.todo-card-branch').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const git = page.getByRole('tab', { name: 'Git' });
  await expectInkStep(git, page.getByRole('tab', { name: '同步到机器' }));

  await git.click();
  await expect(page.getByRole('tab', { name: 'Git', selected: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: '同步到机器', selected: false })).toBeVisible();
});

test('team layout toggle: segmented face (paper track, white ringed chip)', async ({ page }) => {
  await themed(page, 'light', '/app/team?scenario=12');

  const bar = page.getByTestId('page-topbar');
  const group = await bar.getByRole('tablist').evaluate((g) => ({
    border: getComputedStyle(g).borderTopWidth,
    groupBg: getComputedStyle(g).backgroundColor,
  }));
  expect(group.border).toBe('0px');
  expect(group.groupBg).toBe(CANVAS_LIGHT);
  const active = bar.getByRole('tab', { selected: true });
  expect(await bg(active)).toBe(CARD_LIGHT);
  expect(await active.evaluate((el) => getComputedStyle(el).boxShadow)).toContain('0px 0px 0px 1px');
  expect(await active.evaluate((el) => el.getBoundingClientRect().width)).toBe(28);

  const chart = bar.getByRole('tab', { name: 'chart' });
  expect(await bg(chart)).toBe(CLEAR);
  await chart.hover();
  await expect.poll(() => bg(chart)).toBe(CLEAR);
});

test('chief tabs: hover steps the ink, click swaps the view', async ({ page }) => {
  await themed(page, 'light', '/app?scenario=101');
  const charter = page.getByRole('tab', { name: '章程' });
  const idleInk = await ink(charter);
  await charter.hover();
  await expect.poll(() => ink(charter)).not.toBe(idleInk);
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
  const agent = page.getByRole('tab', { name: 'Agent' });
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

  await aligned(agent);
  expect(await bg(agent)).toBe('rgba(0, 0, 0, 0)');
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
