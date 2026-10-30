import { chiefGetResponseSchema } from '@cairn/shared';
import { expect, test } from '@playwright/test';

test('a completed task accepts a follow-up and shows its user bubble and running indicator', async ({
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
  ];
  const sent: string[] = [];
  let rejectNext = true;
  const refusal = 'PR #43 is already merged. Create a new task.';
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
      if (request.method() === 'POST') {
        if (rejectNext) {
          rejectNext = false;
          return route.fulfill({ status: 409, json: { error: refusal } });
        }
        const { content } = request.postDataJSON() as { content: string };
        sent.push(content);
        const message = { id: 'follow-up', role: 'user', content, createdAt: Date.now() };
        messages.push(message);
        steps.push({
          ...steps[0]!,
          id: 'continued-step',
          status: 'claimed',
          createdAt: Date.now(),
        });
        task.phase = 'building';
        task.v += 1;
        return route.fulfill({ status: 201, json: { message } });
      }
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
  const composer = page.getByTestId('composer-card');
  const input = composer.getByRole('textbox');
  await expect(input).toBeEnabled();
  await input.fill('Add a regression test');
  await composer.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByText(refusal, { exact: true }).first()).toBeVisible();
  await expect(page.getByText('当前没有运行中的会话，消息未送出', { exact: true })).toHaveCount(0);
  await expect(input).toHaveValue('Add a regression test');
  await composer.getByRole('button', { name: '发送', exact: true }).click();
  await expect.poll(() => sent).toEqual(['Add a regression test']);
  await expect(
    page.getByTestId('user-bubble').filter({ hasText: 'Add a regression test' }),
  ).toBeVisible();
  await expect(page.getByTestId('live-row')).toBeVisible();
  await expect(page.getByTestId('detail-head').getByTestId('phase-chip')).toHaveText('执行中');
  await expect(input).toHaveValue('');
  expect(pageErrors).toEqual([]);
});
