import { expect, type Page, test } from '@playwright/test';
import { mockLive, PROJECT } from './chief-home-mock';

interface World {
  subscription?: boolean;
  claudeCodeFound?: boolean;
  projects: unknown[];
  bound: boolean;
  rules: { use: string; provider: string; modelId: string }[];
  patches: { use: string; body: unknown }[];
  machines?: unknown[];
}

const MACHINE = { id: 'm1', name: 'mac', online: true, enabledRuntimes: ['pi', 'claude-code'] };

async function open(page: Page, world: World, path = '/app') {
  await mockLive(
    page,
    { threads: [], messages: [], projects: world.projects, todos: [] },
    (p, route, json) => {
      if (p === '/api/teams/t1/providers') {
        return json({ presets: [], providers: world.bound ? [{ id: 'p1', label: 'Claude token' }] : [] });
      }
      if (p === '/api/teams/t1/model-routing') {
        return json({
          edges: [],
          connections: [
            { id: 'machine:m1', vendor: 'anthropic', kind: 'subscription', models: [], available: true },
            ...(world.subscription
              ? [{ id: 's1', vendor: 'anthropic', kind: 'subscription', models: [], available: true }]
              : []),
          ],
          quota: [],
          settings: {},
        });
      }
      if (p === '/api/teams/t1/machines') return json(world.machines ?? [MACHINE]);
      if (p === '/api/teams/t1/model-sources') {
        return json({
          sources: [
            ...(world.claudeCodeFound
              ? [{ runtime: 'claude-code', installed: true, hostname: 'mac', models: [{ id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' }] }]
              : []),
            {
              runtime: 'pi',
              provider: 'p1',
              providerLabel: 'Claude token',
              models: [
                { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
                { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
              ],
            },
          ],
        });
      }
      if (p === '/api/teams/t1/routing-settings') {
        return json({
          rules: world.rules,
          policies: [],
          sessionDefault: { reason: 'claude-code', provider: 'claude-code', modelId: 'claude-sonnet-5-5' },
          coordinatorDefault: world.bound
            ? { reason: 'provider', provider: 'p1', modelId: 'claude-opus-5-5' }
            : world.subscription && world.claudeCodeFound
              ? { reason: 'claude-code', provider: 'claude-code', modelId: 'claude-sonnet-5-5' }
              : { reason: 'none', provider: null, modelId: null },
        });
      }
      const patch = /^\/api\/teams\/t1\/routing-rules\/(\w+)$/.exec(p);
      if (patch?.[1] !== undefined && route.request().method() === 'PATCH') {
        const body = route.request().postDataJSON() as { provider: string; modelId: string };
        world.patches.push({ use: patch[1], body });
        world.rules.push({ use: patch[1], ...body });
        return json({ id: `r-${patch[1]}`, use: patch[1], ...body });
      }
      if (p === '/api/teams/t1/chief' && !world.bound && !(world.subscription && world.claudeCodeFound)) {
        return json({ chief: { id: 'c', userId: 'u1', teamId: 't1', agent: null }, agentActor: null, context: null, watches: [], wakes: [] });
      }
      return undefined;
    },
  );
  await page.goto(path);
}

const fresh = (): World => ({ projects: [], bound: true, rules: [], patches: [] });

test('a team with no projects lands on the setup page, and confirming saves both rules', async ({ page }) => {
  const world = fresh();
  await open(page, world);
  const setup = page.getByTestId('first-run-setup');
  await expect(setup).toBeVisible();
  await expect(page.getByTestId('first-run-step-1')).toHaveAttribute('data-state', 'done');
  await expect(page.getByTestId('first-run-step-2')).toHaveAttribute('data-state', 'now');
  await expect(setup).toContainText('还差第 2 步：确认模型');
  await expect(page.getByTestId('first-run-pick-coordinator')).toContainText('最早添加');
  await expect(page.getByTestId('first-run-pick-session')).toContainText('Claude Code');
  await page.getByTestId('first-run-confirm').click();
  await expect.poll(() => world.patches.map((p) => p.use)).toEqual(['coordinator', 'session']);
  expect(world.patches[0]?.body).toEqual({ provider: 'p1', modelId: 'claude-opus-5-5' });
  await expect(setup.getByRole('link', { name: '新建第一个项目' })).toBeVisible();
});

test('the change control opens the model picker, and confirming saves the model picked there', async ({ page }) => {
  const world = fresh();
  await open(page, world);
  const coordinator = page.getByTestId('first-run-pick-coordinator');
  await coordinator.getByRole('combobox').click();
  await page.getByRole('option', { name: 'Claude Sonnet 5.5' }).click();
  await expect(coordinator).toContainText('Claude Sonnet 5.5');
  await expect(coordinator).toContainText('你换的，原本推荐 Claude Opus 5.5');
  expect(world.patches).toEqual([]);
  await page.getByTestId('first-run-confirm').click();
  await expect.poll(() => world.patches.map((p) => p.use)).toEqual(['coordinator', 'session']);
  expect(world.patches[0]?.body).toEqual({ provider: 'p1', modelId: 'claude-sonnet-5-5' });
});

test('without a provider, step 1 offers only Add provider, which opens the picker in place', async ({ page }) => {
  await open(page, { ...fresh(), bound: false });
  await expect(page.getByTestId('first-run-step-1')).toHaveAttribute('data-state', 'now');
  await expect(page.getByTestId('first-run-setup')).not.toContainText('本机 Claude Code');
  await expect(page.getByTestId('first-run-setup').getByRole('switch')).toHaveCount(0);
  await expect(page.getByTestId('first-run-setup')).toContainText('还差第 1 步');
  await page.getByTestId('first-run-add-provider').click();
  const picker = page.getByRole('dialog', { name: '添加模型服务' });
  await expect(picker).toBeVisible();
  await expect(page).toHaveURL(/\/app(\?|$)/);
  await picker.locator('[data-preset-id="claude-subscription"]').click();
  await expect(page.getByRole('dialog', { name: '添加 Claude 订阅' })).toBeVisible();
});

test('the new-project dialog says which step is missing until setup is done', async ({ page }) => {
  await open(page, { ...fresh(), bound: false }, '/app/project/new');
  await expect(page.getByTestId('project-new-blocked')).toContainText('还差第 1 步：接入模型');
  await page.getByRole('button', { name: '去完成设置' }).click();
  await expect(page.getByTestId('first-run-setup')).toBeVisible();
});

test('skipping goes to the Coordinator home; a team with projects never sees the page', async ({ page }) => {
  await open(page, fresh());
  await page.getByRole('button', { name: '先跳过，去主页看看' }).click();
  await expect(page.getByTestId('first-run-setup')).toHaveCount(0);
  await expect(page.getByTestId('home-c')).toBeVisible();

  const other = await page.context().newPage();
  await open(other, { ...fresh(), projects: [PROJECT] });
  await expect(other.getByTestId('home-c')).toBeVisible();
  await expect(other.getByTestId('first-run-setup')).toHaveCount(0);
});

test('a saved Claude subscription with Claude Code found is the Coordinator pick, and says so', async ({ page }) => {
  const world: World = { ...fresh(), bound: false, subscription: true, claudeCodeFound: true };
  await open(page, world);
  await expect(page.getByTestId('first-run-step-1')).toHaveAttribute('data-state', 'done');
  await expect(page.getByTestId('first-run-pick-coordinator')).toContainText('Claude Sonnet 5.5');
  await expect(page.getByTestId('first-run-pick-coordinator')).toContainText('因为你登录了 Claude 订阅');
  await page.getByTestId('first-run-confirm').click();
  await expect.poll(() => world.patches.map((p) => p.use)).toEqual(['coordinator', 'session']);
  expect(world.patches[0]?.body).toEqual({ provider: 'claude-code', modelId: 'claude-sonnet-5-5' });
});

test('a saved subscription without Claude Code on this computer says what is missing', async ({ page }) => {
  await open(page, { ...fresh(), bound: false, subscription: true });
  await expect(page.getByTestId('first-run-step-1')).toHaveAttribute('data-state', 'now');
  await expect(page.getByTestId('first-run-step-1')).toContainText('订阅已保存。这台电脑还没找到 Claude Code');
});
