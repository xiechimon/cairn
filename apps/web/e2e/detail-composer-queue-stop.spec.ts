import { chiefGetResponseSchema } from '@cairn/shared';
import { expect, type Page, test } from '@playwright/test';

async function runningTask(page: Page) {
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
    phase: 'building',
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
    errorMessage: null as string | null,
    prUrl: null,
    prNumber: null,
    diffHash: null,
    createdAt: 1,
  };
  const messages: { id: string; role: string; content: unknown; createdAt: number }[] = [
    { id: 'tool', role: 'assistant', content: { kind: 'toolcall', call: { id: 'tool', name: 'bash', arguments: { command: 'pnpm test' } } }, createdAt: Date.now() },
  ];
  const steps = [
    {
      id: 'previous-step',
      buildId: build.id,
      kind: 'build',
      machineId: 'machine-1',
      createdAt: 1,
      status: 'claimed',
      checkpointCommit: null,
      skillInjection: null,
    },
  ];
  const sent: { content: string; mode?: string; queuedMessageId?: string; deliverAfterStop?: boolean; cancelQueued?: boolean }[] = [];
  const stops: { discard: boolean }[] = [];
  const queuedMessages: { id: string; content: string; createdAt: number; error?: string; deliverAfterStop?: boolean }[] = [];
  const steerPending: string[] = [];
  let turns = 0;
  const finish = (status = 'done') => {
    steps[0]!.status = status;
    task.phase = status === 'stopped' ? 'todo' : 'review';
    build.errorMessage = status === 'stopped' ? '已取消' : null;
    const nextIndex = queuedMessages.findIndex((row) => status === 'done' || row.deliverAfterStop);
    if (nextIndex >= 0) {
      const next = queuedMessages.splice(nextIndex, 1)[0]!;
      messages.push({ ...next, role: 'user' });
      turns += 1;
      steps.push({ ...steps[0]!, id: `next-${turns}`, status: 'claimed', createdAt: Date.now() });
      task.phase = 'building';
      build.errorMessage = null;
    }
  };
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
    if (path === `/api/builds/${build.id}/changes`) return route.fulfill({ json: { files: [{ path: 'src/kept.ts', status: 'modified', additions: 1, deletions: 0, hunks: [] }] } });
    if (path === `/api/builds/${build.id}/stop`) {
      stops.push(request.postDataJSON() as { discard: boolean });
      return route.fulfill({ json: { delegated: true } });
    }
    if (path === `/api/builds/${build.id}/steps`) return route.fulfill({ json: steps });
    if (path === `/api/conversations/${build.id}/messages`) {
      if (request.method() === 'POST') {
        const input = request.postDataJSON() as { content: string; mode?: string; queuedMessageId?: string; deliverAfterStop?: boolean; cancelQueued?: boolean };
        sent.push(input);
        const message = { id: `message-${sent.length}`, role: 'user', content: input.content, createdAt: Date.now(), deliverAfterStop: input.deliverAfterStop };
        if (input.cancelQueued) {
          queuedMessages.splice(queuedMessages.findIndex((row) => row.id === input.queuedMessageId), 1);
          return route.fulfill({ status: 201, json: { conversationId: build.id } });
        }
        if (input.mode === 'queue') queuedMessages.push(message);
        else {
          if (input.queuedMessageId) queuedMessages.splice(queuedMessages.findIndex((row) => row.id === input.queuedMessageId), 1);
          messages.push(message);
          steerPending.push(input.content);
        }
        task.phase = 'building';
        task.v += 1;
        return route.fulfill({ status: 201, json: { message } });
      }
      return route.fulfill({
        json: {
          messages,
          chips: null,
          historyEpoch: 0,
          steerPending,
          queuedMessages,
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
  const input = page.getByTestId('composer-card').getByRole('textbox');
  await expect(input).toBeEnabled();
  return { input, sent, stops, steerPending, queuedMessages, finish, turns: () => turns };
}

for (const chord of ['Meta+Enter', 'Control+Enter']) {
  test(`${chord} queues without steering and survives reload until completion`, async ({ page }) => {
    const task = await runningTask(page);
    await task.input.fill('Run the next turn');
    await task.input.press(chord);
    await expect(page.getByTestId('composer-card').getByTestId('queued-message')).toBeVisible();
    await expect(page.getByTestId('transcript-col').getByTestId('queued-message')).toHaveCount(0);
    expect(task.steerPending).toEqual([]);
    expect(task.sent).toEqual([{ content: 'Run the next turn', mode: 'queue' }]);
    await expect(task.input).toHaveValue('');
    await expect(page.getByTestId('transcript-col').getByTestId('queued-message')).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('composer-card').getByTestId('queued-message')).toBeVisible();
    task.finish();
    await page.reload();
    await expect(page.getByTestId('composer-card').getByTestId('queued-message')).toHaveCount(0);
    await expect(page.getByTestId('user-bubble').filter({ hasText: 'Run the next turn' })).toHaveCount(1);
    expect(task.turns()).toBe(1);
  });
}

test('send now delivers the queued capsule immediately and plain Enter still steers', async ({ page }) => {
  const task = await runningTask(page);
  await task.input.fill('Queued steer');
  await task.input.press('Control+Enter');
  await page.getByTestId('steer-queued-message').click();
  await expect.poll(() => task.steerPending).toEqual(['Queued steer']);
  await expect(page.getByTestId('composer-card').getByTestId('queued-message')).toHaveCount(0);
  await task.input.fill('Plain steer');
  await task.input.press('Enter');
  await expect.poll(() => task.steerPending).toEqual(['Queued steer', 'Plain steer']);
});

test('Stop preserves changes without a dialog and cancelled tools show cancelled', async ({ page }) => {
  const task = await runningTask(page);
  await task.input.fill('A stays queued');
  await task.input.press('Control+Enter');
  await expect(page.getByTestId('composer-card').getByTestId('queued-message')).toBeVisible();
  await page.getByTestId('composer-card').getByRole('button', { name: '停止', exact: true }).click();
  await expect.poll(() => task.stops).toEqual([{ discard: false }]);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  task.finish('stopped');
  await page.reload();
  expect(task.turns()).toBe(0);
  await expect(page.getByTestId('composer-card').getByTestId('queued-message')).toContainText('A stays queued');
  await expect(page.getByTestId('transcript-col').getByTestId('queued-message')).toHaveCount(0);
  await expect(page.getByTestId('work-cancelled')).toBeVisible();
  await expect(page.getByTestId('work-cancelled')).toHaveText('已取消');
  await expect(page.getByTestId('work-spinner')).toHaveCount(0);
  await expect(page.getByTestId('doc-pane').getByText('kept.ts', { exact: true })).toBeVisible();
});

test('Escape stops and a second Escape queues the draft after cancellation', async ({ page }) => {
  const task = await runningTask(page);
  await task.input.fill('A stays queued');
  await task.input.press('Control+Enter');
  await expect(page.getByTestId('composer-card').getByTestId('queued-message')).toBeVisible();
  await task.input.fill('Use this draft next');
  await task.input.press('Escape');
  await task.input.press('Escape');
  await expect.poll(() => task.stops).toEqual([{ discard: false }]);
  await expect(task.input).toHaveValue('');
  expect(task.stops).toHaveLength(1);
  expect(task.sent).toEqual([{ content: 'A stays queued', mode: 'queue' }, { content: 'Use this draft next', mode: 'queue', deliverAfterStop: true }]);
  expect(task.steerPending).toEqual([]);
  expect(task.turns()).toBe(0);
  task.finish('stopped');
  await page.reload();
  await expect(page.getByTestId('user-bubble').filter({ hasText: 'Use this draft next' })).toHaveCount(1);
  expect(task.turns()).toBe(1);
  await expect(page.getByTestId('composer-card').getByTestId('queued-message')).toContainText('A stays queued');
});

test('discard is available during a running step only and requires confirmation', async ({ page }) => {
  const task = await runningTask(page);
  await page.getByTestId('detail-head').getByRole('button', { name: '更多' }).click();
  await page.getByTestId('discard-changes').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(task.stops).toEqual([]);
  await page.getByRole('dialog').getByRole('button', { name: '丢弃修改', exact: true }).click();
  await expect.poll(() => task.stops).toEqual([{ discard: true }]);
});

test('kept changes after Stop do not expose discard', async ({ page }) => {
  const task = await runningTask(page);
  await page.getByTestId('composer-card').getByRole('button', { name: '停止', exact: true }).click();
  await expect.poll(() => task.stops).toEqual([{ discard: false }]);
  task.finish('stopped');
  await page.reload();
  await expect(page.getByTestId('doc-pane').getByText('kept.ts', { exact: true })).toBeVisible();
  await page.getByTestId('detail-head').getByRole('button', { name: '更多' }).click();
  await expect(page.getByTestId('discard-changes')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a queued capsule sits in the composer above the input and shows the full text on hover', async ({ page }) => {
  const task = await runningTask(page);
  const long = 'Summarise the change in two lines and list every file you touched so the review stays quick and nobody has to open the diff';
  await task.input.fill(long);
  await task.input.press('Control+Enter');
  const card = page.getByTestId('composer-card');
  const capsule = card.getByTestId('queued-message');
  await expect(capsule).toBeVisible();
  await expect(capsule).toHaveAttribute('title', long);
  await expect(capsule.getByRole('button', { name: '现在插话' })).toBeVisible();
  await expect(capsule.getByRole('button', { name: '移除' })).toBeVisible();
  const [capsuleBox, inputBox] = await Promise.all([capsule.boundingBox(), task.input.boundingBox()]);
  expect(capsuleBox!.y + capsuleBox!.height).toBeLessThanOrEqual(inputBox!.y);
  await expect(page.getByTestId('transcript-col').getByTestId('queued-message')).toHaveCount(0);
  await expect(page.getByTestId('user-bubble').filter({ hasText: 'Summarise the change' })).toHaveCount(0);
});

test('a failed capsule is red with the reason and Retry delivers it', async ({ page }) => {
  const task = await runningTask(page);
  await task.input.fill('Retry this queued text');
  await task.input.press('Control+Enter');
  const capsule = page.getByTestId('composer-card').getByTestId('queued-message');
  await expect(capsule).toHaveAttribute('data-state', 'queued');
  task.queuedMessages[0]!.error = 'Task cannot accept a message';
  await page.reload();
  await expect(capsule).toHaveAttribute('data-state', 'failed');
  await expect(capsule.getByTestId('queued-message-error')).toHaveText('Task cannot accept a message');
  await expect(capsule.getByRole('button', { name: '现在插话' })).toHaveCount(0);
  await capsule.getByRole('button', { name: '重试' }).click();
  await expect.poll(() => task.steerPending).toEqual(['Retry this queued text']);
  await expect(capsule).toHaveCount(0);
});

test('removing a capsule cancels the queued message', async ({ page }) => {
  const task = await runningTask(page);
  await task.input.fill('Cancel this queued text');
  await task.input.press('Control+Enter');
  const capsule = page.getByTestId('composer-card').getByTestId('queued-message');
  await expect(capsule).toBeVisible();
  await capsule.getByRole('button', { name: '移除' }).click();
  await expect(capsule).toHaveCount(0);
  expect(task.sent.at(-1)?.cancelQueued).toBe(true);
  expect(task.steerPending).toEqual([]);
});
