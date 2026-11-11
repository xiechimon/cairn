import { expect, type Page, test } from '@playwright/test';

const HOME = '/app?scenario=home-c';

const panel = (page: Page) => page.getByRole('complementary', { name: '任务' });
const madePanel = (page: Page) => page.getByRole('complementary', { name: '成果' });
const tasksButton = (page: Page) => page.getByTestId('home-c').getByRole('button', { name: '任务' });
const madeButton = (page: Page) => page.getByTestId('home-c').getByRole('button', { name: '成果' });

test('the Tasks toggle carries the needs-you count and opens sections in Duet order', async ({
  page,
}) => {
  await page.goto(HOME);
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByTestId('tasks-badge')).toHaveText('3');
  await tasksButton(page).click();
  await expect(panel(page)).toBeVisible();
  await expect(page).toHaveURL(/[?&]pane=tasks/);
  const sections = panel(page).getByTestId('tasks-section');
  await expect(sections).toHaveCount(3);
  await expect(sections.nth(0)).toHaveAttribute('data-section', 'ready_for_review');
  await expect(sections.nth(1)).toHaveAttribute('data-section', 'needs_input');
  await expect(sections.nth(2)).toHaveAttribute('data-section', 'working');
  await expect(sections.nth(0)).toContainText('Fold finished turns into purpose and duration');
  await expect(sections.nth(1)).toContainText('Connect a Claude subscription token');
  await expect(sections.nth(2)).toContainText('Orb canary round 7');
  await expect(sections.nth(2)).toContainText('Rerun the relay probe');
  await expect(panel(page).getByRole('tab')).toHaveText([/进行中/, /接下来/, /定时/, /已完成/]);
  await expect(panel(page)).not.toContainText('Sidebar status groups');

  await page.reload();
  await expect(panel(page)).toBeVisible();
  await panel(page).getByRole('button', { name: '关闭' }).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(page).not.toHaveURL(/pane=/);
});

test('rows are one quiet line; a row waiting on the owner adds what waits, and every row describes its status and where to act', async ({
  page,
}) => {
  await page.goto(`${HOME}&pane=tasks`);
  const waiting = panel(page).locator('[data-slot="task-row"][data-waiting]');
  await expect(waiting).toHaveCount(3);
  for (const row of await waiting.all()) {
    await expect(row.locator('[data-slot="task-row-what"]')).toBeVisible();
    await expect(row).toHaveAccessibleDescription(/ → /);
    await expect(row).not.toContainText('已就绪，等你审阅');
    expect(await row.evaluate((el) => el.getBoundingClientRect().height)).toBeLessThanOrEqual(60);
  }
  const question = panel(page)
    .locator('[data-section="needs_input"] [data-slot="task-row"]')
    .first();
  await expect(question).toContainText('Credential relay · #74');
  await expect(question).toHaveAccessibleDescription(/在对话里回答/);
  await expect(
    panel(page).locator('[data-slot="task-row"]').filter({ hasText: 'Connect a Claude' }),
  ).toHaveAccessibleDescription(/到任务里批准计划/);
  await expect(
    panel(page).locator('[data-slot="task-row"]').filter({ hasText: 'Fold finished turns' }),
  ).toHaveAccessibleDescription(/待审阅 · 改动写好了 → 到任务里看改动/);
  const working = panel(page).locator('[data-section="working"] [data-slot="task-row"]');
  await expect(working.locator('[data-slot="task-row-what"]')).toHaveCount(0);
  await expect(working.first()).toHaveAccessibleDescription(/^进行中 · /);
  await expect(working.first()).not.toHaveAccessibleDescription(/→/);
  await expect(working.locator('[data-slot="task-row-running"]')).toHaveCount(3);
  for (const row of await working.all()) {
    expect(await row.evaluate((el) => el.getBoundingClientRect().height)).toBeLessThanOrEqual(50);
  }
  await working.first().hover();
  await expect(page.locator('[data-slot="task-row-tooltip"]')).toContainText('进行中 · ');
});

test('Up next, Scheduled and Done tabs list their own entries', async ({ page }) => {
  await page.goto(`${HOME}&pane=tasks`);
  await panel(page).getByRole('tab', { name: /接下来/ }).click();
  const next = panel(page).locator('[data-section="up_next"] [data-slot="task-row"]');
  await expect(next).toHaveCount(1);
  await expect(next).toContainText('Sidebar status groups');
  await panel(page).getByRole('tab', { name: '定时' }).click();
  await expect(panel(page).locator('[data-slot="schedule-row"]')).toHaveCount(3);
  await expect(panel(page).getByRole('link', { name: '管理定时' })).toBeVisible();
  await panel(page).getByRole('tab', { name: '已完成' }).click();
  await expect(panel(page).locator('[data-section="resolved"]')).toContainText(
    'Unread dot on threads',
  );
  await expect(panel(page).locator('[data-section="resolved"] [data-slot="task-row"]')).toContainText(
    /\d+月\d+日/,
  );
  await expect(panel(page).getByRole('link', { name: '管理定时' })).toHaveCount(0);
  await panel(page).getByRole('tab', { name: '进行中' }).click();
  await expect(panel(page).getByRole('link', { name: '管理定时' })).toHaveCount(0);
});

test('a schedule row opens the schedule detail', async ({ page }) => {
  await page.goto(`${HOME}&pane=tasks`);
  await panel(page).getByRole('tab', { name: '定时' }).click();
  await panel(page).locator('[data-slot="schedule-row"]').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('a row opens its thread in the side chat', async ({ page }) => {
  await page.goto(`${HOME}&pane=tasks`);
  await panel(page).getByText('Orb canary round 7').click();
  await expect(page).toHaveURL(/[?&]thread=home-c-working-c/);
  await expect(page.getByTestId('side-chat')).toContainText('Orb canary round 7');
});

test('the plus button opens an inline add input; Escape closes it; submit hands the text to the composer', async ({
  page,
}) => {
  await page.goto(`${HOME}&pane=tasks`);
  const input = panel(page).getByTestId('tasks-add-input');
  await expect(input).toHaveCount(0);
  await panel(page).getByTestId('tasks-new').click();
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute('placeholder', '添加任务…');
  const field = panel(page).getByTestId('tasks-add-field');
  const tabsBox = await panel(page).getByRole('tablist').boundingBox();
  const fieldBox = await field.boundingBox();
  expect(fieldBox?.y ?? 0).toBeGreaterThan((tabsBox?.y ?? 0) + (tabsBox?.height ?? 0));
  expect(fieldBox?.height).toBe(46);
  await expect(field).not.toHaveCSS('outline-style', 'none');
  await expect(panel(page).getByTestId('tasks-add-submit')).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(input).toHaveCount(0);
  await panel(page).getByTestId('tasks-new').click();
  await input.fill('Audit the relay probe retries');
  await input.press('Enter');
  await expect(input).toHaveCount(0);
  await expect(page.locator('.chief-composer textarea')).toHaveValue(
    'Audit the relay probe retries',
  );
});

test('a row menu offers open, mark done, rename, archive and delete; delete asks first', async ({ page }) => {
  await page.goto(`${HOME}&pane=tasks`);
  const row = panel(page).locator('[data-slot="task-row-frame"]').filter({ hasText: 'Orb canary round 7' });
  await row.hover();
  await row.getByTestId('task-row-menu-button').click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem')).toHaveText([/打开任务/, /标记完成/, /重命名/, /归档/, /删除/]);
  await menu.getByRole('menuitem', { name: /删除/ }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
});

test('an up-next row menu offers Move to project and Mark done with the current project marked', async ({
  page,
}) => {
  await page.goto(`${HOME}&pane=tasks`);
  await panel(page).getByRole('tab', { name: /接下来/ }).click();
  const row = panel(page).locator('[data-slot="task-row-frame"]').filter({ hasText: 'Sidebar status groups' });
  await row.hover();
  await row.getByTestId('task-row-menu-button').click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem')).toHaveText([
    /打开任务/,
    /移到项目/,
    /标记完成/,
    /重命名/,
    /归档/,
    /删除/,
  ]);
  await menu.getByRole('menuitem', { name: /移到项目/ }).click();
  const projects = page.getByTestId('task-move-projects');
  await expect(projects.getByRole('menuitemradio')).toHaveText(['cairn', 'Credential relay']);
  await expect(projects.getByRole('menuitemradio', { name: 'cairn' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(projects.getByRole('menuitemradio', { name: 'Credential relay' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
});

test('a started task cannot be moved to another project', async ({ page }) => {
  await page.goto(`${HOME}&pane=tasks`);
  const row = panel(page).locator('[data-slot="task-row-frame"]').filter({ hasText: 'Orb canary round 7' });
  await row.hover();
  await row.getByTestId('task-row-menu-button').click();
  await expect(page.getByRole('menuitem', { name: /移到项目/ })).toHaveCount(0);
});

test('a scheduled row menu offers run, pause and delete; delete asks first', async ({ page }) => {
  await page.goto(`${HOME}&pane=tasks`);
  await panel(page).getByRole('tab', { name: '定时' }).click();
  const rows = panel(page).locator('[data-slot="schedule-row-frame"]');
  await expect(rows).toHaveCount(3);
  const menuSlot = rows.first().locator('[data-slot="schedule-row-menu"]');
  await expect(menuSlot).toHaveCSS('opacity', '0');
  await rows.first().hover();
  await expect(menuSlot).toHaveCSS('opacity', '1');
  await rows.first().getByTestId('schedule-row-menu-button').hover();
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText('更多');
  await rows.first().getByTestId('schedule-row-menu-button').click();
  const menu = page.getByRole('menu');
  await expect(menu.locator('[data-slot="schedule-menu-facts"] > span')).toHaveText([
    /运行一次$/,
    /^下次 /,
    '还没运行过',
  ]);
  await expect(menu.getByRole('menuitem')).toHaveText([/立即运行/, /暂停定时/, /查看详情/, /删除/]);
  await menu.getByRole('menuitem', { name: /删除/ }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
});

test('the scheduled row menu opens the schedule detail', async ({ page }) => {
  await page.goto(`${HOME}&pane=tasks`);
  await panel(page).getByRole('tab', { name: '定时' }).click();
  const row = panel(page).locator('[data-slot="schedule-row-frame"]').first();
  await row.hover();
  await row.getByTestId('schedule-row-menu-button').click();
  await page.getByRole('menuitem', { name: /查看详情/ }).click();
  await expect(page.getByTestId('schedule-detail-body')).toBeVisible();
});

test('the task row menu groups open, move, mark done and rename above a divider, then archive and delete', async ({
  page,
}) => {
  await page.goto(`${HOME}&pane=tasks`);
  await panel(page).getByRole('tab', { name: /接下来/ }).click();
  const row = panel(page).locator('[data-slot="task-row-frame"]').filter({ hasText: 'Sidebar status groups' });
  await row.hover();
  await row.getByTestId('task-row-menu-button').hover();
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText('更多');
  await row.getByTestId('task-row-menu-button').click();
  const order = await page
    .getByRole('menu')
    .locator('[role="menuitem"], [role="separator"]')
    .evaluateAll((nodes) =>
      nodes.map((node) => (node.getAttribute('role') === 'separator' ? '|' : node.getAttribute('data-action'))),
    );
  expect(order).toEqual(['open', 'move', 'done', 'rename', '|', 'archive', 'delete']);
});

test('a schedule whose task is running cannot be run again from the menu', async ({ page }) => {
  await page.goto(`${HOME}&pane=tasks`);
  await panel(page).getByRole('tab', { name: '定时' }).click();
  const row = panel(page).locator('[data-slot="schedule-row-frame"]').filter({ hasText: 'Orb canary round 7' });
  await row.hover();
  await row.getByTestId('schedule-row-menu-button').click();
  await expect(page.getByRole('menuitem', { name: /立即运行/ })).toHaveAttribute('data-disabled', '');
});

test('rename opens a dialog prefilled with the title', async ({ page }) => {
  await page.goto(`${HOME}&pane=tasks`);
  const row = panel(page).locator('[data-slot="task-row-frame"]').filter({ hasText: 'Orb canary round 7' });
  await row.hover();
  await row.getByTestId('task-row-menu-button').click();
  await page.getByRole('menuitem', { name: /重命名/ }).click();
  await expect(page.getByTestId('task-rename-input')).toHaveValue('Orb canary round 7');
});

test('every open task has a checkbox, failed and done rows do not, and it does not open the row', async ({
  page,
}) => {
  await page.goto(`${HOME}&pane=tasks`);
  const checks = panel(page).getByRole('checkbox');
  await expect(checks).toHaveCount(5);
  const rowOf = (title: string) =>
    panel(page).locator('[data-slot="task-row-frame"]').filter({ hasText: title });
  await expect(rowOf('Fold finished turns').getByRole('checkbox')).toHaveAccessibleName(
    /^标记完成：Fold finished turns/,
  );
  await expect(rowOf('Connect a Claude subscription token').getByRole('checkbox')).toHaveCount(1);
  await expect(rowOf('Orb canary round 7').getByRole('checkbox')).toHaveCount(1);
  await expect(rowOf('Rerun the relay probe').getByRole('checkbox')).toHaveCount(0);
  await panel(page).getByRole('tab', { name: /接下来/ }).click();
  await expect(panel(page).getByRole('checkbox')).toHaveCount(1);
  await panel(page).getByRole('tab', { name: '已完成' }).click();
  await expect(panel(page).getByRole('checkbox')).toHaveCount(0);
  await panel(page).getByRole('tab', { name: '进行中' }).click();
  await rowOf('Fold finished turns').getByRole('checkbox').click();
  await expect(page).not.toHaveURL(/[?&]thread=/);
});

test('the checkbox on a running task asks before stopping it', async ({ page }) => {
  await page.goto(`${HOME}&pane=tasks`);
  await panel(page)
    .locator('[data-slot="task-row-frame"]')
    .filter({ hasText: 'Orb canary round 7' })
    .getByRole('checkbox')
    .click();
  const confirm = page.getByRole('alertdialog', { name: '停止并标记完成' });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('停止并标记完成？');
  await expect(confirm).toContainText('正在运行的工作会被停止');
  await confirm.getByRole('button', { name: '取消' }).click();
  await expect(confirm).toHaveCount(0);
});

test('the checkbox on a task ready for review opens the accept dialog with the merge choice', async ({
  page,
}) => {
  await page.goto(`${HOME}&pane=tasks`);
  await panel(page)
    .locator('[data-slot="task-row-frame"]')
    .filter({ hasText: 'Fold finished turns' })
    .getByRole('checkbox')
    .click();
  const dialog = page.getByRole('dialog', { name: '完成任务' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('checkbox')).toBeVisible();
  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(dialog).toHaveCount(0);
});

test('the menu offers Mark done on open tasks only and follows the checkbox', async ({ page }) => {
  await page.goto(`${HOME}&pane=tasks`);
  const frame = (title: string) =>
    panel(page).locator('[data-slot="task-row-frame"]').filter({ hasText: title });
  const openMenu = async (title: string) => {
    await frame(title).hover();
    await frame(title).getByTestId('task-row-menu-button').click();
  };
  await openMenu('Rerun the relay probe');
  await expect(page.getByRole('menuitem', { name: /标记完成/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await openMenu('Serif greeting fix');
  await page.getByRole('menuitem', { name: /标记完成/ }).click();
  await expect(page.getByRole('alertdialog', { name: '停止并标记完成' })).toBeVisible();
});

test('Manage schedules links to the schedules page', async ({ page }) => {
  await page.goto(`${HOME}&pane=tasks`);
  await panel(page).getByRole('tab', { name: '定时' }).click();
  await panel(page).getByRole('link', { name: '管理定时' }).click();
  await expect(page).toHaveURL(/\/app\/schedules/);
});

test('with no tasks anywhere the panel centres a first-run note whose button opens the add field, and the toggle has no badge', async ({
  page,
}) => {
  await page.goto('/app?scenario=home-c-empty&pane=tasks');
  const empty = panel(page).getByTestId('tasks-empty');
  await expect(empty).toBeVisible();
  await expect(empty.locator('svg')).toHaveCount(0);
  await expect(page.getByTestId('tasks-badge')).toHaveCount(0);
  await empty.getByRole('button', { name: '添加任务' }).click();
  await expect(panel(page).getByTestId('tasks-add-input')).toBeFocused();
});

test('once tasks exist, an empty tab is one left-aligned quiet line under the tabs', async ({
  page,
}) => {
  await page.goto('/app?scenario=home-c-quiet&pane=tasks');
  await expect(panel(page).getByTestId('tasks-empty')).toHaveCount(0);
  const quiet = panel(page).getByTestId('tasks-quiet');
  await expect(quiet).toHaveText('现在没有进行中的任务');
  await expect(quiet).toHaveCSS('text-align', 'start');
  await panel(page).getByRole('tab', { name: /接下来/ }).click();
  await expect(quiet).toHaveText('接下来没有安排');
  await panel(page).getByRole('tab', { name: '已完成' }).click();
  await expect(panel(page).locator('[data-section="resolved"]')).toContainText('Unread dot on threads');
});

test('the Made button swaps the panel to finished work', async ({ page }) => {
  await page.goto(`${HOME}&pane=tasks`);
  await madeButton(page).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(madePanel(page)).toBeVisible();
  await expect(page).toHaveURL(/[?&]pane=made/);
  await expect(madePanel(page)).toContainText('Unread dot on threads');
  await expect(madePanel(page)).not.toContainText('Orb canary round 7');
  await madeButton(page).click();
  await expect(madePanel(page)).toHaveCount(0);
});

test('Made shows an empty state when nothing has finished', async ({ page }) => {
  await page.goto('/app?scenario=home-c-empty&pane=made');
  await expect(madePanel(page).getByTestId('made-empty')).toBeVisible();
});

const MADE = '/app?scenario=home-c-made&pane=made';

test('Made groups finished work by kind with counts, as horizontal rows of preview cards', async ({
  page,
}) => {
  await page.goto('/app?scenario=make-ref&pane=made');
  const groups = madePanel(page).getByTestId('made-group');
  await expect(groups).toHaveCount(3);
  await expect(groups.locator('h3')).toHaveText(['文档6', '设计3', '其他1']);
  await expect(groups.nth(0).getByTestId('made-card')).toHaveCount(6);
  const first = groups.nth(0).getByTestId('made-card').first();
  await expect(first).toContainText('发布会演讲稿');
  await expect(first.getByTestId('made-card-meta')).toHaveText('18 小时前 · cairn');
  await expect(first).toContainText('仅自己可见');
  await expect(first.locator('img')).toHaveCount(1);
  const other = groups.nth(2).getByTestId('made-card').first();
  await expect(other.getByTestId('made-card-placeholder')).toBeVisible();
  await expect(other.locator('img')).toHaveCount(0);
  const box = await first.boundingBox();
  const second = await groups.nth(0).getByTestId('made-card').nth(1).boundingBox();
  expect(Math.abs((box?.y ?? 0) - (second?.y ?? 1))).toBeLessThan(1);
  expect(box?.height).toBe(144);
  await expect(madePanel(page)).not.toContainText('Unread dot on threads');
});

test('a carousel never clips the border of a fully visible card at either edge', async ({
  page,
}) => {
  await page.goto('/app?scenario=make-ref&pane=made');
  const docs = madePanel(page).getByTestId('made-group').first();
  const scroller = docs.getByTestId('made-carousel');
  const cards = docs.getByTestId('made-card');
  const count = await cards.count();
  const edges = async () => {
    const frame = await scroller.boundingBox();
    const boxes = await cards.evaluateAll((els) =>
      els.map((el) => {
        const { left, right } = el.getBoundingClientRect();
        return { left, right };
      }),
    );
    return { frame: frame!, boxes };
  };
  const insideFrame = async (index: number) => {
    const { frame, boxes } = await edges();
    expect(boxes[index].left).toBeGreaterThanOrEqual(frame.x + 1);
    expect(boxes[index].right).toBeLessThanOrEqual(frame.x + frame.width - 1);
  };
  await expect(docs.getByTestId('made-carousel-prev')).toHaveCount(0);
  await insideFrame(0);
  await insideFrame(1);
  await docs.getByTestId('made-carousel-next').click();
  await expect(cards.nth(2)).toBeInViewport({ ratio: 0.99 });
  await expect
    .poll(async () => {
      const { frame, boxes } = await edges();
      return boxes[2].left - frame.x;
    })
    .toBeGreaterThanOrEqual(1);
  await insideFrame(2);
  await docs.getByTestId('made-carousel-next').click();
  await expect(docs.getByTestId('made-carousel-next')).toHaveCount(0);
  await expect
    .poll(async () => {
      const { frame, boxes } = await edges();
      return frame.x + frame.width - boxes[count - 1].right;
    })
    .toBeGreaterThanOrEqual(1);
  await insideFrame(count - 1);
  await insideFrame(count - 2);
  expect(await scroller.evaluate((el) => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('a carousel pages with its arrows and keeps the next page reachable by keyboard', async ({
  page,
}) => {
  await page.goto('/app?scenario=make-ref&pane=made');
  const docs = madePanel(page).getByTestId('made-group').first();
  const cards = docs.getByTestId('made-card');
  await expect(docs.getByTestId('made-carousel-prev')).toHaveCount(0);
  await expect(cards.nth(2)).not.toBeInViewport({ ratio: 0.9 });
  await docs.getByTestId('made-carousel-next').click();
  await expect(cards.nth(2)).toBeInViewport({ ratio: 0.99 });
  await expect(docs.getByTestId('made-carousel-prev')).toBeVisible();
  await docs.getByTestId('made-carousel-next').click();
  await expect(cards.nth(5)).toBeInViewport({ ratio: 0.9 });
  await expect(docs.getByTestId('made-carousel-next')).toHaveCount(0);
  await docs.getByTestId('made-carousel-prev').click();
  await expect(cards.nth(2)).toBeInViewport({ ratio: 0.99 });
  await docs.getByTestId('made-carousel-prev').click();
  await expect(docs.getByTestId('made-carousel-prev')).toHaveCount(0);
  await expect(cards.nth(0)).toBeInViewport({ ratio: 0.9 });
  await cards.nth(0).getByRole('button').focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(cards.nth(2).getByRole('button')).toBeFocused();
  await expect(cards.nth(2)).toBeInViewport({ ratio: 0.9 });
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/[?&]thread=ref-doc-2/);
});

test('Made search also matches the kind and keeps the matching group', async ({ page }) => {
  await page.goto('/app?scenario=make-ref&pane=made');
  await madePanel(page).getByRole('button', { name: '搜索成果' }).click();
  await madePanel(page).getByTestId('made-search').fill('设计');
  await expect(madePanel(page).getByTestId('made-group').locator('h3')).toHaveText(['设计3']);
});

test('Made with many finished items scrolls the groups under fixed tabs', async ({ page }) => {
  await page.goto('/app?scenario=home-c-made-many&pane=made');
  const cards = madePanel(page).getByTestId('made-card');
  await expect(cards).toHaveCount(15);
  const tabs = madePanel(page).getByTestId('made-tabs');
  await tabs.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(madePanel(page).getByRole('tab', { name: '全部' })).toBeInViewport();
  await expect(madePanel(page).getByTestId('made-group').last()).toBeInViewport();
});

test('Made search filters by title and project, and Escape clears and closes it', async ({
  page,
}) => {
  await page.goto(MADE);
  const rows = madePanel(page).getByTestId('made-card');
  await expect(rows).toHaveCount(5);
  await expect(madePanel(page).getByTestId('made-search')).toHaveCount(0);
  await madePanel(page).getByRole('button', { name: '搜索成果' }).click();
  const input = madePanel(page).getByTestId('made-search');
  await expect(input).toBeFocused();
  await input.fill('CONTRIB');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Contributing guide');
  await input.fill('credential');
  await expect(rows).toHaveCount(2);
  await input.fill('zzz-nothing');
  await expect(madePanel(page).getByTestId('made-no-match')).toContainText('没有匹配的成果');
  await expect(madePanel(page).getByTestId('made-empty')).toHaveCount(0);
  await input.press('Escape');
  await expect(input).toHaveCount(0);
  await expect(rows).toHaveCount(5);
  await expect(madePanel(page)).toBeVisible();
});

test('Made archived tab lists archived finished work and keeps the retention note', async ({
  page,
}) => {
  await page.goto(MADE);
  const tabs = madePanel(page).getByTestId('made-tabs');
  await expect(tabs).toBeVisible();
  await madePanel(page).getByRole('tab', { name: '已归档' }).click();
  const rows = madePanel(page).getByTestId('made-card');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Retired onboarding checklist');
  await expect(madePanel(page).getByTestId('made-archived-note')).toHaveText(
    '已归档的成果会一直保留，直到你删除它或它所在的项目。',
  );
  await madePanel(page).getByRole('tab', { name: '全部' }).click();
  await expect(madePanel(page)).not.toContainText('Retired onboarding checklist');
});

test('Made archived tab says so when nothing is archived', async ({ page }) => {
  await page.goto(`${HOME}&pane=made`);
  await madePanel(page).getByRole('tab', { name: '已归档' }).click();
  const empty = madePanel(page).getByTestId('made-archived-empty');
  await expect(empty).toHaveText('还没有已归档的成果');
  await expect(madePanel(page).getByTestId('made-empty')).toHaveCount(0);
  const note = madePanel(page).getByTestId('made-archived-note');
  const noteBox = await note.boundingBox();
  const emptyBox = await empty.boundingBox();
  expect(noteBox?.y ?? 0).toBeLessThan(emptyBox?.y ?? 0);
});

test('the composer has no in-progress pill above it', async ({ page }) => {
  await page.goto(HOME);
  await expect(page.getByTestId('home-c').locator('.chief-composer')).toBeVisible();
  await expect(page.getByTestId('in-progress-pill')).toHaveCount(0);
});

test('the sidebar has no Schedules row in any layout', async ({ page }) => {
  await page.goto(HOME);
  const aside = page.locator('.board-sidebar');
  await expect(aside.getByRole('button', { name: '定时' })).toHaveCount(0);
  await page.evaluate(() => localStorage.setItem('cairn.sidebar-collapsed', '1'));
  await page.reload();
  await expect(page.getByRole('complementary').first().getByRole('link', { name: '定时' })).toHaveCount(0);
});

test('at phone width the panel overlays without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${HOME}&pane=tasks`);
  await expect(panel(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(
    0,
  );
});

test('one mark holds the left edge: the checkbox when the row has one, its ring in the accent when it waits on the owner, else the status glyph', async ({
  page,
}) => {
  await page.goto(`${HOME}&pane=tasks`);
  const frame = (title: string) =>
    panel(page).locator('[data-slot="task-row-frame"]').filter({ hasText: title });
  const review = frame('Fold finished turns');
  await expect(review.getByRole('checkbox')).toHaveCount(1);
  await expect(review.locator('[data-glyph]')).toHaveCount(0);
  const accent = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--card-button)';
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  await expect(review.getByRole('checkbox')).toHaveCSS('border-top-color', accent);
  const running = frame('Push for finished threads');
  await expect(running.getByRole('checkbox')).not.toHaveCSS('border-top-color', accent);
  await expect(running.locator('[data-glyph]')).toHaveCount(0);
  await expect(running).toContainText('进行中');
  const failed = frame('Rerun the relay probe');
  await expect(failed.getByRole('checkbox')).toHaveCount(0);
  await expect(failed.locator('[data-glyph]')).toHaveCount(1);
  const title = review.locator('[data-slot="task-row-title"]');
  expect(await title.evaluate((el) => el.getBoundingClientRect().height)).toBe(20);
  await expect(review.locator('[data-slot="task-row-what"]')).toHaveText('改动写好了');
});
