import { expect, type Page, type Request, test } from '@playwright/test';

const CONFIRM = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=20';
const REVIEW = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=27';
const PLANNING = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=16';

const TEAM = { id: 'team-1', name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null };
const USER = { id: 'user-1', displayName: '我', avatarUrl: null };

function wireAgent(id: string, displayName: string, modelId: string, thinkingLevel: string | null) {
  return {
    id: `member-${id}`,
    teamId: 'team-1',
    actorId: id,
    memberType: 'agent',
    actor: {
      id,
      displayName,
      avatarUrl: null,
      description: null,
      provider: 'Codex',
      modelId,
      thinkingLevel,
    },
  };
}

const MEMBERS = [
  { id: 'member-user-1', teamId: 'team-1', actorId: 'user-1', memberType: 'user', actor: USER },
  wireAgent('agent-a', 'Alpha', 'gpt-6.1-sol', 'medium'),
  wireAgent('agent-b', 'Beta', 'claude-sonnet-5-5', 'high'),
];

const WIRE_TASK = {
  id: 'todo-0',
  teamId: 'team-1',
  projectId: 'proj-a',
  title: 'picker probe',
  spec: 'picker probe',
  phase: 'planning',
  phaseAt: Date.now() - 4 * 60_000,
  seqNum: 1,
  orderIndex: 0,
  tagIds: [],
  assignment: { plan: null, build: { agentId: 'agent-b' } },
  agent: { id: 'agent-b', displayName: 'Beta' },
  latestBuildId: null,
  lastRunAt: 0,
  hasChanges: false,
  hasPlan: false,
  buildHistory: [],
  sourceTodo: null,
  v: 1,
};

async function stubLive(page: Page, writes: Request[]) {
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') {
      if (request.method() === 'PATCH') writes.push(request);
      return route.fulfill({ json: WIRE_TASK });
    }
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.route('**/api/teams', (route) => route.fulfill({ json: [TEAM] }));
  await page.route('**/api/user/me', (route) => route.fulfill({ json: USER }));
  await page.route('**/api/teams/team-1/members', (route) => route.fulfill({ json: MEMBERS }));
  await page.route('**/api/todos?*', (route) => route.fulfill({ json: [WIRE_TASK] }));
  await page.route('**/api/todos/todo-0', (route, request) =>
    request.method() === 'GET' ? route.fulfill({ json: WIRE_TASK }) : route.fallback(),
  );
}

test('status chip opens the phase list with the current phase checked and the next step spelled out', async ({
  page,
}) => {
  await page.goto(PLANNING);
  await page.getByTestId('phase-chip').click();
  const menu = page.getByRole('dialog', { name: '任务状态' });
  await expect(menu).toBeVisible();

  await expect(menu.locator('[data-phase]')).toHaveText([
    /待开始/,
    /规划中/,
    /确认方案/,
    /构建中/,
    /审核/,
    /已完成/,
  ]);
  await expect(menu.locator('[data-current]')).toHaveCount(1);
  await expect(menu.locator('[data-phase="planning"][data-current]')).toBeVisible();
  await expect(menu.locator('[data-phase="planning"][data-current] svg').last()).toBeVisible();
  await expect(menu.getByTestId('status-note')).toHaveText(
    '方案写好后，Agent 会把它移到确认方案。',
  );
  await expect(menu.getByRole('button', { name: '移回待开始' })).toBeVisible();
  await expect(menu.getByRole('button', { name: '标记为已完成' })).toHaveCount(0);
  await expect(menu.getByRole('button')).toHaveCount(1);
});

test('status menu offers Mark done where the app allows it, and move-back asks before resetting', async ({
  page,
}) => {
  await page.goto(REVIEW);
  await page.getByTestId('phase-chip').click();
  const menu = page.getByRole('dialog', { name: '任务状态' });
  await expect(menu.locator('[data-phase="review"][data-current]')).toBeVisible();
  await expect(menu.getByRole('button', { name: '标记为已完成' })).toBeVisible();

  await menu.getByRole('button', { name: '移回待开始' }).click();
  await expect(menu).toBeHidden();
  await expect(page.getByText('把任务重置回待开始？')).toBeVisible();
});

test('the status menu repeats neither the title nor an owner row', async ({ page }) => {
  await page.goto(CONFIRM);
  await page.getByTestId('phase-chip').click();
  const menu = page.getByRole('dialog', { name: '任务状态' });
  const title = (await page.getByTestId('detail-title').textContent()) ?? '';
  await expect(menu).not.toContainText(title);
  await expect(menu).not.toContainText('负责人');
});

test('agent chip opens the picker: search row, check on the bound agent, restart footnote', async ({
  page,
}) => {
  await page.goto(CONFIRM);
  const chip = page.getByTestId('agent-chip');
  await expect(chip).toContainText('r3-builder');
  await chip.click();
  const picker = page.getByRole('dialog', { name: '选择执行 Agent' });
  await expect(picker).toBeVisible();
  await expect(picker.getByPlaceholder('分配给…')).toBeVisible();
  const row = picker.getByRole('option', { selected: true });
  await expect(row).toContainText('r3-builder');
  await expect(row.locator('svg').last()).toBeVisible();
  await expect(picker).toContainText('后续步骤会改由所选 Agent 执行。');
  await picker.getByPlaceholder('分配给…').fill('不存在');
  await expect(picker.getByText('没有匹配的 Agent')).toBeVisible();
});

test('picking another agent asks to confirm, then rebinds the task to it', async ({ page }) => {
  const writes: Request[] = [];
  await stubLive(page, writes);
  await page.goto('/app/todo/todo-0');
  const chip = page.getByTestId('agent-chip');
  await expect(chip).toContainText('Beta');
  await chip.click();
  const picker = page.getByRole('dialog', { name: '选择执行 Agent' });

  const beta = picker.getByRole('option', { name: /Beta/ });
  await expect(beta).toHaveAttribute('aria-selected', 'true');
  await expect(beta).toContainText('Codex · claude-sonnet-5-5 · high');
  const alpha = picker.getByRole('option', { name: /Alpha/ });
  await expect(alpha).toContainText('Codex · gpt-6.1-sol · medium');
  await alpha.click();

  await expect(picker.getByTestId('agent-picker-confirm')).toContainText(
    '更换执行 Agent？后续运行将改由 Alpha 执行。',
  );
  expect(writes).toHaveLength(0);
  await picker.getByRole('button', { name: '更换' }).click();

  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]?.method()).toBe('PATCH');
  expect(writes[0]?.url()).toContain('/api/todos/todo-0');
  expect(writes[0]?.postDataJSON()).toEqual({ assignment: { build: { agentId: 'agent-a' } } });
  await expect(picker).toBeHidden();
});

test('cancelling the rebind confirmation writes nothing', async ({ page }) => {
  const writes: Request[] = [];
  await stubLive(page, writes);
  await page.goto('/app/todo/todo-0');
  await page.getByTestId('agent-chip').click();
  const picker = page.getByRole('dialog', { name: '选择执行 Agent' });
  await picker.getByRole('option', { name: /Alpha/ }).click();
  await picker.getByRole('button', { name: '取消' }).click();
  await expect(picker.getByRole('option', { name: /Alpha/ })).toBeVisible();
  expect(writes).toHaveLength(0);
});
