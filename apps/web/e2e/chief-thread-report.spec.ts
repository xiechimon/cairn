import { expect, test } from '@playwright/test';
import { mockLive, TASK, THREAD } from './chief-home-mock';

const STATUS = {
  done: '已完成',
  verified: '已完成',
  failed: '失败',
  review: '审阅中',
} as const;

for (const [label, phase, verified] of [
  ['done', 'done', false],
  ['verified', 'done', true],
  ['failed', 'failed', undefined],
  ['review', 'review', undefined],
] as const) {
  test(`${label}: the task report names its status and the event turn stays silent`, async ({
    page,
  }) => {
    await mockLive(page, {
      threads: [THREAD],
      messages: [
        { id: 'request', role: 'user', content: 'Repair the board counts', createdAt: 10 },
        {
          id: 'report',
          role: 'system',
          content: JSON.stringify({
            kind: 'thread-report',
            todoId: TASK.id,
            phase,
            seqNum: TASK.seqNum,
            title: 'Repair board counts',
            wakeStepId: 'wake-step',
            ...(verified !== undefined ? { verified } : {}),
          }),
          createdAt: 20,
        },
        {
          id: 'user-wake-step',
          role: 'user',
          content: `[wake:${phase === 'done' ? 'settle' : phase === 'failed' ? 'failed' : 'gate'}] provenance=watch:${TASK.id}\nInternal worker reporting instructions`,
          createdAt: 30,
        },
        {
          id: 'summary',
          role: 'assistant',
          content: `The worker has reported ${phase}.`,
          createdAt: 31,
        },
      ],
      todos: [],
    });
    await page.goto('/app');
    const stream = page.getByTestId('home-c').getByTestId('chief-stream');
    const marker = stream.getByTestId('thread-report-marker');
    await expect(marker).toHaveText(`Repair board counts：${STATUS[label]}`);
    await expect(marker.getByRole('link')).toHaveAttribute('href', `/app?thread=${TASK.id}`);
    await expect(stream.getByTestId('chief-bubble')).toHaveCount(1);
    await expect(stream).not.toContainText('[wake:');
    await expect(stream).not.toContainText('Internal worker reporting instructions');
    await expect(stream).not.toContainText(`The worker has reported ${phase}.`);
  });
}

test('a prose attachment citation in a notice renders as a chip', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const reportKey = 'team-1/hg4lgHMHQLnQBHR3CImra.md';
  const at = Date.now();
  await mockLive(
    page,
    {
      threads: [THREAD],
      todos: [{ ...TASK, id: 'todo-173', seqNum: 173, phase: 'done', title: 'Markdown preview' }],
      messages: [
        {
          id: 'notice',
          role: 'system',
          content: JSON.stringify({
            kind: 'chief_notice',
            message: `[#173](todo:todo-173) 调研与方案已验收，尚未实现。建议：点击 Markdown 附件。\n[完整报告](attachment:${reportKey})`,
            provenance: 'watch:todo-173',
          }),
          createdAt: at,
        },
        {
          id: 'unchanged',
          role: 'assistant',
          content:
            '仍是链接 [docs](https://example.com/docs)。别点 [click](javascript:alert(1))。\n![shot](attachment:team-1/shot.png)',
          createdAt: at,
        },
      ],
    },
    (path, route) => {
      if (!path.startsWith('/api/attachments/')) return undefined;
      return route.fulfill({
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAGAAAAAwCAIAAABhdOiYAAAAZElEQVR4nO3QMQ0AIADAMNQhB2GoxAGc7GgyAUvHXFuXxveDeIAAAQIEKBwgQIAAAQoHCBAgQIDCAQIECBCgcIAAAQIEKBwgQIAAAQoHCBAgQIDCAQIECBCgcIAAAQIEKBygRwfhbp1pnik9bgAAAABJRU5ErkJggg==',
          'base64',
        ),
      });
    },
  );
  await page.goto('/app');
  const stream = page.getByTestId('home-c').getByTestId('chief-stream');
  const notice = stream.getByTestId('chief-msg').first();
  const report = notice.getByRole('link', { name: '完整报告' });
  await expect(report).toHaveAttribute('href', '/api/attachments/hg4lgHMHQLnQBHR3CImra');
  await expect(notice).not.toContainText('attachment:');
  await expect(notice.locator('.mention-chip--todo')).toHaveText('Markdown preview');
  await expect(notice).not.toContainText('#173');
  const unchanged = stream.getByTestId('chief-msg').nth(1);
  await expect(unchanged.getByRole('link', { name: 'docs' })).toHaveAttribute(
    'href',
    'https://example.com/docs',
  );
  await expect(unchanged).toContainText('[click](javascript:alert(1))');
  await expect(unchanged.getByRole('img', { name: 'shot' })).toBeVisible();
  const shotDir = process.env.ATTACHMENT_SHOT_DIR;
  if (shotDir !== undefined) {
    const padded = async (locator: typeof notice, name: string) => {
      const box = await locator.boundingBox();
      if (box === null) return;
      await page.screenshot({
        path: `${shotDir}/${name}.png`,
        clip: {
          x: Math.max(0, box.x - 12),
          y: Math.max(0, box.y - 12),
          width: box.width + 24,
          height: box.height + 24,
        },
      });
    };
    await padded(notice, 'after');
    await padded(unchanged, 'unchanged');
  }
});

test('a notify_user notice from an event turn shows in the conversation', async ({ page }) => {
  await mockLive(page, {
    threads: [THREAD],
    messages: [
      { id: 'request', role: 'user', content: 'Repair the board counts', createdAt: 10 },
      {
        id: 'user-wake-step',
        role: 'user',
        content: `[wake:failed] provenance=watch:${TASK.id}\nInternal failure instructions`,
        createdAt: 30,
      },
      { id: 'wake-thoughts', role: 'assistant', content: 'Checking machines first.', createdAt: 31 },
      {
        id: 'notice',
        role: 'system',
        content: JSON.stringify({
          kind: 'chief_notice',
          message: '#9 failed twice on the same machine. Move it to another machine?',
          provenance: `watch:${TASK.id}`,
        }),
        createdAt: 32,
      },
    ],
    todos: [],
  });
  await page.goto('/app');
  const stream = page.getByTestId('home-c').getByTestId('chief-stream');
  await expect(stream.getByTestId('chief-msg').last()).toContainText(
    '#9 failed twice on the same machine. Move it to another machine?',
  );
  await expect(stream).not.toContainText('Checking machines first.');
  await expect(stream).not.toContainText('Internal failure instructions');
});

const NEEDS_YOU_ROWS = [
  { id: 'request', role: 'user', content: 'Add an export', createdAt: 10 },
  {
    id: 'report',
    role: 'system',
    content: JSON.stringify({
      kind: 'thread-report',
      todoId: TASK.id,
      phase: 'needs-you',
      seqNum: TASK.seqNum,
      title: 'Add an export',
      line: 'Which export format?',
    }),
    createdAt: 20,
  },
];

test('a needs-you report shows the thread own line and answers the question through the thread message path', async ({
  page,
}) => {
  const sent: Record<string, unknown>[] = [];
  await mockLive(
    page,
    {
      threads: [THREAD],
      messages: NEEDS_YOU_ROWS,
      todos: [{ ...TASK, phase: 'needs_input' }],
    },
    (path, route, json) => {
      if (path !== `/api/todos/${TASK.id}/messages` || route.request().method() !== 'POST') return;
      sent.push(route.request().postDataJSON() as Record<string, unknown>);
      return json({ todoId: TASK.id, conversationId: 'build-1', delivered: 'steer' }, 201);
    },
  );
  await page.goto('/app');
  const stream = page.getByTestId('home-c').getByTestId('chief-stream');
  const marker = stream.getByTestId('thread-report-marker');
  await expect(marker).toHaveAttribute('data-phase', 'needs-you');
  await expect(marker).toHaveText('Add an export：待你决定Which export format?');
  await stream.getByTestId('thread-report-reply').getByRole('button', { name: '回复' }).click();
  await page.getByRole('textbox', { name: '回复这个任务' }).fill('JSON please');
  await page.keyboard.press('Enter');
  await expect.poll(() => sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ content: 'JSON please' });
  expect(typeof sent[0]?.clientMessageId).toBe('string');
});

test('a needs-you report offers no reply once the question is answered', async ({ page }) => {
  await mockLive(page, {
    threads: [THREAD],
    messages: NEEDS_YOU_ROWS,
    todos: [{ ...TASK, phase: 'building' }],
  });
  await page.goto('/app');
  const stream = page.getByTestId('home-c').getByTestId('chief-stream');
  await expect(stream.getByTestId('thread-report-marker')).toBeVisible();
  await expect(stream.getByTestId('thread-report-reply')).toHaveCount(0);
});

test('only the newest needs-you report of a thread offers a reply', async ({ page }) => {
  const asked = (id: string, line: string, createdAt: number) => ({
    id,
    role: 'system',
    content: JSON.stringify({
      kind: 'thread-report',
      todoId: TASK.id,
      phase: 'needs-you',
      seqNum: TASK.seqNum,
      title: 'Add an export',
      line,
    }),
    createdAt,
  });
  await mockLive(page, {
    threads: [THREAD],
    messages: [
      { id: 'request', role: 'user', content: 'Add an export', createdAt: 10 },
      asked('first-question', 'Which export format?', 20),
      asked('second-question', 'Which delimiter?', 30),
    ],
    todos: [{ ...TASK, phase: 'needs_input' }],
  });
  await page.goto('/app');
  const stream = page.getByTestId('home-c').getByTestId('chief-stream');
  await expect(stream.getByTestId('thread-report-marker')).toHaveCount(2);
  await expect(stream.getByTestId('thread-report-reply')).toHaveCount(1);
  const replyAfter = (text: string) =>
    stream
      .getByTestId('thread-report-marker')
      .filter({ hasText: text })
      .locator('xpath=following-sibling::*[@data-testid="thread-report-reply"]');
  await expect(replyAfter('Which delimiter?')).toHaveCount(1);
  await expect(replyAfter('Which export format?')).toHaveCount(0);
});

test('user relay markers stay hidden while Coordinator messages remain visible', async ({ page }) => {
  const marker = (by: 'user' | 'coordinator', excerpt: string, createdAt: number) => ({
    id: `msg-${by}`,
    role: 'system',
    content: JSON.stringify({
      kind: 'thread-message',
      todoId: TASK.id,
      seqNum: TASK.seqNum,
      title: TASK.title,
      excerpt,
      delivered: 'steer',
      conversationId: 'build-1',
      by,
    }),
    createdAt,
  });
  await mockLive(page, {
    threads: [THREAD],
    messages: [
      { id: 'request', role: 'user', content: 'Add an export', createdAt: 10 },
      marker('user', 'JSON please', 20),
      marker('coordinator', 'Use CSV instead', 30),
    ],
    todos: [],
  });
  await page.goto('/app');
  const stream = page.getByTestId('home-c').getByTestId('chief-stream');
  await expect(stream.getByTestId('thread-activity')).toHaveCount(0);
  await expect(stream.getByTestId('thread-message-marker')).toHaveText(`Coordinator 直接对 ${TASK.title} 说：Use CSV instead`);
  await expect(stream).not.toContainText('JSON please');
  await expect(stream.getByTestId('chief-bubble')).toHaveText('Add an export');
});

test('events about one thread coalesce, repeated statuses dedupe, another thread breaks the group', async ({
  page,
}) => {
  const event = (
    id: string,
    content: Record<string, unknown>,
    createdAt: number,
    thread = { todoId: TASK.id, seqNum: TASK.seqNum, title: TASK.title },
  ) => ({
    id,
    role: 'system',
    content: JSON.stringify({ ...thread, ...content }),
    createdAt,
  });
  const message = (
    id: string,
    createdAt: number,
    thread?: { todoId: string; seqNum: number; title: string },
  ) =>
    event(
      id,
      { kind: 'thread-message', excerpt: id, delivered: 'steer', conversationId: 'build-1', by: 'coordinator' },
      createdAt,
      thread,
    );
  const review = (id: string, createdAt: number) =>
    event(id, { kind: 'thread-report', phase: 'review' }, createdAt);
  await mockLive(page, {
    threads: [THREAD],
    messages: [
      { id: 'request', role: 'user', content: 'Add an export', createdAt: 10 },
      message('one', 20),
      message('two', 21),
      review('r1', 22),
      review('r2', 23),
      message('elsewhere', 24, { todoId: 'other-todo', seqNum: 3, title: 'Trim the log' }),
    ],
    todos: [],
  });
  await page.goto('/app');
  const stream = page.getByTestId('home-c').getByTestId('chief-stream');
  const group = stream.getByTestId('thread-activity');
  await expect(group).toHaveCount(1);
  await expect(group.getByTestId('thread-activity-summary')).toHaveText(`${TASK.title} · 2 次追问 · 审阅中`);
  await group.getByTestId('thread-activity-toggle').click();
  await expect(group.getByTestId('thread-activity-event')).toHaveCount(3);
  await expect(stream.getByTestId('thread-message-marker')).toHaveText('Coordinator 直接对 Trim the log 说：elsewhere');
  const box = await group.getByTestId('thread-activity-summary').boundingBox();
  const chat = await stream.boundingBox();
  if (box === null || chat === null) throw new Error('no box');
  expect(box.x - chat.x).toBeLessThan(40);
  const decoration = await group.getByTestId('thread-activity-summary').evaluate((node) => getComputedStyle(node).textDecorationLine);
  expect(decoration).toBe('none');
});

test('a parked question keeps its reply after a later review report', async ({ page }) => {
  const report = (id: string, phase: string, createdAt: number) => ({
    id,
    role: 'system',
    content: JSON.stringify({
      kind: 'thread-report',
      todoId: TASK.id,
      phase,
      seqNum: TASK.seqNum,
      title: 'Add an export',
      ...(phase === 'needs-you' ? { line: 'Which export format?' } : {}),
    }),
    createdAt,
  });
  await mockLive(page, {
    threads: [THREAD],
    messages: [
      { id: 'request', role: 'user', content: 'Add an export', createdAt: 10 },
      report('question', 'needs-you', 20),
      report('parked', 'review', 30),
    ],
    todos: [{ ...TASK, phase: 'needs_input' }],
  });
  await page.goto('/app');
  const stream = page.getByTestId('home-c').getByTestId('chief-stream');
  await expect(stream.getByTestId('thread-report-marker')).toHaveCount(2);
  await expect(stream.getByTestId('thread-report-reply')).toHaveCount(1);
  await expect(
    stream
      .getByTestId('thread-report-marker')
      .filter({ hasText: 'Which export format?' })
      .locator('xpath=following-sibling::*[@data-testid="thread-report-reply"]'),
  ).toHaveCount(1);
});
