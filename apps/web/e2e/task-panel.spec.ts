import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { evidenceShot } from './evidence';

const HOME = '/app?scenario=board-inbox';
const BOARD = '/app?scenario=board-inbox&view=board';

const panel = (page: Page) => page.getByRole('complementary', { name: '任务面板' });
const toggle = (page: Page) => page.getByRole('button', { name: '任务面板' });
const params = (page: Page) => new URL(page.url()).searchParams;
async function shot(page: Page, name: string) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Number.POSITIVE_INFINITY)
        .map((a) => a.finished),
    ),
  );
  await evidenceShot(page, name);
}

test.describe('task panel list view', () => {
  test('the toggle opens the list in four groups and writes ?panel=1 without a history entry', async ({
    page,
  }) => {
    await page.goto(HOME);
    const before = await page.evaluate(() => history.length);
    await toggle(page).click();
    const p = panel(page);
    await expect(p).toBeVisible();
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
    const groups = p.getByTestId('task-panel-group');
    await expect(groups).toHaveText([/待你处理.*4/, /运行中.*1/, /待开始.*1/, /已完成.*4/]);
    await expect(groups.nth(3)).toHaveAttribute('aria-expanded', 'false');
    await expect(p.getByTestId('task-panel-row')).toHaveCount(6);
    await p.getByTestId('task-panel-stale').click();
    await expect(p.getByTestId('task-panel-row')).toHaveCount(11);
    await groups.nth(3).click();
    await expect(p.getByTestId('task-panel-row')).toHaveCount(15);
    expect(params(page).get('panel')).toBe('1');
    expect(await page.evaluate(() => history.length)).toBe(before);
    await expect(page.getByTestId('chief-home')).toBeVisible();
    await shot(page, 'home-list.png');
  });

  test('a mouse open after a keyboard open does not move focus into the panel', async ({ page }) => {
    await page.goto(HOME);
    await toggle(page).focus();
    await page.keyboard.press('Enter');
    await expect(panel(page).getByRole('button', { name: '关闭面板' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    await page.getByTestId('home-running-row').getByRole('link').click();
    await expect(panel(page).getByTestId('task-panel-title')).toBeVisible();
    await expect.poll(() => panel(page).evaluate((el) => el.contains(document.activeElement))).toBe(false);
  });

  test('leaving for a page without the panel closes it', async ({ page }) => {
    await page.goto(`${HOME}&task=inbox-running`);
    await expect(panel(page)).toBeVisible();
    await page.getByRole('link', { name: '定时' }).first().click();
    await expect(page).toHaveURL(/\/app\/schedules/);
    await page.goBack();
    await expect(page.getByTestId('chief-home')).toBeVisible();
    await expect(panel(page)).toHaveCount(0);
  });

  test('Esc closes the panel, clears the URL and returns focus to the toggle', async ({ page }) => {
    await page.goto(HOME);
    await toggle(page).click();
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    expect(params(page).has('panel')).toBe(false);
    await expect(toggle(page)).toBeFocused();
  });

  test('a reload with ?panel=1 opens the list again', async ({ page }) => {
    await page.goto(`${HOME}&panel=1`);
    await expect(panel(page).getByTestId('task-panel-group')).toHaveCount(4);
  });
});

test.describe('task panel task view', () => {
  test('a home row opens the task in place with the ask box, the stage list and the expand link', async ({
    page,
  }) => {
    await page.goto(HOME);
    await page.getByTestId('needs-you-row').filter({ hasText: '#102' }).getByRole('link').click();
    const p = panel(page);
    await expect(p.getByTestId('task-panel-title')).toHaveText(
      '段超时杀已交付 plan 的残留流：停闸后的 build 被覆写为 failed',
    );
    expect(new URL(page.url()).pathname).toBe('/app');
    expect(params(page).get('task')).toBe('inbox-confirm');
    await expect(p.getByTestId('task-panel-ask')).toContainText('待确认');
    const stages = p.getByTestId('task-panel-stage');
    await expect(stages).toHaveCount(4);
    await expect(stages.nth(0)).toHaveAttribute('data-state', 'wait');
    await expect(stages.nth(1)).toHaveAttribute('data-state', 'not');
    await expect(p.getByRole('link', { name: '展开为整页' })).toHaveAttribute(
      'href',
      /\/app\/todo\/inbox-confirm/,
    );
    await expect(page.getByTestId('chief-home')).toBeVisible();
    await shot(page, 'home-task.png');

    await p.getByRole('button', { name: '任务', exact: true }).click();
    await expect(p.getByTestId('task-panel-group')).toHaveCount(4);
    expect(params(page).has('task')).toBe(false);
    expect(params(page).get('panel')).toBe('1');
  });

  test('a deep link with ?task opens that task', async ({ page }) => {
    await page.goto(`${HOME}&task=inbox-running`);
    const p = panel(page);
    await expect(p.getByTestId('task-panel-title')).toContainText('verify-cairn');
    await expect(p.getByTestId('task-panel-stage').nth(1)).toHaveAttribute('data-state', 'cur');
    await expect(p.getByTestId('task-panel-ask')).toHaveCount(0);
  });

  test('a keyboard open moves focus into the panel and Esc returns it to the row', async ({
    page,
  }) => {
    await page.goto(HOME);
    const link = page.getByTestId('home-running-row').getByRole('link');
    await link.focus();
    await page.keyboard.press('Enter');
    const p = panel(page);
    await expect(p.getByTestId('task-panel-title')).toBeVisible();
    await expect.poll(() => p.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(p).toHaveCount(0);
    await expect(link).toBeFocused();
  });

  test('the expand link leaves for the full task page and closes the panel', async ({ page }) => {
    await page.goto(`${HOME}&task=inbox-review`);
    await panel(page).getByRole('link', { name: '展开为整页' }).click();
    await expect(page).toHaveURL(/\/app\/todo\/inbox-review/);
    expect(params(page).has('task')).toBe(false);
    expect(params(page).has('panel')).toBe(false);
    await expect(panel(page)).toHaveCount(0);
  });
});

test.describe('task panel hosts', () => {
  test('kanban: a card opens the panel and the board stays; a modified click keeps the link', async ({
    page,
  }) => {
    await page.goto(BOARD);
    const card = page.locator('[data-todo-id="inbox-running"]');
    await card.locator('.todo-card-link').click();
    await expect(panel(page).getByTestId('task-panel-title')).toContainText('verify-cairn');
    await expect(page.locator('[data-column]')).toHaveCount(4);
    expect(new URL(page.url()).searchParams.get('view')).toBe('board');
    await expect(card.locator('.todo-card-link')).toHaveAttribute('href', /\/app\/todo\/inbox-running/);
    await shot(page, 'board-task.png');
  });

  test('project page: a task row opens the panel', async ({ page }) => {
    await page.goto('/app/project/ZAQczKCu0MOAzC1ZqcFlX?scenario=prj-tasks&tab=tasks');
    const row = page.getByTestId('task-row').first();
    const title = (await row.locator('.prj-task-link').textContent()) ?? '';
    await row.locator('.prj-task-link').click();
    await expect(panel(page).getByTestId('task-panel-title')).toHaveText(title);
    await expect(page).toHaveURL(/\/app\/project\/ZAQczKCu0MOAzC1ZqcFlX/);
    await shot(page, 'project-task.png');
  });

  test('agent page: an in-progress row opens the panel', async ({ page }) => {
    await page.goto('/app/resources/agents/r3-builder?scenario=agent-detail-active');
    await page.getByRole('button', { name: /给 README\.md 增加/ }).click();
    await expect(panel(page).getByTestId('task-panel-title')).toContainText('给 README.md 增加');
    await expect(page).toHaveURL(/\/app\/resources\/agents\/r3-builder/);
  });

  test('machine page: the toggle opens the task list', async ({ page }) => {
    await page.goto('/app/resources/machines/Kd8fG2hJ4mN9pQ1rStUvWx3?scenario=06');
    await toggle(page).click();
    await expect(panel(page).getByTestId('task-panel-group')).toHaveCount(4);
  });
});

test.describe('task panel layout', () => {
  test('desktop: the panel docks at 420px beside the page', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${HOME}&panel=1`);
    const box = await panel(page).boundingBox();
    expect(box?.width).toBeCloseTo(420, 0);
    await expect(page.getByTestId('task-panel-scrim')).toBeHidden();
  });

  test('1100px and below: the panel overlays the page and the scrim closes it', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.goto(BOARD);
    const before = await page.getByTestId('board-scroller').boundingBox();
    await toggle(page).click();
    await expect(panel(page)).toBeVisible();
    const after = await page.getByTestId('board-scroller').boundingBox();
    expect(after?.width).toBe(before?.width);
    const scrim = page.getByTestId('task-panel-scrim');
    await expect(scrim).toBeVisible();
    await shot(page, 'overlay.png');
    await scrim.click({ position: { x: 20, y: 400 } });
    await expect(panel(page)).toHaveCount(0);
  });

  test('phone: the panel fills the screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${HOME}&task=inbox-reply`);
    const box = await panel(page).boundingBox();
    expect(box?.width).toBeCloseTo(390, 0);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(390);
    await shot(page, 'phone-task.png');
  });
});

test('a task created while the list is open flashes once', async ({ page }) => {
  await page.goto('/app?scenario=01&view=board&panel=1');
  await expect(panel(page)).toBeVisible();
  await page.locator('.sidebar-new-task').click();
  const dialog = page.getByRole('dialog', { name: '新建任务' });
  await dialog.getByRole('textbox').fill('给登录页加验证码');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  const row = panel(page).getByTestId('task-panel-row').filter({ hasText: '给登录页加验证码' });
  await expect(row).toHaveAttribute('data-flash', 'true');
  await expect(row).not.toHaveAttribute('data-flash', 'true', { timeout: 4000 });
  await expect(panel(page).locator('[data-flash="true"]')).toHaveCount(0);
});

test.describe('axe with the panel open', () => {
  for (const [name, url] of [
    ['list', `${HOME}&panel=1`],
    ['task', `${HOME}&task=inbox-reply`],
    ['board task', `${BOARD}&task=inbox-review`],
  ] as const) {
    test(name, async ({ page }) => {
      await page.goto(url);
      await expect(panel(page)).toBeVisible();
      const result = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(result.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
    });
  }
});

const TEAM = { id: 't1', name: '团队' };
const USER = { id: 'u1', displayName: 'ian', avatarUrl: null };
const TASK = {
  id: 'todo-1',
  teamId: 't1',
  projectId: 'proj-1',
  title: '修复看板拖拽后计数不刷新',
  spec: '',
  phase: 'building',
  phaseAt: Date.now() - 12 * 60_000,
  seqNum: 9,
  orderIndex: 0,
  tagIds: [],
  assignment: null,
  agent: { id: 'agent-1', displayName: 'r5-scribe' },
  latestBuildId: 'build-1',
  lastRunAt: 0,
  hasChanges: false,
  hasPlan: true,
  buildHistory: [],
  sourceTodo: null,
  v: 1,
};
const PROJECT = {
  id: 'proj-1',
  name: 'cairn',
  teamId: 't1',
  repoKind: 'hosted',
  repoName: 'cairn',
  githubRepo: null,
  localPath: null,
};

test('live: the panel shows the last agent summary and the composer steers the running task', async ({
  page,
}) => {
  await page.addInitScript(() => {
    class FakeEventSource {
      readyState = 1;
      onopen: (() => void) | null = null;
      onmessage: (() => void) | null = null;
      onerror: (() => void) | null = null;
      close() {}
      addEventListener() {}
      removeEventListener() {}
    }
    Object.defineProperty(window, 'EventSource', { configurable: true, value: FakeEventSource });
  });
  const steers: string[] = [];
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const p = new URL(request.url()).pathname;
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (p === '/api/teams') return json([TEAM]);
    if (p === '/api/user/me') return json(USER);
    if (p === '/api/teams/t1/notifications') return json({ unreadThreadIds: [] });
    if (p === '/api/todos') return json([TASK]);
    if (p === '/api/projects') return json([PROJECT]);
    if (p === '/api/teams/t1/chief')
      return json({
        chief: {
          id: 'chief-u1-t1',
          userId: 'u1',
          teamId: 't1',
          agent: { agentId: 'agent-1' },
          charter: null,
          lastTurnAt: null,
          createdAt: 0,
          tz: null,
        },
        agentActor: null,
        context: null,
        watches: [],
        wakes: [],
      });
    if (p === '/api/builds/build-1/steps')
      return json([{ id: 's1', buildId: 'build-1', status: 'claimed', kind: 'build' }]);
    if (p === '/api/conversations/build-1/messages' && request.method() === 'POST') {
      steers.push((request.postDataJSON() as { content: string }).content);
      return json({ message: { id: 'm9' } });
    }
    if (p === '/api/conversations/build-1/messages')
      return json({
        messages: [
          { id: 'm1', role: 'user', content: '开始', createdAt: 1 },
          { id: 'm2', role: 'assistant', content: '计数在 drop 之后没有重新读取，正在补测试。', createdAt: 2 },
        ],
        chips: null,
        historyEpoch: 0,
        steerPending: [],
        activeRun: null,
        nextCursor: null,
      });
    return json([]);
  });
  await page.goto('/app?task=todo-1');
  const p = panel(page);
  await expect(p.getByTestId('task-panel-title')).toHaveText(TASK.title);
  await expect(p.getByTestId('task-panel-meta')).toContainText('cairn');
  await expect(p.getByTestId('task-panel-meta')).toContainText('r5-scribe');
  await expect(p.getByTestId('task-panel-summary')).toHaveText('计数在 drop 之后没有重新读取，正在补测试。');
  const input = p.getByRole('textbox', { name: '引导这个任务' });
  await input.fill('空列提示也改一下');
  await input.press('Enter');
  await expect.poll(() => steers).toEqual(['空列提示也改一下']);
  await expect(input).toHaveValue('');
  await shot(page, 'live-task.png');
});
