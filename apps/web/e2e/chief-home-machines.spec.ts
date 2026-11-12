import { expect, type Page, test } from '@playwright/test';
import { HISTORY, mockLive, PROJECT } from './chief-home-mock';

const HOME = '/app?scenario=home-c';
const MIDDAY_IN_BEIJING = Date.UTC(2026, 10, 12, 4);

const chip = (page: Page) => page.getByTestId('machines-button');
const panel = (page: Page) => page.getByRole('complementary', { name: '电脑' });

test('the computer chip names only the Coordinator machine and its running count', async ({
  page,
}) => {
  await page.goto(HOME);
  await expect(chip(page)).toHaveAccessibleName(/xmonsMac/);
  await expect(chip(page)).toHaveAccessibleName(/2\/8 在跑/);
  await expect(chip(page)).not.toHaveAccessibleName(/\+1/);
  await expect(chip(page)).toHaveText('');
  await expect(chip(page).locator('span')).toHaveCount(0);
  await expect(chip(page)).toHaveAttribute('aria-pressed', 'false');
});

test('the chip opens a list with one row per computer, the Coordinator machine first, and no new-session button', async ({
  page,
}) => {
  await page.goto(HOME);
  await chip(page).click();
  await expect(panel(page)).toBeVisible();
  await expect(page).toHaveURL(/[?&]pane=machines/);
  await expect(chip(page)).toHaveAttribute('aria-pressed', 'true');

  await expect(panel(page).getByRole('heading', { name: '你的电脑' })).toBeVisible();
  const rows = panel(page).getByRole('button', { name: /xmonsMac|omarchy/ });
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('xmonsMac');
  await expect(rows.nth(0)).toHaveText('xmonsMac2 个在跑');
  await expect(rows.nth(0)).not.toContainText('Coordinator');
  await expect(rows.nth(1)).toContainText('omarchy');
  await expect(rows.nth(1)).toContainText('离线');
  await expect(panel(page).getByRole('switch')).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: /新会话|新任务|新建/ })).toHaveCount(0);
  await expect(panel(page)).toContainText('检查过');
  await expect(panel(page).getByRole('button', { name: '再检查一次' })).toBeEnabled();

  await panel(page).getByRole('link', { name: '添加电脑' }).click();
  await expect(page).toHaveURL(/\/app\/settings\/machines/);
});

test('a row opens that computer in the same panel and the back controls return to the list', async ({
  page,
}) => {
  await page.goto(`${HOME}&pane=machines`);
  await panel(page).getByRole('button', { name: /xmonsMac/ }).click();
  await expect(page).toHaveURL(/[?&]pane=machines/);
  await expect(panel(page).getByRole('heading', { name: 'xmonsMac' })).toBeVisible();
  await expect(panel(page).getByTestId('machine-detail-status')).toHaveText(
    '在线 · Coordinator 在这台',
  );
  await expect(panel(page).getByTestId('machine-hostname')).toHaveCount(0);
  await expect(panel(page).getByRole('tab', { name: 'Agent 的权限' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(panel(page).getByRole('heading', { name: '能力' })).toHaveCount(0);
  await expect(panel(page).getByRole('switch')).toHaveCount(0);
  await expect(panel(page).getByTestId('machine-folders-empty')).toBeVisible();
  await expect(panel(page).getByText('已安装')).toHaveCount(0);
  await expect(panel(page).getByText('未安装')).toHaveCount(0);
  await expect(panel(page).getByRole('heading', { name: '你的电脑' })).toHaveCount(0);

  await panel(page).getByRole('button', { name: '所有电脑' }).first().click();
  await expect(panel(page).getByRole('heading', { name: '你的电脑' })).toBeVisible();

  await panel(page).getByRole('button', { name: /omarchy/ }).click();
  await expect(panel(page).getByRole('heading', { name: 'omarchy' })).toBeVisible();
  await expect(panel(page)).toContainText('离线');
  await expect(panel(page).getByTestId('machine-screen-hint')).toHaveCount(0);
  await panel(page).getByRole('button', { name: '所有电脑' }).first().click();
  await expect(panel(page).getByRole('heading', { name: '你的电脑' })).toBeVisible();
});

test('re-checking refreshes the checked time without leaving the list', async ({ page }) => {
  await page.goto(`${HOME}&pane=machines`);
  await panel(page).getByRole('button', { name: '再检查一次' }).click();
  await expect(panel(page).getByRole('button', { name: '再检查一次' })).toBeEnabled();
  await expect(panel(page)).toContainText(/\d\d:\d\d 检查过/);
});

test('the chip name carries the Coordinator machine and its state', async ({ page }) => {
  await page.goto(HOME);
  await expect(chip(page)).toHaveAccessibleName('电脑 · xmonsMac · 在线 · 2/8 在跑');
});

test('with one computer the panel says work runs on the Coordinator machine', async ({ page }) => {
  await page.goto('/app?scenario=home-c-empty&pane=machines');
  await expect(panel(page)).toContainText('没有其他电脑时，任务都在 Coordinator 这台电脑上跑。');
});

test('at phone width the chip stays an icon and the title stays for screen readers', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(HOME);
  const box = await chip(page).boundingBox();
  expect(box?.width ?? 0).toBeLessThanOrEqual(60);
  const title = page.getByTestId('home-c').getByRole('heading', { level: 1 });
  await expect(title).toHaveText('Coordinator');
  await expect(title).toHaveClass(/sr-only/);
});

test('the icon-only header buttons show a tooltip with their name on hover', async ({
  page,
}) => {
  await page.goto(HOME);
  for (const [name, tip] of [
    ['任务', '任务，3 件等你'],
    ['成果', '成果'],
    ['电脑', '电脑 · xmonsMac · 在线 · 2/8 在跑'],
  ] as const) {
    const button = page.getByTestId('home-c-pane-buttons').getByRole('button', { name });
    await button.hover();
    await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText(tip);
    await page.mouse.move(0, 0);
    await expect(page.locator('[data-slot="tooltip-content"]')).toHaveCount(0);
  }
});

test('computers share one group, each glyph carries its status dot, and the add row is outlined', async ({
  page,
}) => {
  await page.clock.setFixedTime(MIDDAY_IN_BEIJING);
  await page.goto('/app?scenario=home-c-machines&pane=machines');
  const group = panel(page).locator('[data-slot="list-card"]').filter({ hasText: 'xmonsMac' });
  await expect(group).toHaveCount(1);
  const rows = group.getByTestId('machine-list-row');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('xmonsMac');
  const dots = group.getByTestId('machine-status-dot');
  await expect(dots).toHaveCount(4);
  await expect(dots.nth(0)).toHaveAttribute('data-online', 'true');
  await expect(dots.nth(1)).toHaveAttribute('data-online', 'false');
  await expect(dots.nth(2)).toHaveAttribute('data-online', 'true');
  await expect(dots.nth(3)).toHaveAttribute('data-online', 'false');
  await expect(rows.nth(3)).toHaveText('Office Mac mini离线 · 2 小时前');
  await expect(group).toHaveAttribute('data-outlined', 'true');
  await expect(panel(page).getByTestId('machines-add').locator('[data-slot="list-card"]')).toHaveAttribute(
    'data-outlined',
    'true',
  );
});

test('a computer page puts the status under the header and links its settings from Edit', async ({
  page,
}) => {
  await page.goto('/app?scenario=home-c-machines&pane=machines');
  await panel(page).getByRole('button', { name: /Office Mac mini/ }).click();
  const status = panel(page).getByTestId('machine-detail-status');
  await expect(status).toHaveText(/^离线 · 12\d 分钟前检查过$/);
  await expect(status.getByTestId('machine-status-dot')).toHaveAttribute('data-online', 'false');
  await expect(panel(page).locator('[data-panel-head]')).not.toContainText('离线');
  await expect(panel(page).getByRole('switch')).toHaveCount(0);
  await panel(page).getByRole('link', { name: '编辑' }).click();
  await expect(page).toHaveURL(/\/app\/settings\/machines\?machine=home-c-office/);
});

test('re-checking shows a spinner in place of the label and keeps the button name', async ({
  page,
}) => {
  await page.goto(`${HOME}&pane=machines`);
  const recheck = panel(page).getByTestId('machines-recheck');
  await expect(recheck).toHaveAccessibleName('再检查一次');
  await expect(recheck).toHaveAttribute('aria-busy', 'false');
  await recheck.click();
  await expect(recheck).toHaveAttribute('aria-busy', 'false');
  await expect(recheck).toHaveText('再检查一次');
});

const REF = '/app?scenario=sessions-ref&pane=machines';

test('the reference list says what runs on an online computer and how long an offline one has been away', async ({
  page,
}) => {
  await page.clock.setFixedTime(MIDDAY_IN_BEIJING);
  await page.goto(REF);
  const rows = panel(page).getByTestId('machine-list-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toHaveText('工作室的 MacBook Air2 个在跑');
  await expect(rows.nth(1)).toHaveText(/^办公室 Mac mini离线 · \d+ (分钟|小时)前$/);
  await expect(panel(page).getByRole('button', { name: /云|cloud/i })).toHaveCount(0);
});

test('the reference detail names the host, lists folders under access, and work here opens running threads', async ({
  page,
}) => {
  await page.goto('/app?scenario=sessions-ref-detail&pane=machines');
  await expect(panel(page).getByRole('heading', { name: '工作室的 MacBook Air' })).toBeVisible();
  await expect(panel(page).getByTestId('machine-hostname')).toHaveText('它自称 studio-mbp-01');
  await expect(panel(page).getByTestId('machine-detail-status')).toHaveText('在线 · Coordinator 在这台');
  const folders = panel(page).getByTestId('machine-folder');
  await expect(folders).toHaveText(['tmp已开放', '~/Code已开放']);
  await expect(folders.first().locator('.font-mono')).toHaveText('tmp');
  await expect(panel(page).getByRole('switch')).toHaveCount(0);

  await panel(page).getByRole('tab', { name: '在这台工作' }).click();
  await expect(panel(page).getByTestId('machine-folder')).toHaveCount(0);
  const running = panel(page).getByTestId('machine-running-row');
  await expect(running).toHaveCount(2);
  await expect(running.nth(0)).toContainText('Push for finished threads');
  await expect(running.nth(0)).toContainText('cairn · 12 分钟前开始');
  await running.nth(0).click();
  await expect(page).toHaveURL(/[?&]thread=home-c-working-a/);
});

test('an offline reference computer says nothing runs there and shows its folders as off', async ({
  page,
}) => {
  await page.goto(REF);
  await panel(page).getByRole('button', { name: /办公室 Mac mini/ }).click();
  await expect(panel(page).getByTestId('machine-detail-status')).toHaveText(/^离线 · 11[45] 分钟前检查过$/);
  await expect(panel(page).getByTestId('machine-folder')).toHaveText(['~/Projects未开放']);
  await panel(page).getByRole('tab', { name: '在这台工作' }).click();
  await expect(panel(page).getByTestId('machine-running-empty')).toHaveText(
    '这台电脑上现在没有在跑的任务。',
  );
});

test('a live computer without the running list falls back to its running count on work here', async ({
  page,
}) => {
  await page.goto(`${HOME}&pane=machines`);
  await panel(page).getByRole('button', { name: /xmonsMac/ }).click();
  await panel(page).getByRole('tab', { name: '在这台工作' }).click();
  await expect(panel(page).getByTestId('machine-running-empty')).toHaveText('这台电脑上有 2 个任务在跑。');
  await expect(panel(page).getByTestId('machine-running-row')).toHaveCount(0);
  await panel(page).getByRole('tab', { name: 'Agent 的权限' }).click();
  await expect(panel(page).getByText('Agent 在这台电脑上能用的文件夹')).toBeVisible();
  await expect(panel(page).getByTestId('machine-folders-empty')).toHaveText('还没有开放任何文件夹');
});

test('a live computer lists the threads the server reports running on it', async ({ page }) => {
  const startedAt = Date.now() - 20 * 60_000;
  await mockLive(page, {
    threads: [],
    messages: HISTORY,
    machines: [
      {
        id: 'm1',
        name: 'omarchy',
        online: true,
        kind: 'remote',
        enabledRuntimes: ['pi'],
        runningSteps: 2,
        running: [
          { threadId: 'todo-1', title: 'Orb canary round 7', projectId: PROJECT.id, startedAt },
          { threadId: 'todo-2', title: 'Serif greeting fix', projectId: PROJECT.id, startedAt },
        ],
      },
    ],
  });
  await page.goto('/app?pane=machines');
  await panel(page).getByRole('button', { name: /omarchy/ }).click();
  await panel(page).getByRole('tab', { name: '在这台工作' }).click();
  const running = panel(page).getByTestId('machine-running-row');
  await expect(running).toHaveCount(2);
  await expect(running.first()).toContainText('Orb canary round 7');
  await expect(running.first()).toContainText('cairn');
  await expect(panel(page).getByTestId('machine-running-empty')).toHaveCount(0);
});
