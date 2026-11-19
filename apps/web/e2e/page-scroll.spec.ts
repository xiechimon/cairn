import { expect, type Locator, type Page, test } from '@playwright/test';

const MARK = 'data-scroll-probe-1032';

async function expectScrollerReachesBottom(page: Page, probe: Locator, last: Locator) {
  await expect(last).toBeAttached();
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

  const scroller = page.locator(`[${MARK}]`);
  await expect(scroller).toHaveCount(1);

  const box = await probe.boundingBox();
  if (box == null) throw new Error('probe element has no box (not rendered?)');
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 10));
  await page.mouse.wheel(0, 240);
  await expect
    .poll(() => scroller.evaluate((el) => el.scrollTop), { timeout: 3_000 })
    .toBeGreaterThan(0);

  await scroller.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect
    .poll(() =>
      scroller.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1),
    )
    .toBe(true);
  await expect(last).toBeInViewport();

  const overflow = await page.evaluate(() => ({
    h: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    v: document.documentElement.scrollHeight - document.documentElement.clientHeight,
  }));
  expect(overflow.h).toBeLessThanOrEqual(0);
  expect(overflow.v).toBeLessThanOrEqual(0);
}

const TEAM = { id: 'team-1', name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null };
const USER = { id: 'user-1', displayName: '我', avatarUrl: null };
async function stubLiveBoot(page: Page) {
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.route('**/api/teams', (route) => route.fulfill({ json: [TEAM] }));
  await page.route('**/api/user/me', (route) => route.fulfill({ json: USER }));
}

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
      projectName: 'cairn',
      ownerId: 'user-1',
    },
  };
}

test('the schedules tab scrolls to its last row and the new schedule button (#1032)', async ({ page }) => {
  await stubLiveBoot(page);
  await page.route('**/api/schedules*', (route) =>
    route.fulfill({ json: Array.from({ length: 30 }, (_, i) => wireSchedule(i)) }),
  );
  await page.goto('/app?pane=tasks&tab=scheduled');
  const rows = page
    .getByRole('complementary', { name: '任务' })
    .locator('[data-slot="schedule-row"]');
  await expect(rows).toHaveCount(30);
  await expectScrollerReachesBottom(page, rows.first(), page.getByTestId('schedule-new'));
});

test('project settings page scrolls to the bottom (#1032)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 360 });
  await page.goto('/app/project/ZAQczKCu0MOAzC1ZqcFlX/settings?scenario=r2-24c');
  const archive = page.getByTestId('project-archive');
  await expect(archive).toBeAttached();
  const firstPanel = page.getByTestId('project-icon-trigger');
  await expect(firstPanel).toBeVisible();
  await expectScrollerReachesBottom(page, firstPanel, archive);
});

test('new project page scrolls to the bottom (#1032)', async ({ page }) => {

  await page.setViewportSize({ width: 1440, height: 300 });
  await page.goto('/app/project/new?scenario=01');
  const heading = page.getByRole('button', { name: '创建项目' });
  await expect(heading).toBeAttached();

  const icon = page.getByRole('button', { name: '更换项目图标' });
  await expect(icon).toBeVisible();
  await expectScrollerReachesBottom(page, icon, heading);
});
