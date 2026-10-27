import { expect, test } from '@playwright/test';

test('feedback route is gone — old URL redirects to the board', async ({ page }) => {
  await page.goto('/app/feedback');
  await expect(page).toHaveURL('/app');
  await expect(page.locator('[data-route="feedback"]')).toHaveCount(0);
});

test('user menu drops its dead rows — `反馈` (#149), `新功能/快捷键` (#163)', async ({ page }) => {
  await page.goto('/app?view=board');
  await page.locator('.sidebar-user').click();
  const menu = page.locator('.user-menu');
  await expect(menu).toBeVisible();

  for (const dead of ['反馈', '新功能', '快捷键']) {
    await expect(menu).not.toContainText(dead);
  }

  for (const live of ['外观', '账号', 'API 密钥', 'MCP']) {
    await expect(menu).toContainText(live);
  }
  await expect(menu.locator('a.user-menu-row')).toHaveCount(3);
});

test('board topbar drops the `看板指南` button — right actions = `筛选` / `定时`, `新任务` lives in the new-task bar (#363, claude shell)', async ({
  page,
}) => {
  await page.goto('/app?view=board');

  await expect(page.locator('.board-guide')).toHaveCount(0);
  await expect(page.locator('.board-guide-wrap')).toHaveCount(0);
  await expect(page.locator('.board-guide-pop')).toHaveCount(0);
  await expect(page.locator('[aria-label="看板指南"]')).toHaveCount(0);

  const actions = page.locator('.board-topbar-actions');
  await expect(actions).toBeVisible();
  await expect(actions.getByRole('button')).toHaveCount(2);
  await expect(actions.getByRole('link')).toHaveCount(1);
  await expect(actions.getByRole('button', { name: '筛选', exact: true })).toBeVisible();
  await expect(actions.getByRole('button', { name: '任务面板' })).toBeVisible();
  await expect(actions.getByRole('link', { name: '定时' })).toBeVisible();
  await expect(actions.getByRole('button', { name: '新任务' })).toHaveCount(0);

  const bar = page.getByTestId('board-new-task-bar');
  await expect(bar).toBeVisible();
  await expect(bar).toContainText('新任务：接下来让 agent 做什么？');
  await bar.click();
  await expect(page.getByRole('dialog', { name: '新建任务' })).toBeVisible();
});

test('board renders exactly the four #351 columns, retired names and collapse family gone', async ({
  page,
}) => {
  await page.goto('/app?scenario=01&view=board');

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('看板');

  await expect(page.locator('.board-column')).toHaveCount(4);
  for (const [id, name] of [
    ['todo', '待开始'],
    ['building', '执行中'],
    ['pending', '待处理'],
    ['done', '已完成'],
  ] as const) {
    await expect(
      page.locator(`.board-column[data-column="${id}"] .board-column-name`),
    ).toHaveText(name);
  }

  for (const retired of ['规划中', '待确认', '待验收']) {
    await expect(page.locator('.board-column-name', { hasText: retired })).toHaveCount(0);
  }

  await expect(page.locator('.board-column-collapse')).toHaveCount(0);
  await expect(page.locator('.board-column-strip')).toHaveCount(0);
  await expect(page.locator('.board-column--collapsed')).toHaveCount(0);
});

test('project files pane: no export button, static branch chip, wired `文件|历史` segment', async ({
  page,
}) => {
  await page.goto('/app/project/ZAQczKCu0MOAzC1ZqcFlX?scenario=r2-24');

  await expect(page.locator('.prj-files-share')).toHaveCount(0);

  const chip = page.locator('.prj-branch-chip');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('main');
  expect(await chip.evaluate((el) => el.tagName)).toBe('SPAN');

  const segTabs = page.locator('.prj-files-seg-tab');
  await expect(segTabs).toHaveCount(2);
  await segTabs.nth(1).click();
  await expect(segTabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.prj-history-row').first()).toBeVisible();
  await expect(page.locator('.prj-file-row')).toHaveCount(0);
  await segTabs.nth(0).click();
  await expect(segTabs.nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.prj-file-row').first()).toBeVisible();
  await expect(page.locator('.prj-history-row')).toHaveCount(0);
});

test('schedules empty state drops the `查看文档` button; `新建定时` really opens and saves (#149, #1037)', async ({
  page,
}) => {
  await page.goto('/app/schedules?scenario=11');
  await expect(page.locator('.sched-empty')).toBeVisible();
  await expect(page.locator('.sched-empty-docs')).toHaveCount(0);
  const emptyNew = page.locator('.sched-empty').getByRole('button', { name: '新建定时' });
  await expect(emptyNew).toBeVisible();

  await emptyNew.click();
  const dialog = page.getByRole('dialog', { name: '新建定时' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '保存' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.sched-card')).toHaveCount(1);
  await expect(page.locator('.sched-empty')).toHaveCount(0);
});

test('schedules fixture face: topbar `新建` opens the dialog, freq tabs respond, save lands a card (#1037)', async ({
  page,
}) => {
  await page.goto('/app/schedules?scenario=11');
  await expect(page.locator('.page-new-action')).toHaveCount(0);
  await page.locator('.sched-empty').getByRole('button', { name: '新建定时' }).click();
  const dialog = page.getByRole('dialog', { name: '新建定时' });
  await expect(dialog).toBeVisible();

  await dialog.getByRole('radio', { name: '每周' }).click();
  await expect(dialog.locator('.sched-form-freq-tab[aria-checked="true"]')).toHaveText('每周');
  await dialog.getByRole('button', { name: '保存' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.sched-card')).toHaveCount(1);

  await expect(page.locator('.sched-card')).toContainText('每周运行');
});

test('doc pane `变更▾` opens the document-type listbox and closes on Escape', async ({ page }) => {
  await page.goto('/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=27');
  const select = page.locator('.doc-select-wrap .doc-pane-select');
  await expect(select).toContainText('变更');
  await select.click();

  const dropdown = page.getByRole('menu');
  await expect(dropdown).toBeVisible();

  await expect(dropdown.getByRole('menuitemradio').first()).toContainText('变更');
  await page.keyboard.press('Escape');
  await expect(dropdown).toBeHidden();
});

test('doc pane type-row click re-selects the current type and closes (#306)', async ({ page }) => {
  await page.goto('/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=27');
  await page.locator('.doc-select-wrap .doc-pane-select').click();
  const dropdown = page.getByRole('menu');
  await expect(dropdown).toBeVisible();

  await dropdown.getByRole('menuitemradio').first().click();
  await expect(dropdown).toBeHidden();
  await expect(page.locator('.detail-right .doc-pane')).toBeVisible();
});

test('machines rows carry only live controls, no dead inline buttons (#222 shipped + #1108 narrowed)', async ({
  page,
}) => {
  await page.goto('/app/resources/machines?scenario=06');

  await expect(page.locator('[data-on]').first()).toBeVisible();

  await expect(page.locator('div[data-kind] button')).toHaveCount(2);
  await expect(page.locator('div[data-kind] button[aria-label^="并发上限"]')).toHaveCount(2);
});

test('composer toolbar drops the `语音输入` button, keeps attachment + mention', async ({ page }) => {

  await page.goto('/app/todo/r8-15?scenario=chain');
  const toolbar = page.locator('.composer-toolbar');
  await expect(toolbar).toBeVisible();

  await expect(toolbar.locator('button[aria-label="语音输入"]')).toHaveCount(0);
  await expect(toolbar.locator('button[aria-label="添加附件"]')).toBeVisible();
  await expect(toolbar.locator('button[aria-label="提及"]')).toBeVisible();
});

test('new-task dialog tools drop the `语音输入` button, keep two live tools', async ({ page }) => {
  await page.goto('/app?scenario=01&view=board');
  await page.locator('.sidebar-new-task').click();

  const tools = page.getByTestId('new-task-tools');
  await expect(tools).toBeVisible();

  await expect(tools.getByRole('button', { name: '语音输入' })).toHaveCount(0);
  await expect(tools.getByRole('button')).toHaveCount(2);
  await expect(tools.getByRole('button', { name: '添加附件' })).toBeVisible();
  await expect(tools.getByRole('button', { name: '提及' })).toBeVisible();
});

test('api-keys empty state drops the `查看文档` button, keeps `新建密钥` (#307)', async ({ page }) => {
  await page.goto('/app/api-keys');

  const keysEmpty = page.getByTestId('keys-empty');
  await expect(keysEmpty).toBeVisible();
  await expect(page.getByRole('link', { name: '查看文档' })).toHaveCount(0);
  await expect(keysEmpty.getByRole('button', { name: '新建密钥' })).toBeVisible();
});

test('api-keys non-empty state keeps `新建密钥` visible and opens the create dialog', async ({ page }) => {
  await page.route('**/api/**', (route, request) => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/stream')) return route.abort();
    if (request.method() !== 'GET') return route.fallback();
    if (path === '/api/teams') {
      return route.fulfill({
        json: [{ id: 'team-1', name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null }],
      });
    }
    if (path === '/api/user/me') {
      return route.fulfill({ json: { id: 'user-1', displayName: '我', avatarUrl: null } });
    }
    if (path === '/api/teams/team-1/api-keys') {
      return route.fulfill({
        json: [
          {
            id: 'key-1',
            name: 'Existing key',
            masked: 'cairn_afe07565…',
            gitAccess: false,
            mcpAccess: false,
          },
        ],
      });
    }
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.goto('/app/api-keys');
  await expect(page.getByText('Existing key', { exact: true })).toBeVisible();
  await expect(page.getByTestId('keys-empty')).toHaveCount(0);
  const create = page.getByRole('button', { name: '新建密钥', exact: true });
  await expect(create).toBeVisible();
  await create.click();
  await expect(page.getByRole('dialog', { name: '新建密钥', exact: true })).toBeVisible();
});

test('resources empty state drops the `查看文档` link (#307); skills empty-state main button = `新建技能` dialog (XMON-114)', async ({
  page,
}) => {
  await page.goto('/app/resources/skills?scenario=01');

  const skillsEmpty = page.getByTestId('resource-empty');
  await expect(skillsEmpty).toBeVisible();

  await expect(page.getByRole('link', { name: '查看文档' })).toHaveCount(0);

  await expect(skillsEmpty.getByRole('button', { name: '新建技能' })).toHaveText('新建技能');
  await page.goto('/app/resources/secrets?scenario=01');
  const secretsEmpty = page.getByTestId('resource-empty');
  await expect(secretsEmpty).toBeVisible();
  await expect(page.getByRole('link', { name: '查看文档' })).toHaveCount(0);
  await expect(secretsEmpty.getByRole('button', { name: '添加密钥' })).toBeVisible();
});

test('mcp page is read-only: no create entry, no per-row more-menu ink, empty state points at ~/.claude.json (#368)', async ({
  page,
}) => {

  await page.goto('/app/resources/mcp-servers?scenario=01');
  await expect(page.getByRole('button', { name: '新建', exact: true })).toHaveCount(0);
  const empty = page.getByTestId('resource-empty');
  await expect(empty).toBeVisible();
  await expect(empty.getByRole('button')).toHaveCount(0);
  await expect(empty.locator('p')).toContainText('~/.claude.json');

  await page.goto('/app/resources/mcp-servers?scenario=07');
  await expect(page.locator('[data-testid="resource-row"][data-mcp]')).toHaveCount(1);
  await expect(page.locator('[data-testid="resource-row"] button')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '新建', exact: true })).toHaveCount(0);
});

test('create-agent dialog drops the avatar `更换` ink (#307)', async ({ page }) => {
  await page.goto('/app/team?scenario=12');
  await page.getByRole('button', { name: '创建 Agent' }).click();

  const dialog = page.getByRole('dialog', { name: '创建 agent' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.dlg-agent-swap')).toHaveCount(0);

  await expect(dialog.getByTestId('agent-avatar').locator('img')).toBeVisible();
  await expect(dialog.getByLabel('名称')).toBeVisible();
});

test('project settings drops the avatar `更换` ink (#307, supersedes the #177 chrome verdict)', async ({
  page,
}) => {
  await page.goto('/app/project/ZAQczKCu0MOAzC1ZqcFlX/settings?scenario=r2-24c');
  await expect(page.locator('.prj-set-change')).toHaveCount(0);

  await expect(page.locator('.prj-set-avatar')).toBeVisible();
  await expect(page.locator('span.prj-set-branch')).toBeVisible();
});

test('chief drawer drops the ⋮ `更多` button — thread view keeps three head actions (#306)', async ({
  page,
}) => {
  await page.goto('/app?scenario=114&view=board');
  const drawer = page.locator('.chief-drawer');

  const actions = drawer
    .getByRole('button', { name: '新主题', exact: true })
    .locator('xpath=..')
    .getByRole('button');

  await expect(drawer.getByRole('button', { name: '更多', exact: true })).toHaveCount(0);

  await expect(drawer.getByRole('button', { name: '全屏', exact: true })).toHaveCount(0);
  await expect(actions).toHaveCount(3);
  await expect(actions.nth(0)).toHaveAttribute('aria-label', '新主题');
  await expect(actions.nth(1)).toHaveAttribute('aria-label', '总管设置');
  await expect(actions.nth(2)).toHaveAttribute('aria-label', '最小化');
});

test('sched card `更多` opens a menu and deletes the row through the confirm (#306)', async ({
  page,
}) => {
  await page.goto('/app/schedules?scenario=r3-93');
  const card = page.locator('.sched-card');
  await expect(card).toHaveCount(1);
  const more = page.locator('.sched-card-more');
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await more.click();
  const menu = page.locator('.sched-card-menu');
  await expect(menu).toBeVisible();
  await expect(more).toHaveAttribute('aria-expanded', 'true');

  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  await more.click();
  await expect(menu).toBeVisible();
  await menu.locator('.sched-card-menu-row').click();

  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('确定删除该定时？此操作不可撤销。');
  await expect(confirm).toContainText('#1');
  await confirm.getByRole('button', { name: '删除' }).click();
  await expect(confirm).toBeHidden();
  await expect(page.locator('.sched-card')).toHaveCount(0);

  await expect(page.locator('.sched-empty')).toBeVisible();
});

test('skills `排序` opens the single-select listbox, picking an option closes it (#306)', async ({
  page,
}) => {
  await page.goto('/app/resources/skills?scenario=08');

  const sort = page.getByRole('button', { name: '排序' });
  await expect(sort).toHaveAttribute('aria-expanded', 'false');
  await sort.click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(sort).toHaveAttribute('aria-expanded', 'true');

  await expect(menu.getByRole('menuitemradio')).toHaveCount(2);
  await expect(menu.locator('[role="menuitemradio"][aria-checked="true"]')).toHaveText(/默认/);

  await menu.getByRole('menuitemradio', { name: '名称' }).click();
  await expect(menu).toBeHidden();
  await expect(page.getByTestId('resource-row')).toHaveCount(1);

  await sort.click();
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
});

test('account drops the `更换` button, keeps the avatar head (#306 wontfix shipped)', async ({
  page,
}) => {
  await page.goto('/app/account?scenario=13');
  await expect(page.locator('.account-swap')).toHaveCount(0);
  await expect(page.locator('.account-avatar img')).toBeVisible();
});

test('transcript work summary collapses and re-expands call rows', async ({ page }) => {
  await page.goto('/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=28');
  const summary = page.getByTestId('work-summary');
  await expect(page.getByTestId('work-call')).toHaveCount(2);
  await expect(summary).toHaveAttribute('aria-expanded', 'true');
  await summary.click();
  await expect(page.getByTestId('work-call')).toHaveCount(0);
  await expect(summary).toHaveAttribute('aria-expanded', 'false');
  await summary.click();
  await expect(page.getByTestId('work-call')).toHaveCount(2);
  await expect(summary).toHaveAttribute('aria-expanded', 'true');
});

const REVIEW_DETAIL = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=27';

test('more menu `完成` opens the accept dialog on the review surface (#318)', async ({ page }) => {
  await page.goto(REVIEW_DETAIL);
  await page.locator('.detail-head-icon--more').click();

  const menu = page.getByRole('menu', { name: '更多' });
  await expect(menu).toBeVisible();
  const complete = menu.getByRole('menuitem', { name: '完成' });
  await expect(complete).toBeEnabled();
  await complete.click();

  await expect(menu).toBeHidden();
  await expect(page.getByRole('dialog', { name: '完成任务' })).toBeVisible();
});

test('more menu `关闭` is phase-gated by the server funnel edges (#318)', async ({ page }) => {

  await page.goto(REVIEW_DETAIL);
  await page.locator('.detail-head-icon--more').click();
  await expect(page.getByRole('menuitem', { name: '关闭' })).toBeDisabled();

  await page.goto('/app/todo/r8-12?scenario=54');
  await page.locator('.detail-head-icon--more').click();
  const closeRow = page.getByRole('menuitem', { name: '关闭' });
  await expect(closeRow).toBeEnabled();

  await expect(page.getByRole('menuitem', { name: '完成' })).toBeDisabled();
  await closeRow.click();
  await expect(page).toHaveURL('/app');
});

test('todo-phase `开始` fires orchestration directly — no start dialog (#640)', async ({ page }) => {

  await page.goto('/app/todo/fresh-probe?scenario=23');
  await page.locator('.detail-head-action').click();
  await expect(page.locator('.overlay-title')).toHaveCount(0);
});

test('failed rerun dialog is the slim single-exit face — no agent selector, no split switch, no plan/run branch (#640)', async ({
  page,
}) => {

  await page.goto('/app/todo/r8-12?scenario=56');
  await expect(page.locator('.overlay-title')).toHaveText('开始任务');
  await expect(page.locator('.rerun-agent-row')).toHaveCount(0);
  await expect(page.locator('.rerun-switch')).toHaveCount(0);
  await expect(page.locator('.overlay-actions button', { hasText: '先做规划' })).toHaveCount(0);
  await expect(page.locator('.overlay-actions button', { hasText: '立即执行' })).toHaveCount(0);

  await expect(page.locator('.overlay-actions button', { hasText: '重跑' })).toBeVisible();
  await expect(page.locator('.overlay-actions button', { hasText: '复用方案' })).toHaveCount(0);
});

test('reuse panel `查看方案` flips the doc pane to the plan face (#318)', async ({ page }) => {
  await page.goto('/app/todo/r8-15?scenario=75');
  await expect(page.locator('.overlay-title')).toHaveText('复用方案');

  await expect(page.locator('.doc-select-wrap .doc-pane-select')).toContainText('变更');

  await page.locator('.overlay-actions button', { hasText: '查看方案' }).click();

  await expect(page.locator('.overlay')).toBeHidden();
  await expect(page.locator('.doc-empty')).toContainText('暂无方案');
});

test('project task rows and cards are real links to the todo detail that open in the panel (#318, #1937)', async ({ page }) => {
  await page.goto('/app/project/ZAQczKCu0MOAzC1ZqcFlX?scenario=prj-tasks&tab=tasks');
  const row = page.locator('.prj-task-row').first();
  await expect(row).toBeVisible();

  await expect(row.locator('a.prj-task-link')).toHaveCount(1);
  await expect(row.locator('a.prj-task-link')).toHaveAttribute(
    'href',
    /\/app\/todo\/[^?]+\?scenario=prj-tasks&tab=tasks/,
  );
  await row.click();
  await expect(page).toHaveURL(/[?&]task=[^&]+/);
  await expect(page.getByRole('complementary', { name: '任务面板' })).toBeVisible();

  await page.goto('/app/project/ZAQczKCu0MOAzC1ZqcFlX?scenario=prj-tasks&tab=tasks');
  await page.locator('.prj-tasks-view-btn').nth(1).click();
  const card = page.locator('.prj-task-card').first();
  await expect(card).toBeVisible();
  await expect(card.locator('a.prj-task-link')).toHaveCount(1);
  await card.click();
  await expect(page).toHaveURL(/[?&]task=[^&]+/);
});

test('new-task dialog: the close control anchors to the head’s right edge (#574 re-key debt)', async ({
  page,
}) => {
  await page.goto('/app?scenario=01&view=board');
  const dialog = page.getByRole('dialog', { name: '新建任务' });
  await page.locator('.sidebar-new-task').click();
  await expect(dialog).toBeVisible();
  // #656: settle the dialog enter animation (tw-animate-css zoom-in-95) before the
  // head/close right-edge geometry is measured off the laid-out box.
  await dialog.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  const hb = await dialog.getByTestId('new-task-head').boundingBox();
  const cb = await dialog.getByRole('button', { name: '关闭' }).boundingBox();
  if (hb === null || cb === null) throw new Error('head / close not laid out');

  expect(Math.abs(hb.x + hb.width - (cb.x + cb.width) - 4)).toBeLessThan(1.5);
  expect(cb.width).toBeCloseTo(28, 0);
  expect(cb.height).toBeCloseTo(28, 0);
});

test('new-task dialog gates unsaved closes and resets on discard (#318)', async ({ page }) => {
  await page.goto('/app?scenario=01&view=board');
  const dialog = page.getByRole('dialog', { name: '新建任务' });
  const discard = page.getByRole('alertdialog', { name: '放弃新建任务？' });

  await page.locator('.sidebar-new-task').click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '关闭' }).click();
  await expect(dialog).toBeHidden();
  await expect(discard).toHaveCount(0);

  await page.locator('.sidebar-new-task').click();
  await dialog.getByRole('textbox').fill('未保存探针');
  await dialog.getByRole('button', { name: '关闭' }).click();
  await expect(discard).toBeVisible();
  await expect(discard).toContainText('放弃新建任务？');
  await expect(discard).toContainText('未保存的内容将丢失。');

  await discard.getByRole('button', { name: '继续编辑' }).click();
  await expect(discard).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('textbox')).toHaveValue('未保存探针');

  await page.keyboard.press('Escape');
  await expect(discard).toBeVisible();
  await expect(discard.getByRole('button', { name: '继续编辑' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(discard).toBeHidden();
  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', { name: '关闭' }).click();
  await discard.getByRole('button', { name: '放弃并关闭' }).click();
  await expect(dialog).toBeHidden();
  await page.locator('.sidebar-new-task').click();
  await expect(dialog.getByRole('textbox')).toHaveValue('');
});

test('detail transcript action rows carry no restore glyph (#884)', async ({ page }) => {
  await page.goto('/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=36');
  // Positive control: the action-row family still renders and the copy is
  // still the real button (#634) — the absence assertions below must not
  // pass vacuously on a page that failed to render.
  await expect(page.locator('.chat-row-icons .chat-copy').first()).toBeVisible();
  // The dead shape is gone from every action row of the transcript column,
  // identified by the Restore glyph's own outline (icons/Restore.tsx).
  await expect(page.locator('.chat-col path[d^="M3 12a9"]')).toHaveCount(0);
  // The user row's action row is exactly the copy button: one glyph, and
  // it sits inside its button (the task-start bubble row carries a
  // taskline between the bubble and the action row).
  const userRow = page.locator('.chat-row:has(.chat-bubble) ~ .chat-row-icons').first();
  await expect(userRow.locator('svg')).toHaveCount(1);
  await expect(userRow.locator('button svg')).toHaveCount(1);
});

test('fail row `查看原始错误` opens the raw-error dialog with the full text (#1258)', async ({
  page,
}) => {
  await page.goto('/app/todo/r8-12?scenario=54');

  await expect(page.locator('.chat-para--fail')).toHaveText('运行该任务的机器已离线');
  await page.getByRole('button', { name: '查看原始错误' }).click();
  const dialog = page.getByRole('dialog', { name: '原始错误' });
  await expect(dialog).toBeVisible();

  await expect(dialog.locator('[data-testid="fail-raw-error"]')).toHaveText(
    '运行该任务的机器已离线',
  );

  await dialog.getByRole('button', { name: '关闭' }).click();
  await expect(dialog).toBeHidden();
});

test('fail row drops the `排查指南` dead link — no doc target, no shape (#1258)', async ({
  page,
}) => {
  await page.goto('/app/todo/r8-12?scenario=54');

  await expect(page.locator('.chat-para--fail')).toBeVisible();

  await expect(page.getByText('排查指南')).toHaveCount(0);

  await expect(page.getByRole('button', { name: '查看原始错误' })).toBeVisible();
});
