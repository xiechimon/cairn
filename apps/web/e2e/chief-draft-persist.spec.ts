import { expect, type Page, test } from '@playwright/test';
import { evidenceShot } from './evidence';

// #1056: chief 悬浮窗 composer 草稿跨整页刷新持久化（Multica 对齐面，#1009
// A0 实审 spin-off）。D6 常驻契约是内存面的保（最小化/路由切换/SPA 导航
// 全保，已验），整页刷新原本即丢——本面把 live 面草稿提为 chief-drawer
// 受控态并写穿 localStorage（键 = cairn.chief-draft，品牌前缀照
// cairn.chief-open 先例；Multica packages/core/chat/store.ts 的
// setInputDraft 每键写穿 + writeDrafts 空值 removeItem 同律）。单槽纯文本
// 只保活动线程的 composer 现文（票面两选项裁「只保活动线程」：本窗会话内
// 草稿就是单槽跨线程切换持续，按线程分键会改写这条已验行为）。
//
// Failure modes pinned here (one test per mode):
//  1. 刷新不回显：写稿 → 存储写穿 → 整页刷新 → textarea 逐字回显，且
//     回显不抢焦点（MUL-5522 同律：持久化开态的加载不 autofocus）；
//  2. 发送成功后草稿复活：accepted send 清稿必须同时清键——刷新后
//     composer 保持空（写面漏清键 = 复活 bug）；
//  3. 被拒发送丢稿（#631 × #1056 交互面）：500 被拒保留 draft 且保留
//     存储，刷新后仍逐字在（持久化是加载面，不改发送面语义）；
//  4. D6 已验面回归：受控态上提不改最小化/路由切换的内存面保持
//     （带稿走 minimize 往返 + SPA 路由往返，双腿逐字完好）；
//  5. fixture 面读写存储（采集确定性律，A0 S11 同形）：scenario 面
//     零读零写 cairn.chief-draft——预植键不被消费也不被改写，草稿
//     回显来源恒为 scenario 的 chief.draft。

const TEAM_ID = 'team-1';
const USER = { id: 'user-1', displayName: '我', avatarUrl: null };
const TEAM = { id: TEAM_ID, name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null };
const DRAFT_KEY = 'cairn.chief-draft';
// CJK + ASCII 混排：存储往返的逐字性用真文案形态钉（参照产品捕获稿同款）。
const DRAFT = '帮我看看这个项目的进展 — reload 后逐字还在 (#1056)';

/** Boot face（composer-wire-reject stubBoot 同纪律）：teams / user me 带
 *  teamId、chief threads 答空列表，其余 GET 全 500（data ?? [] 族容忍）。
 *  page.route matches in reverse registration order — catch-all first. */
async function stubBoot(page: Page) {
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.route('**/api/teams', (route) => route.fulfill({ json: [TEAM] }));
  await page.route('**/api/user/me', (route) => route.fulfill({ json: USER }));
  await page.route(`**/api/teams/${TEAM_ID}/notifications`, (route) =>
    route.fulfill({ json: { unreadThreadIds: [] } }),
  );
  await page.route(`**/api/teams/${TEAM_ID}/chief/threads`, (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ json: [] });
  });
}

async function openChiefComposer(page: Page) {
  await stubBoot(page);
  await page.goto('/app');
  // live 面默认关（D5 never pops uninvited）；FAB 点击开窗并写
  // cairn.chief-open=1，后续 reload 窗自开（D5 已验面，本 spec 顺带倚靠）。
  await page.getByRole('button', { name: '总管', exact: true }).click();
  const input = page.getByTestId('chief-composer-input');
  await expect(input).toBeVisible();
  await expect(input).toBeEditable();
  return { drawer: page.locator('.chief-drawer'), input };
}

const storedDraft = (page: Page) => page.evaluate((key) => localStorage.getItem(key), DRAFT_KEY);

test('live face: the draft survives a full-page reload', async ({ page }) => {
  const { input } = await openChiefComposer(page);
  await input.fill(DRAFT);
  await expect.poll(() => storedDraft(page)).toBe(DRAFT);
  await evidenceShot(page, 'draft-typed-before-reload.png');

  await page.reload();
  // 持久化开态（D5）把窗带回；草稿回显只落 value，不抢焦点——
  // 「持久化开态的加载不 autofocus」律（chief-drawer MUL-5522 注）在
  // 草稿恢复面上同样成立。
  await expect(input).toBeVisible();
  await expect(input).toHaveValue(DRAFT);
  await expect.poll(() => storedDraft(page)).toBe(DRAFT);
  const focused = await page.evaluate(() =>
    document.activeElement?.getAttribute('data-testid'),
  );
  expect(focused).not.toBe('chief-composer-input');
  await evidenceShot(page, 'draft-restored-after-reload.png');
});

test('live face: an accepted send clears the persisted draft (no resurrection)', async ({
  page,
}) => {
  const { input } = await openChiefComposer(page);
  let posts = 0;
  await page.route(`**/api/teams/${TEAM_ID}/chief/threads`, (route, request) => {
    if (request.method() !== 'POST') return route.fallback();
    posts += 1;
    return route.fulfill({
      status: 200,
      json: { thread: { id: 'chief-1', teamId: TEAM_ID, title: DRAFT, createdAt: 0 } },
    });
  });

  await input.fill(DRAFT);
  await expect.poll(() => storedDraft(page)).toBe(DRAFT);
  await input.press('Enter');

  await expect.poll(() => posts).toBe(1);
  await expect(input).toHaveValue('');
  // 空稿删键不留残（Multica writeDrafts removeItem 同律）。
  await expect.poll(() => storedDraft(page)).toBeNull();
  await evidenceShot(page, 'send-accepted-storage-cleared.png');

  await page.reload();
  await expect(input).toBeVisible();
  await expect(input).toHaveValue('');
});

test('live face: a rejected send keeps the draft in the box and in storage (#631)', async ({
  page,
}) => {
  const { input } = await openChiefComposer(page);
  await page.route(`**/api/teams/${TEAM_ID}/chief/threads`, (route, request) => {
    if (request.method() !== 'POST') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'upstream refused' } });
  });

  await input.fill(DRAFT);
  await expect.poll(() => storedDraft(page)).toBe(DRAFT);
  await input.press('Enter');

  // #631 契约：被拒保留 draft；#1056 面：存储同保留（加载面不改发送面）。
  await expect(input).toHaveValue(DRAFT);
  await expect.poll(() => storedDraft(page)).toBe(DRAFT);
  await evidenceShot(page, 'send-rejected-draft-persisted.png');

  await page.reload();
  await expect(input).toBeVisible();
  await expect(input).toHaveValue(DRAFT);
});

test('live face: minimize and SPA route switches keep the draft (D6 zero regression)', async ({
  page,
}) => {
  // 资源 folds by default in the Grouped sidebar; open it to reach 技能
  await page.addInitScript(() => localStorage.setItem('cairn.sidebarResourcesCollapsed', '0'));
  const { drawer, input } = await openChiefComposer(page);
  await input.fill(DRAFT);
  await expect.poll(() => storedDraft(page)).toBe(DRAFT);

  // 最小化腿：keepMounted 常驻保内存态（D6），受控态上提后同律。
  await drawer.getByRole('button', { name: '最小化' }).click();
  await expect(drawer).toBeHidden();
  await page.getByRole('button', { name: '总管', exact: true }).click();
  await expect(input).toBeVisible();
  await expect(input).toHaveValue(DRAFT);

  // SPA 路由往返腿：根 host 常驻不重挂（chief-root D6），草稿不经刷新
  // 也不经存储往返——内存态直接活着。
  await page.getByRole('link', { name: '技能' }).click();
  await expect(page).toHaveURL(/\/app\/resources\/skills/);
  await expect(input).toHaveValue(DRAFT);
  await page.getByRole('link', { name: '工作台' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(input).toHaveValue(DRAFT);
  await evidenceShot(page, 'd6-legs-draft-intact.png');
});

test('fixture face: zero writes, zero reads (A0 S11 shape)', async ({ page }) => {
  // 预植键：scenario 面既不得消费（读面禁）也不得改写/删除（写面禁）。
  await page.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    [DRAFT_KEY, 'SEEDED-BY-TEST'],
  );
  await page.goto('/app?scenario=111');
  const input = page.getByTestId('chief-composer-input');
  await expect(input).toBeVisible();
  // 草稿回显来源 = scenario 的 chief.draft（r5 100/111 捕获稿），非预植值；
  // 静态面 readOnly（#129 契约），打字不发动任何写路径。
  await expect(input).not.toHaveValue('SEEDED-BY-TEST');
  await expect(input).toHaveValue(/我想做一个能在浏览器里直接玩的网页小游戏/);
  await expect(input).toHaveAttribute('readonly', '');
  await expect.poll(() => storedDraft(page)).toBe('SEEDED-BY-TEST');
  await evidenceShot(page, 'fixture-face-storage-untouched.png');
});
