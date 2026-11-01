import { expect, type Page, type Request, test } from '@playwright/test';

const FRESH = '/app/todo/fresh-probe?scenario=23';

const TEAM = { id: 'team-1', name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null };
const USER = { id: 'user-1', displayName: '我', avatarUrl: null };
const MEMBERS = [
  { id: 'member-user-1', teamId: 'team-1', actorId: 'user-1', memberType: 'user', actor: USER },
  {
    id: 'member-agent-a',
    teamId: 'team-1',
    actorId: 'agent-a',
    memberType: 'agent',
    actor: {
      id: 'agent-a',
      displayName: 'Alpha',
      avatarUrl: null,
      description: null,
      provider: null,
      modelId: 'gpt-6.1-sol',
      thinkingLevel: 'medium',
    },
  },
];
const PROJECT = { id: 'proj-a', teamId: 'team-1', name: 'Lifecycle', kind: 'local' };
const WIRE_TASK = {
  id: 'todo-0',
  teamId: 'team-1',
  projectId: 'proj-a',
  title: 'Add a dark mode toggle',
  spec: '',
  phase: 'todo',
  phaseAt: 0,
  seqNum: 1,
  orderIndex: 0,
  tagIds: [],
  assignment: { plan: null, build: { agentId: 'agent-a' } },
  agent: { id: 'agent-a', displayName: 'Alpha' },
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
  await page.route('**/api/teams/team-1/projects', (route) => route.fulfill({ json: [PROJECT] }));
  await page.route('**/api/todos?*', (route) => route.fulfill({ json: [WIRE_TASK] }));
  await page.route('**/api/todos/todo-0', (route, request) =>
    request.method() === 'GET' ? route.fulfill({ json: WIRE_TASK }) : route.fallback(),
  );
}

test('fresh task reads as a brief: title, property chips, description box, Start with one plain line', async ({
  page,
}) => {
  await page.goto(FRESH);
  const block = page.getByTestId('fresh-block');
  await expect(block.getByRole('heading')).toBeVisible();
  await expect(block.getByTestId('fresh-project')).toBeVisible();
  const chip = block.getByTestId('fresh-agent-chip');
  await expect(chip).toContainText('r3-builder');
  await expect(chip).toContainText('claude-sonnet-5');
  await expect(block.getByTestId('fresh-description')).toBeVisible();
  await expect(block.getByRole('button', { name: '开始', exact: true })).toBeVisible();
  await expect(block.getByTestId('fresh-start-note')).toHaveText(
    'r3-builder 会先写方案，你确认之前不会改动任何东西。',
  );
  await expect(block).not.toContainText('尚无描述');
  await expect(block).not.toContainText('总管');
});

test('fresh task column is as wide as the chat column', async ({ page }) => {
  await page.goto(FRESH);
  const block = await page.getByTestId('fresh-block').boundingBox();
  const chat = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.width = 'var(--chat-max-w)';
    document.body.append(probe);
    const width = probe.getBoundingClientRect().width;
    probe.remove();
    return width;
  });
  expect(block).not.toBeNull();
  expect(Math.abs((block?.width ?? 0) - chat)).toBeLessThanOrEqual(2);
});

test('the agent chip on a fresh task opens the same picker', async ({ page }) => {
  await page.goto(FRESH);
  await page.getByTestId('fresh-agent-chip').click();
  const picker = page.getByRole('dialog', { name: '选择执行 Agent' });
  await expect(picker.getByPlaceholder('分配给…')).toBeVisible();
  await expect(picker.getByRole('option', { selected: true })).toContainText('r3-builder');
});

test('typing a description saves it on blur', async ({ page }) => {
  const writes: Request[] = [];
  await stubLive(page, writes);
  await page.goto('/app/todo/todo-0');
  const box = page.getByTestId('fresh-description');
  await expect(box).toHaveAttribute('placeholder', /Agent/);
  await box.fill('Put the toggle under Appearance.');
  expect(writes).toHaveLength(0);
  await box.blur();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]?.method()).toBe('PATCH');
  expect(writes[0]?.postDataJSON()).toEqual({ spec: 'Put the toggle under Appearance.' });
});
