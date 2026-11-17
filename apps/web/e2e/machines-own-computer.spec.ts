import { expect, type Page, test } from '@playwright/test';

const STATES = '/app/settings/machines?scenario=own-computer-states';

const settings = (page: Page) => page.getByRole('dialog', { name: '设置' });
const panelOf = (page: Page, machine: string) =>
  settings(page)
    .getByTestId('machine-item')
    .filter({ hasText: machine })
    .getByTestId('own-computer-panel');

test('each own-Mac state shows its one line and only its own actions', async ({ page }) => {
  await page.goto(STATES);
  const cases: [string, string, RegExp, string[]][] = [
    ['off-mac', 'off', /读取文件和运行程序/, []],
    ['browser-mac', 'finish-in-app', /打开 Cairn 应用完成设置/, []],
    ['installing-mac', 'installing', /正在安装 agent-desktop/, []],
    ['failed-mac', 'install-failed', /校验不通过/, ['own-computer-install']],
    ['no-access-mac', 'no-accessibility', /辅助功能/, ['own-computer-guide', 'own-computer-recheck']],
    ['no-screen-mac', 'no-screen-recording', /只能以文字读取应用/, ['own-computer-guide']],
    ['ians-macbook', 'ready', /你批准后/, ['own-computer-grants']],
  ];
  for (const [machine, state, text, actions] of cases) {
    const panel = panelOf(page, machine);
    await expect(panel).toHaveAttribute('data-state', state);
    await expect(panel.getByTestId('own-computer-status')).toHaveText(text);
    await expect(panel.getByTestId('own-computer-switch')).toHaveAttribute(
      'aria-checked',
      state === 'off' ? 'false' : 'true',
    );
    for (const action of actions) await expect(panel.getByTestId(action)).toBeVisible();
  }
  await expect(panelOf(page, 'failed-mac').getByTestId('own-computer-status')).toHaveAttribute(
    'role',
    'alert',
  );
});

test('the ready Mac lists its standing grants with a revoke each', async ({ page }) => {
  await page.goto(STATES);
  const grants = panelOf(page, 'ians-macbook').getByTestId('own-computer-grant');
  await expect(grants).toHaveCount(2);
  await expect(grants.nth(0)).toContainText('finder');
  await expect(grants.nth(0)).toContainText('对话「整理下载文件夹」');
  await expect(grants.nth(1)).toContainText('命令 git status');
  await expect(grants.nth(1)).toContainText('所有对话');
  await expect(grants.getByTestId('own-computer-revoke')).toHaveCount(2);
});
