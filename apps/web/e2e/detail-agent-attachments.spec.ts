import { chiefGetResponseSchema } from '@cairn/shared';
import { expect, test } from '@playwright/test';

test('a final assistant reply renders two loaded screenshots and opens each in a lightbox', async ({
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
    {
      id: 'previous-response',
      role: 'assistant',
      content:
        'Task completed.\n\n![Light screenshot](attachment:team-1/agent-light.png)\n![Dark screenshot](attachment:team-1/agent-dark.png)',
      createdAt: 2,
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
    if (path === `/api/conversations/${build.id}/messages`)
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
    if (path.startsWith('/api/attachments/'))
      return route.fulfill({
        contentType: 'image/png',
        headers: {
          'x-content-type-options': 'nosniff',
          'content-security-policy': "sandbox; default-src 'none'",
          'content-disposition': 'inline',
        },
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGP48OHDfxBmgDEAiNQPPZGgNrYAAAAASUVORK5CYII=',
          'base64',
        ),
      });
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
  const bubble = page.getByTestId('agent-text').filter({ hasText: 'Task completed.' });
  const images = bubble.getByRole('img');
  await expect(images).toHaveCount(2);
  for (const name of ['Light screenshot', 'Dark screenshot']) {
    const image = bubble.getByRole('img', { name, exact: true });
    await expect
      .poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    await image.click();
    const lightbox = page.getByRole('dialog', { name, exact: true });
    await expect(lightbox).toBeVisible();
    await expect
      .poll(() =>
        lightbox
          .getByRole('img', { name, exact: true })
          .evaluate((element) => (element as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await expect(lightbox).toHaveCount(0);
  }
  expect(pageErrors).toEqual([]);
});
