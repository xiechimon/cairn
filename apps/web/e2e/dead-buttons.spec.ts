import { expect, test } from '@playwright/test';
import { stubLiveApiKeys } from './helpers.js';

test('feedback route is gone — old URL redirects to the home', async ({ page }) => {
  await page.goto('/app/feedback');
  await expect(page).toHaveURL('/app');
  await expect(page.locator('[data-route="feedback"]')).toHaveCount(0);
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
  await expect(dialog.getByRole('radio', { checked: true })).toHaveText('每周');
  await dialog.getByRole('button', { name: '保存' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.sched-card')).toHaveCount(1);

  await expect(page.locator('.sched-card')).toContainText('每周运行');
});

test('machines rows carry only live controls, no dead inline buttons (#222 shipped + #1108 narrowed)', async ({
  page,
}) => {
  await page.goto('/app/settings/machines?scenario=06&machine=TlZ2sSD4EJCxjNJqVhdo_');

  await expect(page.getByTestId('machine-accept-toggle').first()).toBeVisible();

  await expect(page.locator('[data-testid="machine-item"] > div:first-child button:not([data-testid])')).toHaveCount(0);
});

test('composer toolbar drops the `语音输入` button, keeps attachment', async ({ page }) => {

  await page.goto('/app/todo/r8-15?scenario=chain');
  const toolbar = page.locator('.composer-toolbar');
  await expect(toolbar).toBeVisible();

  await expect(page.locator('.side-panel button[aria-label="语音输入"]')).toHaveCount(0);
  await page.locator('.side-panel [data-testid="composer-plus"]').click();
  await expect(page.getByRole('menuitem', { name: '添加附件' })).toBeVisible();
});

test('api-keys empty state drops the `查看文档` button, keeps `新建密钥` (#307)', async ({ page }) => {
  await stubLiveApiKeys(page);
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
            machineAccess: false,
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
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(page.getByRole('dialog', { name: '设置' })).toBeVisible();
  await expect(page.getByRole('button', { name: '新建', exact: true })).toHaveCount(0);
});

test('project settings drops the avatar `更换` ink (#307, supersedes the #177 chrome verdict)', async ({
  page,
}) => {
  await page.goto('/app/project/ZAQczKCu0MOAzC1ZqcFlX/settings?scenario=r2-24c');
  await expect(page.locator('.prj-set-change')).toHaveCount(0);

  await expect(page.locator('.prj-set-avatar')).toBeVisible();
  await expect(page.locator('span.prj-set-branch')).toBeVisible();
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
  await expect(confirm).not.toContainText('#1');
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
  await expect(page.locator('.account-avatar [data-slot="avatar"]')).toBeVisible();
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
  await page.getByTestId('side-chat').getByRole('button', { name: '更多操作…' }).click();

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
  await page.getByTestId('side-chat').getByRole('button', { name: '更多操作…' }).click();
  await expect(page.getByRole('menuitem', { name: '关闭' })).toBeDisabled();

  await page.goto('/app/todo/r8-12?scenario=54');
  await page.getByTestId('side-chat').getByRole('button', { name: '更多操作…' }).click();
  const closeRow = page.getByRole('menuitem', { name: '关闭' });
  await expect(closeRow).toBeEnabled();

  await expect(page.getByRole('menuitem', { name: '完成' })).toBeDisabled();
  await closeRow.click();
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('todo-phase `开始` fires orchestration directly — no start dialog (#640)', async ({ page }) => {

  await page.goto('/app/todo/fresh-probe?scenario=23');
  await page.getByTestId('side-chat-action').getByRole('button').last().click();
  await expect(page.locator('.overlay-title')).toHaveCount(0);
});

test('project task rows and cards are real links that open the todo detail (#318, #2531)', async ({ page }) => {
  await page.goto('/app/project/ZAQczKCu0MOAzC1ZqcFlX/tasks?scenario=prj-tasks');
  const row = page.locator('.prj-task-row').first();
  await expect(row).toBeVisible();

  await expect(row.locator('a.prj-task-link')).toHaveCount(1);
  await expect(row.locator('a.prj-task-link')).toHaveAttribute(
    'href',
    /^\/app\?scenario=prj-tasks&thread=[^&]+$/,
  );
  await row.click();
  await expect(page).toHaveURL(/\/app\?scenario=prj-tasks&thread=/);

  await page.goto('/app/project/ZAQczKCu0MOAzC1ZqcFlX/tasks?scenario=prj-tasks');
  await page.locator('.prj-tasks-view-btn').nth(1).click();
  const card = page.locator('.prj-task-card').first();
  await expect(card).toBeVisible();
  await expect(card.locator('a.prj-task-link')).toHaveCount(1);
  await card.click();
  await expect(page).toHaveURL(/\/app\?scenario=prj-tasks&thread=/);
});

test('detail transcript message tools carry no restore action (#884)', async ({ page }) => {
  await page.goto('/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=36');
  await expect(page.locator('.chat-col path[d^="M3 12a9"]')).toHaveCount(0);
  const block = page.locator('.chat-row--user [data-slot="reply-block"]').first();
  await block.hover();
  const tools = block.getByTestId('msg-tools');
  await expect(tools.getByRole('button')).toHaveCount(1);
  await tools.getByTestId('chief-msg-more').click();
  await expect(page.getByRole('menuitem')).toHaveText(['复制']);
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
