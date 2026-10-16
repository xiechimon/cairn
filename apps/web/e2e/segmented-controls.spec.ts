import { expect, type Locator, type Page, test } from '@playwright/test';

// Issue #138 acceptance, re-pinned by #1007 (wave 1 L4) onto the registry
// Tabs default form: the segmented-control family (PageShell .page-tab,
// sched-form freq, project files seg, tasks view toggle) rides
// components/ui/tabs base-nova — group = TabsList (bg-muted rounded-lg
// p-[3px] h-8, no hairline border), chip = TabsTrigger (rounded-md, active
// fill = bg-background light / bg-input/30 dark + shadow/border per the
// registry variant strings). The #138 hover-tint skin retired with the
// hand-rolled SEG_* recipes: the registry hover affordance is an INK step
// (muted-foreground → foreground), not a background tint — so the family
// law this spec guards becomes "unselected chips answer hover with an ink
// change on their own box, the selected chip keeps its fill under hover,
// and both states share one geometry". Faces outside this lane (user-menu
// 外观, branch-dialog seg, team layout toggle, chief tabs) keep their own
// carriers below, untouched by #1007.
// #366: the detail doc/chat tab group is gone from the family (the detail
// route re-laid out to three panes); the branch-dialog seg now opens from
// the board card icon — the detail route hosts the branch surface as a
// static right-pane section instead.
// #367: the skills-import tabs are gone from the family too (the import
// page retired with the GitHub-scan/folder-upload faces — skills are a
// read-only local-directory projection now).

const PROJ = '/app/project/ZAQczKCu0MOAzC1ZqcFlX';

// registry Tabs canon values (shadcn.css tokens, #1002 palette): group fill
// = --muted; active chip fill = --background (light) / --input at 30%
// (dark); trigger ink rest/hover = muted-foreground → foreground (dark),
// foreground at 60% → foreground (light).
const GROUP_DARK = 'rgb(45, 41, 38)'; // --muted dark
const GROUP_LIGHT = 'rgb(235, 228, 216)'; // --muted light
const TAB_FILL_DARK = 'rgba(64, 60, 57, 0.3)'; // --input/30 dark (active fill)
const TAB_FILL_LIGHT = 'rgb(251, 249, 245)'; // --background light (active fill)
// team layout toggle (L2 face, seg skin not yet migrated) still fills its
// active chip with --card:
const CHIP_LIGHT = 'rgb(255, 255, 255)'; // --card light
const INK_REST_DARK = 'rgb(179, 174, 170)'; // --muted-foreground dark
const INK_HOVER_DARK = 'rgb(238, 232, 228)'; // --foreground dark
const INK_REST_LIGHT = 'rgba(43, 38, 32, 0.6)'; // --foreground/60 light
const INK_HOVER_LIGHT = 'rgb(43, 38, 32)'; // --foreground light
// Faces OUTSIDE the L4 lane (user-menu 外观, branch-dialog seg, team layout
// toggle, chief tabs) still ride their domain's hand-rolled seg skins until
// those lanes migrate — their hover tint stays the #138 --seg-hover value.
const HOVER_DARK = 'rgba(255, 252, 248, 0.05)'; // --seg-hover dark
const HOVER_LIGHT = 'rgba(28, 25, 21, 0.05)'; // --seg-hover light
const CHIP_DARK = 'rgb(38, 34, 31)'; // --card dark (tab-chip-bg merged → card, #1002)
// #1005 registry 对齐：team 布局钮离 SEG_* 分段族、骑 registry default Tabs——
// 组盒 bg-muted（light 与 --secondary 同值 #ebe4d8）、无发丝环 border、选中片
// bg-background、hover 只换墨不上底（无 tint）。
const TABS_GROUP_LIGHT = 'rgb(235, 228, 216)'; // --muted light (registry TabsList default)
const TABS_CHIP_ACTIVE_LIGHT = 'rgb(251, 249, 245)'; // --background light (registry data-active chip)

// Tailwind v4 opacity modifiers (bg-input/30, text-foreground/60) compute to
// oklab color-mix strings; the repo value notation (#411) wants rgb/hex —
// normalize in-page (oklab → sRGB, legacy rgb()/rgba() pass through).
function cssColor(loc: Locator, prop: 'backgroundColor' | 'color') {
  return loc.evaluate((el, p) => {
    const v = getComputedStyle(el)[p];
    const m = /^oklab\([-\d.e]+\s+[-\d.e]+\s+[-\d.e]+(?:\s*\/\s*[\d.e%]+)?\)$/.exec(v);
    if (m == null) return v;
    const parts = v.slice(6, -1).split(/[\s/]+/);
    const [L, a, b] = [Number(parts[0]), Number(parts[1]), Number(parts[2])];
    const alpha =
      parts[3] == null ? 1 : parts[3].endsWith('%') ? Number.parseFloat(parts[3]) / 100 : Number(parts[3]);
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
    const l = l_ ** 3;
    const mm = m_ ** 3;
    const s = s_ ** 3;
    const gam = (x: number) => {
      x = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(Math.max(x, 0), 1 / 2.4) - 0.055;
      return Math.round(Math.min(Math.max(x, 0), 1) * 255);
    };
    return `rgba(${gam(4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s)}, ${gam(
      -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
    )}, ${gam(-0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s)}, ${alpha})`;
  }, prop);
}
const bg = (loc: Locator) => loc.evaluate((el) => getComputedStyle(el).backgroundColor);
const bgRgb = (loc: Locator) => cssColor(loc, 'backgroundColor');
const ink = (loc: Locator) => cssColor(loc, 'color');

async function themed(page: Page, theme: 'dark' | 'light', url: string) {
  await page.addInitScript((t) => localStorage.setItem('pacman-theme', t), theme);
  await page.goto(url);
}

test('page-tab: unselected hover steps the chip ink — dark + light', async ({ page }) => {
  await page.goto(`${PROJ}?scenario=r2-24b`);
  const files = page.locator('.page-tab', { hasText: '文件' });

  expect(await bg(files)).toBe('rgba(0, 0, 0, 0)');
  expect(await ink(files)).toBe(INK_REST_DARK);
  await files.hover();
  await expect.poll(() => ink(files)).toBe(INK_HOVER_DARK);

  await themed(page, 'light', `${PROJ}?scenario=r2-24b`);
  const lightFiles = page.locator('.page-tab', { hasText: '文件' });
  expect(await ink(lightFiles)).toBe(INK_REST_LIGHT);
  await lightFiles.hover();
  await expect.poll(() => ink(lightFiles)).toBe(INK_HOVER_LIGHT);
});

test('page-tab: selected chip keeps its fill under hover, same geometry as the rest state', async ({
  page,
}) => {
  await page.goto(`${PROJ}?scenario=r2-24b`);
  const tasks = page.locator('.page-tab', { hasText: '任务' });
  const files = page.locator('.page-tab', { hasText: '文件' });

  expect(await bgRgb(tasks)).toBe(TAB_FILL_DARK);
  await tasks.hover();
  await page.waitForTimeout(250); // past the registry transition step
  expect(await bgRgb(tasks)).toBe(TAB_FILL_DARK); // hover must not wash the chip

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

test('page-tab group rides the registry TabsList form (bg-muted, 32px, 3px inset)', async ({
  page,
}) => {
  await page.goto(`${PROJ}?scenario=r2-24b`);
  const ring = await page.evaluate(() => {
    const group = document.querySelector('.page-tabs-group [data-slot="tabs-list"]')!;
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
  expect(ring.border).toBe('0px'); // hairline ring retired with the SEG_* shells
  expect(ring.groupBg).toBe(GROUP_DARK);
  expect(ring.groupH).toBe(32); // registry h-8
  // p-[3px] + the trigger's h-[calc(100%-1px)] centering half-pixel
  expect(ring.insetTop).toBe(4);
  expect(ring.insetLeft).toBe(3);
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

test('sched freq: dark active chip reads against the container, hover steps the rest ink', async ({
  page,
}) => {
  await page.goto('/app/schedules?scenario=r3-92');
  const group = page.locator('.sched-form-freq [data-slot="tabs-list"]');
  const active = page.locator('.sched-form-freq-tab[aria-selected="true"]');
  const weekly = page.locator('.sched-form-freq-tab', { hasText: '每周' });

  expect(await bg(group)).toBe(GROUP_DARK);
  expect(await bgRgb(active)).toBe(TAB_FILL_DARK); // was container-identical = invisible

  expect(await ink(weekly)).toBe(INK_REST_DARK);
  await weekly.hover();
  await expect.poll(() => ink(weekly)).toBe(INK_HOVER_DARK);

  await themed(page, 'light', '/app/schedules?scenario=r3-92');
  expect(await bgRgb(page.locator('.sched-form-freq-tab[aria-selected="true"]'))).toBe(
    TAB_FILL_LIGHT,
  );
  const lightWeekly = page.locator('.sched-form-freq-tab', { hasText: '每周' });
  expect(await ink(lightWeekly)).toBe(INK_REST_LIGHT);
  await lightWeekly.hover();
  await expect.poll(() => ink(lightWeekly)).toBe(INK_HOVER_LIGHT);
});

test('files seg + tasks view toggle: hover steps the unselected ink (dark)', async ({ page }) => {
  await page.goto(`${PROJ}?scenario=r2-24`);
  const history = page.locator('.prj-files-seg-tab', { hasText: '历史' });
  expect(await ink(history)).toBe(INK_REST_DARK);
  await history.hover();
  await expect.poll(() => ink(history)).toBe(INK_HOVER_DARK);

  await page.goto(`${PROJ}?scenario=prj-tasks`);
  const grid = page.locator('.prj-tasks-view-btn[aria-label="网格视图"]');
  await grid.hover();
  await expect.poll(() => ink(grid)).toBe(INK_HOVER_DARK);
});

test('user-menu 外观 seg: hover tints, click switches the theme', async ({ page }) => {
  await themed(page, 'light', '/app?scenario=01');
  await page.click('.sidebar-user');
  const dark = page.locator('.user-menu-seg button').nth(1);

  await dark.hover();
  await expect.poll(() => bg(dark)).toBe(HOVER_LIGHT);

  await dark.click();
  await expect(dark).toHaveAttribute('data-active', 'true');
  // 深色 selected = the .light root class drops (dark is the :root default)
  await expect(page.locator('html')).not.toHaveClass(/light/);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.user-menu-seg button').nth(0)).toHaveAttribute('data-active', 'false');
});

test('branch-dialog seg: hover tints Git, click swaps the tab body', async ({ page }) => {
  // #366: the detail route no longer opens the branch dialog (the surface
  // is a static right-pane section there) — the board card icon remains
  // the dialog's live trigger.
  // #945/#910 重钉（正典表 §5.4）：seg 迁 Tabs 件 default 档——载体换
  // role=tab + 文案一级（.dlg → getByRole('dialog')，.dlg-seg-tab 退役）；
  // data-active/aria-selected 断言归并成 selected:true（Base UI 的
  // aria-selected 即 selected 态载体）；hover tint 值 = --seg-hover 不变
  // （#138 家族律走消费端 TabsTrigger hover utility）。
  await page.goto('/app?scenario=01');
  await page.locator('.todo-card-branch').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const git = page.getByRole('tab', { name: 'Git' });
  await git.hover();
  await expect.poll(() => bg(git)).toBe(HOVER_DARK);

  await git.click();
  await expect(page.getByRole('tab', { name: 'Git', selected: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: '同步到机器', selected: false })).toBeVisible();
});

test('team layout toggle: registry default Tabs form (muted group, background chip, no ring)', async ({
  page,
}) => {
  await themed(page, 'light', '/app/team?scenario=12');
  // #1005 registry 对齐（重钉）：team 布局钮离 SEG_* 分段族（发丝环 / --secondary
  // 组底 / --card 选中片 / --seg-hover tint 全退役），骑 registry default Tabs：
  // 组盒 bg-muted 无 border、选中片 bg-background、未选中片零底（hover 只换墨）。
  // 载体仍 = role=tablist/tab 一级（#947/#910）。
  const group = await page.evaluate(() => {
    const g = document.querySelector('[role="tablist"]')!;
    return {
      border: getComputedStyle(g).borderTopWidth,
      groupBg: getComputedStyle(g).backgroundColor,
    };
  });
  expect(group.border).toBe('0px');
  expect(group.groupBg).toBe(TABS_GROUP_LIGHT);
  expect(await bg(page.locator('[role="tab"][aria-selected="true"]'))).toBe(
    TABS_CHIP_ACTIVE_LIGHT,
  );

  // 未选中片零底：registry hover 是 ink-only，不上 tint 底。
  const chart = page.getByRole('tab', { name: 'chart' });
  expect(await bg(chart)).toBe('rgba(0, 0, 0, 0)');
  await chart.hover();
  await expect.poll(() => bg(chart)).toBe('rgba(0, 0, 0, 0)');
});

// skills-import tab 半已随 spec 13（#367）退役——导入页删除，res-tab 族
// 出账；chief tabs 半保留。
test('chief tabs: hover tints, click swaps the view', async ({ page }) => {
  await themed(page, 'light', '/app?scenario=101');
  // #950 载体：chip = role tab（.chief-tab 类退役）；选中态 = aria-selected
  // （#910 裁定 3，.is-active 类退役）。
  const charter = page.getByRole('tab', { name: '章程' });
  await charter.hover();
  await expect.poll(() => bg(charter)).toBe(HOVER_LIGHT);
  await charter.click();
  await expect(charter).toHaveAttribute('aria-selected', 'true');
});

// #644: the chief-tab selected fill moved off the chip onto a sliding pill
// (Base UI TabsIndicator under the tabs, z0 vs chip z1). Motion values are
// the 2026-10-02 todos.dev live capture: the pill transitions
// left/top/width/height over 0.15s ease (CSSTransition records observed on
// left+width when switching). Pins: pill geometry tracks the active chip,
// chips paint no own fill, transition carries the measured values, and a
// switch really runs the slide instead of jumping.
test('chief tabs: indicator pill slides between chips — 150ms ease on left/top/width/height', async ({
  page,
}) => {
  await themed(page, 'light', '/app?scenario=101');
  const pill = page.getByTestId('chief-tab-indicator');
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

  // 切换必须真的滑：transitionrun 事件在过渡起跑时对每个属性各响一次
  //（rAF 采样在无合成帧的环境里会停摆，事件路径不依赖渲染帧）。
  await page.evaluate(() => {
    (window as unknown as Record<string, string[]>).__pillRuns = [];
    document.addEventListener(
      'transitionrun',
      (e) => {
        const el = e.target as HTMLElement;
        if (el.getAttribute?.('data-testid') === 'chief-tab-indicator') {
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
  // 落位核对要等 150ms 滑行动画跑完——poll 到 pill 与新激活 chip 重合。
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
    .getByTestId('chief-tab-indicator')
    .evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(dur.split(', ').every((d) => d === '0s')).toBe(true);
});
