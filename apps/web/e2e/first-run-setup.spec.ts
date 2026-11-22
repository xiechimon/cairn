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
  local?: { providerId: string; state: string; models?: { id: string; name: string }[] }[];
  existing?: string[];
  created?: {
    providerId: string;
    label?: string;
    apiKey?: string;
    models?: { id: string; name: string }[];
  }[];
  deleted?: string[];
  verdicts?: Record<string, { status: 'ok' | 'failed'; failure: string | null }>;
  tests?: string[];
  vm?: boolean;
  installs?: string[];
}

const liveCreated = (world: World) =>
  (world.created ?? []).filter((c) => !world.deleted?.includes(`p-${c.providerId}`));

const MACHINE = { id: 'm1', name: 'mac', online: true, enabledRuntimes: ['pi', 'claude-code'] };

const LOCAL_PROVIDER = {
  source: 'pi',
  label: 'Relay',
  api: 'openai-completions',
  baseUrl: 'https://relay.example.com/v1',
  authHeader: false,
  models: [{ id: 'claude-opus-5-5', name: 'Claude Opus 5.5' }],
};

async function open(page: Page, world: World, path = '/app') {
  if (world.local !== undefined) {
    await page.addInitScript(
      ({ rows, base }) => {
        const found = rows.map((row) => ({ ...base, ...row, label: row.providerId }));
        Object.assign(window, {
          cairnDesktop: {
            localProviders: {
              scan: async () => found,
              read: async (ids: string[]) =>
                found
                  .filter((row) => row.state === 'ready' && ids.includes(row.providerId))
                  .map((row) => ({ ...row, apiKey: `test-key-${row.providerId}` })),
            },
          },
        });
      },
      { rows: world.local, base: LOCAL_PROVIDER },
    );
  }
  await mockLive(
    page,
    { threads: [], messages: [], projects: world.projects, todos: [] },
    (p, route, json) => {
      const tested = /^\/api\/teams\/t1\/providers\/([\w-]+)\/test$/.exec(p);
      if (tested?.[1] !== undefined && route.request().method() === 'POST') {
        const { model } = (route.request().postDataJSON() ?? {}) as { model?: string };
        const key = `${tested[1]}/${model}`;
        world.tests = [...(world.tests ?? []), key];
        const verdict = world.verdicts?.[key] ?? { status: 'ok', failure: null };
        return json({
          ...verdict,
          reason: verdict.status === 'ok' ? null : 'upstream refused',
          httpStatus: null,
          detail: null,
          latencyMs: null,
        });
      }
      if (p === '/api/teams/t1/providers' && route.request().method() === 'POST') {
        const body = route.request().postDataJSON() as NonNullable<World['created']>[number];
        world.created = [...(world.created ?? []), body];
        world.bound = true;
        return json({ id: `p-${body.providerId}`, ...body }, 201);
      }
      const removed = /^\/api\/teams\/t1\/providers\/([\w-]+)$/.exec(p);
      if (removed?.[1] !== undefined && route.request().method() === 'DELETE') {
        world.deleted = [...(world.deleted ?? []), removed[1]];
        world.bound = liveCreated(world).length > 0;
        return route.fulfill({ status: 204 });
      }
      if (p === '/api/teams/t1/providers') {
        return json({
          presets: [],
          providers: [
            ...(world.bound
              ? [
                  {
                    id: 'p1',
                    providerId: 'p1',
                    label: 'Claude token',
                    models: [{ id: 'claude-opus-5-5', name: 'Claude Opus 5.5' }],
                  },
                ]
              : []),
            ...liveCreated(world).map((c) => ({
              id: `p-${c.providerId}`,
              providerId: c.providerId,
              label: c.label ?? c.providerId,
              models: c.models ?? [],
            })),
            ...(world.existing ?? []).map((id) => ({ id, providerId: id, label: id })),
          ],
        });
      }
      if (p === '/api/teams/t1/model-routing') {
        return json({
          edges: [],
          connections: [
            ...(world.subscription
              ? [{ id: 's1', vendor: 'anthropic', kind: 'subscription', models: [], available: true }]
              : []),
          ],
          quota: [],
          settings: {},
        });
      }
      if (p === '/api/teams/t1/machines') return json(world.machines ?? [MACHINE]);
      if (p === '/api/computers' && world.vm === true && route.request().method() === 'GET') {
        return json({
          computers: [
            {
              id: 'comp-1',
              scopeKey: 'chief:u1',
              state: 'stopped',
              controlHolder: 'none',
              handoffReason: null,
              kind: 'vm',
              download: { state: 'absent', doneBytes: 0, totalBytes: 1_481_435_942 },
              machine: { id: 'm1', name: 'mac', online: true },
            },
          ],
        });
      }
      if (p === '/api/computers/comp-1/actions') {
        const { action } = route.request().postDataJSON() as { action: string };
        world.installs = [...(world.installs ?? []), action];
        return json({ outcome: 'installed' });
      }
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
            ...liveCreated(world).map((c) => ({
              runtime: 'pi',
              provider: c.providerId,
              providerLabel: c.label ?? c.providerId,
              models: c.models ?? [],
            })),
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

test('a team with no projects lands on the setup page, and confirming saves the Coordinator rule only and opens the conversation', async ({ page }) => {
  const world = fresh();
  await open(page, world);
  const setup = page.getByTestId('first-run-setup');
  await expect(setup).toBeVisible();
  await expect(page.getByTestId('first-run-step-1')).toHaveAttribute('data-state', 'done');
  await expect(page.getByTestId('first-run-step-2')).toHaveAttribute('data-state', 'now');
  await expect(page.getByTestId('first-run-pick-coordinator')).toHaveText(/Claude Opus 5\.5/);
  await expect(page.getByTestId('first-run-pick-session')).toHaveCount(0);
  await expect(setup).toContainText('任务默认用 Coordinator 的模型');
  await expect(setup).not.toContainText('因为');
  await expect(page.getByTestId('first-run-vm')).toHaveCount(0);
  await page.getByTestId('first-run-confirm').click();
  await expect.poll(() => world.patches.map((p) => p.use)).toEqual(['coordinator']);
  expect(world.patches[0]?.body).toEqual({ provider: 'p1', modelId: 'claude-opus-5-5' });
  await expect(setup).toHaveCount(0);
  await expect(page.getByTestId('home-c')).toBeVisible();
});

test('a Mac whose Linux VM is not downloaded offers it off by default, and downloads only when switched on', async ({ page }) => {
  const off = { ...fresh(), vm: true };
  await open(page, off);
  const row = page.getByTestId('first-run-vm');
  await expect(row).toContainText('Linux 虚拟机');
  await expect(row).toContainText('1.5 GB');
  await expect(row.getByRole('switch')).not.toBeChecked();
  await page.getByTestId('first-run-confirm').click();
  await expect(page.getByTestId('home-c')).toBeVisible();
  expect(off.installs).toBeUndefined();

  const on = { ...fresh(), vm: true };
  await open(page, on);
  await page.getByTestId('first-run-vm').getByRole('switch').click();
  await page.getByTestId('first-run-confirm').click();
  await expect.poll(() => on.installs).toEqual(['install']);
});

test('the change control opens the model picker, and confirming saves the model picked there', async ({ page }) => {
  const world = fresh();
  await open(page, world);
  const coordinator = page.getByTestId('first-run-pick-coordinator');
  await coordinator.getByRole('combobox').click();
  await page.getByRole('option', { name: 'Claude Sonnet 5.5' }).click();
  await expect(coordinator).toContainText('Claude Sonnet 5.5');
  expect(world.patches).toEqual([]);
  await page.getByTestId('first-run-confirm').click();
  await expect.poll(() => world.patches.map((p) => p.use)).toEqual(['coordinator']);
  expect(world.patches[0]?.body).toEqual({ provider: 'p1', modelId: 'claude-sonnet-5-5' });
});

test('without a provider, step 1 lists the providers on the page, and Claude Pro / Max opens its sign-in', async ({ page }) => {
  await open(page, { ...fresh(), bound: false });
  await expect(page.getByTestId('first-run-step-1')).toHaveAttribute('data-state', 'now');
  await expect(page.getByTestId('first-run-setup')).not.toContainText('本机 Claude Code');
  await expect(page.getByTestId('first-run-setup').getByRole('switch')).toHaveCount(0);
  await expect(page.getByTestId('local-provider-import')).toHaveCount(0);
  const picker = page.getByTestId('first-run-add-provider');
  await expect(picker.getByRole('textbox', { name: '搜索服务商...' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(/\/app(\?|$)/);
  await picker.locator('[data-preset-id="claude-subscription"]').click();
  await expect(page.getByRole('dialog', { name: '添加 Claude 订阅' })).toBeVisible();
});

test('the provider list starts below the language switch', async ({ page }) => {
  await open(page, { ...fresh(), bound: false });
  const search = page.getByTestId('first-run-add-provider').getByRole('textbox', { name: '搜索服务商...' });
  const language = page.locator('[data-testid="first-run-locale-en"]:visible');
  const searchBox = await search.boundingBox();
  const languageBox = await language.boundingBox();
  expect(searchBox).not.toBeNull();
  expect(languageBox).not.toBeNull();
  expect((languageBox?.y ?? 0) + (languageBox?.height ?? 0)).toBeLessThanOrEqual(searchBox?.y ?? 0);
});

test('a vendor opens its form in place, and Cancel goes back to the list', async ({ page }) => {
  await open(page, { ...fresh(), bound: false });
  const picker = page.getByTestId('first-run-add-provider');
  await picker.locator('[data-preset-id="anthropic"]').click();
  await expect(picker.getByLabel('API 密钥')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await picker.getByRole('button', { name: '取消' }).click();
  await expect(picker.locator('[data-preset-id="anthropic"]')).toBeVisible();
});

test('reloading the setup page never flashes the Coordinator home', async ({ page }) => {
  await open(page, { ...fresh(), bound: false });
  await expect(page.getByTestId('first-run-add-provider')).toBeVisible();
  await page.route('**/api/teams/t1/routing-settings', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.fallback();
  });
  await page.addInitScript(() => {
    const seen = { home: false };
    Object.assign(window, { __seen: seen });
    new MutationObserver(() => {
      if (document.querySelector('[data-route="board"], [data-testid="home-c"]')) seen.home = true;
    }).observe(document, { childList: true, subtree: true });
  });
  await page.reload();
  await expect(page.getByTestId('first-run-add-provider')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __seen: { home: boolean } }).__seen.home)).toBe(false);
});

test('the welcome side draws the ink spiral as far as the open step', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, { ...fresh(), bound: false });
  const spiral = page.getByTestId('first-run-setup').locator('[data-slot="ink-spiral"]');
  await expect(spiral).toBeVisible();
  await expect(spiral).toHaveAttribute('data-drawn', '0.33');
  await page.setViewportSize({ width: 1280, height: 800 });
  const rail = await page.getByTestId('first-run-setup').locator('ol').first().boundingBox();
  const drawn = await spiral.boundingBox();
  expect((rail?.y ?? 0) + (rail?.height ?? 0)).toBeLessThanOrEqual(drawn?.y ?? 0);
  await page.setViewportSize({ width: 1440, height: 680 });
  await expect(spiral).toBeHidden();
});

test('the language switch on the setup page changes the page language', async ({ page }) => {
  await open(page, fresh());
  await page.getByRole('radio', { name: 'English' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome to Cairn');
  await expect(page.getByTestId('first-run-confirm')).toHaveText('Confirm and start chatting');
});

test('the new-project dialog says which step is missing until setup is done', async ({ page }) => {
  await open(page, { ...fresh(), bound: false }, '/app/project/new');
  await expect(page.getByTestId('project-new-blocked')).toContainText('还差第 1 步：接入模型');
  await page.getByRole('button', { name: '去完成设置' }).click();
  await expect(page.getByTestId('first-run-setup')).toBeVisible();
});

test('setup cannot be skipped until the Coordinator has a model; a team with projects never sees the page', async ({ page }) => {
  await open(page, fresh());
  await expect(page.getByTestId('first-run-setup')).toBeVisible();
  await expect(page.getByTestId('first-run-skip')).toHaveCount(0);
  await expect(page.getByText('稍后再说')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('first-run-setup')).toBeVisible();
  await expect(page.getByTestId('home-c')).toHaveCount(0);

  const other = await page.context().newPage();
  await open(other, { ...fresh(), projects: [PROJECT] });
  await expect(other.getByTestId('home-c')).toBeVisible();
  await expect(other.getByTestId('first-run-setup')).toHaveCount(0);
});

test('a saved Claude subscription with Claude Code found is the Coordinator pick', async ({ page }) => {
  const world: World = { ...fresh(), bound: false, subscription: true, claudeCodeFound: true };
  await open(page, world);
  await expect(page.getByTestId('first-run-step-1')).toHaveAttribute('data-state', 'done');
  await expect(page.getByTestId('first-run-pick-coordinator')).toContainText('Claude Sonnet 5.5');
  await page.getByTestId('first-run-confirm').click();
  await expect.poll(() => world.patches.map((p) => p.use)).toEqual(['coordinator']);
  expect(world.patches[0]?.body).toEqual({ provider: 'claude-code', modelId: 'claude-sonnet-5-5' });
});

test('a saved subscription without Claude Code on this computer says what is missing', async ({ page }) => {
  await open(page, { ...fresh(), bound: false, subscription: true });
  await expect(page.getByTestId('first-run-step-1')).toHaveAttribute('data-state', 'now');
  await expect(page.getByTestId('first-run-setup')).toContainText('现在先添加一个服务商，Coordinator 就能开始工作');
});

const TWO = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
  { id: 'gone-model', name: 'Gone model' },
];

test('Import all keeps step 1 open and checks every imported provider before step 2', async ({ page }) => {
  const world: World = {
    ...fresh(),
    bound: false,
    local: [
      { providerId: 'relay', state: 'ready' },
      { providerId: 'gateway', state: 'ready' },
      { providerId: 'anthropic', state: 'needs-login' },
    ],
    verdicts: { 'p-gateway/claude-opus-5-5': { status: 'failed', failure: 'auth' } },
  };
  await open(page, world);
  const card = page.getByTestId('local-provider-import');
  await expect(card).toContainText('在这台 Mac 上找到 2 个服务商');
  await card.getByRole('button', { name: '全部导入' }).click();
  await expect.poll(() => world.created?.map((c) => [c.providerId, c.apiKey])).toEqual([
    ['relay', 'test-key-relay'],
    ['gateway', 'test-key-gateway'],
  ]);
  const list = page.getByTestId('first-run-provider-check');
  await expect(list).toContainText('导入了 2 个服务商');
  await expect(page.getByTestId('first-run-step-1')).toHaveAttribute('data-state', 'now');
  await expect(list.getByTestId('provider-check-relay')).toContainText('能用');
  const gateway = list.getByTestId('provider-check-gateway');
  await expect(gateway).toContainText('不能用');
  await expect(gateway).toContainText('密钥被拒绝');
  await gateway.getByRole('button', { name: '移除' }).click();
  await expect.poll(() => world.deleted).toEqual(['p-gateway']);
  await expect(gateway).toHaveCount(0);
  await list.getByRole('button', { name: '下一步：确认模型' }).click();
  await expect(page.getByTestId('first-run-step-2')).toHaveAttribute('data-state', 'now');
});

test('a provider with some broken models reads partly usable, and step 2 lists neither its broken model nor a rejected provider', async ({ page }) => {
  const world: World = {
    ...fresh(),
    bound: false,
    local: [
      { providerId: 'relay', state: 'ready', models: TWO },
      { providerId: 'gateway', state: 'ready', models: TWO },
    ],
    verdicts: {
      'p-relay/gone-model': { status: 'failed', failure: 'not-found' },
      'p-gateway/claude-opus-5-5': { status: 'failed', failure: 'auth' },
    },
  };
  await open(page, world);
  await page.getByTestId('local-provider-import').getByRole('button', { name: '全部导入' }).click();
  const relay = page.getByTestId('provider-check-relay');
  await expect(relay).toContainText('部分能用');
  await expect(relay).toContainText('gone-model');
  await expect(relay).toContainText('服务商没有这个模型');
  await page.getByRole('button', { name: '下一步：确认模型' }).click();
  await page.getByTestId('first-run-pick-coordinator').getByRole('combobox').click();
  await expect(page.getByRole('option', { name: 'Claude Opus 5.5' }).first()).toBeVisible();
  await expect(page.getByRole('option', { name: 'Gone model' })).toHaveCount(0);
});

test('Undo this import on the check list removes what it added and shows the provider list again', async ({ page }) => {
  const world: World = {
    ...fresh(),
    bound: false,
    local: [
      { providerId: 'relay', state: 'ready' },
      { providerId: 'gateway', state: 'ready' },
    ],
  };
  await open(page, world);
  await page.getByTestId('local-provider-import').getByRole('button', { name: '全部导入' }).click();
  await page.getByTestId('first-run-provider-check').getByRole('button', { name: '撤销这次导入' }).click();
  await expect.poll(() => world.deleted).toEqual(['p-relay', 'p-gateway']);
  await expect(page.getByTestId('first-run-provider-check')).toHaveCount(0);
  await expect(page.getByTestId('local-provider-import')).toContainText('在这台 Mac 上找到 2 个服务商');
});

test('confirming tries the picked model first and saves nothing when it does not answer', async ({ page }) => {
  const world: World = {
    ...fresh(),
    verdicts: { 'p1/claude-opus-5-5': { status: 'failed', failure: 'upstream' } },
  };
  await open(page, world);
  await page.getByTestId('first-run-confirm').click();
  await expect(page.getByTestId('first-run-pick-coordinator')).toContainText('服务商暂时没响应或额度用完');
  await expect.poll(() => world.tests).toContain('p1/claude-opus-5-5');
  expect(world.patches).toEqual([]);
});

test('Choose lists what was found; sign-in and already-added providers cannot be picked', async ({ page }) => {
  const world: World = {
    ...fresh(),
    bound: false,
    existing: ['gateway'],
    local: [
      { providerId: 'relay', state: 'ready' },
      { providerId: 'other', state: 'ready' },
      { providerId: 'gateway', state: 'ready' },
      { providerId: 'anthropic', state: 'needs-login' },
    ],
  };
  await open(page, world);
  const card = page.getByTestId('local-provider-import');
  await card.getByRole('button', { name: '选择' }).click();
  await expect(card.getByRole('checkbox', { name: 'anthropic' })).toBeDisabled();
  await expect(card).toContainText('要在 Cairn 里登录');
  await expect(card.getByRole('checkbox', { name: 'gateway' })).toBeDisabled();
  await expect(card).toContainText('已添加');
  await card.getByRole('checkbox', { name: 'other' }).click();
  await card.getByRole('button', { name: '导入 1 个' }).click();
  await expect.poll(() => world.created?.map((c) => c.providerId)).toEqual(['relay']);
});

test('the change menu groups models by provider name without a generic heading', async ({ page }) => {
  await open(page, fresh());
  await page.getByTestId('first-run-pick-coordinator').getByRole('combobox').click();
  const menu = page.locator('.routing-rule-model-menu:visible');
  await expect(menu.getByRole('option', { name: 'Claude Opus 5.5' })).toBeVisible();
  await expect(menu).not.toContainText('服务商');
  await expect(menu.getByText('Claude token', { exact: true })).toHaveCount(1);
});
