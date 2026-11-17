import { expect, type Page, test } from '@playwright/test';

const STATES = '/app/settings/machines?scenario=own-computer-states';

const settings = (page: Page) => page.getByRole('dialog', { name: '设置' });
const itemOf = (page: Page, machine: string) =>
  settings(page).getByTestId('machine-item').filter({ hasText: machine });

test('each own-Mac state folds into the meta line and only its own drawer actions', async ({
  page,
}) => {
  await page.goto(STATES);
  const cases: [string, string, RegExp | null, boolean, string[]][] = [
    ['off-mac', 'off', null, false, []],
    ['browser-mac', 'finish-in-app', /Cairn 应用/, false, []],
    ['installing-mac', 'installing', /正在安装 agent-desktop/, false, []],
    ['failed-mac', 'install-failed', /安装失败/, true, ['own-computer-install']],
    [
      'no-access-mac',
      'no-accessibility',
      /辅助功能/,
      true,
      ['own-computer-guide', 'own-computer-recheck'],
    ],
    ['no-screen-mac', 'no-screen-recording', /屏幕录制/, true, ['own-computer-guide']],
    ['ians-macbook', 'ready', /2 项授权/, false, []],
  ];
  for (const [machine, state, segment, drawerOpen, actions] of cases) {
    const item = itemOf(page, machine);
    await expect(item).toHaveAttribute('data-oc-state', state);
    const meta = item.getByTestId('own-computer-meta');
    if (segment === null) await expect(meta).toHaveCount(0);
    else await expect(meta).toContainText(segment);
    await expect(item.getByTestId('own-computer-drawer')).toHaveCount(drawerOpen ? 1 : 0);
    await expect(item.getByTestId('own-computer-switch')).toHaveAttribute(
      'aria-checked',
      state === 'off' ? 'false' : 'true',
    );
    for (const action of actions) await expect(item.getByTestId(action)).toBeVisible();
  }
  const failed = itemOf(page, 'failed-mac');
  await expect(failed.getByTestId('own-computer-status')).toHaveAttribute('role', 'alert');
  await expect(failed.getByTestId('own-computer-status')).toContainText(/校验不通过/);
  const off = itemOf(page, 'off-mac');
  await off.getByTestId('own-computer-switch').hover();
  await expect(page.locator('[data-slot="tooltip-content"]')).toContainText(/读取文件和运行程序/);
});

test('the ready Mac folds its standing grants behind the meta line', async ({ page }) => {
  await page.goto(STATES);
  const item = itemOf(page, 'ians-macbook');
  await expect(item.getByTestId('own-computer-drawer')).toHaveCount(0);
  await item.getByTestId('own-computer-meta').click();
  const grants = item.getByTestId('own-computer-grant');
  await expect(grants).toHaveCount(2);
  await expect(grants.nth(0)).toContainText('finder');
  await expect(grants.nth(0)).toContainText('对话「整理下载文件夹」');
  await expect(grants.nth(1)).toContainText('命令 git status');
  await expect(grants.nth(1)).toContainText('所有对话');
  await expect(grants.getByTestId('own-computer-revoke')).toHaveCount(2);
  await item.getByTestId('own-computer-meta').click();
  await expect(item.getByTestId('own-computer-drawer')).toHaveCount(0);
});
