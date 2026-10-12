import { expect, type Page, test } from '@playwright/test';

// ADR 0013 (#1009 A0, superseding #447 / ADR 0004): 总管面板 = Multica 式
// 悬浮窗. Failure modes pinned here (fixture face — the live send path rides
// the real-backend self-verification, the fixture build has no API):
//   1. Esc never closes the panel (D3 — the #146 second-press law and the
//      #136 ledger bug's old fix are both superseded: Minimize + ⌘J are the
//      only dismissals); board AND a wake surface must obey.
//   2. Esc layering: with the thread switcher popover open (r5 116), the
//      innermost overlay closes first and the panel survives BOTH presses.
//   3. composer bar renders the attach + mention tools and 发送 — #732
//      (ruling change) reopened the tool face the #146 ruling had hidden;
//      语音输入 stays out (#304 C5).
//   4. the panel is a floating window, not a docked column: 380×600 anchored
//      8px off the content area's bottom-right corner, position fixed,
//      radius --radius-window (12px), opaque card ground, edge-ring +
//      --floating-shadow dual shadow, --z-floating (15) above docked chrome
//      and below every active layer (D2/D10, #688 law); the 全屏 toggle stays
//      retired (0004 D1 carried over), so no form-toggle button exists.
//   5. content never yields and never restores (D1: overlay, no yield) —
//      board-main keeps full width with the window open, the scroller stays
//      non-scrollable in both states, columns keep the single 200px floor
//      track (#1035 two-state retired with the yield).
//   6. the wake shells (pages / resources / secondary) keep their main column
//      width with the window open — the window overlays, nothing narrows.
//   7. detail route: the right pane COEXISTS with the open window (D7 mutual
//      exclusion reversed); the center column stays fluid and unchanged.
//   8. hero examples drift or vanish: the four canon prompt cards (r5 111)
//      render verbatim; on the fixture face the click stays inert (send is
//      live-only, #129 contract) and the view does not change.
//   9. the open state persists across a reload (D5, reversing 0004 D9):
//      localStorage pacman.chief-open on the live face, default closed.
//  10. the composer's size follows its content (XMON-102): one fixed height
//      on every state (3 lines), overflow kept inside the box.
//  11. the composer placeholder does not follow the turn state (#624): the
//      r5 113 running face carries the steer canon, the idle faces the idle
//      canon — both single-sourced from @pacman/shared.
// 载体契约（D6）：关 = 在 DOM 但 hidden/inert（keepMounted 常驻）——count-0
// 断言族退役，关态断言走 toBeHidden + count 1（#1067：hidden 的
// display:none 副作用被 app.css 中和成 visibility/opacity 停靠，布局盒
// 存活、滚动位置保留，toBeHidden 仍以 hidden 属性为判据）；收起钮 =
// aria-label 最小化（Minus，无 X）；FAB 单实例载体 = .chief-fab（根
// layout 常驻，D4 族 FAB 类名退役）。

const drawer = (page: Page) => page.locator('.chief-drawer');
const fab = (page: Page) => page.locator('.chief-fab');
const minimize = (page: Page) => drawer(page).getByRole('button', { name: '最小化' });

// the window enters with fade + scale (ADR 0013 D7) — measure only after the
// entrance animation settles so transforms are off the boxes
async function settled(page: Page) {
  await drawer(page).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
}

/** ADR 0013 D2 窗几何单源：380×600 @ right/bottom 8（1440×732 主口径）。 */
const WIN_BOX = { x: 1440 - 8 - 380, y: 732 - 8 - 600, width: 380, height: 600 };

test.describe('chief panel floating form (ADR 0013)', () => {
  test('Esc never closes the panel on the board route (D3)', async ({ page }) => {
    await page.goto('/app?scenario=111');
    await expect(drawer(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(drawer(page)).toBeVisible();
  });

  test('Esc never closes the panel on a wake surface', async ({ page }) => {
    await page.goto('/app/team?scenario=12');
    // D6 载体：关态驻 DOM（hidden），不再是 count 0
    await expect(drawer(page)).toBeHidden();
    await expect(drawer(page)).toHaveCount(1);

    await fab(page).click();
    await settled(page);
    await expect(drawer(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(drawer(page)).toBeVisible();
  });

  test('Esc layers: the open thread switcher closes first, the panel survives both', async ({
    page,
  }) => {
    await page.goto('/app?scenario=116');
    await expect(drawer(page)).toBeVisible();
    // #950: 切换器容器载体 = role menu（.chief-switcher 类退役）。
    await expect(page.getByRole('menu')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(drawer(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(drawer(page)).toBeVisible();
  });

  test('composer bar carries the attach + mention tools and the send button', async ({ page }) => {
    await page.goto('/app?scenario=111');
    // #950: .chief-composer-bar 容器类退役；scope 走存活的 .chief-composer
    // 零规则钩子（composer 内按钮 = 工具条三钮，语义等价）。
    const bar = page.locator('.chief-composer');
    // #732（裁决变更，#146 旧隐藏裁决翻案）：附件/提及开闸渲染，与 detail
    // 面同一套交互；语音维持 wontfix 不渲染（#304 C5，本票不含）。
    await expect(bar.locator('button[aria-label="语音输入"]')).toHaveCount(0);
    await expect(bar.locator('button[aria-label="添加附件"]')).toBeVisible();
    await expect(bar.locator('button[aria-label="提及"]')).toBeVisible();
    await expect(bar.locator('button')).toHaveCount(3);
    await expect(bar.locator('button[aria-label="发送"]')).toBeVisible();
  });

  test('the panel floats as a 380x600 window anchored 8px off the corner (board)', async ({
    page,
  }) => {
    await page.goto('/app?scenario=111');
    await settled(page);
    const box = await drawer(page).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeCloseTo(WIN_BOX.x, 0);
    expect(box!.y).toBeCloseTo(WIN_BOX.y, 0);
    expect(box!.width).toBeCloseTo(WIN_BOX.width, 0);
    expect(box!.height).toBeCloseTo(WIN_BOX.height, 0);

    const skin = await drawer(page).evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        position: cs.position,
        radius: cs.borderRadius,
        shadow: cs.boxShadow,
        z: cs.zIndex,
        bg: cs.backgroundColor,
        backdrop: cs.backdropFilter,
        sidebarRight: document.querySelector('.board-sidebar')!.getBoundingClientRect().right,
        left: el.getBoundingClientRect().left,
      };
    });
    // an overlay anchored to the corner, not an in-flow column (D10)
    expect(skin.position).toBe('fixed');
    // --radius-window token (A0 实审裁决 3), Multica rounded-xl 原值
    expect(skin.radius).toBe('12px');
    // edge-ring hairline + --floating-shadow 双层（D2，非 none）
    expect(skin.shadow).not.toBe('none');
    expect(skin.shadow).toContain('inset');
    // --z-floating 新 rung：docked 之上、一切活动层之下（#688 律）
    expect(skin.z).toBe('15');
    // 不透明卡底非玻璃（D2）
    expect(skin.bg).toMatch(/^rgb\(/);
    expect(skin.backdrop === 'none' || skin.backdrop === '').toBe(true);
    // 包含块 = 侧栏右侧内容区：窗不压侧栏（D2）
    expect(skin.left).toBeGreaterThanOrEqual(skin.sidebarRight);

    // D1: the form toggle is retired — neither label exists anywhere
    await expect(page.locator('button[aria-label="全屏"]')).toHaveCount(0);
    await expect(page.locator('button[aria-label="退出全屏"]')).toHaveCount(0);
  });

  test('board content never yields to the window (D1 overlay, no yield)', async ({ page }) => {
    await page.goto('/app?scenario=111');
    await settled(page);
    const main = await page.locator('.board-main').boundingBox();
    expect(main).not.toBeNull();
    // 全宽：侧栏 240 之外的整段，窗是覆盖层不让位
    expect(main!.width).toBeCloseTo(1440 - 240, 0);

    const open = await page.locator('.board-scroller').evaluate((el) => ({
      scrollable: el.scrollWidth > el.clientWidth,
      columns: [...el.querySelectorAll('.board-column')].map((c) => c.getBoundingClientRect().width),
    }));
    // 单态地板（#1035 两态随让位退役）：静止 1440 无横滚、四列等宽 1fr 段主导
    expect(open.scrollable).toBe(false);
    expect(open.columns).toHaveLength(4);
    const first = open.columns[0] ?? 0;
    for (const w of open.columns) expect(Math.abs(w - first)).toBeLessThanOrEqual(1);
  });

  test('minimizing leaves the board grid at the same geometry (nothing to restore)', async ({
    page,
  }) => {
    await page.goto('/app?scenario=111');
    await settled(page);
    const openMain = await page.locator('.board-main').boundingBox();

    await minimize(page).click();
    await expect(drawer(page)).toBeHidden();

    const main = await page.locator('.board-main').boundingBox();
    expect(main!.width).toBeCloseTo(openMain!.width, 0);
    const rest = await page.locator('.board-scroller').evaluate((el) => ({
      scrollable: el.scrollWidth > el.clientWidth,
      columns: [...el.querySelectorAll('.board-column')].map((c) => c.getBoundingClientRect().width),
    }));
    expect(rest.scrollable).toBe(false);
    const first = rest.columns[0] ?? 0;
    expect(first).toBeGreaterThan(0);
    for (const w of rest.columns) expect(Math.abs(w - first)).toBeLessThanOrEqual(1);
  });

  for (const { name, route, col } of [
    { name: 'pages', route: '/app/schedules?scenario=11', col: '.page-main-col' },
    { name: 'resources', route: '/app/resources/skills?scenario=06', col: '.res-main-col' },
    {
      name: 'secondary',
      route: '/app/team?scenario=12',
      col: '.secondary-main-col', // 零规则跨域钩（chief 域消费，spec/22 §5.0 残留律）
    },
  ] as const) {
    test(`${name}: the main column never narrows while the window is open`, async ({ page }) => {
      await page.goto(route);
      // *-main 不再是 docking row（ADR 0013 D1）；内容列宽与窗开合无关
      const content = page.locator(col);
      await expect(content).toBeVisible();
      const closed = await content.boundingBox();
      expect(closed!.width).toBeCloseTo(1200, 0);

      await fab(page).click();
      await settled(page);
      const floating = await drawer(page).boundingBox();
      expect(floating!.x).toBeCloseTo(WIN_BOX.x, 0);
      expect(floating!.y).toBeCloseTo(WIN_BOX.y, 0);
      expect(floating!.width).toBeCloseTo(WIN_BOX.width, 0);
      expect(floating!.height).toBeCloseTo(WIN_BOX.height, 0);
      const open = await content.boundingBox();
      expect(open!.width).toBeCloseTo(1200, 0);

      await minimize(page).click();
      await expect(drawer(page)).toBeHidden();
      const restored = await content.boundingBox();
      expect(restored!.width).toBeCloseTo(1200, 0);
      expect(restored!.x).toBeCloseTo(closed!.x, 0);
    });
  }

  test('detail: the right pane coexists with the floating window (D7 reversed)', async ({
    page,
  }) => {
    await page.goto('/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=detail-unread');
    await expect(page.locator('.detail-right')).toBeVisible();
    const restingCenter = await page.locator('.detail-center').boundingBox();

    await fab(page).click();
    await settled(page);
    // 互斥退役：右栏在位，窗盖在其上（覆盖代价由无模态 + ⌘J 即关消化）
    await expect(page.locator('.detail-right')).toBeVisible();
    const box = await drawer(page).boundingBox();
    expect(box!.x).toBeCloseTo(WIN_BOX.x, 0);
    expect(box!.y).toBeCloseTo(WIN_BOX.y, 0);
    expect(box!.width).toBeCloseTo(WIN_BOX.width, 0);
    expect(box!.height).toBeCloseTo(WIN_BOX.height, 0);

    // the center column stays fluid and unchanged by the overlay
    const center = await page.locator('.detail-center').boundingBox();
    expect(center!.width).toBeCloseTo(restingCenter!.width, 0);
    expect(center!.width).toBeCloseTo(1440 - 240 - 488, 0);

    await minimize(page).click();
    await expect(drawer(page)).toBeHidden();
    await expect(page.locator('.detail-right')).toBeVisible();
    const restored = await page.locator('.detail-center').boundingBox();
    expect(restored!.width).toBe(1440 - 240 - 488);
  });

  test('hero examples: the four canon prompt cards, inert on the fixture face', async ({
    page,
  }) => {
    await page.goto('/app?scenario=111');
    // #950: 网格容器 = 二级 testid（结构盲区），卡 = 容器内 role button。
    const examples = page.getByTestId('chief-examples');
    const cards = examples.getByRole('button');
    await expect(cards).toHaveCount(4);
    await expect(cards.nth(0)).toContainText('帮我组建 Agent 团队');
    await expect(cards.nth(1)).toContainText('帮我创建一个新项目');
    await expect(cards.nth(2)).toContainText('总结一下我所有项目现在的进展');
    await expect(cards.nth(3)).toContainText('查一下这个月的 token 用量');

    // the fixture face has no send callback (#129): clicking a card must
    // not swap the hero for a thread view or crash the surface
    await cards.nth(0).click();
    await expect(drawer(page)).toBeVisible();
    await expect(examples).toBeVisible();
    // #1009 A1（D6 同族载体律）：流容器 = MessageScroller Content，随窗常驻
    // ——「hero 面无流」的判据从容器缺席翻成容器在位且零行（与 A0 的
    // count-0→hidden 重钉同一条 0012 D6 载体法）。
    await expect(page.getByTestId('chief-stream')).toHaveCount(1);
    await expect(page.locator('[data-slot="message-scroller-item"]')).toHaveCount(0);
    await expect(page.locator('.chief-msg, [data-testid="chief-msg"]')).toHaveCount(0);
  });

  test('composer grows with a restored draft to the six-line cap, empty face keeps the base track (#860 supersedes XMON-102)', async ({
    page,
  }) => {
    // #860 grow 律（chief-drawer 注记原文 "the XMON-102 fixed-height law is
    // superseded"）：草稿面随内容长到 6 行封顶、盒内滚动；空面守 3 行基座轨。
    // 旧「两面等高 60px」pin 钉的是 grow 副作用在 fixture 面从未触发的意外面
    // （隐藏挂载吞掉首跑度量、deps 稳定不再跑——A0 态 worktree build 实证，
    // PR #1066 body）；A1 换装后副作用真实触发 = 已裁决律的真面目。
    // 钉扎值来源（实审裁决 2026-10-08「截图上是多少就钉多少」）：两面读数
    // 均为实测渲染值，录于 docs/verify/1009/result-a1-fixture-smoke.json 的
    // S5（drafted 120px）/ S5b（empty 60px）两行，截图对照 a1-04-hero-111.png
    // 与 a1-01-thread-114.png——不是 growCap 常数的推定值（数值恰合同为
    // 实测结果，来源以 json/截图为准）。
    const measureComposer = async (url: string) => {
      await page.goto(url);
      await settled(page);
      const composer = page.getByTestId('chief-composer-input');
      await expect(composer).toBeVisible();
      const box = await composer.boundingBox();
      if (box === null) throw new Error(`composer box missing at ${url}`);
      return {
        height: Math.round(box.height),
        cssHeight: await composer.evaluate((el) => getComputedStyle(el).height),
        overflowY: await composer.evaluate((el) => getComputedStyle(el).overflowY),
      };
    };

    const drafted = await measureComposer('/app?scenario=111');
    const empty = await measureComposer('/app?scenario=114');

    expect(drafted.height).toBe(120);
    expect(empty.height).toBe(60);
    expect(drafted.cssHeight).toBe('120px');
    expect(empty.cssHeight).toBe('60px');
    // 封顶后溢出留在盒内滚动，不把面板顶变形（grow 律的另一半）。
    expect(drafted.overflowY).toBe('auto');
    expect(empty.overflowY).toBe('auto');
  });

  test('composer placeholder switches to the steer canon while a turn runs (#624)', async ({
    page,
  }) => {
    // r5 113: the running face (activeRun projection = ChiefContent.running)
    // carries the steer placeholder; the idle faces keep the idle canon —
    // 111 (fresh thread) and 114 (turn ended, 完成 44s footer) straddle the
    // two idle shapes. Values verbatim from @pacman/shared
    // (CHIEF_INPUT_PLACEHOLDER / CHIEF_INPUT_PLACEHOLDER_STEERING).
    const placeholderAt = async (scenario: string) => {
      await page.goto(`/app?scenario=${scenario}`);
      const composer = page.getByTestId('chief-composer-input');
      await expect(composer).toBeVisible();
      return composer.getAttribute('placeholder');
    };

    expect(await placeholderAt('113')).toBe('向 Agent 补充说明，执行过程中即可送达');
    expect(await placeholderAt('111')).toBe('有什么可以帮你的？');
    expect(await placeholderAt('114')).toBe('有什么可以帮你的？');
  });

  // D5 持久化是 live 面专属（fixture 面零读写 = 采集确定性律）——本条走
  // live-mock 桩（composer-wire-reject / chief-send-fallback 同款 stubBoot
  // 纪律：无 ?scenario = 真 API 分支，桩只答 chief 封套读面）。
  test('the open state persists across a reload (D5, reversing 0004 D9)', async ({ page }) => {
    const TEAM_ID = 'team-1';
    await page.route('**/api/**', (route, request) => {
      if (request.method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
    });
    await page.route('**/api/teams', (route) =>
      route.fulfill({
        json: [{ id: TEAM_ID, name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null }],
      }),
    );
    await page.route('**/api/user/me', (route) =>
      route.fulfill({ json: { id: 'user-1', displayName: '我', avatarUrl: null } }),
    );
    await page.route(`**/api/teams/${TEAM_ID}/notifications`, (route) =>
      route.fulfill({ json: { unreadThreadIds: [] } }),
    );
    await page.route(`**/api/teams/${TEAM_ID}/chief/threads`, (route) =>
      route.fulfill({ json: [] }),
    );
    await page.route(`**/api/teams/${TEAM_ID}/chief`, (route) =>
      route.fulfill({
        json: {
          chief: {
            id: `chief-user-1-${TEAM_ID}`,
            userId: 'user-1',
            teamId: TEAM_ID,
            agent: null,
            charter: '',
            lastTurnAt: null,
            createdAt: 0,
            tz: null,
          },
          agentActor: null,
          context: null,
          watches: [],
          wakes: [],
        },
      }),
    );
    await page.route(`**/api/teams/${TEAM_ID}/model-sources`, (route) =>
      route.fulfill({ json: { sources: [] } }),
    );

    await page.goto('/app');
    await expect(drawer(page)).toBeHidden();
    // FAB 单实例载体（根 layout 常驻，D6）：类钩 .chief-fab + aria-label 总管
    await fab(page).click();
    await settled(page);
    await expect(drawer(page)).toBeVisible();
    await page.reload();
    await settled(page);
    await expect(drawer(page)).toBeVisible();
    // 关态同样持久（最小化写 0）
    await minimize(page).click();
    await expect(drawer(page)).toBeHidden();
    await page.reload();
    await expect(drawer(page)).toBeHidden();
  });
});
