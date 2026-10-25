import { expect, type Page, test } from '@playwright/test';

const TEAM_WITH_SOURCES = '/app/team?scenario=agent-detail';
const TEAM_NO_SOURCES = '/app/team?scenario=12';

const TEAM_ID = 'team-1';

const STUB_MACHINE_ID = 'machine-cc-stub';
const STUB_MACHINE_NAME = 'stub-mea';

const CC_MODELS = [
  { id: 'claude-opus-4-5', name: 'claude-opus-4-5', slot: 'default' },
  { id: 'claude-sonnet-5', name: 'claude-sonnet-5', slot: 'sonnet' },
  { id: 'claude-haiku-4-5', name: 'claude-haiku-4-5', slot: 'haiku' },
];

async function stubLive(
  page: Page,
  opts: {
    hasSources: boolean;
    bodies: unknown[];
    models?: Array<{ id: string; name: string }>;
    withPiLeak?: boolean;
  },
) {
  await page.route('**/api/**', (route, request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && path === `/api/teams/${TEAM_ID}/agents`) {
      opts.bodies.push(JSON.parse(request.postData() ?? '{}'));
      return route.fulfill({ status: 201, json: { id: 'agent-new' } });
    }
    if (request.method() !== 'GET') return route.fallback();
    if (path === '/api/teams') {
      return route.fulfill({
        json: [{ id: TEAM_ID, name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null }],
      });
    }
    if (path === '/api/user/me') {
      return route.fulfill({ json: { id: 'user-1', displayName: '我', avatarUrl: null } });
    }
    if (path === `/api/teams/${TEAM_ID}/members`) {
      return route.fulfill({ json: [] });
    }
    if (path === `/api/teams/${TEAM_ID}/providers`) {

      return route.fulfill({ json: { presets: [], providers: [] } });
    }
    if (path === `/api/teams/${TEAM_ID}/machines`) {
      return route.fulfill({
        json: [
          {
            id: STUB_MACHINE_ID,
            teamId: TEAM_ID,
            name: STUB_MACHINE_NAME,
            online: true,
            latestCliVersion: null,
            kind: 'remote',
            enabledRuntimes: ['pi', 'claude-code'],
            shellEnabled: false,
            maxConcurrent: 3,
            runningSteps: 0,
          },
        ],
      });
    }
    if (path === `/api/teams/${TEAM_ID}/model-sources`) {
      const sources = opts.hasSources
        ? [

            {
              runtime: 'pi',
              installed: true,
              hostname: 'test-host',
              models: opts.withPiLeak
                ? [{ id: 'pi-sneak', name: 'Pi 段模型' }]
                : [{ id: 'claude-sonnet-5', name: 'Claude Sonnet 5（R3 网关）' }],
            },
            {
              runtime: 'claude-code',
              installed: true,
              hostname: 'test-host',
              machineId: STUB_MACHINE_ID,
              models: opts.models ?? CC_MODELS,
            },
          ]
        : [];
      return route.fulfill({ json: { sources } });
    }
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
}

async function openDialog(page: Page, teamUrl: string) {
  await page.goto(teamUrl);
  await page.getByRole('button', { name: '创建 Agent' }).click();

  const dialog = page.getByRole('dialog', { name: '创建 agent' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('no machines: shows the machine alert row with the `接入机器` external link, no pickers render', async ({ page }) => {
  const dialog = await openDialog(page, TEAM_NO_SOURCES);

  await expect(dialog.getByText('还没有接入机器')).toBeVisible();
  await expect(dialog.getByRole('link', { name: '接入机器' })).toBeVisible();
  await expect(dialog.locator('.dlg-agent-model-select')).toHaveCount(0);
  await expect(dialog.locator('.dlg-agent-runtime-select')).toHaveCount(0);
  await expect(dialog.locator('.dlg-agent-machine-select')).toHaveCount(0);
});

test('machines but no candidates: provider alert row degrades to informational, runtime/owner slots still render (pi creation unblocked)', async ({
  page,
}) => {
  const dialog = await openDialog(page, '/app/team?scenario=team-no-sources');
  await expect(dialog.locator('.dlg-agent-runtime-select')).toBeVisible();
  await expect(dialog.locator('.dlg-agent-machine-select')).toBeVisible();
  await expect(dialog.getByText('尚未配置模型服务商')).toBeVisible();
  await expect(dialog.getByRole('link', { name: '配置服务商' })).toBeVisible();

  await dialog.getByLabel('名称').fill('pi-only agent');
  await dialog.locator('.dlg-agent-machine-select').click();
  await page.locator('.dlg-agent-machine-row', { hasText: 'mea-wsl' }).click();
  await expect(dialog.getByRole('button', { name: '创建', exact: true })).toBeEnabled();
});

test('with candidates: no alert row, three-level picker renders and the model level is disabled first', async ({ page }) => {
  const dialog = await openDialog(page, TEAM_WITH_SOURCES);
  await expect(dialog.getByText('尚未配置模型服务商')).toHaveCount(0);
  await expect(dialog.locator('.dlg-agent-runtime-select')).toBeVisible();
  await expect(dialog.locator('.dlg-agent-machine-select')).toBeVisible();

  await expect(dialog.locator('.dlg-agent-model-select')).toBeDisabled();

  await dialog.locator('.dlg-agent-runtime-select').click();
  await page.locator('.dlg-agent-runtime-row', { hasText: 'Claude Code' }).click();
  await expect(dialog.locator('.dlg-agent-model-select')).toBeDisabled();
  await dialog.locator('.dlg-agent-machine-select').click();
  await page.locator('.dlg-agent-machine-row').first().click();
  await expect(dialog.locator('.dlg-agent-model-select')).toBeEnabled();
});

test('level one lists runtimes plus the built-in empty row, and the pi section enters candidates (#1288 reversal: no longer skipped)', async ({
  page,
}) => {
  await stubLive(page, { hasSources: true, bodies: [], withPiLeak: true });
  const dialog = await openDialog(page, '/app/team');
  await dialog.locator('.dlg-agent-runtime-select').click();
  const runtimeMenu = page.locator('.dlg-agent-runtime-menu');
  await expect(runtimeMenu).toBeVisible();

  await expect(runtimeMenu.locator('.dlg-agent-runtime-row').first()).toContainText('内置 (pi)');

  await expect(runtimeMenu.locator('.dlg-agent-runtime-row')).toHaveCount(3);

  await expect(runtimeMenu.locator('.dlg-agent-runtime-row', { hasText: 'pi' })).toHaveCount(2);
  await expect(runtimeMenu.locator('.dlg-agent-runtime-row', { hasText: 'Claude Code' })).toHaveCount(
    1,
  );

  await runtimeMenu.locator('.dlg-agent-runtime-row', { hasText: 'Claude Code' }).click();
  await dialog.locator('.dlg-agent-machine-select').click();
  await page.locator('.dlg-agent-machine-row', { hasText: STUB_MACHINE_NAME }).click();
  await dialog.locator('.dlg-agent-model-select').click();
  const modelMenu = page.locator('.dlg-agent-model-menu');
  await expect(modelMenu).toBeVisible();
  await expect(modelMenu.locator('.dlg-agent-model-row', { hasText: 'claude-sonnet-5' })).toHaveCount(
    1,
  );

  await expect(modelMenu).not.toContainText('pi-sneak');
});

test('model rows show only the model name: no provider badge, no invented context-window numbers', async ({ page }) => {
  const dialog = await openDialog(page, TEAM_WITH_SOURCES);
  await dialog.locator('.dlg-agent-runtime-select').click();
  await page.locator('.dlg-agent-runtime-row', { hasText: 'Claude Code' }).click();
  await dialog.locator('.dlg-agent-machine-select').click();
  await page.locator('.dlg-agent-machine-row', { hasText: 'mea-wsl' }).click();
  await dialog.locator('.dlg-agent-model-select').click();
  const menu = page.locator('.dlg-agent-model-menu');
  const row = menu.locator('.dlg-agent-model-row', { hasText: 'claude-sonnet-5' });
  await expect(row).toHaveCount(1);

  await expect(row).not.toContainText('Claude Code');
  await expect(menu).not.toContainText('128k');
});

test('create dialog: both menu levels fit entirely within the viewport (geometry)', async ({ page }) => {
  const dialog = await openDialog(page, TEAM_WITH_SOURCES);
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  if (viewport === null) return;

  await dialog.locator('.dlg-agent-runtime-select').click();
  const runtimeMenu = page.locator('.dlg-agent-runtime-menu');
  await expect(runtimeMenu).toBeVisible();
  const rb = await runtimeMenu.boundingBox();
  expect(rb).not.toBeNull();
  if (rb !== null) {
    expect(rb.y).toBeGreaterThanOrEqual(-0.5);
    expect(rb.x).toBeGreaterThanOrEqual(-0.5);
    expect(rb.y + rb.height).toBeLessThanOrEqual(viewport.height + 0.5);
    expect(rb.x + rb.width).toBeLessThanOrEqual(viewport.width + 0.5);
  }
  await runtimeMenu.locator('.dlg-agent-runtime-row', { hasText: 'Claude Code' }).click();

  await dialog.locator('.dlg-agent-machine-select').click();
  await page.locator('.dlg-agent-machine-row', { hasText: 'mea-wsl' }).click();
  await dialog.locator('.dlg-agent-model-select').click();
  const modelMenu = page.locator('.dlg-agent-model-menu');
  await expect(modelMenu).toBeVisible();
  const mb = await modelMenu.boundingBox();
  expect(mb).not.toBeNull();
  if (mb === null) return;
  expect(mb.y).toBeGreaterThanOrEqual(-0.5);
  expect(mb.x).toBeGreaterThanOrEqual(-0.5);
  expect(mb.y + mb.height).toBeLessThanOrEqual(viewport.height + 0.5);
  expect(mb.x + mb.width).toBeLessThanOrEqual(viewport.width + 0.5);
});

const MANY_MODELS = Array.from({ length: 40 }, (_, i) => {
  const id = `vendor/model-${String(i + 1).padStart(2, '0')}`;
  return { id, name: id };
});

test('many models: after picking a runtime the menu stays in the viewport, first row clickable, all 40 rows present', async ({ page }) => {
  await stubLive(page, { hasSources: true, bodies: [], models: MANY_MODELS });
  const dialog = await openDialog(page, '/app/team');
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  if (viewport === null) return;
  await dialog.locator('.dlg-agent-runtime-select').click();
  await page.locator('.dlg-agent-runtime-row', { hasText: 'Claude Code' }).click();
  await dialog.locator('.dlg-agent-machine-select').click();
  await page.locator('.dlg-agent-machine-row', { hasText: STUB_MACHINE_NAME }).click();
  await dialog.locator('.dlg-agent-model-select').click();
  const menu = page.locator('.dlg-agent-model-menu');
  await expect(menu).toBeVisible();

  const mb = await menu.boundingBox();
  expect(mb).not.toBeNull();
  if (mb === null) return;
  expect(mb.y).toBeGreaterThanOrEqual(-0.5);
  expect(mb.y + mb.height).toBeLessThanOrEqual(viewport.height + 0.5);

  await expect(page.locator('.dlg-agent-model-row')).toHaveCount(MANY_MODELS.length + 1);

  const firstModel = page.locator('.dlg-agent-model-row', { hasText: 'vendor/model-01' });
  await firstModel.click({ timeout: 5000 });
  await expect(dialog.locator('.dlg-agent-model-select')).toContainText('vendor/model-01');

  await dialog.locator('.dlg-agent-model-select').click();
  const rows = page.locator('.dlg-agent-model-row');
  await rows.nth(MANY_MODELS.length).click({ timeout: 5000 });
  await expect(dialog.locator('.dlg-agent-model-select')).toContainText('vendor/model-40');
});

test('submitting with runtime and model selected: POST body carries provider and modelId', async ({ page }) => {
  const bodies: unknown[] = [];
  await stubLive(page, { hasSources: true, bodies });
  const dialog = await openDialog(page, '/app/team');
  await dialog.getByLabel('名称').fill('带模型的 agent');
  await dialog.locator('.dlg-agent-runtime-select').click();
  await page.locator('.dlg-agent-runtime-row', { hasText: 'Claude Code' }).click();
  await dialog.locator('.dlg-agent-machine-select').click();
  await page.locator('.dlg-agent-machine-row', { hasText: STUB_MACHINE_NAME }).click();
  await dialog.locator('.dlg-agent-model-select').click();
  await page.locator('.dlg-agent-model-row', { hasText: 'claude-sonnet-5' }).click();
  await dialog.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '创建 agent' })).toBeHidden();
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({
    displayName: '带模型的 agent',
    provider: 'claude-code',
    modelId: 'claude-sonnet-5',
    machineId: STUB_MACHINE_ID,
  });
});

test('submitting with only runtime and owner machine: body carries provider, machineId, modelId null (half state keeps fields)', async ({
  page,
}) => {
  const bodies: unknown[] = [];
  await stubLive(page, { hasSources: true, bodies });
  const dialog = await openDialog(page, '/app/team');
  await dialog.getByLabel('名称').fill('半态 agent');
  await dialog.locator('.dlg-agent-runtime-select').click();
  await page.locator('.dlg-agent-runtime-row', { hasText: 'Claude Code' }).click();

  await expect(dialog.getByRole('button', { name: '创建', exact: true })).toBeDisabled();
  await dialog.locator('.dlg-agent-machine-select').click();
  await page.locator('.dlg-agent-machine-row', { hasText: STUB_MACHINE_NAME }).click();
  await dialog.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '创建 agent' })).toBeHidden();
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({
    displayName: '半态 agent',
    provider: 'claude-code',
    modelId: null,
    machineId: STUB_MACHINE_ID,
  });
});

test('switching runtime clears the stale model: body carries no cross-provider dirty modelId', async ({ page }) => {
  const bodies: unknown[] = [];
  await stubLive(page, { hasSources: true, bodies });
  const dialog = await openDialog(page, '/app/team');
  await dialog.getByLabel('名称').fill('换运行时 agent');
  await dialog.locator('.dlg-agent-runtime-select').click();
  await page.locator('.dlg-agent-runtime-row', { hasText: 'Claude Code' }).click();
  await dialog.locator('.dlg-agent-machine-select').click();
  await page.locator('.dlg-agent-machine-row', { hasText: STUB_MACHINE_NAME }).click();
  await dialog.locator('.dlg-agent-model-select').click();
  await page.locator('.dlg-agent-model-row', { hasText: 'claude-sonnet-5' }).click();

  await dialog.locator('.dlg-agent-runtime-select').click();
  await page.locator('.dlg-agent-runtime-row', { hasText: '内置 (pi)' }).click();
  await expect(dialog.locator('.dlg-agent-model-select')).not.toContainText('claude-sonnet-5');
  await expect(dialog.getByRole('button', { name: '创建', exact: true })).toBeDisabled();
  await dialog.locator('.dlg-agent-machine-select').click();
  await page.locator('.dlg-agent-machine-row', { hasText: STUB_MACHINE_NAME }).click();
  await dialog.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '创建 agent' })).toBeHidden();
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({ provider: null, modelId: null, machineId: STUB_MACHINE_ID });
});
