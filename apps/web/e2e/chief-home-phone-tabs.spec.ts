import { expect, type Page, test } from '@playwright/test';

const HOME = '/app?scenario=home-c';

const tabs = (page: Page) => page.getByRole('navigation', { name: '对话、任务和成果' });
const panel = (page: Page) => page.getByRole('complementary', { name: '任务' });
const composer = (page: Page) => page.locator('.chief-composer textarea');

test.describe('at phone width', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Chat and Tasks are bottom tabs, and the only Tasks toggle is the round top-right button', async ({
    page,
  }) => {
    await page.goto(HOME);
    await expect(tabs(page)).toBeVisible();
    await expect(page.getByTestId('home-c-pane-buttons')).toHaveCount(0);
    await expect(page.getByTestId('tasks-toggle')).toHaveCount(1);
    await expect(
      page.locator('[data-slot="narrow-top"]').getByTestId('tasks-toggle'),
    ).toBeVisible();
    const chat = tabs(page).getByRole('link', { name: '对话' });
    const tasks = tabs(page).getByRole('link', { name: /任务/ });
    await expect(chat).toHaveAttribute('aria-current', 'page');
    await expect(tabs(page).getByTestId('tasks-badge')).toHaveText('3');
    await tasks.click();
    await expect(panel(page)).toBeVisible();
    await expect(page).toHaveURL(/[?&]pane=tasks/);
    await expect(tasks).toHaveAttribute('aria-current', 'page');
    const bar = await tabs(page).boundingBox();
    const sheetBottom = await panel(page).evaluate((node) => {
      const box = node.getBoundingClientRect();
      return box.bottom - Number.parseFloat(getComputedStyle(node).paddingBottom);
    });
    expect(bar).not.toBeNull();
    expect(sheetBottom).toBeLessThanOrEqual(bar!.y + 1);
    await chat.click();
    await expect(panel(page)).toHaveCount(0);
    await expect(page).not.toHaveURL(/pane=/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
  });

  test('the drawer button stays on top of the Tasks sheet and opens the drawer', async ({
    page,
  }) => {
    await page.goto(`${HOME}&pane=tasks`);
    await expect(panel(page)).toBeVisible();
    await page.getByRole('button', { name: '展开侧边栏' }).click({ trial: true, timeout: 2000 });
    await page.getByRole('button', { name: '展开侧边栏' }).click();
    await expect(page.locator('aside.board-sidebar')).toBeVisible();
  });

  test('an open task thread covers the top controls and the tab bar, as the reference phone task view', async ({
    page,
  }) => {
    await page.goto(`${HOME}&pane=tasks`);
    await panel(page).getByText('Orb canary round 7').click();
    await expect(page).toHaveURL(/[?&]thread=home-c-working-c/);
    const thread = page.getByTestId('side-chat');
    await expect(thread).toBeVisible();
    const head = await thread.getByRole('button', { name: '关闭' }).boundingBox();
    const menu = await page.getByTestId('narrow-menu').boundingBox();
    expect(head!.y).toBeLessThan(menu!.y + menu!.height);
    const covered = await tabs(page).evaluate((el) => {
      const r = el.getBoundingClientRect();
      return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('aside.side-panel') != null;
    });
    expect(covered).toBe(true);
    await page.goBack();
    await expect(page).not.toHaveURL(/thread=/);
    await expect(panel(page)).toBeVisible();
  });

  test('the Tasks plus button adds a task inline, then closes the sheet onto the composer', async ({
    page,
  }) => {
    await page.goto(`${HOME}&pane=tasks`);
    await panel(page).getByTestId('tasks-new').click();
    await panel(page).getByTestId('tasks-add-input').fill('Check the relay probe');
    await panel(page).getByTestId('tasks-add-input').press('Enter');
    await expect(panel(page)).toHaveCount(0);
    await expect(composer(page)).toHaveValue('Check the relay probe');
    await expect(composer(page)).toBeInViewport();
  });

  test('the empty Tasks action opens the add field, and a submitted task lands in the composer', async ({
    page,
  }) => {
    await page.goto('/app?scenario=home-c-empty&pane=tasks');
    await panel(page).getByRole('button', { name: '添加任务' }).click();
    const input = panel(page).getByTestId('tasks-add-input');
    await expect(input).toBeFocused();
    await input.fill('Check the relay probe');
    await input.press('Enter');
    await expect(panel(page)).toHaveCount(0);
    await expect(composer(page)).toHaveValue('Check the relay probe');
  });

  test('drawer project rows keep their status in the description, not a second line', async ({ page }) => {
    await page.goto(HOME);
    await page.getByRole('button', { name: '展开侧边栏' }).click();
    const aside = page.locator('aside.board-sidebar');
    const row = (name: string) =>
      aside.locator('[data-slot="sidebar-project-row"]').filter({ hasText: name });
    await expect(row('cairn')).toHaveAttribute('aria-description', '待回答 · 计划写好了');
    await expect(row('cairn')).toHaveText('cairn');
    await expect(row('Credential relay')).toHaveAttribute('aria-description', '2 件进行中');
    await expect(row('Credential relay')).toHaveText('Credential relay');
  });
});

test('wide screens keep the header Tasks toggle and draw no tabs or status lines', async ({
  page,
}) => {
  await page.goto(HOME);
  await expect(page.getByTestId('tasks-toggle')).toBeVisible();
  await expect(tabs(page)).toHaveCount(0);
  await expect(page.locator('[data-slot="project-status"]')).toHaveCount(0);
});

test('the Tasks plus button has a visible tooltip', async ({ page }) => {
  await page.goto(`${HOME}&pane=tasks`);
  await panel(page).getByTestId('tasks-new').hover();
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText('新任务');
});
