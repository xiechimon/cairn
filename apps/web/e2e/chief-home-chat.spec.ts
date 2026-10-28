import { expect, test } from '@playwright/test';
import { HISTORY, mockLive, PROJECT, type Row, TASK, THREAD } from './chief-home-mock';
import { evidenceShot } from './evidence';

test.describe('home is one continuous chief chat (T1)', () => {
  test('a fresh home shows the greeting, the composer and the sections, and no chief drawer', async ({
    page,
  }) => {
    await mockLive(page, { threads: [], messages: [] });
    await page.goto('/app');
    const home = page.getByTestId('chief-home');
    await expect(home).toHaveAttribute('data-layout', 'hero');
    await expect(page.getByTestId('chief-home-hero')).toContainText('ian');
    await expect(page.getByTestId('chief-home-summary')).toContainText('1 个任务运行中');
    await expect(home.getByTestId('chief-composer-input')).toBeVisible();
    await expect(page.getByTestId('home-sections')).toBeVisible();
    await expect(page.getByRole('button', { name: '总管', exact: true })).toHaveCount(0);
    await expect(page.locator('.chief-drawer')).toBeHidden();
    await evidenceShot(page, 'home-hero.png');
  });

  test('the first send moves the composer to the bottom and the message joins the chat', async ({
    page,
  }) => {
    const sent = await mockLive(page, { threads: [], messages: [] });
    await page.goto('/app');
    const input = page.getByTestId('chief-home').getByTestId('chief-composer-input');
    await input.fill('看板拖完卡片计数不对');
    await input.press('Enter');
    await expect.poll(() => sent).toEqual(['看板拖完卡片计数不对']);
    const home = page.getByTestId('chief-home');
    await expect(home).toHaveAttribute('data-layout', 'chat');
    await expect(home.getByTestId('chief-stream')).toContainText('看板拖完卡片计数不对');
    await expect(page.getByTestId('home-sections')).toHaveCount(0);
    const composer = await home.locator('.chief-composer').boundingBox();
    const viewport = page.viewportSize();
    expect(composer).not.toBeNull();
    expect(viewport).not.toBeNull();
    if (composer && viewport) expect(composer.y + composer.height).toBeGreaterThan(viewport.height - 40);
  });

  test('a first send that fails brings the greeting and the sections back', async ({ page }) => {
    const sent = await mockLive(page, { threads: [], messages: [], rejectSend: true });
    await page.goto('/app');
    const input = page.getByTestId('chief-home').getByTestId('chief-composer-input');
    await input.fill('看板拖完卡片计数不对');
    await input.press('Enter');
    await expect.poll(() => sent).toEqual(['看板拖完卡片计数不对']);
    await expect(page.getByTestId('chief-home')).toHaveAttribute('data-layout', 'hero');
    await expect(page.getByTestId('home-sections')).toBeVisible();
    await expect(input).toHaveValue('看板拖完卡片计数不对');
  });

  test('Escape closes the thread menu on home', async ({ page }) => {
    await mockLive(page, { threads: [THREAD], messages: HISTORY });
    await page.goto('/app');
    const home = page.getByTestId('chief-home');
    await home.getByRole('button', { name: '主题', exact: true }).click();
    const menu = home.getByRole('menu');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
  });

  test('a reply carries a live task chip, a hand-off row and an expandable trace; reload keeps it', async ({
    page,
  }) => {
    await mockLive(page, { threads: [THREAD], messages: HISTORY });
    await page.goto('/app');
    const stream = page.getByTestId('chief-home').getByTestId('chief-stream');
    const chip = stream.locator('a.mention-chip--todo').first();
    await expect(chip).toHaveAttribute('data-phase', 'building');
    await expect(chip.getByRole('img', { name: '执行中' })).toBeVisible();
    const handoff = stream.getByTestId('chief-handoff');
    await expect(handoff).toContainText('已转给任务');
    await expect(handoff).toContainText('#9');
    const expand = stream.getByRole('button', { name: '展开过程' }).first();
    await expand.click();
    await expect(stream.getByTestId('chief-turn-tools').first()).toBeVisible();
    await evidenceShot(page, 'home-chat.png');
    await page.reload();
    await expect(page.getByTestId('chief-home').getByTestId('chief-stream')).toContainText(
      '已经补给它了',
    );
    await page.getByTestId('chief-home').locator('a.mention-chip--todo').first().click();
    await expect(page).toHaveURL(/\/app\?(.*&)?task=todo-1/);
    await expect(page.getByRole('complementary', { name: '任务面板' })).toBeVisible();
  });

  test('cmd+J on home focuses the home composer instead of opening the drawer', async ({ page }) => {
    await mockLive(page, { threads: [THREAD], messages: HISTORY });
    await page.goto('/app');
    await expect(page.getByTestId('chief-home').getByTestId('chief-stream')).toBeVisible();
    await page.keyboard.press('ControlOrMeta+j');
    await expect(page.getByTestId('chief-home').getByTestId('chief-composer-input')).toBeFocused();
    await expect(page.locator('.chief-drawer')).toBeHidden();
  });

  test('the board view keeps the chief button and drawer', async ({ page }) => {
    await mockLive(page, { threads: [THREAD], messages: HISTORY });
    await page.goto('/app?view=board');
    await expect(page.getByTestId('chief-home')).toHaveCount(0);
    await page.getByRole('button', { name: '总管', exact: true }).click();
    await expect(page.locator('.chief-drawer')).toBeVisible();
  });

  test('a task chip in the drawer opens the task panel on the board instead of leaving it', async ({
    page,
  }) => {
    await mockLive(page, { threads: [THREAD], messages: HISTORY });
    await page.goto('/app?view=board');
    await page.getByRole('button', { name: '总管', exact: true }).click();
    const drawer = page.locator('.chief-drawer');
    await drawer.locator('a.mention-chip--todo').first().click();
    const panel = page.getByRole('complementary', { name: '任务面板' });
    await expect(panel).toBeVisible();
    await expect(panel).toBeInViewport({ ratio: 1 });
    await expect.poll(() => new URL(page.url()).searchParams.get('task')).toBe('todo-1');
    const url = new URL(page.url());
    expect(url.pathname).toBe('/app');
    expect(url.searchParams.get('view')).toBe('board');
    await expect(drawer).toBeHidden();
  });

  test('phone width: the chat fills the screen and the composer stays on screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockLive(page, { threads: [THREAD], messages: HISTORY });
    await page.goto('/app');
    const composer = page.getByTestId('chief-home').locator('.chief-composer');
    await expect(composer).toBeInViewport();
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(390);
    await evidenceShot(page, 'home-chat-phone.png');
  });
});

const DAY = 24 * 60 * 60 * 1000;
const startOfToday = () => new Date().setHours(0, 0, 0, 0);
const yesterdayHistory = (): Row[] => {
  const base = startOfToday() - 10 * 60 * 60 * 1000;
  return HISTORY.map((row, i) => ({ ...row, createdAt: base + i * 60_000 }));
};
const SITE = { ...PROJECT, id: 'proj-2', name: 'cairn-site', repoName: 'cairn-site' };
const dayTasks = () => [
  TASK,
  {
    ...TASK,
    id: 'todo-2',
    seqNum: 12,
    title: '首页问候语对齐原型',
    phase: 'review',
    phaseAt: Date.now() - 2 * 60 * 60 * 1000,
  },
  {
    ...TASK,
    id: 'todo-3',
    projectId: 'proj-2',
    seqNum: 4,
    title: '官网作品区换成真实截图',
    phase: 'done',
    phaseAt: Date.now() - 3 * 60 * 60 * 1000,
  },
  {
    ...TASK,
    id: 'todo-4',
    projectId: 'proj-2',
    seqNum: 2,
    title: '上周合并的旧任务',
    phase: 'done',
    phaseAt: Date.now() - 3 * DAY,
  },
];

test.describe('the first open of each day starts on a clean home (T3)', () => {
  test('yesterday stays above, dimmed, and today opens on the greeting, the date and a per-project brief', async ({
    page,
  }) => {
    await mockLive(page, {
      threads: [THREAD],
      messages: yesterdayHistory(),
      todos: dayTasks(),
      projects: [PROJECT, SITE],
    });
    await page.goto('/app');
    const home = page.getByTestId('chief-home');
    await expect(home).toHaveAttribute('data-layout', 'day');
    const today = home.getByTestId('chief-home-today');
    await expect(today.getByRole('heading', { level: 2 })).toContainText('ian');
    const date = new Intl.DateTimeFormat('zh-CN', {
      month: 'long',
      day: 'numeric',
      weekday: 'short',
    }).format(Date.now());
    await expect(today).toContainText(date);
    await expect(today).toContainText('往上滑查看昨天的对话');
    const lines = today.getByTestId('chief-brief-project');
    await expect(lines).toHaveCount(2);
    await expect(lines.nth(0)).toContainText('cairn');
    await expect(lines.nth(0)).toContainText('1 个运行中');
    await expect(lines.nth(0)).toContainText('1 项待处理');
    await expect(lines.nth(1)).toContainText('cairn-site');
    await expect(lines.nth(1)).toContainText('完成 1 个');
    await expect(today.getByTestId('needs-you-row')).toHaveCount(1);
    await expect(today.getByTestId('needs-you-row')).toContainText('首页问候语对齐原型');
    const earlier = home.getByTestId('chief-earlier');
    await expect(earlier).toContainText('已经补给它了');
    const opacity = await earlier.evaluate((node) => Number(getComputedStyle(node).opacity));
    expect(opacity).toBeLessThan(1);
    await expect(today.getByRole('heading', { level: 2 })).toBeInViewport();
    await expect(earlier.getByText('看板拖完卡片计数不对，修一下')).not.toBeInViewport();
    await expect(page.getByTestId('home-sections')).toHaveCount(0);
    await expect(home.getByTestId('jump-to-latest')).toHaveAttribute('data-active', 'false');
    await evidenceShot(page, 'day-home.png');
    await earlier.getByText('看板拖完卡片计数不对，修一下').scrollIntoViewIfNeeded();
    await evidenceShot(page, 'day-home-scrolled-up.png');
    await page.evaluate(() => localStorage.setItem('cairn-theme', 'light'));
    await page.reload();
    await expect(today.getByRole('heading', { level: 2 })).toBeInViewport();
    await expect(home.getByTestId('jump-to-latest')).toHaveAttribute('data-active', 'false');
    await page.waitForTimeout(300);
    await evidenceShot(page, 'day-home-light.png');
  });

  test('a need card in the brief opens the task panel in place', async ({ page }) => {
    await mockLive(page, {
      threads: [THREAD],
      messages: yesterdayHistory(),
      todos: dayTasks(),
      projects: [PROJECT, SITE],
    });
    await page.goto('/app');
    await page
      .getByTestId('chief-home-today')
      .getByTestId('needs-you-row')
      .getByRole('link')
      .click();
    await expect.poll(() => new URL(page.url()).searchParams.get('task')).toBe('todo-2');
    expect(new URL(page.url()).pathname).toBe('/app');
    await expect(page.getByRole('complementary', { name: '任务面板' })).toBeVisible();
  });

  test('the first send of the day continues the chat below the brief', async ({ page }) => {
    const sent = await mockLive(page, {
      threads: [THREAD],
      messages: yesterdayHistory(),
      todos: dayTasks(),
      projects: [PROJECT, SITE],
    });
    await page.goto('/app');
    const home = page.getByTestId('chief-home');
    await expect(home).toHaveAttribute('data-layout', 'day');
    const input = home.getByTestId('chief-composer-input');
    await input.fill('先看 #12 的评审');
    await input.press('Enter');
    await expect.poll(() => sent).toEqual(['先看 #12 的评审']);
    await expect(home).toHaveAttribute('data-layout', 'chat');
    const today = home.getByTestId('chief-home-today');
    await expect(today).toBeVisible();
    await expect(today).not.toContainText('往上滑查看');
    const message = home.getByTestId('chief-stream').getByText('先看 #12 的评审');
    await expect(message).toBeInViewport();
    await expect(home.getByTestId('chief-earlier')).not.toContainText('先看 #12 的评审');
    const brief = await today.boundingBox();
    const sentBox = await message.boundingBox();
    expect(brief).not.toBeNull();
    expect(sentBox).not.toBeNull();
    if (brief && sentBox) expect(sentBox.y).toBeGreaterThan(brief.y + brief.height - 1);
    await evidenceShot(page, 'day-home-after-send.png');
  });

  test('a send whose server time is still yesterday does not bring the clean layout back', async ({
    page,
  }) => {
    const sent = await mockLive(page, {
      threads: [THREAD],
      messages: yesterdayHistory(),
      todos: dayTasks(),
      projects: [PROJECT, SITE],
      sendAt: startOfToday() - 60_000,
    });
    await page.goto('/app');
    const home = page.getByTestId('chief-home');
    const input = home.getByTestId('chief-composer-input');
    await input.fill('时钟偏差');
    await input.press('Enter');
    await expect.poll(() => sent).toEqual(['时钟偏差']);
    await expect(home.getByTestId('chief-stream')).toContainText('时钟偏差');
    await expect(home).toHaveAttribute('data-layout', 'chat');
    await expect(home.getByTestId('chief-earlier')).not.toContainText('时钟偏差');
  });

  test('a thread that already has messages from today opens as normal chat', async ({ page }) => {
    const base = startOfToday() + 60_000;
    await mockLive(page, {
      threads: [THREAD],
      messages: HISTORY.map((row, i) => ({ ...row, createdAt: base + i * 1000 })),
    });
    await page.goto('/app');
    const home = page.getByTestId('chief-home');
    await expect(home.getByTestId('chief-stream')).toContainText('已经补给它了');
    await expect(home).toHaveAttribute('data-layout', 'chat');
    await expect(home.getByTestId('chief-home-today')).toHaveCount(0);
  });

  test('a quiet night says so in one line and shows no need cards', async ({ page }) => {
    await mockLive(page, {
      threads: [THREAD],
      messages: yesterdayHistory(),
      todos: [{ ...TASK, phase: 'todo' }],
    });
    await page.goto('/app');
    const today = page.getByTestId('chief-home-today');
    await expect(today).toContainText('过去 24 小时各项目没有新进展');
    await expect(today.getByTestId('chief-brief-project')).toHaveCount(0);
    await expect(today.getByTestId('needs-you-row')).toHaveCount(0);
  });

  test('phone width: the clean home fits the screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockLive(page, {
      threads: [THREAD],
      messages: yesterdayHistory(),
      todos: dayTasks(),
      projects: [PROJECT, SITE],
    });
    await page.goto('/app');
    const today = page.getByTestId('chief-home-today');
    await expect(today.getByRole('heading', { level: 2 })).toBeInViewport();
    await expect(page.getByTestId('chief-home').locator('.chief-composer')).toBeInViewport();
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(390);
    await expect(page.getByTestId('jump-to-latest')).toHaveAttribute('data-active', 'false');
    await evidenceShot(page, 'day-home-phone.png');
  });
});
