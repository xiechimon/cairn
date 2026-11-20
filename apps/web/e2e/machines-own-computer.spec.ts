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

test('a ready Mac row carries no action log, computer-control switches or folder list', async ({
  page,
}) => {
  await page.goto(STATES);
  const item = itemOf(page, 'macbook-pro');
  await expect(item).toHaveAttribute('data-oc-state', 'ready');
  await expect(item.getByTestId('machine-item-status')).toHaveText('在线');
  await expect(item.getByTestId('own-computer-meta')).toHaveCount(0);
  await expect(item.getByTestId('own-computer-drawer')).toHaveCount(0);
  await expect(item).not.toContainText(/操作记录|电脑控制|文件夹/);
  await expect(item.getByRole('switch')).toHaveCount(0);
  await expect(item.getByRole('textbox')).toHaveCount(0);
});
