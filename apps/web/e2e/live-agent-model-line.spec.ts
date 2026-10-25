import { expect, type Page, type Route, test } from '@playwright/test';
import { evidencePanelShot } from './evidence';

const TEAM = { id: 'team-1', name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null };
const USER = { id: 'user-1', displayName: '我', avatarUrl: null };
const FIXTURE_MODEL = 'claude-sonnet-5';

function wireAgent(id: string, displayName: string, modelId: string | null, thinkingLevel: string | null) {
  return {
    id: `member-${id}`,
    teamId: 'team-1',
    actorId: id,
    memberType: 'agent',
    actor: { id, displayName, avatarUrl: null, description: null, modelId, thinkingLevel },
  };
}
const MEMBERS = [
  { id: 'member-user-1', teamId: 'team-1', actorId: 'user-1', memberType: 'user', actor: USER },
  wireAgent('agent-a', 'Alpha', 'gpt-5.5', null),
  wireAgent('agent-b', 'Beta', 'qwen3.8-max', 'high'),
  wireAgent('agent-c', 'Gamma', null, null),
];

function wireTodo(i: number, agent: { id: string; displayName: string } | null) {
  return {
    id: `todo-${i}`,
    teamId: 'team-1',
    projectId: 'proj-a',
    title: `model line probe ${i}`,
    spec: `model line probe ${i}`,
    phase: 'todo',
    phaseAt: 0,
    seqNum: i + 1,
    orderIndex: i,
    tagIds: [],
    assignment: agent === null ? null : { plan: null, build: { agentId: agent.id } },
    agent,
    latestBuildId: null,
    lastRunAt: 0,
    hasChanges: false,
    hasPlan: false,
    buildHistory: [],
    sourceTodo: null,
    v: 1,
  };
}
const WIRE_TASKS = [
  wireTodo(0, null),
  wireTodo(1, { id: 'agent-b', displayName: 'Beta' }),
  wireTodo(2, { id: 'agent-a', displayName: 'Alpha' }),
  wireTodo(3, { id: 'agent-c', displayName: 'Gamma' }),
];

async function stubLiveBoot(page: Page) {
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') {
      return route.fulfill({ status: 404, json: { error: 'e2e stub: write not expected' } });
    }
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.route('**/api/teams', (route) => route.fulfill({ json: [TEAM] }));
  await page.route('**/api/user/me', (route) => route.fulfill({ json: USER }));
  await page.route('**/api/todos?*', (route) => route.fulfill({ json: WIRE_TASKS }));
  for (const todo of WIRE_TASKS) {
    await page.route(`**/api/todos/${todo.id}`, (route, request) =>
      request.method() === 'GET' ? route.fulfill({ json: todo }) : route.fallback(),
    );
  }
}

const serveMembers = (page: Page) =>
  page.route('**/api/teams/team-1/members', (route) => route.fulfill({ json: MEMBERS }));

/** Holds every GET members until release(), then answers MEMBERS. */
async function holdMembers(page: Page) {
  const held: Route[] = [];
  let released = false;
  await page.route('**/api/teams/team-1/members', (route) => {
    if (released) return route.fulfill({ json: MEMBERS });
    held.push(route);
  });
  return {
    count: () => held.length,
    release: async () => {
      released = true;
      for (const route of held.splice(0)) await route.fulfill({ json: MEMBERS });
    },
  };
}

async function openRow(page: Page, todoId: string) {
  await page.goto(`/app/todo/${todoId}`);
  await page.getByTestId('phase-chip').click();
  const popover = page.locator('.chip-popover');
  await expect(popover).toBeVisible();
  return { popover, row: popover.locator('[data-selected] [data-row-kind="agent"]') };
}

/** evidencePanelShot after the popover's enter fade; regression runs skip both. */
async function shot(page: Page, name: string) {
  if (process.env.CAIRN_E2E_EVIDENCE === undefined) return;
  await page.waitForTimeout(300);
  await evidencePanelShot(page, name, page.locator('.chip-popover'));
}

test('unassigned todo: `未指派` alone, no model segment', async ({ page }) => {
  await stubLiveBoot(page);
  await serveMembers(page);
  const { popover, row } = await openRow(page, 'todo-0');
  await expect(popover).toContainText('model line probe 0');
  await shot(page, 'unassigned.png');
  await expect(row).toHaveText('未指派');
});

test('assigned agent: its own model and thinking level, not another member’s', async ({
  page,
}) => {
  await stubLiveBoot(page);
  await serveMembers(page);
  const beta = await openRow(page, 'todo-1');
  await expect(beta.popover).toContainText('model line probe 1');
  await shot(page, 'assigned-thinking-level.png');
  await expect(beta.row).toHaveText('Beta · qwen3.8-max · high');

  const alpha = await openRow(page, 'todo-2');
  await expect(alpha.popover).toContainText('model line probe 2');
  await shot(page, 'assigned-default-level.png');
  await expect(alpha.row).toHaveText('Alpha · gpt-5.5 · 默认');
});

test('agent without a model configured: the name alone', async ({ page }) => {
  await stubLiveBoot(page);
  await serveMembers(page);
  const { popover, row } = await openRow(page, 'todo-3');
  await expect(popover).toContainText('model line probe 3');
  await expect(popover).toContainText('Gamma');
  await expect(row).toHaveText('Gamma');
  await expect(popover).not.toContainText(FIXTURE_MODEL);
});

test('members pending: the name alone, then the model fills in', async ({ page }) => {
  await stubLiveBoot(page);
  const members = await holdMembers(page);
  const { popover, row } = await openRow(page, 'todo-1');
  await expect.poll(members.count).toBeGreaterThan(0);
  await expect(popover).toContainText('model line probe 1');
  await shot(page, 'members-pending.png');
  await expect(row).toHaveText('Beta');

  await members.release();
  await expect(row).toHaveText('Beta · qwen3.8-max · high');
});

test('members read failed: the name alone', async ({ page }) => {
  await stubLiveBoot(page);
  let answered = 0;
  await page.route('**/api/teams/team-1/members', (route) => {
    answered += 1;
    return route.fulfill({ status: 500, json: { error: 'e2e stub: members read failed' } });
  });
  const { popover, row } = await openRow(page, 'todo-1');
  await expect(popover).toContainText('model line probe 1');
  // React Query's single retry answered and painted
  await expect.poll(() => answered, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
  await page.evaluate(
    () => new Promise<void>((res) => requestAnimationFrame(() => requestAnimationFrame(() => res()))),
  );
  await expect(row).toHaveText('Beta');
});

test('en locale: the null thinking level reads Default', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn.locale', 'en'));
  await stubLiveBoot(page);
  await serveMembers(page);
  const { popover, row } = await openRow(page, 'todo-2');
  await expect(popover).toContainText('model line probe 2');
  await expect(row).toHaveText('Alpha · gpt-5.5 · Default');
});
