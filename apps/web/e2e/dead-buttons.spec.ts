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

test('doc pane tabs: the doc tab reads `变更` and re-selecting it keeps the pane (#306)', async ({
  page,
}) => {
  await page.goto('/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=27');
  const docTab = page.getByTestId('pane-tab-doc');
  await expect(docTab).toHaveText('变更');
  await expect(docTab).toHaveAttribute('aria-selected', 'true');
  await docTab.click();
  await expect(page.getByTestId('doc-pane')).toBeVisible();
  await expect(page.locator('.overlay-actions button', { hasText: '复用方案' })).toHaveCount(0);
});

test('reuse panel `查看方案` flips the doc pane to the plan face (#318)', async ({ page }) => {
  await page.goto('/app/todo/r8-15?scenario=75');
  await expect(page.locator('.overlay-title')).toHaveText('复用方案');

  await expect(page.getByTestId('pane-tab-doc')).toHaveText('变更');

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
