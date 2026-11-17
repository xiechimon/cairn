import { expect, test } from '@playwright/test';
import { stubLiveApiKeys } from './helpers.js';

test('feedback route is gone — old URL redirects to the home', async ({ page }) => {
  await page.goto('/app/feedback');
  await expect(page).toHaveURL('/app');
  await expect(page.locator('[data-route="feedback"]')).toHaveCount(0);
});

const EMPTY_SCHEDULES = '/app?scenario=11&pane=tasks&tab=scheduled';
const SCHEDULES = '/app?scenario=home-c&pane=tasks&tab=scheduled';

test('the empty schedules tab has no docs button; its `新建定时` really opens the editor (#149, #1037)', async ({
  page,
}) => {
  await page.goto(EMPTY_SCHEDULES);
  await expect(page.getByTestId('tasks-schedules-empty')).toBeVisible();
  await expect(page.getByRole('button', { name: '查看文档' })).toHaveCount(0);
  const emptyNew = page.getByTestId('schedule-new');
  await expect(emptyNew).toHaveText('新建定时');
  await emptyNew.click();
  const popover = page.getByTestId('schedule-popover');
  await expect(popover).toContainText('新建定时');
  await expect(popover).toContainText('这里还没有可以定时的任务');
  await popover.getByRole('button', { name: '取消' }).click();
  await expect(popover).toBeHidden();
});

test('schedules fixture face: the new schedule editor frequency radios respond and Save closes it (#1037)', async ({
  page,
}) => {
  await page.goto(SCHEDULES);
  await page.getByTestId('schedule-new').click();
  const popover = page.getByTestId('schedule-popover');
  await expect(popover).toBeVisible();

  await popover.getByRole('radio', { name: '每周' }).click();
  await expect(popover.getByRole('radio', { checked: true })).toHaveText('每周');
  await expect(popover.getByLabel('从哪天开始每周重复')).toBeVisible();
  const save = popover.getByRole('button', { name: '保存' });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(popover).toBeHidden();
});

test('machines rows carry only live controls, no dead inline buttons (#222 shipped + #1108 narrowed)', async ({
  page,
}) => {
  await page.goto('/app/settings/machines?scenario=06&machine=TlZ2sSD4EJCxjNJqVhdo_');

  await expect(page.getByTestId('machine-menu').first()).toBeVisible();

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

test('api-keys empty state drops the `查看文档` button, keeps `新建 API 密钥` (#307)', async ({ page }) => {
  await stubLiveApiKeys(page);
  await page.goto('/app/api-keys');

  const keysEmpty = page.getByTestId('keys-empty');
  await expect(keysEmpty).toBeVisible();
  await expect(page.getByRole('link', { name: '查看文档' })).toHaveCount(0);
  await expect(keysEmpty.getByRole('button', { name: '新建 API 密钥' })).toBeVisible();
});

test('api-keys non-empty state keeps `新建 API 密钥` visible and opens the create dialog', async ({ page }) => {
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
  const create = page.getByRole('button', { name: '新建 API 密钥', exact: true });
  await expect(create).toBeVisible();
  await create.click();
  await expect(page.getByRole('dialog', { name: '新建 API 密钥', exact: true })).toBeVisible();
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
  await expect(secretsEmpty.getByRole('button', { name: '添加', exact: true })).toBeVisible();
});

test('mcp page: catalog cards connect, add-server opens a form, local rows stay read-only (#4870)', async ({
  page,
}) => {
  await page.goto('/app/resources/mcp-servers?scenario=01');
  const catalog = page.getByTestId('mcp-catalog');
  await expect(catalog.locator('[data-connector-card]')).toHaveCount(8);
  await expect(page.getByTestId('resource-empty')).toHaveCount(0);
  await catalog.getByRole('button', { name: '接入 Linear' }).click();
  const signIn = page.getByRole('dialog', { name: '前往 mcp.linear.app 登录' });
  await expect(signIn).toBeVisible();
  await expect(signIn.getByTestId('mcp-signin-host')).toHaveText('mcp.linear.app');
  await signIn.getByRole('button', { name: '改用令牌' }).click();
  await expect(page.getByRole('dialog', { name: '连接 Linear' })).toBeVisible();
  await page.getByRole('button', { name: '取消' }).click();
  await catalog.getByRole('button', { name: '接入 GitHub' }).click();
  await expect(page.getByRole('dialog', { name: '连接 GitHub' })).toContainText('Pull requests');
  await page.getByRole('button', { name: '取消' }).click();
  await page.getByTestId('mcp-add-server').click();
  await expect(page.getByRole('dialog', { name: '添加 MCP 服务器' })).toBeVisible();

  await page.goto('/app/resources/mcp-servers?scenario=mcp-manage-needs-auth');
  const manage = page.getByRole('dialog', { name: 'Cloudflare' });
  await expect(manage.getByTestId('dialog-foot').getByRole('button').last()).toHaveText('重新连接');
  await manage.getByRole('button', { name: '删除' }).click();
  const confirm = page.getByRole('alertdialog', { name: '删除连接' });
  await expect(confirm).toBeVisible();
  await expect(manage).toHaveCount(0);
  await confirm.getByRole('button', { name: '取消' }).click();
  await expect(manage).toBeVisible();

  await page.goto('/app/resources/mcp-servers?scenario=mcp-oauth-denied');
  const banner = page.getByTestId('mcp-oauth-error');
  await expect(banner).toContainText('没能连上 Linear');
  await expect(banner.getByRole('button', { name: '重试' })).toBeVisible();

  await page.goto('/app/resources/mcp-servers?scenario=07');
  await expect(page.locator('[data-testid="resource-row"][data-mcp]')).toHaveCount(1);
  await expect(page.locator('[data-testid="resource-row"] button')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: '设置' })).toBeVisible();
});

test('project settings drops the avatar `更换` ink (#307, supersedes the #177 chrome verdict)', async ({
  page,
}) => {
  await page.goto('/app/project/ZAQczKCu0MOAzC1ZqcFlX/settings?scenario=r2-24c');
  await expect(page.locator('.prj-set-change')).toHaveCount(0);

  await expect(page.getByTestId('project-icon-trigger')).toBeVisible();
  await expect(page.locator('span.prj-set-branch')).toBeVisible();
});

test('schedule row `更多` opens a menu and its delete asks through the confirm (#306)', async ({
  page,
}) => {
  await page.goto('/app?scenario=r3-93&pane=tasks&tab=scheduled');
  const frame = page.locator('[data-slot="schedule-row-frame"]');
  await expect(frame).toHaveCount(1);
  const more = frame.getByTestId('schedule-row-menu-button');
  await frame.hover();
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await more.click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(more).toHaveAttribute('aria-expanded', 'true');

  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  await more.click();
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: /删除/ }).click();

  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('确定删除该定时？此操作不可撤销。');
  await expect(confirm).not.toContainText('#1');
  await confirm.getByRole('button', { name: '删除' }).click();
  await expect(confirm).toBeHidden();
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

test('more menu `完成` does not open an accept dialog', async ({ page }) => {
  await page.goto(REVIEW_DETAIL);
  await page.getByTestId('side-chat').getByRole('button', { name: '更多操作…' }).click();

  const menu = page.getByRole('menu', { name: '更多' });
  await expect(menu).toBeVisible();
  const complete = menu.getByRole('menuitem', { name: '完成' });
  await expect(complete).toBeEnabled();
  await complete.click();

  await expect(menu).toBeHidden();
  await expect(page.getByRole('dialog', { name: '完成任务' })).toHaveCount(0);
});

test('more menu ends a task only by archiving it: `归档` is offered and there is no `关闭`', async ({
  page,
}) => {
  await page.goto('/app/todo/r8-12?scenario=54');
  await page.getByTestId('side-chat').getByRole('button', { name: '更多操作…' }).click();
  await expect(page.getByRole('menuitem', { name: '归档' })).toBeEnabled();
  await expect(page.getByRole('menuitem', { name: '关闭' })).toHaveCount(0);
});

test('todo-phase `开始` fires orchestration directly — no start dialog (#640)', async ({ page }) => {

  await page.goto('/app/todo/fresh-probe?scenario=23');
  await page.getByTestId('side-chat-action').getByRole('button').last().click();
  await expect(page.locator('.overlay-title')).toHaveCount(0);
});

test('detail transcript message tools carry no restore action (#884)', async ({ page }) => {
  await page.goto('/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=36');
  await expect(page.locator('.chat-col path[d^="M3 12a9"]')).toHaveCount(0);
  const block = page.locator('.chat-row--user [data-slot="reply-block"]').first();
  await block.hover();
  const tools = block.getByTestId('msg-tools');
  await expect(tools.getByRole('button')).toHaveCount(1);
  await tools.getByTestId('chief-msg-more').click();
  await expect(page.getByRole('menuitem')).toHaveText([/^复制/]);
});

test('fail row `查看原始错误` opens the raw-error dialog with the full text (#1258)', async ({
  page,
}) => {
  await page.goto('/app/todo/r8-12?scenario=54');

  await expect(page.locator('.chat-para--fail')).toHaveText('运行该任务的执行机已离线');
  await page.getByRole('button', { name: '查看原始错误' }).click();
  const dialog = page.getByRole('dialog', { name: '原始错误' });
  await expect(dialog).toBeVisible();

  await expect(dialog.locator('[data-testid="fail-raw-error"]')).toHaveText(
    '运行该任务的执行机已离线',
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
