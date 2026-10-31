import { chiefGetResponseSchema, transcriptPromptRowId } from '@cairn/shared';
import { expect, test } from '@playwright/test';

test('a fixture scheduled run shows its wake marker, folded turn and completion', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const chief = chiefGetResponseSchema.parse({
    chief: {
      id: 'chief-user-1-team-1',
      userId: 'user-1',
      teamId: 'team-1',
      agent: null,
      charter: null,
      lastTurnAt: null,
      createdAt: 0,
      tz: null,
    },
    agentActor: null,
    context: null,
    watches: [],
    wakes: [],
  });
  const task = {
    id: 'completed-task',
    teamId: 'team-1',
    projectId: 'project-1',
    title: 'Continue a completed task',
    spec: '',
    phase: 'done',
    phaseAt: 1,
    seqNum: 43,
    orderIndex: 0,
    tagIds: [],
    assignment: null,
    agent: null,
    latestBuildId: 'completed-build',
    lastRunAt: 1,
    hasChanges: false,
    hasPlan: false,
    buildHistory: [],
    sourceTodo: null,
    v: 1,
  };
  const build = {
    id: task.latestBuildId,
    todoId: task.id,
    withPlan: false,
    prevPhase: null,
    triggerSource: 'user',
    planDocId: null,
    errorMessage: null,
    prUrl: null,
    prNumber: null,
    diffHash: null,
    createdAt: 1,
  };
  const messages = [
    { id: 'previous-response', role: 'assistant', content: 'Task completed.', createdAt: 2 },
    {
      id: 'scheduled-wake',
      role: 'system',
      content: JSON.stringify({ kind: 'schedule-wake', stepId: 'scheduled-step' }),
      createdAt: 10,
    },
    {
      id: transcriptPromptRowId('scheduled-step'),
      role: 'user',
      content: 'Check the latest changes',
      createdAt: 11,
    },
    {
      id: 'scheduled-response',
      role: 'assistant',
      content: 'No new changes found.',
      createdAt: 12,
    },
  ];
  const steps = [
    {
      id: 'previous-step',
      buildId: build.id,
      kind: 'build',
      machineId: 'machine-1',
      createdAt: 1,
      status: 'done',
      checkpointCommit: null,
      skillInjection: null,
    },
    {
      id: 'scheduled-step',
      buildId: build.id,
      kind: 'build',
      machineId: 'machine-1',
      createdAt: 10,
      status: 'done',
      checkpointCommit: null,
      skillInjection: null,
    },
  ];
  await page.addInitScript(() => {
    class FakeEventSource extends EventTarget {
      readyState = 1;
      close() {}
    }
    Object.defineProperty(window, 'EventSource', { value: FakeEventSource });
  });
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/teams') return route.fulfill({ json: [{ id: 'team-1', name: 'Team' }] });
    if (path === '/api/user/me')
      return route.fulfill({ json: { id: 'user-1', displayName: 'Owner', avatarUrl: null } });
    if (path === '/api/teams/team-1/chief') return route.fulfill({ json: chief });
    if (path === '/api/teams/team-1/notifications')
      return route.fulfill({ json: { unreadThreadIds: [] } });
    if (path === '/api/projects')
      return route.fulfill({
        json: [{ id: task.projectId, teamId: task.teamId, name: 'cairn', repoKind: 'hosted' }],
      });
    if (path === '/api/todos') return route.fulfill({ json: [task] });
    if (path === `/api/todos/${task.id}`) return route.fulfill({ json: task });
    if (path === `/api/builds/${build.id}`) return route.fulfill({ json: build });
    if (path === `/api/builds/${build.id}/gate`) return route.fulfill({ json: { state: null } });
    if (path === `/api/builds/${build.id}/changes`) return route.fulfill({ json: { files: [] } });
    if (path === `/api/builds/${build.id}/steps`) return route.fulfill({ json: steps });
    if (path === `/api/conversations/${build.id}/messages`) {
      return route.fulfill({
        json: {
          messages,
          chips: null,
          historyEpoch: 0,
          steerPending: [],
          activeRun: null,
          nextCursor: null,
        },
      });
    }
    if (
      request.method() === 'GET' &&
      [
        '/api/teams/team-1/chief/threads',
        '/api/teams/team-1/members',
        '/api/teams/team-1/machines',
        '/api/teams/team-1/skills',
        `/api/builds/${build.id}/plans`,
        `/api/builds/${build.id}/usage`,
        `/api/projects/${task.projectId}/builds`,
        `/api/projects/${task.projectId}/tags`,
      ].includes(path)
    )
      return route.fulfill({ json: [] });
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.goto(`/app/todo/${task.id}`);
  await expect(page.getByTestId('detail-head').getByTestId('phase-chip')).toHaveText('已完成');
  const wake = page.getByTestId('schedule-wake-marker');
  const turn = page.getByTestId('scheduled-turn');
  const completed = page.getByTestId('automation-completed');
  await expect(wake).toBeVisible();
  await expect(page.getByTestId('user-bubble')).toHaveCount(0);
  await expect(turn.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText('No new changes found.', { exact: true })).toBeHidden();
  await expect(completed).toBeVisible();
  const positions = await Promise.all([
    wake.boundingBox(),
    turn.boundingBox(),
    completed.boundingBox(),
  ]);
  expect(positions.every(Boolean)).toBe(true);
  expect(positions[0]!.y).toBeLessThan(positions[1]!.y);
  expect(positions[1]!.y).toBeLessThan(positions[2]!.y);
  await turn.getByRole('button').click();
  await expect(page.getByText('No new changes found.', { exact: true })).toBeVisible();
  expect(pageErrors).toEqual([]);
});
