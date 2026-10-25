import { expect, type Locator, type Page, test } from '@playwright/test';

const DETAIL = '/app/resources/agents/r3-builder?scenario=agent-detail';
const MEMORY_DETAIL = '/app/resources/agents/r3-builder?scenario=agent-detail-memory';
const TEAM = '/app/team?scenario=agent-detail';

async function openDetail(page: Page) {
  await page.goto(DETAIL);
  return page.locator('.agent-detail');
}

async function openMemory(page: Page) {
  await page.goto(MEMORY_DETAIL);
  const detail = page.locator('.agent-detail');
  await detail.locator('.agent-tab').nth(1).click();
  return detail;
}

async function memoryTitles(page: Page): Promise<string[]> {
  return page.locator('.agent-memory-title').allTextContents();
}

test('team page Agent cards are links, click lands on the detail route', async ({ page }) => {
  await page.goto(TEAM);

  await page.getByTestId('team-agent-card').filter({ hasText: 'r3-builder' }).click();
  await expect(page).toHaveURL(DETAIL);
  await expect(page.locator('.agent-detail')).toBeVisible();
});

test('detail route opens directly from a deep link, no catch-all', async ({ page }) => {
  const detail = await openDetail(page);
  await expect(detail).toBeVisible();

  await expect(page.getByRole('heading', { level: 1, name: 'r3-builder' })).toHaveText(
    'r3-builder',
  );
});

test('three tabs all present, overview selected by default, clicking memory switches content', async ({ page }) => {
  const detail = await openDetail(page);
  const tabs = detail.locator('.agent-tab');
  await expect(tabs).toHaveCount(3);
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect(detail.locator('.agent-overview')).toBeVisible();

  await tabs.nth(1).click();
  await expect(detail.locator('.agent-memories')).toBeVisible();
  await expect(detail.locator('.agent-overview')).toHaveCount(0);

  await tabs.nth(2).click();
  await expect(detail.locator('.agent-perms')).toBeVisible();
});

test('overview: inline name edit submits and echoes the new value', async ({ page }) => {
  const detail = await openDetail(page);
  await detail.locator('.agent-name-edit').click();
  const input = detail.locator('#agent-name-input');
  await expect(input).toBeVisible();
  await input.fill('r3-renamed');
  await input.press('Enter');
  await expect(detail.locator('.agent-name')).toHaveText('r3-renamed');
});

test('overview: duty slot renders the canon empty state and is editable', async ({ page }) => {
  const detail = await openDetail(page);
  await expect(detail.locator('.agent-role-text')).toHaveText('未设置职责');
  await detail.locator('.agent-role-edit').click();
  const input = detail.locator('#agent-role-input');
  await input.fill('负责构建与合并');
  await detail.locator('.agent-role-save').click();
  await expect(detail.locator('.agent-role-text')).toHaveText('负责构建与合并');
});

test('overview: existing provider binding shows the raw string, level one lists only built-in rows and runtime sources', async ({ page }) => {
  const detail = await openDetail(page);
  const runtimeTrigger = detail.locator('.agent-runtime-select');

  await expect(runtimeTrigger).toContainText('r3-gw');
  await runtimeTrigger.click();
  const runtimeMenu = page.locator('.agent-runtime-menu');
  await expect(runtimeMenu).toBeVisible();

  await expect(runtimeMenu.locator('.agent-runtime-row').first()).toContainText('内置 (pi)');
  await expect(runtimeMenu.locator('.agent-runtime-row', { hasText: 'r3-gw' })).toHaveCount(0);
  await expect(runtimeMenu.locator('.agent-runtime-row', { hasText: 'Claude Code' })).toHaveCount(1);
  await page.keyboard.press('Escape');

  await detail.locator('.agent-runtime-select').click();
  await page.locator('.agent-runtime-row', { hasText: 'Claude Code' }).click();
  await expect(detail.locator('.agent-runtime-select')).toContainText('Claude Code');
  await detail.locator('.agent-model-select').click();
  const menu = page.locator('.agent-model-menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.agent-model-row').first()).toHaveText(/未设置模型/);
  await expect(menu.locator('.agent-model-row', { hasText: 'claude-haiku-4-5' })).toHaveCount(1);
  await page.keyboard.press('Escape');
  await detail.locator('.agent-runtime-select').click();
  await expect(
    page.locator('.agent-runtime-menu .agent-runtime-row', { hasText: 'r3-gw' }),
  ).toHaveCount(0);
});

test('overview: two-level menu anchors on the trigger button and fits in the viewport (geometry)', async ({ page }) => {
  const detail = await openDetail(page);
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  if (viewport === null) return;

  for (const prefix of ['agent-runtime', 'agent-model']) {
    const trigger = detail.locator(`.${prefix}-select`);
    await trigger.click();
    const menu = page.locator(`.${prefix}-menu`);
    await expect(menu).toBeVisible();

    await page.waitForTimeout(150);
    const tb = await trigger.boundingBox();
    const mb = await menu.boundingBox();
    expect(tb).not.toBeNull();
    expect(mb).not.toBeNull();
    if (tb === null || mb === null) return;

    expect(mb.x).toBeLessThan(tb.x + tb.width);
    expect(mb.x + mb.width).toBeGreaterThan(tb.x);

    expect(mb.y).toBeLessThanOrEqual(tb.y + tb.height + 8);
    expect(mb.y + mb.height).toBeGreaterThanOrEqual(tb.y - 8);

    expect(mb.x).toBeGreaterThanOrEqual(-0.5);
    expect(mb.y).toBeGreaterThanOrEqual(-0.5);
    expect(mb.x + mb.width).toBeLessThanOrEqual(viewport.width + 0.5);
    expect(mb.y + mb.height).toBeLessThanOrEqual(viewport.height + 0.5);
    await page.keyboard.press('Escape');
  }
});

test('overview: empty thinking level is the `未设置` dropdown', async ({ page }) => {
  const detail = await openDetail(page);
  const thinking = detail.locator('.agent-thinking-select');
  await expect(thinking).toContainText('未设置');
  await expect(thinking).toHaveRole('combobox');
});

test('overview: no `状态` row', async ({ page }) => {
  const detail = await openDetail(page);
  expect(await detail.locator('.agent-field-label').allTextContents()).not.toContain('状态');
  await expect(detail.locator('.agent-status')).toHaveCount(0);
});

test('memory tab: empty state = icon + title + description', async ({ page }) => {
  const detail = await openDetail(page);
  await detail.locator('.agent-tab').nth(1).click();
  const empty = detail.locator('.agent-memory-empty');
  await expect(empty.locator('svg')).toHaveCount(1);
  await expect(empty.getByRole('heading', { name: '尚无记忆' })).toBeVisible();
  await expect(empty).toContainText('Agent 会在工作中将值得沉淀的经验存入此处。');
});

test('permissions tab: all 6 tool switches render (r3 §4 full list, XMON-84 restored)', async ({ page }) => {
  const detail = await openDetail(page);
  await detail.locator('.agent-tab').nth(2).click();
  await expect(detail.locator('.agent-tool-switch')).toHaveCount(6);
});

test('permissions tab: each of the 6 tiers carries a description subline', async ({ page }) => {
  const detail = await openDetail(page);
  await detail.locator('.agent-tab').nth(2).click();
  const hints = detail.locator('.agent-perm-group').first().locator('.agent-perm-hint');
  await expect(hints).toHaveCount(6);
  await expect(hints.nth(1)).toHaveText(
    '允许该 Agent 通过合并分支进行发布（例如将 develop 合并进 main）。',
  );
  await expect(hints.nth(5)).toHaveText('允许该 Agent 修改团队技能库中已有的技能。');
});

test('overview: runtime tier sits above the model, value derived from provider', async ({ page }) => {
  const detail = await openDetail(page);
  const runtime = detail.locator('.agent-runtime-select');
  await expect(runtime).toContainText('r3-gw');
  const labels = detail.locator('.agent-field-label');
  const texts = await labels.allTextContents();
  expect(texts.indexOf('运行时')).toBeGreaterThan(-1);
  expect(texts.indexOf('运行时')).toBeLessThan(texts.indexOf('模型'));
});

test('permissions tab: tool switches can be toggled', async ({ page }) => {
  const detail = await openDetail(page);
  await detail.locator('.agent-tab').nth(2).click();
  const first = detail.locator('.agent-tool-switch').first();
  await expect(first).toHaveAttribute('aria-checked', 'false');
  await first.click();
  await expect(first).toHaveAttribute('aria-checked', 'true');
});

test('permissions tab: MCP servers render as per-server check rows', async ({ page }) => {
  const detail = await openDetail(page);
  await detail.locator('.agent-tab').nth(2).click();
  await expect(detail.locator('.agent-mcp-row').first()).toBeVisible();
});

const DETAIL_SECRETS = '/app/resources/agents/r3-builder?scenario=agent-detail-secrets';

test('permissions tab: with secrets, the secret section has exactly one master switch row', async ({ page }) => {
  await page.goto(DETAIL_SECRETS);
  await page.locator('.agent-tab').nth(2).click();
  await expect(page.locator('.agent-secret-row')).toHaveCount(1);
  await expect(page.locator('.agent-secret-switch')).toHaveCount(1);
  await expect(page.locator('.agent-secret-name')).toHaveText('团队密钥');

  await expect(page.locator('.agent-secret-hint')).toHaveText(
    '任务执行时，该 Agent 可在需要密钥的执行步中按需取用团队密钥，每次取用都会留下记录；密钥不预置进 shell 环境。所在机器需要 cairn CLI 0.1.28 及以上。',
  );
});

test('permissions tab: master switch toggles on→off→back', async ({ page }) => {
  await page.goto(DETAIL_SECRETS);
  await page.locator('.agent-tab').nth(2).click();
  const sw = page.locator('.agent-secret-switch');
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
});

test('permissions tab: zero secrets is an empty state, no switch', async ({ page }) => {
  const detail = await openDetail(page);
  await detail.locator('.agent-tab').nth(2).click();
  await expect(detail.locator('.agent-perm-empty')).toHaveText('暂无团队密钥。');
  await expect(detail.locator('.agent-secret-switch')).toHaveCount(0);
  await expect(detail.locator('.agent-secret-row')).toHaveCount(0);
});

test('permissions tab: zero-secret empty state has an entry to add secrets, click lands on the secrets page', async ({ page }) => {
  const detail = await openDetail(page);
  await detail.locator('.agent-tab').nth(2).click();
  const entry = detail.locator('.agent-secret-add');
  await expect(entry).toBeVisible();
  await expect(entry).toHaveText('去添加密钥');
  await entry.click();
  await expect(page).toHaveURL(/\/app\/resources\/secrets/);
  await expect(page.getByRole('heading', { level: 1, name: '密钥' })).toHaveText('密钥');
});

test('permissions tab: with secrets, no `去添加密钥` entry', async ({ page }) => {
  await page.goto(DETAIL_SECRETS);
  await page.locator('.agent-tab').nth(2).click();
  await expect(page.locator('.agent-secret-row')).toHaveCount(1);
  await expect(page.locator('.agent-secret-add')).toHaveCount(0);
});

const LIVE_AGENT = {
  id: 'agent-1',
  displayName: 'live-builder',
  description: null,
  status: 'active',
  avatarUrl: null,
  provider: null,
  modelId: null,
  thinkingLevel: null,
  tools: [],
  secrets: [],
  defaultSkill: null,
  skillsAllowlist: null,
  mcpServers: [],
};

async function stubLiveBoot(page: Page) {
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.route('**/api/teams', (route) =>
    route.fulfill({
      json: [{ id: 'team-1', name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null }],
    }),
  );
  await page.route('**/api/user/me', (route) =>
    route.fulfill({ json: { id: 'user-1', displayName: '我', avatarUrl: null } }),
  );
}

const PI_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const CC_THINKING_LEVELS = ['off', 'low', 'medium', 'high', 'xhigh', 'max'];

async function stubThinkingAgent(page: Page, initial: typeof LIVE_AGENT, withSources = false) {
  await stubLiveBoot(page);
  const patches: Record<string, unknown>[] = [];
  let agent: typeof LIVE_AGENT = { ...initial };
  await page.route('**/api/capabilities', (route) =>
    route.fulfill({ json: { thinkingLevels: PI_THINKING_LEVELS } }),
  );
  if (withSources) {
    await page.route('**/api/teams/team-1/model-sources', (route) =>
      route.fulfill({
        json: {
          sources: [
            {
              runtime: 'claude-code',
              installed: true,
              hostname: 'repro-host',
              machineId: 'machine-1',
              models: [{ id: 'claude-haiku-4-5', name: 'claude-haiku-4-5' }],
            },
          ],
        },
      }),
    );
  }
  await page.route('**/api/teams/team-1/agents/agent-1', (route) => {
    const req = route.request();
    if (req.method() === 'PATCH') {
      const body = req.postDataJSON() as Record<string, unknown>;
      patches.push(body);
      agent = { ...agent, ...body } as typeof LIVE_AGENT;
      return route.fulfill({ json: agent });
    }
    return route.fulfill({ json: agent });
  });
  return patches;
}

test('thinking level: empty value is the `未设置` dropdown option, picking a tier PATCHes thinkingLevel and it survives reload', async ({
  page,
}) => {
  const patches = await stubThinkingAgent(page, {
    ...LIVE_AGENT,
    provider: null,
    thinkingLevel: null,
  });
  await page.goto('/app/resources/agents/agent-1');
  const select = page.locator('.agent-thinking-select');
  await expect(select).toContainText('未设置');
  await select.click();
  await expect(page.getByRole('listbox').getByRole('option')).toHaveText([
    '未设置',
    ...PI_THINKING_LEVELS,
  ]);
  await page.getByRole('option', { name: 'high', exact: true }).click();

  await expect.poll(() => patches.at(-1)).toEqual({ thinkingLevel: 'high' });
  await expect(select).toContainText('high');
  await page.reload();
  await expect(page.locator('.agent-thinking-select')).toContainText('high');
  await page.locator('.agent-thinking-select').click();
  await page.getByRole('option', { name: '未设置', exact: true }).click();
  await expect.poll(() => patches.at(-1)).toEqual({ thinkingLevel: null });
});

test('thinking level: claude-code menu contains off, not minimal', async ({ page }) => {
  await stubThinkingAgent(page, {
    ...LIVE_AGENT,
    provider: 'claude-code',
    thinkingLevel: null,
  });
  await page.goto('/app/resources/agents/agent-1');
  await page.locator('.agent-thinking-select').click();
  await expect(page.getByRole('listbox').getByRole('option')).toHaveText([
    '未设置',
    ...CC_THINKING_LEVELS,
  ]);
});

test('thinking level: switching to claude-code clears illegal tiers with the model, keeps legal ones', async ({ page }) => {
  const illegal = await stubThinkingAgent(
    page,
    { ...LIVE_AGENT, provider: null, thinkingLevel: 'minimal' },
    true,
  );
  await page.goto('/app/resources/agents/agent-1');
  await page.locator('.agent-runtime-select').click();
  await page.locator('.agent-runtime-row', { hasText: 'Claude Code' }).click();
  await expect.poll(() => illegal.at(-1)).toEqual({
    provider: 'claude-code',
    modelId: null,
    thinkingLevel: null,
  });

  const legal = await stubThinkingAgent(
    page,
    { ...LIVE_AGENT, provider: null, thinkingLevel: 'high' },
    true,
  );
  await page.goto('/app/resources/agents/agent-1');
  await page.locator('.agent-runtime-select').click();
  await page.locator('.agent-runtime-row', { hasText: 'Claude Code' }).click();
  await expect.poll(() => legal.at(-1)).toEqual({ provider: 'claude-code', modelId: null });
});

test('permissions tab: save failure shows visible error feedback, switches do not bounce back', async ({ page }) => {
  await stubLiveBoot(page);
  let patches = 0;
  await page.route('**/api/teams/team-1/agents/agent-1', (route) => {
    if (route.request().method() === 'PATCH') {
      patches += 1;
      return route.fulfill({ status: 500, json: { error: 'boom' } });
    }
    return route.fulfill({ json: LIVE_AGENT });
  });

  await page.goto('/app/resources/agents/agent-1');
  await page.locator('.agent-tab').nth(2).click();
  const sw = page.locator('.agent-tool-switch').first();
  await expect(sw).toHaveAttribute('aria-checked', 'false');

  await sw.click();

  await expect.poll(() => patches).toBe(1);
  const error = page.locator('.agent-perm-error');
  await expect(error).toBeVisible();
  await expect(error).toHaveText('保存失败，请重试。');

  await expect(sw).toHaveAttribute('aria-checked', 'false');
});

test('permissions tab: successful save leaves no error row', async ({ page }) => {
  await stubLiveBoot(page);
  await page.route('**/api/teams/team-1/agents/agent-1', (route) => {
    if (route.request().method() === 'PATCH') return route.fulfill({ json: LIVE_AGENT });
    return route.fulfill({ json: LIVE_AGENT });
  });

  await page.goto('/app/resources/agents/agent-1');
  await page.locator('.agent-tab').nth(2).click();
  await page.locator('.agent-tool-switch').first().click();
  await expect(page.locator('.agent-perm-error')).toHaveCount(0);
});

test('authorized skills: unrestricted ↔ unchecked map to explicit null/[]; checked items enter the array slot only', async ({ page }) => {
  await stubLiveBoot(page);
  const patches: Record<string, unknown>[] = [];
  let agent: typeof LIVE_AGENT = { ...LIVE_AGENT };
  await page.route('**/api/skills**', (route) =>
    route.fulfill({
      json: [
        { id: 'skill-a', teamId: 'team-1', name: 'skill-a', description: null },
        { id: 'skill-b', teamId: 'team-1', name: 'skill-b', description: null },
      ],
    }),
  );
  await page.route('**/api/teams/team-1/agents/agent-1', (route) => {
    const req = route.request();
    if (req.method() === 'PATCH') {
      const body = req.postDataJSON() as Record<string, unknown>;
      patches.push(body);
      agent = { ...agent, ...body } as typeof LIVE_AGENT;
      return route.fulfill({ json: agent });
    }
    return route.fulfill({ json: agent });
  });

  await page.goto('/app/resources/agents/agent-1');
  await page.locator('.agent-tab').nth(2).click();

  const master = page.locator('.agent-allowlist-switch');
  await expect(master).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.agent-allowlist-row')).toHaveCount(0);

  await master.click();
  await expect.poll(() => patches.at(-1)).toEqual({ skillsAllowlist: [] });
  await expect(master).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('.agent-allowlist-row')).toHaveCount(2);

  await page.locator('.agent-allowlist-skill-switch').first().click();
  await expect.poll(() => patches.at(-1)).toEqual({ skillsAllowlist: ['skill-a'] });

  await master.click();
  await expect.poll(() => patches.at(-1)).toEqual({ skillsAllowlist: null });
  await expect(page.locator('.agent-allowlist-row')).toHaveCount(0);
});

test('default skill: single-value Select writes only the defaultSkill slot, no permission-face keys (the two controls do not interfere)', async ({ page }) => {
  await stubLiveBoot(page);
  const patches: Record<string, unknown>[] = [];
  let agent: typeof LIVE_AGENT = { ...LIVE_AGENT };
  await page.route('**/api/skills**', (route) =>
    route.fulfill({
      json: [
        { id: 'skill-a', teamId: 'team-1', name: 'skill-a', description: null },
      ],
    }),
  );
  await page.route('**/api/teams/team-1/agents/agent-1', (route) => {
    const req = route.request();
    if (req.method() === 'PATCH') {
      const body = req.postDataJSON() as Record<string, unknown>;
      patches.push(body);
      agent = { ...agent, ...body } as typeof LIVE_AGENT;
      return route.fulfill({ json: agent });
    }
    return route.fulfill({ json: agent });
  });

  await page.goto('/app/resources/agents/agent-1');

  const select = page.locator('.agent-skill-select');
  await expect(select).toContainText('未设置');
  await select.click();
  await page.getByRole('option', { name: 'skill-a' }).click();
  await expect.poll(() => patches.at(-1)).toEqual({ defaultSkill: 'skill-a' });
  await expect(select).toContainText('skill-a');

  await select.click();
  await page.getByRole('option', { name: '未设置' }).click();
  await expect.poll(() => patches.at(-1)).toEqual({ defaultSkill: null });
});

test('unknown agent id does not white-screen, falls back to the fallback presentation', async ({ page }) => {
  await page.goto('/app/resources/agents/no-such-agent?scenario=agent-detail');
  await expect(page.locator('.agent-missing')).toBeVisible();
});

test('memory tab: quota header `记忆 · n / 100` plus search/sort controls all present', async ({ page }) => {
  const detail = await openMemory(page);
  await expect(detail.locator('.agent-memory-head')).toHaveText('记忆 · 3 / 100');
  await expect(detail.locator('.agent-memory-search input')).toHaveAttribute(
    'placeholder',
    '搜索记忆…',
  );
  await expect(detail.locator('.agent-memory-sort')).toContainText('排序');
  await expect(detail.locator('.agent-memory-row')).toHaveCount(3);
});

test('memory tab: search filters by title, only matching rows remain', async ({ page }) => {
  const detail = await openMemory(page);
  await detail.locator('.agent-memory-search input').fill('历史轮次');
  await expect(detail.locator('.agent-memory-row')).toHaveCount(1);
  await expect(detail.locator('.agent-memory-title')).toHaveText('PROBE 探针的历史轮次');
});

test('memory tab: search scans content and is ASCII case-insensitive', async ({ page }) => {
  const detail = await openMemory(page);
  await detail.locator('.agent-memory-search input').fill('probe');
  await expect(detail.locator('.agent-memory-row')).toHaveCount(2);
  expect(await memoryTitles(page)).toEqual(['验收只看真机跑通', 'PROBE 探针的历史轮次']);
});

test('memory tab: zero hits show `没有匹配的记忆。`, no fallback to the canon empty state', async ({ page }) => {
  const detail = await openMemory(page);
  await detail.locator('.agent-memory-search input').fill('不存在的词');
  await expect(detail.locator('.agent-memory-row')).toHaveCount(0);
  await expect(
    detail.locator('.agent-memory-no-match').getByRole('heading', { name: '没有匹配的记忆' }),
  ).toBeVisible();
  await expect(detail.locator('.agent-memory-empty')).toHaveCount(0);

  await expect(detail.locator('.agent-memory-head')).toHaveText('记忆 · 3 / 100');
});

test('memory tab: `添加时间` tier reorders newest → oldest', async ({ page }) => {
  const detail = await openMemory(page);
  expect(await memoryTitles(page)).toEqual([
    '构建分支的命名规律',
    '验收只看真机跑通',
    'PROBE 探针的历史轮次',
  ]);
  await detail.locator('.agent-memory-sort').click();

  await page
    .locator('.agent-memory-sort-menu')
    .getByRole('menuitemradio', { name: '添加时间' })
    .click();
  expect(await memoryTitles(page)).toEqual([
    'PROBE 探针的历史轮次',
    '验收只看真机跑通',
    '构建分支的命名规律',
  ]);
});

test('memory tab: search and sort compose — sort applies within the hit set only', async ({ page }) => {
  const detail = await openMemory(page);
  await detail.locator('.agent-memory-search input').fill('probe');
  await detail.locator('.agent-memory-sort').click();

  await page
    .locator('.agent-memory-sort-menu')
    .getByRole('menuitemradio', { name: '添加时间' })
    .click();
  await expect(detail.locator('.agent-memory-row')).toHaveCount(2);
  expect(await memoryTitles(page)).toEqual(['PROBE 探针的历史轮次', '验收只看真机跑通']);
});

test('memory tab: zero memories shows no search row, canon empty state kept', async ({ page }) => {
  const detail = await openDetail(page);
  await detail.locator('.agent-tab').nth(1).click();
  await expect(detail.locator('.agent-memory-empty')).toBeVisible();
  await expect(detail.locator('.agent-memory-search')).toHaveCount(0);
  await expect(detail.locator('.agent-memory-head')).toHaveText('记忆 · 0 / 100');
});

test('overview: header `编辑名称` enters edit mode, cancel restores the original name', async ({ page }) => {
  const detail = await openDetail(page);
  const edit = detail.locator('.agent-name-edit');
  await expect(edit).toHaveText('编辑名称');
  await edit.click();
  const input = detail.locator('#agent-name-input');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('r3-builder');
  await input.fill('不保存');
  await detail.getByRole('button', { name: '取消' }).click();
  await expect(input).toHaveCount(0);
  await expect(detail.locator('.agent-name')).toHaveText('r3-builder');
});

test('overview: duty edit button is an icon button with an accessible name', async ({ page }) => {
  const detail = await openDetail(page);
  const edit = detail.locator('.agent-role-edit');
  await expect(edit).toHaveAttribute('aria-label', '编辑');
  await expect(edit.locator('svg')).toHaveCount(1);
  await edit.click();
  await expect(detail.locator('#agent-role-input')).toBeVisible();
});

test('overview: zero running tasks → section header has no count, canon empty state shows', async ({ page }) => {
  const detail = await openDetail(page);
  await expect(detail.locator('.agent-tasks-head')).toHaveText('进行中');
  await expect(detail.locator('.agent-tasks-empty')).toHaveText('暂无进行中的任务');
  await expect(detail.locator('.agent-task-row')).toHaveCount(0);
});

test('overview: with running tasks rows are listed, section header carries the count', async ({ page }) => {
  await page.goto(`${DETAIL.replace('agent-detail', 'agent-detail-active')}`);
  const detail = page.locator('.agent-detail');
  await expect(detail.locator('.agent-tasks-head')).toHaveText('进行中 · 2');
  await expect(detail.locator('.agent-tasks-empty')).toHaveCount(0);

  const rows = detail.locator('.agent-task-row');
  await expect(rows).toHaveCount(2);

  await expect(rows.nth(0).locator('.agent-task-seq')).toHaveText('#12');
  await expect(rows.nth(0).locator('.agent-task-title')).toHaveText(
    'README 文档目录 + 新建 CHANGELOG.md + scripts/',
  );

  await expect(rows.nth(0).locator('[data-tone="idle"]')).toHaveText('排队中');

  await expect(rows.nth(1).locator('.agent-task-seq')).toHaveText('#13');
  await expect(rows.nth(1).locator('[data-tone="plan"]')).toHaveText('执行中');
  await expect(rows.nth(1).locator('.agent-task-go svg')).toHaveCount(1);
});

test('overview: clicking a row enters task detail', async ({ page }) => {
  await page.goto(`${DETAIL.replace('agent-detail', 'agent-detail-active')}`);
  await page.locator('.agent-task-row').first().click();
  await expect(page).toHaveURL(/\/app\/todo\/r3-legacy-12$/);
});

const OVERVIEW_LABELS = ['职责', '默认 skill', '运行时', '模型', '思考强度'];

test('overview: the five field rows live in the same template card, avatar and name above the card', async ({ page }) => {
  const detail = await openDetail(page);
  const card = detail.locator('.agent-overview .settings-card');
  await expect(card).toHaveCount(1);
  await expect(card.locator('.settings-avatar')).toHaveCount(0);
  const avatarImg = detail.locator('.agent-overview .settings-header .settings-avatar img');
  await expect(avatarImg).toHaveCount(1);

  const avatarGeom = await avatarImg.evaluate((el) => ({
    w: el.offsetWidth,
    h: el.offsetHeight,
  }));
  expect(avatarGeom.w).toBe(56);
  expect(avatarGeom.h).toBe(56);
  await expect(card.locator('.settings-row')).toHaveCount(OVERVIEW_LABELS.length);

  expect(await card.locator('.settings-label-text').allTextContents()).toEqual(OVERVIEW_LABELS);
});

test('memory tab: memory rows live in the template card', async ({ page }) => {
  const detail = await openMemory(page);
  const card = detail.locator('.agent-memories .settings-card');
  await expect(card).toHaveCount(1);
  await expect(card.locator('.settings-row.agent-memory-row')).toHaveCount(3);
});

test('permissions tab: five switch groups each live in their own template card (#1251 adds the machine-match section)', async ({ page }) => {
  const detail = await openDetail(page);
  await detail.locator('.agent-tab').nth(2).click();
  const cards = detail.locator('.agent-perms .settings-card');

  await expect(cards).toHaveCount(5);

  await expect(cards.first().locator('.settings-row')).toHaveCount(6);
  await expect(cards.first().locator('.agent-tool-switch')).toHaveCount(6);
});

test('memory/permission cards: first row has no background, no top border (no square-corner overflow, no 2px top edge)', async ({
  page,
}) => {
  const detail = await openMemory(page);

  const memoryFirst = detail.locator('.agent-memories .settings-card > .settings-row:first-child');
  await expect(memoryFirst).toHaveCount(1);
  await assertTopCorner(memoryFirst);

  await detail.locator('.agent-tab').nth(2).click();

  const permFirst = detail.locator('.agent-perms .settings-card > .settings-row:first-child');
  await expect(permFirst).toHaveCount(5);
  await assertTopCorner(permFirst);
});

async function assertTopCorner(rows: Locator) {
  for (const row of await rows.all()) {
    const { background, topBorder } = await row.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { background: cs.backgroundColor, topBorder: cs.borderTopWidth };
    });
    expect(background).toBe('rgba(0, 0, 0, 0)');
    expect(topBorder).toBe('0px');
  }
}
