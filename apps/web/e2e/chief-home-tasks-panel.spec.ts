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

test('every row waiting on the owner says what is waiting and where to act', async ({ page }) => {
  await page.goto(`${HOME}&pane=tasks`);
  const waiting = panel(page).locator('[data-slot="task-row"][data-waiting]');
  await expect(waiting).toHaveCount(3);
  for (const row of await waiting.all()) {
    await expect(row.locator('[data-slot="task-row-where"]')).toBeVisible();
    await expect(row).not.toContainText('已就绪，等你审阅');
  }
  const question = panel(page)
    .locator('[data-section="needs_input"] [data-slot="task-row"]')
    .first();
  await expect(question).toContainText('Credential relay · #74');
  await expect(question).toContainText('在问题卡里选');
  await expect(
    panel(page).locator('[data-slot="task-row"]').filter({ hasText: 'Connect a Claude' }),
  ).toContainText('到任务里批准计划');
  await expect(
    panel(page).locator('[data-slot="task-row"]').filter({ hasText: 'Fold finished turns' }),
  ).toContainText('到任务里看改动');
  const working = panel(page).locator('[data-section="working"] [data-slot="task-row"]');
  await expect(working.locator('[data-slot="task-row-where"]')).toHaveCount(0);
  await expect(working.locator('[data-slot="task-row-running"]')).toHaveCount(3);
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
  await expect(menu.getByRole('menuitem')).toHaveText([/立即运行/, /暂停定时/, /删除/]);
  await menu.getByRole('menuitem', { name: /删除/ }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
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

test('with no tasks the panel shows one sentence and the toggle has no badge', async ({ page }) => {
  await page.goto('/app?scenario=home-c-empty&pane=tasks');
  await expect(panel(page).getByTestId('tasks-empty')).toBeVisible();
  await expect(page.getByTestId('tasks-badge')).toHaveCount(0);
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

test('Made groups finished work by day, newest first, with the project name on each row', async ({
  page,
}) => {
  await page.goto(MADE);
  const groups = madePanel(page).getByTestId('made-group');
  await expect(groups).toHaveCount(4);
  await expect(groups.nth(0)).toContainText('今天');
  await expect(groups.nth(1)).toContainText('昨天');
  await expect(groups.nth(2)).toContainText('本周');
  await expect(groups.nth(3)).toContainText('更早');
  await expect(groups.getByTestId('made-group-count')).toHaveText(['1', '1', '2', '1']);
  await expect(groups.nth(0).locator('[data-slot="thread-row"]')).toHaveCount(1);
  await expect(groups.nth(2).locator('[data-slot="thread-row"]')).toHaveCount(2);
  await expect(groups.nth(0)).toContainText('Contributing guide');
  await expect(groups.nth(0)).toContainText('cairn');
  await expect(groups.nth(3)).toContainText('Credential relay');
  await expect(madePanel(page)).not.toContainText('Retired onboarding checklist');
  await expect(madePanel(page).getByTestId('made-archived-note')).toHaveCount(0);
});

test('Made with many finished items scrolls the list under fixed tabs', async ({ page }) => {
  await page.goto('/app?scenario=home-c-made-many&pane=made');
  const rows = madePanel(page).locator('[data-slot="thread-row"]');
  await expect(rows).toHaveCount(15);
  const tabs = madePanel(page).getByTestId('made-tabs');
  await tabs.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(madePanel(page).getByRole('tab', { name: '全部' })).toBeInViewport();
  await expect(rows.last()).toBeInViewport();
});

test('Made search filters by title and project, and Escape clears and closes it', async ({
  page,
}) => {
  await page.goto(MADE);
  const rows = madePanel(page).locator('[data-slot="thread-row"]');
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
  const rows = madePanel(page).locator('[data-slot="thread-row"]');
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
  await expect(review.locator('[data-slot="task-row-what"]')).toContainText('到任务里看改动');
});
