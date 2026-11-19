import { expect, type Page, test } from '@playwright/test';

const STATES = '/app/settings/machines?scenario=own-computer-states';

const settings = (page: Page) => page.getByRole('dialog', { name: '设置' });
const itemOf = (page: Page, machine: string) =>
  settings(page).getByTestId('machine-item').filter({ hasText: machine });

test('each own-Mac state folds into the meta line with no switch and only its own actions', async ({
  page,
}) => {
  await page.goto(STATES);
  const cases: [string, string, RegExp, boolean, string[]][] = [
    ['cli-mac', 'not-in-app', /Cairn 应用/, false, []],
    [
      'no-access-mac',
      'no-accessibility',
      /辅助功能/,
      true,
      ['own-computer-guide', 'own-computer-recheck'],
    ],
    ['no-screen-mac', 'no-screen-recording', /屏幕录制/, true, ['own-computer-guide']],
    ['macbook-pro', 'ready', /4 条操作记录/, false, []],
  ];
  for (const [machine, state, segment, drawerOpen, actions] of cases) {
    const item = itemOf(page, machine);
    await expect(item).toHaveAttribute('data-oc-state', state);
    await expect(item.getByTestId('own-computer-meta')).toContainText(segment);
    await expect(item.getByTestId('own-computer-drawer')).toHaveCount(drawerOpen ? 1 : 0);
    for (const action of actions) await expect(item.getByTestId(action)).toBeVisible();
  }
  await expect(settings(page).getByRole('switch', { name: /使用这台 Mac/ })).toHaveCount(0);
});

test('the ready Mac lists every logged call behind the meta line, failures marked', async ({
  page,
}) => {
  await page.goto(STATES);
  const item = itemOf(page, 'macbook-pro');
  await item.getByTestId('own-computer-meta').click();
  await expect(item.getByTestId('own-computer-status')).toContainText('危险命令');
  const rows = item.getByTestId('own-computer-activity-row');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('xcodebuild -scheme Cairn');
  await expect(rows.nth(0)).toContainText('运行命令 · 验收桌面版的托盘菜单');
  await expect(rows.nth(1)).toContainText('Cairn: click, type');
  await expect(rows.nth(2)).toContainText('没有成功');
  await expect(rows.nth(0)).not.toContainText('没有成功');
  await item.getByTestId('own-computer-meta').click();
  await expect(item.getByTestId('own-computer-drawer')).toHaveCount(0);
});
