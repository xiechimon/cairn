import { expect, test } from '@playwright/test';
import { mockLive } from './chief-home-mock';

test('model selector with no rules offers the Coordinator picker, no task row, and no Runner or policy controls', async ({
  page,
}) => {
  await page.goto('/app/settings/routing?scenario=01');
  const settings = page.getByRole('dialog', { name: '设置' });
  await expect(settings.locator('[data-settings-section="routing"]')).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(settings.getByTestId('settings-head')).toHaveText('模型');
  await expect(settings.getByTestId('routing-rule-new-coordinator')).toBeVisible();
  await expect(settings.getByTestId('frequent-models')).toBeVisible();
  await expect(settings.getByTestId('frequent-models-empty')).toBeVisible();
  for (const use of ['session', 'review', 'citation_check']) {
    await expect(settings.locator(`#route-${use}`)).toHaveCount(0);
  }
  await expect(settings.getByTestId('routing-rule-new-coordinator')).toContainText(
    '先给 Coordinator 选模型',
  );
  await expect(settings.getByText('首选执行机')).toHaveCount(0);
  await expect(settings.getByText('工作策略')).toHaveCount(0);
  await expect(settings.getByRole('button', { name: '创建' })).toHaveCount(0);
});

test('model selector lists the frequently used models in place of the task row, never review or policies', async ({
  page,
}) => {
  await page.goto('/app/settings/routing?scenario=routing-settings');
  const settings = page.getByRole('dialog', { name: '设置' });
  await expect(settings.getByTestId('routing-rule-session')).toHaveCount(0);
  await expect(settings.getByTestId('routing-rule-new-session')).toHaveCount(0);
  const rows = settings.getByTestId('frequent-model-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('claude-sonnet-5');
  await expect(rows.nth(0).locator('.frequent-model-level')).toContainText('High');
  await expect(rows.nth(2)).toHaveAttribute('data-unavailable', '');
  await expect(settings.getByTestId('routing-rule-review')).toHaveCount(0);
  await expect(settings.getByTestId('routing-rule-new-coordinator')).toBeVisible();
  await expect(settings.locator('[data-testid^="work-policy-"]')).toHaveCount(0);
});

test('V6: the two add actions on the Model page are the same outline tier, and a set Coordinator row carries no subtitle', async ({
  page,
}) => {
  await page.goto('/app/settings/routing?scenario=model-routing');
  const settings = page.getByRole('dialog', { name: '设置' });
  await expect(settings.getByTestId('routing-add-provider')).toHaveAttribute(
    'data-variant',
    'outline',
  );
  await expect(settings.getByTestId('frequent-models-add')).toHaveAttribute(
    'data-variant',
    'outline',
  );
  await expect(settings.locator('[data-variant="default"]')).toHaveCount(0);
  const coordinator = settings.getByTestId('routing-rule-coordinator');
  await expect(coordinator).toBeVisible();
  await expect(coordinator).not.toContainText('和你对话');
});

test('the model menu groups by runtime and greys nothing, not for the Coordinator and not for a runtime no Runner has turned on', async ({
  page,
}) => {
  await page.goto('/app/settings/routing?scenario=routing-settings');
  const settings = page.getByRole('dialog', { name: '设置' });
  await settings
    .getByTestId('routing-rule-new-coordinator')
    .locator('.routing-rule-model-select')
    .click();
  const coordinatorMenu = page.locator('.routing-rule-model-menu:visible');
  await expect(coordinatorMenu.getByText('Claude Code', { exact: true })).toBeVisible();
  await expect(coordinatorMenu.getByText('Claude Code（Coordinator 用不了）')).toHaveCount(0);
  await expect(
    coordinatorMenu.locator('.routing-rule-model-row', { hasText: 'claude-haiku-4-5' }),
  ).not.toHaveAttribute('data-disabled', '');
  await expect(
    coordinatorMenu.locator('.routing-rule-model-row', { hasText: 'GPT-5.2' }),
  ).not.toHaveAttribute(
    'data-disabled',
    '',
  );
  await page.keyboard.press('Escape');

  await page.goto('/app/settings/routing?scenario=routing-settings-pi-only');
  await page
    .getByRole('dialog', { name: '设置' })
    .locator('#route-coordinator .routing-rule-model-select')
    .click();
  const piOnly = page.locator('.routing-rule-model-menu');
  await expect(piOnly.getByText('Claude Code', { exact: true })).toBeVisible();
  await expect(
    piOnly.locator('.routing-rule-model-row', { hasText: 'claude-haiku-4-5' }),
  ).not.toHaveAttribute('data-disabled', '');
  await expect(
    piOnly.locator('.routing-rule-model-row', { hasText: 'GPT-5.2' }),
  ).not.toHaveAttribute('data-disabled', '');
});

test('rules that cannot run say why, preview what the fix changes, and offer no fix without a default', async ({
  page,
}) => {
  await page.goto('/app/settings/routing?scenario=routing-rule-issues');
  const issues = page.getByRole('dialog', { name: '设置' }).getByTestId('routing-rule-issues');
  const session = issues.getByTestId('routing-rule-issue-session');
  await expect(session).toContainText('任务：没有执行机启用 Claude Code');
  await expect(session).toContainText('修复后改用 GPT-5.2');
  await expect(session).toContainText('并清空首选执行机、思考强度。');
  await expect(session.getByTestId('routing-rule-fix-session')).toBeVisible();
  const review = issues.getByTestId('routing-rule-issue-review');
  await expect(review).toContainText('评审：');
  await expect(review).toContainText('这个用途没有能自动换上的模型。');
  await expect(review.getByRole('button')).toHaveCount(0);
});

const FIX = {
  provider: 'relay',
  modelId: 'glm-5.3',
  thinkingLevel: null,
  machineId: null,
  expectedUpdatedAt: 1700,
};

async function mockIssue(
  page: import('@playwright/test').Page,
  patch: (body: unknown) => { status: number; body: unknown },
) {
  const seen = { gets: 0, patches: [] as unknown[] };
  await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    const method = route.request().method();
    if (path === '/api/teams/t1/routing-settings') {
      seen.gets += 1;
      const fixed = seen.patches.length > 0 && seen.gets > 1;
      return json({
        rules: [],
        policies: [],
        ruleIssues: fixed
          ? []
          : [{ use: 'session', reason: 'provider-no-key', provider: 'relay', suggested: FIX }],
      });
    }
    if (path === '/api/teams/t1/routing-rules/session' && method === 'PATCH') {
      const body = route.request().postDataJSON();
      seen.patches.push(body);
      const reply = patch(body);
      return json(reply.body, reply.status);
    }
    if (path === '/api/teams/t1/machines') return json([]);
    if (path === '/api/teams/t1/model-sources')
      return json({
        sources: [
          {
            runtime: 'pi',
            provider: 'relay',
            providerLabel: 'domestic-proxy',
            installed: true,
            models: [{ id: 'glm-5.3', name: 'GLM-5.3' }],
          },
        ],
      });
    return undefined;
  });
  return seen;
}

test('the fix sends the suggested change as is and the warning leaves once the rule is fixed', async ({
  page,
}) => {
  const seen = await mockIssue(page, () => ({ status: 200, body: {} }));
  await page.goto('/app/settings/routing');
  const row = page.getByRole('dialog', { name: '设置' }).getByTestId('routing-rule-issue-session');
  await expect(row).toContainText('任务：服务商 domestic-proxy 没有 API key');
  await expect(row).toContainText('修复后改用 GLM-5.3 · domestic-proxy，并清空首选执行机、思考强度。');
  await row.getByTestId('routing-rule-fix-session').click();
  await expect.poll(() => seen.patches).toEqual([FIX]);
  await expect(row).toHaveCount(0);
});

test('a rule changed since it was read reloads the settings and says so', async ({ page }) => {
  const seen = await mockIssue(page, () => ({
    status: 409,
    body: { error: 'routing rule changed since it was read' },
  }));
  await page.goto('/app/settings/routing');
  const row = page.getByRole('dialog', { name: '设置' }).getByTestId('routing-rule-issue-session');
  await row.getByTestId('routing-rule-fix-session').click();
  await expect(page.locator('[data-sonner-toast]').first()).toContainText(
    '这条规则刚被修改，已重新读取，请再次确认。',
  );
  await expect.poll(() => seen.gets).toBeGreaterThan(1);
});

test('adding, tuning and removing a frequently used model saves the whole list', async ({ page }) => {
  const puts: unknown[] = [];
  let models: unknown[] | null = null;
  await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    const method = route.request().method();
    if (path === '/api/teams/t1/top-models' && method === 'GET') return json({ models });
    if (path === '/api/teams/t1/top-models' && method === 'PUT') {
      const body = route.request().postDataJSON() as { models: unknown[] };
      puts.push(body.models);
      models = body.models;
      return json({ models });
    }
    if (path === '/api/teams/t1/machines') return json([]);
    if (path === '/api/teams/t1/model-sources')
      return json({
        sources: [
          {
            runtime: 'pi',
            provider: 'relay',
            providerLabel: 'domestic-proxy',
            installed: true,
            models: [
              { id: 'glm-5.3', name: 'GLM-5.3', thinkingLevels: ['low', 'high', 'max'] },
              { id: 'claude-opus-5', name: 'Claude Opus 5', thinkingLevels: [] },
            ],
          },
        ],
      });
    return undefined;
  });
  await page.goto('/app/settings/routing');
  const card = page.getByRole('dialog', { name: '设置' }).getByTestId('frequent-models');
  await expect(card.getByTestId('frequent-models-empty')).toBeVisible();
  await expect(card.locator('h2 + p')).toHaveCount(0);
  await expect(card.getByTestId('info-tip')).toHaveCount(0);
  await card.getByTestId('frequent-models-add').click();
  await page.locator('.frequent-models-add-row', { hasText: 'GLM-5.3' }).click();
  await expect
    .poll(() => puts)
    .toEqual([[{ provider: 'relay', modelId: 'glm-5.3', thinkingLevel: null }]]);
  const row = card.getByTestId('frequent-model-row');
  await expect(row).toContainText('GLM-5.3');
  const info = card.getByTestId('info-tip');
  await expect(info).toHaveAccessibleName('Coordinator 派活时按任务难度从这里挑一个。');
  await info.hover();
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText(
    'Coordinator 派活时按任务难度从这里挑一个。',
  );
  await expect(card.locator('h2 ~ p')).toHaveCount(0);
  await row.locator('.frequent-model-level').click();
  await expect(page.getByRole('option')).toHaveText(['Default', 'Low', 'High', 'Max']);
  await page.getByRole('option', { name: 'High', exact: true }).click();
  await expect
    .poll(() => puts.at(-1))
    .toEqual([{ provider: 'relay', modelId: 'glm-5.3', thinkingLevel: 'high' }]);
  await row.getByRole('button', { name: '删除 GLM-5.3' }).click();
  await expect.poll(() => puts.at(-1)).toEqual([]);
  await expect(card.getByTestId('frequent-models-empty')).toBeVisible();
});

test('a stored Devin model shows available and the picker offers the Devin group', async ({
  page,
}) => {
  const puts: unknown[] = [];
  await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    const method = route.request().method();
    if (path === '/api/teams/t1/top-models' && method === 'GET') {
      return json({
        models: [{ provider: 'devin', modelId: 'swe-2-high', thinkingLevel: null }],
      });
    }
    if (path === '/api/teams/t1/top-models' && method === 'PUT') {
      const body = route.request().postDataJSON() as { models: unknown[] };
      puts.push(body.models);
      return json({ models: body.models });
    }
    if (path === '/api/teams/t1/machines') return json([]);
    if (path === '/api/teams/t1/model-sources')
      return json({
        sources: [
          {
            runtime: 'devin',
            installed: true,
            hostname: 'exec-mac',
            machineId: 'm1',
            models: [
              {
                id: 'swe-2-high',
                name: 'SWE-2',
                thinkingLevels: ['medium', 'high', 'max'],
                thinkingDefault: 'high',
              },
              { id: 'swe-2-flash-medium', name: 'SWE-2 Flash' },
            ],
          },
        ],
      });
    return undefined;
  });
  await page.goto('/app/settings/routing');
  const card = page.getByRole('dialog', { name: '设置' }).getByTestId('frequent-models');
  const row = card.getByTestId('frequent-model-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('SWE-2');
  await expect(row).not.toHaveAttribute('data-unavailable', '');
  await row.locator('.frequent-model-level').click();
  await expect(page.getByRole('option')).toHaveText(['Default (High)', 'Medium', 'High', 'Max']);
  await page.keyboard.press('Escape');
  await card.getByTestId('frequent-models-add').click();
  const menu = page.locator('[data-slot="select-content"][aria-label="添加模型"]');
  await expect(menu.getByText('Devin', { exact: true })).toBeVisible();
  await menu.locator('.frequent-models-add-row', { hasText: 'SWE-2 Flash' }).click();
  await expect
    .poll(() => puts.at(-1))
    .toEqual([
      { provider: 'devin', modelId: 'swe-2-high', thinkingLevel: null },
      { provider: 'devin', modelId: 'swe-2-flash-medium', thinkingLevel: null },
    ]);
  await expect(card.getByTestId('frequent-model-row').nth(1).locator('.frequent-model-level')).toHaveCount(0);
});

test('the Model page renders no thinking selector without a real choice and no cannot-do label (C25)', async ({
  page,
}) => {
  await page.goto('/app/settings/routing?scenario=routing-settings');
  const settings = page.getByRole('dialog', { name: '设置' });
  await expect(settings.getByTestId('frequent-model-row').first()).toBeVisible();
  await expect(settings.getByText(/不可调|Fixed/)).toHaveCount(0);
  const selectors = settings.locator('.frequent-model-level, .routing-rule-level-select');
  const count = await selectors.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i += 1) {
    await selectors.nth(i).click();
    await expect(page.getByRole('option').nth(1)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('option')).toHaveCount(0);
  }
});

test('frequently used models support mouse drag and keyboard reordering with persistence and rollback', async ({
  page,
}) => {
  let models = [
    { provider: 'relay', modelId: 'glm-5.3', thinkingLevel: null },
    { provider: 'relay', modelId: 'claude-opus-5', thinkingLevel: null },
    { provider: 'relay', modelId: 'qwen-3', thinkingLevel: null },
  ];
  const saved: unknown[][] = [];
  let failPut = false;
  await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    const method = route.request().method();
    if (path === '/api/teams/t1/top-models' && method === 'GET') return json({ models });
    if (path === '/api/teams/t1/top-models' && method === 'PUT') {
      const body = route.request().postDataJSON() as { models: typeof models };
      saved.push(body.models);
      if (failPut) return route.fulfill({ status: 500, body: '{"error":"boom"}' });
      models = body.models;
      return json({ models });
    }
    if (path === '/api/teams/t1/machines') return json([]);
    if (path === '/api/teams/t1/model-sources')
      return json({
        sources: [
          {
            runtime: 'pi',
            provider: 'relay',
            providerLabel: 'domestic-proxy',
            installed: true,
            models: [
              { id: 'glm-5.3', name: 'GLM-5.3' },
              { id: 'claude-opus-5', name: 'Claude Opus 5' },
              { id: 'qwen-3', name: 'Qwen 3' },
            ],
          },
        ],
      });
    return undefined;
  });

  await page.goto('/app/settings/routing');
  const card = page.getByRole('dialog', { name: '设置' }).getByTestId('frequent-models');
  const rows = card.getByTestId('frequent-model-row');
  const rowIds = () =>
    rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-model-key')));
  await expect.poll(rowIds).toEqual(['relay/glm-5.3', 'relay/claude-opus-5', 'relay/qwen-3']);

  const first = await rows.nth(0).boundingBox();
  const last = await rows.nth(2).boundingBox();
  if (first === null || last === null) throw new Error('frequent model rows not laid out');
  await page.mouse.move(last.x + 20, last.y + last.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + 200, first.y - 100, { steps: 12 });
  const held = await rows.nth(2).boundingBox();
  expect(held?.x ?? 0).toBeCloseTo(last.x, 0);
  expect(held?.y ?? 0).toBeCloseTo(first.y, 0);
  await page.mouse.up();

  const moved = ['relay/qwen-3', 'relay/glm-5.3', 'relay/claude-opus-5'];
  await expect.poll(rowIds).toEqual(moved);
  await expect.poll(() => saved.length).toBe(1);

  await page.reload();
  await expect.poll(rowIds).toEqual(moved);

  const moveDownOnce = async () => {
    await expect(card.locator('[data-dragging="true"]')).toHaveCount(1);
    await card.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    );
    await page.keyboard.press('ArrowDown');
    await expect(rows.nth(1)).toHaveAttribute('style', /translate3d\(0px, -/);
  };

  await rows.nth(0).getByTestId('frequent-model-drag-grip').focus();
  await page.keyboard.press('Space');
  await expect(card.locator('[data-dragging="true"]')).toHaveCount(1);
  await moveDownOnce();
  await page.keyboard.press('Space');
  const kbMoved = ['relay/glm-5.3', 'relay/qwen-3', 'relay/claude-opus-5'];
  await expect.poll(rowIds).toEqual(kbMoved);
  await expect.poll(() => saved.length).toBe(2);

  await rows.nth(0).getByTestId('frequent-model-drag-grip').focus();
  await page.keyboard.press('Space');
  await expect(card.locator('[data-dragging="true"]')).toHaveCount(1);
  await moveDownOnce();
  await page.keyboard.press('Escape');
  await expect(card).toBeVisible();
  await expect(card.locator('[data-dragging="true"]')).toHaveCount(0);
  await expect.poll(rowIds).toEqual(kbMoved);
  expect(saved).toHaveLength(2);

  failPut = true;
  await rows.nth(0).getByTestId('frequent-model-drag-grip').focus();
  await page.keyboard.press('Space');
  await expect(card.locator('[data-dragging="true"]')).toHaveCount(1);
  await moveDownOnce();
  await page.keyboard.press('Space');
  await expect(page.getByText('顺序未能保存，已恢复原来的顺序。')).toBeVisible();
  await expect.poll(rowIds).toEqual(kbMoved);
});

test('navigating to #route-coordinator opens flush at top without clipping SettingsCard top ring', async ({
  page,
}) => {
  await page.goto('/app/settings/routing?scenario=model-routing#route-coordinator');
  const settings = page.getByRole('dialog', { name: '设置' });
  const coordinator = settings.getByTestId('routing-rule-coordinator');
  await expect(coordinator).toBeVisible();
  await expect(coordinator).toHaveClass(/scroll-mt-4/);

  const layout = await settings.getByTestId('settings-body').evaluate((body) => {
    const scroller = body.querySelector('.overflow-y-auto');
    const card = body.querySelector('.settings-card');
    if (scroller === null || card === null) return null;
    const scrollerRect = scroller.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    return {
      scrollTop: scroller.scrollTop,
      topGap: cardRect.top - scrollerRect.top,
    };
  });
  expect(layout).not.toBeNull();
  expect(layout?.scrollTop).toBe(0);
  expect(layout?.topGap ?? 0).toBeGreaterThanOrEqual(3);
});

test('navigating to #route-compaction scrolls with scroll-mt-4 breathing room', async ({
  page,
}) => {
  await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    if (path === '/api/teams/t1/routing-settings') {
      return json({
        rules: [
          {
            id: 'r1',
            teamId: 't1',
            use: 'coordinator',
            provider: 'relay',
            modelId: 'glm-5.3',
            thinkingLevel: null,
            fallbackModels: null,
            machineId: null,
            requiredCapabilities: null,
            seededFromAgentId: null,
            createdAt: 1,
            updatedAt: 1,
          },
          {
            id: 'r2',
            teamId: 't1',
            use: 'compaction',
            provider: 'relay',
            modelId: 'glm-5.3',
            thinkingLevel: null,
            fallbackModels: null,
            machineId: null,
            requiredCapabilities: null,
            seededFromAgentId: null,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        policies: [],
        ruleIssues: [],
      });
    }
    if (path === '/api/teams/t1/machines') return json([]);
    if (path === '/api/teams/t1/model-sources') {
      return json({
        sources: [
          {
            runtime: 'pi',
            provider: 'relay',
            providerLabel: 'domestic-proxy',
            installed: true,
            models: [{ id: 'glm-5.3', name: 'GLM-5.3' }],
          },
        ],
      });
    }
    return undefined;
  });
  await page.goto('/app/settings/routing#route-compaction');
  const settings = page.getByRole('dialog', { name: '设置' });
  const compaction = settings.getByTestId('routing-rule-compaction');
  await expect(compaction).toBeVisible();
  await expect(compaction).toHaveClass(/scroll-mt-4/);
});

test('project override rows reset coordinator overrides via PATCH, disable while pending, and hide section when empty', async ({
  page,
}) => {
  const patches: { id: string; body: unknown }[] = [];
  let projects = [
    {
      id: 'proj-1',
      name: 'cairn',
      teamId: 't1',
      repoKind: 'hosted',
      repoName: 'cairn',
      githubRepo: null,
      localPath: null,
      modelOverrides: {
        coordinator: { provider: 'relay', modelId: 'glm-5.3', thinkingLevel: null },
      },
    },
    {
      id: 'proj-2',
      name: 'docs',
      teamId: 't1',
      repoKind: 'hosted',
      repoName: 'docs',
      githubRepo: null,
      localPath: null,
      modelOverrides: {
        coordinator: { provider: 'relay', modelId: 'glm-5.3', thinkingLevel: null },
      },
    },
    {
      id: 'proj-3',
      name: 'plain',
      teamId: 't1',
      repoKind: 'hosted',
      repoName: 'plain',
      githubRepo: null,
      localPath: null,
    },
  ];
  let releaseFirstPatch: (() => void) | null = null;
  await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    const method = route.request().method();
    if (path === '/api/projects' && method === 'GET') {
      return json(projects);
    }
    const patchMatch = /^\/api\/projects\/([^/]+)$/.exec(path);
    if (patchMatch !== null && method === 'PATCH') {
      const id = patchMatch[1] ?? '';
      const body = route.request().postDataJSON() as {
        modelOverrides?: { coordinator?: unknown };
      };
      patches.push({ id, body });
      const respond = () => {
        projects = projects.map((p) =>
          p.id === id
            ? {
                ...p,
                modelOverrides: {
                  ...p.modelOverrides,
                  coordinator: body.modelOverrides?.coordinator ?? null,
                },
              }
            : p,
        );
        const updated = projects.find((p) => p.id === id);
        return json(updated ?? {});
      };
      if (patches.length === 1) {
        return new Promise<void>((resolve) => {
          releaseFirstPatch = () => {
            void respond().then(resolve);
          };
        });
      }
      return respond();
    }
    if (path === '/api/teams/t1/model-sources') {
      return json({
        sources: [
          {
            runtime: 'pi',
            provider: 'relay',
            providerLabel: 'domestic-proxy',
            installed: true,
            models: [{ id: 'glm-5.3', name: 'GLM-5.3' }],
          },
        ],
      });
    }
    return undefined;
  });

  await page.goto('/app/settings/routing');
  const settings = page.getByRole('dialog', { name: '设置' });
  const overrides = settings.getByTestId('routing-project-overrides');
  await expect(overrides).toBeVisible();
  await overrides.getByRole('button', { name: /2 个项目单独设置了模型/ }).click();

  const resetButtons = overrides.getByTestId('project-override-reset');
  await expect(resetButtons).toHaveCount(2);
  await expect(resetButtons.nth(0)).toHaveAccessibleName('重置 cairn 的模型设置');
  await expect(resetButtons.nth(1)).toHaveAccessibleName('重置 docs 的模型设置');
  const box = await resetButtons.nth(0).boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);

  await resetButtons.nth(0).click();
  await expect(resetButtons.nth(0)).toBeDisabled();
  await expect.poll(() => patches).toEqual([
    { id: 'proj-1', body: { modelOverrides: { coordinator: null } } },
  ]);
  releaseFirstPatch?.();

  await expect(resetButtons).toHaveCount(1);
  await expect(overrides).toContainText('1 个项目单独设置了模型');
  await expect(overrides.getByRole('link', { name: '项目设置' })).toHaveCount(1);

  await resetButtons.nth(0).click();
  await expect.poll(() => patches).toEqual([
    { id: 'proj-1', body: { modelOverrides: { coordinator: null } } },
    { id: 'proj-2', body: { modelOverrides: { coordinator: null } } },
  ]);
  await expect(overrides).toHaveCount(0);
});

test('project override reset keeps row and shows toast when PATCH fails', async ({ page }) => {
  await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    const method = route.request().method();
    if (path === '/api/projects' && method === 'GET') {
      return json([
        {
          id: 'proj-1',
          name: 'cairn',
          teamId: 't1',
          repoKind: 'hosted',
          repoName: 'cairn',
          githubRepo: null,
          localPath: null,
          modelOverrides: {
            coordinator: { provider: 'relay', modelId: 'glm-5.3', thinkingLevel: null },
          },
        },
      ]);
    }
    if (path === '/api/projects/proj-1' && method === 'PATCH') {
      return json({ error: 'boom' }, 500);
    }
    if (path === '/api/teams/t1/model-sources') {
      return json({
        sources: [
          {
            runtime: 'pi',
            provider: 'relay',
            providerLabel: 'domestic-proxy',
            installed: true,
            models: [{ id: 'glm-5.3', name: 'GLM-5.3' }],
          },
        ],
      });
    }
    return undefined;
  });

  await page.goto('/app/settings/routing');
  const settings = page.getByRole('dialog', { name: '设置' });
  const overrides = settings.getByTestId('routing-project-overrides');
  await overrides.getByRole('button', { name: /1 个项目单独设置了模型/ }).click();

  const resetBtn = overrides.getByTestId('project-override-reset');
  await expect(resetBtn).toBeVisible();
  await resetBtn.click();

  await expect(page.locator('[data-sonner-toast]').first()).toContainText('保存失败，请重试。');
  await expect(resetBtn).toBeEnabled();
  await expect(overrides).toContainText('cairn');
});

test('remote access: the empty state does not point at a switch that is not on the page', async ({
  page,
}) => {
  await page.goto('/app/settings/remote?scenario=01');
  const empty = page.getByTestId('remote-routes-empty');
  await expect(empty).toBeVisible();
  await expect(page.getByTestId('remote-access-switch')).toHaveCount(0);
  await expect(empty).not.toContainText('开关');
});
