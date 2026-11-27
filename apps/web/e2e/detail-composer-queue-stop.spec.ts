import { chiefGetResponseSchema } from '@cairn/shared';
import { expect, type Page, test } from '@playwright/test';
import { installConversationStreams } from './tab-stream-fakes.js';

async function runningTask(page: Page, readDelay = 0, targetRead: 'answer' | 'reject' | 'hold' = 'answer') {
  const chief = chiefGetResponseSchema.parse({
    chief: {
      id: 'chief-user-1-team-1',
      userId: 'user-1',
      teamId: 'team-1',
      agent: null,
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
  const sent: { content: string; clientMessageId?: string; mode?: string; queuedMessageId?: string; deliverAfterStop?: boolean; cancelQueued?: boolean }[] = [];
  const stops: { discard: boolean }[] = [];
  const retryNowCalls: { buildId: string; clientMessageId?: string }[] = [];
  let todoStatus = 200;
  let todoReadDelay = 0;
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
    const streams: FakeEventSource[] = [];
    class FakeEventSource extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 2;
      readonly url: string;
      readyState = 1;
      onmessage: ((event: { data: string }) => void) | null = null;
      constructor(url: string) {
        super();
        this.url = url;
        streams.push(this);
      }
      close() { this.readyState = 2; }
    }
    Object.defineProperty(window, '__streams', { value: streams });
    Object.defineProperty(window, 'EventSource', { value: FakeEventSource });
  });
  await page.addInitScript(installConversationStreams, '__streams');
  await page.route('**/api/**', async (route) => {
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
    if (path === '/api/todos') return route.fulfill({ json: todoStatus === 404 ? [] : [task] });
    if (path === `/api/todos/${task.id}`) {
      if (todoReadDelay > 0) await new Promise((resolve) => setTimeout(resolve, todoReadDelay));
      if (todoStatus !== 200) return route.fulfill({ status: todoStatus, json: { error: todoStatus === 404 ? 'not found' : 'todo read failed' } });
      return route.fulfill({ json: task });
    }
    if (path.startsWith('/api/builds/') && path.endsWith('/retry-now') && request.method() === 'POST') {
      const requestedBuild = path.split('/')[3]!;
      const body = (request.postDataJSON() ?? {}) as { clientMessageId?: string };
      const replayed = body.clientMessageId !== undefined && retryNowCalls.some((c) => c.buildId === requestedBuild && c.clientMessageId === body.clientMessageId);
      retryNowCalls.push({ buildId: requestedBuild, clientMessageId: body.clientMessageId });
      if (replayed) return route.fulfill({ status: 202, json: { delegated: true, mode: 'restarted' } });
      if (requestedBuild !== build.id) return route.fulfill({ status: 409, json: { error: 'This run is no longer the latest build' } });
      build.id = 'retried-build';
      task.latestBuildId = build.id;
      task.phase = 'building';
      task.v += 1;
      steps[0] = { ...steps[0]!, buildId: build.id, status: 'pending' };
      return route.fulfill({ status: 202, json: { delegated: true, mode: 'restarted' } });
    }
    if (path === `/api/builds/${build.id}`) return route.fulfill({ json: build });
    if (path === `/api/builds/${build.id}/gate`) return route.fulfill({ json: { state: null } });
    if (path === `/api/builds/${build.id}/changes`) return route.fulfill({ json: { files: [{ path: 'src/kept.ts', status: 'modified', additions: 1, deletions: 0, hunks: [] }] } });
    if (path === `/api/builds/${build.id}/stop`) {
      stops.push(request.postDataJSON() as { discard: boolean });
      return route.fulfill({ json: { delegated: true } });
    }
    if (path === `/api/builds/${build.id}/steps`) return route.fulfill({ json: steps });
    if (path === `/api/todos/${task.id}/messages` && request.method() === 'POST') {
      const input = request.postDataJSON() as { content: string };
      sent.push(input);
      const message = { id: `message-${sent.length}`, role: 'user', content: input.content, createdAt: Date.now() };
      messages.push(message);
      steerPending.push(input.content);
      task.phase = 'building';
      task.v += 1;
      return route.fulfill({ status: 201, json: { todoId: task.id, conversationId: build.id, delivered: 'steer' } });
    }
    if (path === `/api/conversations/${build.id}/messages`) {
      if (request.method() === 'POST') {
        const input = request.postDataJSON() as { content: string; clientMessageId?: string; mode?: string; queuedMessageId?: string; deliverAfterStop?: boolean; cancelQueued?: boolean; editQueued?: boolean };
        const replayed = input.clientMessageId !== undefined && sent.some((earlier) => earlier.clientMessageId === input.clientMessageId);
        if (replayed) return route.fulfill({ status: 201, json: { conversationId: build.id } });
        sent.push(input);
        const message = { id: `message-${sent.length}`, role: 'user', content: input.content, createdAt: Date.now(), ...(input.mode === 'queue' ? { deliverAfterStop: input.deliverAfterStop ?? false } : {}) };
        if (input.editQueued) {
          const row = queuedMessages.find((item) => item.id === input.queuedMessageId);
          if (!row) return route.fulfill({ status: 409, json: { error: 'Queued message was already delivered' } });
          row.content = input.content;
          return route.fulfill({ status: 201, json: { conversationId: build.id } });
        }
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
      if (build.id === 'replacement-build' && targetRead === 'reject')
        return route.fulfill({ status: 503, json: { error: 'Replacement transcript unavailable' } });
      if (build.id === 'replacement-build' && targetRead === 'hold') return new Promise<void>(() => {});
      if (sent.length > 0 && readDelay > 0) await new Promise((resolve) => setTimeout(resolve, readDelay));
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
  const rollover = async () => {
    const source = build.id;
    const queued = queuedMessages.shift()!;
    const message = { id: 'rollover-delivered', role: 'user', content: queued.content, createdAt: Date.now() };
    build.id = 'replacement-build';
    task.latestBuildId = build.id;
    task.v += 1;
    messages.push(message);
    steps[0]!.buildId = build.id;
    await page.evaluate((event) => {
      const streams = (window as unknown as { __streams: { url: string; readyState: number; onmessage: ((event: { data: string }) => void) | null }[] }).__streams;
      const active = streams.find((stream) => stream.url.includes(`/conversations/${event.deliveredQueue.conversationId}/stream`) && stream.readyState === 1);
      if (!active) throw new Error('Source conversation is not subscribed');
      if (streams.some((stream) => stream.url.includes(`/conversations/${event.conversationId}/stream`))) throw new Error('Target subscribed before rollover');
      active.onmessage?.({ data: JSON.stringify(event) });
    }, { type: 'message', conversationId: build.id, message, deliveredQueue: { conversationId: source, messageId: queued.id } });
  };
  const archive = () => {
    Object.assign(task, { archivedAt: 5, v: task.v + 1 });
  };
  return {
    input,
    sent,
    stops,
    steerPending,
    retryNowCalls,
    queuedMessages,
    finish,
    rollover,
    archive,
    setPhase: (phase: string) => { task.phase = phase; },
    setTodoState: (status: number, delayMs = 0) => {
      todoStatus = status;
      todoReadDelay = delayMs;
    },
    failTurn: () => {
      steps[0]!.status = 'failed';
      task.phase = 'failed';
    },
    turns: () => turns,
  };
}

test('a confirmed queue capsule is visible before a slow transcript read without becoming a delivered bubble', async ({ page }) => {
  const task = await runningTask(page, 3000);
  await task.input.fill('Wait for the current turn');
  await task.input.press('Control+Enter');
  await expect(page.getByTestId('composer-card').getByTestId('queued-message')).toContainText('Wait for the current turn', { timeout: 700 });
  await expect(page.getByTestId('user-bubble').filter({ hasText: 'Wait for the current turn' })).toHaveCount(0);
  await expect(task.input).toHaveValue('');
  expect(task.steerPending).toEqual([]);
});

for (const chord of ['Meta+Enter', 'Control+Enter']) {
  test(`${chord} queues without steering and survives reload until completion`, async ({ page }) => {
    const task = await runningTask(page);
    await task.input.fill('Run the next turn');
    await task.input.press(chord);
    await expect(page.getByTestId('composer-card').getByTestId('queued-message')).toBeVisible();
    await expect(page.getByTestId('transcript-col').getByTestId('queued-message')).toHaveCount(0);
    expect(task.steerPending).toEqual([]);
    expect(task.sent).toEqual([{ content: 'Run the next turn', mode: 'queue', clientMessageId: expect.any(String) }]);
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

test('rollover confirms the bubble through the source stream before the target GET finishes', async ({ page }) => {
  const task = await runningTask(page, 3000);
  await task.input.fill('Continue on the replacement build');
  await task.input.press('Control+Enter');
  await expect(page.getByTestId('queued-message')).toBeVisible();
  await task.rollover();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __streams: { url: string; readyState: number }[] }).__streams.some((stream) => stream.url.includes('/conversations/replacement-build/stream') && stream.readyState === 1)), { timeout: 700 }).toBe(true);
  await expect(page.getByTestId('user-bubble').filter({ hasText: 'Continue on the replacement build' })).toHaveCount(1, { timeout: 700 });
  await expect(page.getByTestId('queued-message')).toHaveCount(0, { timeout: 700 });
});

for (const targetRead of ['reject', 'hold'] as const) {
  test(`rollover keeps the surviving queued capsule actionable when the replacement read is ${targetRead === 'reject' ? 'rejected' : 'held'}`, async ({ page }) => {
    const task = await runningTask(page, 0, targetRead);
    await task.input.fill('Deliver A on the replacement build');
    await task.input.press('Control+Enter');
    const capsule = page.getByTestId('composer-card').getByTestId('queued-message');
    await expect(capsule).toHaveCount(1);
    await task.input.fill('B waits behind A');
    await task.input.press('Control+Enter');
    await expect(capsule).toHaveCount(2);
    await task.rollover();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __streams: { url: string; readyState: number }[] }).__streams.some((stream) => stream.url.includes('/conversations/replacement-build/stream') && stream.readyState === 1))).toBe(true);
    await expect(page.getByTestId('user-bubble').filter({ hasText: 'Deliver A on the replacement build' })).toHaveCount(1);
    await expect(capsule).toHaveCount(1);
    await expect(capsule).toContainText('B waits behind A');
    expect(task.queuedMessages.map((row) => row.content)).toEqual(['B waits behind A']);
    await expect(capsule.getByRole('button', { name: '编辑排队消息' })).toBeEnabled();
    await expect(capsule.getByRole('button', { name: '移除' })).toBeEnabled();
    await capsule.getByRole('button', { name: '现在插话' }).click();
    await expect.poll(() => task.sent.at(-1)).toMatchObject({ content: 'B waits behind A', queuedMessageId: 'message-2' });
    await expect(page.getByTestId('user-bubble').filter({ hasText: 'B waits behind A' })).toHaveCount(1);
    await expect(capsule).toHaveCount(0);
    expect(task.queuedMessages).toEqual([]);
  });
}

test('send now removes the capsule as soon as delivery is confirmed despite a slow read', async ({ page }) => {
  const task = await runningTask(page, 3000);
  await task.input.fill('Deliver exactly once');
  await task.input.press('Control+Enter');
  await expect(page.getByTestId('composer-card').getByTestId('queued-message')).toBeVisible();
  await page.getByTestId('steer-queued-message').click();
  await expect(page.getByTestId('user-bubble').filter({ hasText: 'Deliver exactly once' })).toBeVisible({ timeout: 700 });
  await expect(page.getByTestId('composer-card').getByTestId('queued-message')).toHaveCount(0, { timeout: 700 });
  expect(task.steerPending).toEqual(['Deliver exactly once']);
});

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

test('a queued capsule is edited in place: Enter saves, Esc cancels, empty text cancels', async ({ page }) => {
  const task = await runningTask(page);
  await task.input.fill('First draft');
  await task.input.press('Control+Enter');
  const capsule = page.getByTestId('composer-card').getByTestId('queued-message');
  await capsule.getByRole('button', { name: '编辑排队消息' }).click();
  const edit = page.getByRole('textbox', { name: '编辑排队消息' });
  await expect(edit).toBeFocused();
  await expect(page.getByTestId('save-queued-message')).toBeVisible();
  await expect(page.getByTestId('cancel-edit-queued-message')).toBeVisible();
  await expect(page.getByText('回车保存 · Esc 取消')).toBeVisible();
  await edit.fill('Changed and abandoned');
  await edit.press('Escape');
  await expect(capsule).toContainText('First draft');
  expect(task.sent.filter((body) => body.editQueued)).toEqual([]);

  await capsule.getByTestId('queued-message-text').press('Enter');
  await page.getByRole('textbox', { name: '编辑排队消息' }).fill('   ');
  await page.getByRole('textbox', { name: '编辑排队消息' }).press('Enter');
  await expect(capsule).toContainText('First draft');
  expect(task.sent.filter((body) => body.editQueued)).toEqual([]);

  await capsule.getByTestId('queued-message-text').click();
  await page.getByRole('textbox', { name: '编辑排队消息' }).fill('Second draft');
  await page.getByRole('textbox', { name: '编辑排队消息' }).press('Enter');
  await expect(capsule).toContainText('Second draft');
  expect(task.queuedMessages.map((row) => row.content)).toEqual(['Second draft']);
  expect(task.sent.filter((body) => body.editQueued)).toHaveLength(1);
});

test('a capsule dispatched while it is being edited is not resurrected and its edit lands in the composer', async ({ page }) => {
  const task = await runningTask(page);
  await task.input.fill('Dispatch me');
  await task.input.press('Control+Enter');
  const capsule = page.getByTestId('composer-card').getByTestId('queued-message');
  await capsule.getByTestId('queued-message-text').click();
  await page.getByRole('textbox', { name: '编辑排队消息' }).fill('Dispatch me, edited');
  task.finish();
  await page.getByTestId('save-queued-message').click();
  await expect(page.getByTestId('composer-card').getByTestId('queued-message')).toHaveCount(0);
  await expect(task.input).toHaveValue('Dispatch me, edited');
  await expect(page.getByText('这条排队消息已经发出，改动没有生效')).toBeVisible();
  expect(task.queuedMessages).toEqual([]);
  expect(task.turns()).toBe(1);
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
  const capsule = page.getByTestId('queued-message');
  await expect(capsule).toContainText('A stays queued');
  await expect(capsule.getByRole('button', { name: '移除' })).toBeEnabled();
  await expect(capsule.getByRole('button', { name: '现在插话' })).toBeEnabled();
  await expect(page.getByTestId('transcript-col').getByTestId('queued-message')).toHaveCount(0);
  await capsule.getByRole('button', { name: '移除' }).click();
  await expect(capsule).toHaveCount(0);
  const workSummary = page.getByTestId('work-summary');
  await expect(workSummary).toHaveAttribute('aria-expanded', 'false');
  await workSummary.click();
  await expect(page.getByTestId('work-cancelled')).toBeVisible();
  await expect(page.getByTestId('work-cancelled')).toHaveText('已取消');
  await expect(page.getByTestId('work-spinner')).toHaveCount(0);
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
  await expect.poll(() => task.sent).toEqual([{ content: 'A stays queued', mode: 'queue', clientMessageId: expect.any(String) }, { content: 'Use this draft next', mode: 'queue', deliverAfterStop: true, clientMessageId: expect.any(String) }]);
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
  await page.getByTestId('side-chat').getByRole('button', { name: '更多操作…' }).click();
  await page.getByTestId('discard-changes').click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  expect(task.stops).toEqual([]);
  await page.getByRole('alertdialog').getByRole('button', { name: '丢弃修改', exact: true }).click();
  await expect.poll(() => task.stops).toEqual([{ discard: true }]);
});

test('kept changes after Stop do not expose discard', async ({ page }) => {
  const task = await runningTask(page);
  await page.getByTestId('composer-card').getByRole('button', { name: '停止', exact: true }).click();
  await expect.poll(() => task.stops).toEqual([{ discard: false }]);
  task.finish('stopped');
  await page.reload();
  await page.getByTestId('side-chat').getByRole('button', { name: '更多操作…' }).click();
  await expect(page.getByTestId('discard-changes')).toHaveCount(0);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
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

test('queued capsules stay usable when the phase has no composer', async ({ page }) => {
  const task = await runningTask(page);
  await task.input.fill('Still queued after close');
  await task.input.press('Control+Enter');
  await expect(page.getByTestId('composer-card').getByTestId('queued-message')).toBeVisible();
  task.setPhase('closed');
  await page.reload();
  await expect(page.getByTestId('composer-card').getByRole('textbox')).toHaveCount(0);
  const capsule = page.getByTestId('queued-capsules-standalone').getByTestId('queued-message');
  await expect(capsule).toContainText('Still queued after close');
  await capsule.getByRole('button', { name: '移除' }).click();
  await expect(capsule).toHaveCount(0);
  expect(task.sent.at(-1)?.cancelQueued).toBe(true);
});

test('a reload during an unanswered send resends it under its key without opening the task', async ({ page }) => {
  const task = await runningTask(page);
  const held: { clientMessageId?: string }[] = [];
  await page.route('**/api/conversations/completed-build/messages', (route) => {
    if (route.request().method() !== 'POST' || held.length > 0) return route.fallback();
    held.push(route.request().postDataJSON() as { clientMessageId?: string });
    return new Promise<void>(() => {});
  });
  await task.input.fill('Survive the reload');
  await task.input.press('Control+Enter');
  await expect.poll(() => held.length).toBe(1);
  await page.goto('/app');
  await expect.poll(() => task.sent).toEqual([
    { content: 'Survive the reload', mode: 'queue', clientMessageId: held[0]!.clientMessageId },
  ]);
  expect(held[0]!.clientMessageId).toEqual(expect.any(String));
});

test('a send that fails after its task was closed says so and brings the text back', async ({ page }) => {
  const task = await runningTask(page);
  let refuse: (() => Promise<void>) | undefined;
  await page.route('**/api/conversations/completed-build/messages', (route) => {
    if (route.request().method() !== 'POST' || refuse !== undefined) return route.fallback();
    refuse = () => route.fulfill({ status: 500, json: { error: 'refused' } });
  });
  await task.input.fill('Fails behind my back');
  await task.input.press('Control+Enter');
  await expect.poll(() => refuse !== undefined).toBe(true);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '回复这个任务' })).toHaveCount(0);
  await refuse!();
  const toast = page.locator('[data-sonner-toast]');
  await expect(toast).toHaveCount(1);
  await expect(toast).toContainText('有一条消息尚未确认发出');
  await toast.getByRole('button', { name: '打开对话' }).click();
  await expect(page.getByTestId('composer-card').getByRole('textbox')).toHaveValue('Fails behind my back');
});

for (const shut of ['archived', 'closed'] as const)
  test(`an unsent reply on a task ${shut} meanwhile can still be read`, async ({ page }) => {
  const task = await runningTask(page);
  let posts = 0;
  await page.route('**/api/conversations/completed-build/messages', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    posts += 1;
    if (posts === 1) return new Promise<void>(() => {});
    return route.fulfill({ status: 409, json: { error: 'Unarchive to continue' } });
  });
  await task.input.fill('Keep these words readable');
  await task.input.press('Control+Enter');
  await expect.poll(() => posts).toBe(1);
  if (shut === 'archived') task.archive();
  else task.setPhase('closed');
  await page.reload();
  await expect(page.getByTestId('side-chat-unsent-text')).toHaveText('Keep these words readable');
  await page.waitForTimeout(1000);
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
});

test('a saved failed reply stays visible when the task turns missing or unavailable mid-send', async ({ page }) => {
  const task = await runningTask(page);
  let posts = 0;
  await page.route('**/api/conversations/completed-build/messages', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    posts += 1;
    if (posts === 1) return new Promise<void>(() => {});
    return route.fulfill({ status: 500, json: { error: 'Send blew up' } });
  });
  await task.input.fill('Keep failed reply visible across unavailable states');
  await task.input.press('Control+Enter');
  await expect.poll(() => page.getByTestId('user-bubble').filter({ hasText: 'Keep failed reply visible across unavailable states' }).count()).toBe(1);
  await expect.poll(() => posts).toBe(1);

  task.setTodoState(500);
  await page.reload();
  await expect(page.getByTestId('side-chat-unavailable')).toHaveAttribute('data-state', 'error');
  await expect(page.getByTestId('side-chat-unsent-text')).toHaveText('Keep failed reply visible across unavailable states');
  await expect(page.getByTestId('side-chat-send-error')).toBeVisible();

  task.setTodoState(404);
  await page.getByTestId('side-chat-unavailable').getByRole('button', { name: '重试' }).click();
  await expect(page.getByTestId('side-chat-unavailable')).toHaveAttribute('data-state', 'missing');
  await expect(page.getByTestId('side-chat-unsent-text')).toHaveText('Keep failed reply visible across unavailable states');
});

test('double-clicking 立即重试 does not raise a false retry failure toast', async ({ page }) => {
  const task = await runningTask(page);
  task.failTurn();
  task.setTodoState(200, 350);
  await page.reload();
  const retryButton = page.getByTestId('side-chat-action').getByRole('button', { name: '立即重试' });
  await expect(retryButton).toBeVisible();
  await retryButton.click();
  await page.waitForTimeout(80);
  if (await retryButton.isVisible() && (await retryButton.isEnabled())) {
    await retryButton.click();
  }
  await expect.poll(() => task.retryNowCalls.length).toBe(1);
  await page.waitForTimeout(300);
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
});
