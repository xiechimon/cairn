import { expect, type Locator, type Page, test } from '@playwright/test';

// #1032 acceptance: 容器层滚动收口——ChiefSettings（记忆/章程/关注与提醒）与
// PageShell 四页（项目设置 / 项目任务 / 排期 / 新建项目）此前没有任何一环
// 提供纵向滚动（外壳 overflow-hidden，内容列 visible），长内容被裁掉、滚轮
// 不动。修复 = 容器层各补一次滚动层（secondary/shell.tsx:92 与
// resources/shell.tsx:121 是仓内既有模板），子页自动受益。
//
// 钉住的失败方式（每条断言对一个死法）：
//  F1 无可滚祖先：内容超一屏却整链 overflow visible/hidden → 「找不到滚动
//     容器」即红（scroller count=0）；
//  F2 滚轮不到达：用户实测的原始症状——鼠标悬在内容上滚轮零响应 →
//     wheel 后 scrollTop 仍 0 即红；
//  F3 滚不到底：滚动层高度未被 flex 约束（缺 min-h/flex-1 语义）→ 置底后
//     末条不在视口即红；
//  F4 问题搬家：把「滚不动」换成「整页滚」——documentElement 出现页面级
//     溢出（横或纵）即红（验收第 3 条：壳仍是唯一裁切者）。
//
// 数据面纪律（2026-10-08 批教训：stub 太乖会让 CI 假绿）：列表一律打桩成
// **远超一屏**的长内容（40 条记忆 / 30 条关注 / 60 行章程 / 40 条任务 /
// 30 条定时），静态表单页（设置/新建项目）用真实 fixture 内容 + 360px 矮
// 视口逼出溢出；finder 同时要求 scrollHeight > clientHeight，内容不够长
// 时测试红而不是空转通过。

/** 滚动层标记属性：finder 在 evaluate 里就地打标，后续断言用它定位。 */
const MARK = 'data-scroll-probe-1032';

/** 从 probe 元素向上找第一个「可滚且内容确实超高」的祖先并打标；随后按
 *  F2→F3→F4 逐条钉。probe 必须是滚动前就在视口内的元素（滚轮要打在它
 *  上），last 是置底后必须完整可见的末尾元素。 */
async function expectScrollerReachesBottom(page: Page, probe: Locator, last: Locator) {
  await probe.evaluate((el, mark) => {
    let node = el.parentElement;
    while (node != null && node !== document.documentElement) {
      const style = getComputedStyle(node);
      if (
        (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
        node.scrollHeight > node.clientHeight
      ) {
        node.setAttribute(mark, '');
        return;
      }
      node = node.parentElement;
    }
  }, MARK);
  // F1：没有可滚祖先 → 0 个（修复前的 ChiefSettings/PageShell 全族）。
  const scroller = page.locator(`[${MARK}]`);
  await expect(scroller).toHaveCount(1);

  // F2：滚轮真的驱动这个容器（用户报障的原始交互）。
  const box = await probe.boundingBox();
  if (box == null) throw new Error('probe element has no box (not rendered?)');
  // Aim near the probe's top: a tall probe (the 60-line charter) centers
  // below the viewport, in the 10px canvas gap under the sheet.
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 10));
  await page.mouse.wheel(0, 240);
  await expect
    .poll(() => scroller.evaluate((el) => el.scrollTop), { timeout: 3_000 })
    .toBeGreaterThan(0);

  // F3：能滚到底——置底后末条元素在视口内。
  await scroller.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect
    .poll(() =>
      scroller.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1),
    )
    .toBe(true);
  await expect(last).toBeInViewport();

  // F4：页面级零溢出——壳仍是唯一裁切者，问题没从「滚不动」搬成「整页滚」。
  const overflow = await page.evaluate(() => ({
    h: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    v: document.documentElement.scrollHeight - document.documentElement.clientHeight,
  }));
  expect(overflow.h).toBeLessThanOrEqual(0);
  expect(overflow.v).toBeLessThanOrEqual(0);
}

const TEAM = { id: 'team-1', name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null };
const USER = { id: 'user-1', displayName: '我', avatarUrl: null };
const PROJECT = {
  id: 'proj-1',
  name: 'pacman',
  teamId: 'team-1',
  repoKind: 'hosted',
  repoName: 'pacman',
  githubRepo: null,
  localPath: null,
};

/** 启动面打桩（agent-detail.spec 的 stubLiveBoot 同律）：teams / user me 是
 *  teamId 来源、必须成功；其余 GET 一律 500——应用既有 isError 耐受。
 *  page.route 匹配序 = 注册逆序：catch-all 先注册，具体路由后注册才生效。 */
async function stubLiveBoot(page: Page) {
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.route('**/api/teams', (route) => route.fulfill({ json: [TEAM] }));
  await page.route('**/api/user/me', (route) => route.fulfill({ json: USER }));
}

// —— ChiefSettings（board 壳内容交换面；live 打桩出长内容）——

const AGENT_ACTOR = {
  id: 'agent-1',
  displayName: '记忆代理',
  description: null,
  status: 'active',
  avatarUrl: null,
  provider: null,
  modelId: null,
  thinkingLevel: null,
  tools: [],
  secrets: [],
  defaultSkill: null,
  skillsAllowlist: null,
  mcpServers: [],
};

const MEMORY_LINE = '这是一段足够长的记忆内容，用来把设置面的记忆列表撑出真实滚动。';

function wireChief(charter: string, watchCount: number) {
  return {
    chief: {
      id: 'chief-user-1-team-1',
      userId: 'user-1',
      teamId: 'team-1',
      agent: { agentId: 'agent-1' },
      charter,
      lastTurnAt: null,
      createdAt: 0,
      tz: 'Asia/Shanghai',
    },
    agentActor: AGENT_ACTOR,
    context: null,
    watches: Array.from({ length: watchCount }, (_, i) => ({
      todoId: `todo-w${i}`,
      projectId: 'proj-1',
      seqNum: i + 1,
      title: `关注条目 ${i}`,
      projectName: 'pacman',
      phase: 'building',
      reason: 'Dispatched by the chief: report back when it parks at a gate or settles.',
      createdAt: 0,
      threadId: `chief-thread-${i}`,
      threadTitle: '滚动探针线程',
    })),
    wakes: [],
  };
}

const MEMORIES = Array.from({ length: 40 }, (_, i) => ({
  id: `mem-${i}`,
  agentId: 'agent-1',
  teamId: 'team-1',
  title: `记忆条目 ${i}`,
  content: `第 ${i} 条沉淀：${MEMORY_LINE}`,
  projectId: null,
  sourceTodoId: null,
  sourceBuildId: null,
  createdAt: 0,
  updatedAt: 0,
}));

/** live 面开总管设置：FAB → 抽屉 → 齿轮（内容交换；`?chief=settings` 深链
 *  打不开设置面——t-0053 实测，齿轮是唯一通路）。 */
async function openChiefSettings(page: Page) {
  await page.goto('/app');
  await page.locator('button[aria-label="总管"]').click();
  const drawer = page.getByRole('dialog', { name: '总管' });
  await expect(drawer).toBeVisible();
  await drawer.locator('button[aria-label="总管设置"]').click();
  await expect(page.getByRole('heading', { name: '总管设置' })).toBeVisible();
  // #1009 A0（ADR 0013）：设置面 = board 路由内容交换，窗体自身停在泊位
  // （chiefView 三态互斥，settings 态 windowOpen=false，keepMounted 以
  // hidden 属性驻 DOM）——溢出量测要的是窗体节点不卸载（无退场腿顶宽
  // documentElement.scrollWidth，F4 页面级溢出量的噪声源），载体判据 =
  // 节点在场（attached），不是可见。
  await expect(page.locator('.chief-drawer')).toBeAttached();
}

test('总管设置三个长内容 tab 都能滚到底 (#1032)', async ({ page }) => {
  await stubLiveBoot(page);
  const longCharter = Array.from({ length: 60 }, (_, i) => `章程第 ${i} 行：${MEMORY_LINE}`).join(
    '\n',
  );
  await page.route('**/api/teams/team-1/chief', (route) =>
    route.fulfill({ json: wireChief(longCharter, 30) }),
  );
  await page.route('**/api/teams/team-1/agents/agent-1/memories', (route) =>
    route.fulfill({ json: MEMORIES }),
  );
  await openChiefSettings(page);

  // 记忆 tab（用户报障的原始面）：40 条撑出滚动，末条滚轮可达。
  await page.getByRole('tab', { name: '记忆' }).click();
  const quota = page.getByText('记忆 · 40 / 100');
  await expect(quota).toBeVisible();
  await expectScrollerReachesBottom(page, quota, page.getByText('记忆条目 39'));

  // 关注与提醒 tab：30 条 watch 行。
  await page.getByRole('tab', { name: '关注与提醒' }).click();
  const firstWatch = page.getByText('关注条目 0', { exact: true });
  await expect(firstWatch).toBeVisible();
  await expectScrollerReachesBottom(page, firstWatch, page.getByText('关注条目 29', { exact: true }));

  // 章程 tab：60 行长文 + 底部编辑钮。
  await page.getByRole('tab', { name: '章程' }).click();
  const charterHead = page.getByText('章程第 0 行', { exact: false }).first();
  await expect(charterHead).toBeVisible();
  await expectScrollerReachesBottom(
    page,
    charterHead,
    page.getByRole('button', { name: '编辑' }),
  );
});

// —— PageShell 四页（pages/shell.tsx:160 一处包装，四页同时受益）——

function wireTodo(i: number) {
  return {
    id: `todo-${i}`,
    teamId: 'team-1',
    projectId: 'proj-1',
    title: `滚动探针任务 ${i}`,
    spec: `滚动探针任务 ${i}`,
    phase: 'todo',
    phaseAt: 0,
    seqNum: i + 1,
    orderIndex: i,
    tagIds: [],
    assignment: null,
    agent: null,
    latestBuildId: null,
    lastRunAt: 0,
    hasChanges: false,
    hasPlan: false,
    buildHistory: [],
    sourceTodo: null,
    v: 1,
  };
}

test('项目任务列表页能滚到底 (#1032)', async ({ page }) => {
  await stubLiveBoot(page);
  await page.route('**/api/projects?*', (route) => route.fulfill({ json: [PROJECT] }));
  await page.route('**/api/todos?*', (route) =>
    route.fulfill({ json: Array.from({ length: 40 }, (_, i) => wireTodo(i)) }),
  );
  await page.goto('/app/project/proj-1?tab=tasks');
  const rows = page.getByTestId('task-row');
  await expect(rows).toHaveCount(40);
  const search = page.getByRole('textbox', { name: '搜索任务' });
  await expect(search).toBeVisible();
  await expectScrollerReachesBottom(page, search, rows.last());
});

function wireSchedule(i: number) {
  return {
    id: `sched-${i}`,
    teamId: 'team-1',
    projectId: 'proj-1',
    todoId: `todo-${i}`,
    kind: 'daily',
    at: 0,
    tz: 'Asia/Shanghai',
    machineId: null,
    nextRunAt: 0,
    createdBy: 'user-1',
    todo: {
      seqNum: i + 1,
      title: `滚动探针定时 ${i}`,
      phase: 'todo',
      projectName: 'pacman',
      ownerId: 'user-1',
    },
  };
}

test('排期页能滚到底 (#1032)', async ({ page }) => {
  await stubLiveBoot(page);
  await page.route('**/api/schedules*', (route) =>
    route.fulfill({ json: Array.from({ length: 30 }, (_, i) => wireSchedule(i)) }),
  );
  await page.goto('/app/schedules');
  const cards = page.locator('.sched-card');
  await expect(cards).toHaveCount(30);
  await expectScrollerReachesBottom(page, cards.first(), cards.last());
});

// 静态内容页（无列表可打桩）：真实 fixture 内容 + 360px 矮视口逼出溢出。
// finder 的 scrollHeight > clientHeight 前提保证「没溢出就红」，不会空转。

test('项目设置页能滚到底 (#1032)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 360 });
  await page.goto('/app/project/ZAQczKCu0MOAzC1ZqcFlX/settings?scenario=r2-24c');
  const danger = page.getByText('危险操作');
  await expect(danger).toBeAttached();
  const firstPanel = page.locator('.prj-set-avatar');
  await expect(firstPanel).toBeVisible();
  await expectScrollerReachesBottom(
    page,
    firstPanel,
    page.getByRole('button', { name: '删除', exact: true }),
  );
});

test('新建项目页能滚到底 (#1032)', async ({ page }) => {
  // Paper 表单（窄栏、操作行靠右）比旧整宽版矮，360 不再溢出；300 仍逼出溢出。
  await page.setViewportSize({ width: 1440, height: 300 });
  await page.goto('/app/project/new?scenario=01');
  const heading = page.getByRole('button', { name: '创建项目' });
  await expect(heading).toBeAttached();
  // probe 必须在滚动层内且滚动前可见——顶栏返回箭头在壳上不在层内，不能用。
  const hint = page.getByText('可选。未设置时以首字母代替。');
  await expect(hint).toBeVisible();
  await expectScrollerReachesBottom(page, hint, heading);
});
