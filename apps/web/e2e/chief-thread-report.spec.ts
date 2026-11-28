import { expect, test } from '@playwright/test';
import { createTodoRow, mockLive, PROJECT, TASK, THREAD } from './chief-home-mock';

for (const [label, phase, verified] of [
  ['done', 'done', false],
  ['verified', 'done', true],
  ['failed', 'failed', undefined],
  ['review', 'review', undefined],
] as const) {
  test(`${label}: non-mirrored thread reports add no sub-thread row and the event turn stays silent`, async ({
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
      todos: [{ ...TASK, title: 'Repair board counts', phase: phase === 'done' ? 'done' : phase }],
    });
    await page.goto('/app');
    const stream = page.getByTestId('home-c').getByTestId('chief-stream');
    await expect(stream.getByTestId('chief-sub-thread')).toHaveCount(0);
    await expect(stream.getByTestId('chief-task-started-said')).toHaveCount(0);
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
  await expect(notice.locator('a[data-slot="task-mention"]')).toHaveText('Markdown preview');
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

const report = (id: string, phase: string, createdAt: number, line?: string) => ({
  id,
  role: 'system',
  content: JSON.stringify({
    kind: 'thread-report',
    todoId: TASK.id,
    phase,
    seqNum: TASK.seqNum,
    title: TASK.title,
    ...(line !== undefined ? { line } : {}),
  }),
  createdAt,
});

const relay = (id: string, by: 'user' | 'coordinator', excerpt: string, createdAt: number) => ({
  id,
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

test('a settled task summary from notify_user renders as a reply bubble with an inline task chip and no sub-thread row', async ({
  page,
}) => {
  await mockLive(page, {
    threads: [THREAD],
    messages: [
      {
        id: 'report',
        role: 'system',
        content: JSON.stringify({
          kind: 'thread-report',
          todoId: TASK.id,
          phase: 'done',
          seqNum: TASK.seqNum,
          title: 'quota-wire live check (devin)',
          wakeStepId: 'wake-settle',
        }),
        createdAt: 20,
      },
      {
        id: 'user-wake-step',
        role: 'user',
        content: `[wake:settle] provenance=watch:${TASK.id}\nInternal settle instructions`,
        createdAt: 30,
      },
      {
        id: 'notice',
        role: 'system',
        content: JSON.stringify({
          kind: 'chief_notice',
          message: `[#${TASK.seqNum}](todo:${TASK.id}) 已完成：校验配额线协议通过，改动在工作分支。`,
          provenance: `watch:${TASK.id}`,
        }),
        createdAt: 32,
      },
    ],
    todos: [{ ...TASK, phase: 'done', title: 'quota-wire live check (devin)' }],
  });
  await page.goto('/app');
  const stream = page.getByTestId('home-c').getByTestId('chief-stream');
  await expect(stream.getByTestId('chief-sub-thread')).toHaveCount(0);
  const reply = stream.getByTestId('chief-reply-bubble').last();
  await expect(reply.locator('a[data-slot="task-mention"]')).toHaveText(
    'quota-wire live check (devin)',
  );
  await expect(reply).toContainText('已完成：校验配额线协议通过，改动在工作分支。');
  await expect(stream).not.toContainText('[wake:settle]');
  await expect(stream).not.toContainText('Internal settle instructions');
});

test('reports and relayed messages add no bare sub-thread row to the conversation', async ({
  page,
}) => {
  await mockLive(page, {
    threads: [THREAD],
    messages: [
      { id: 'request', role: 'user', content: 'Add an export', createdAt: 10 },
      relay('m1', 'coordinator', 'Use CSV instead', 20),
      report('q1', 'needs-you', 30, 'Which export format?'),
      relay('m2', 'user', 'JSON please', 40),
      report('q2', 'review', 50),
    ],
    todos: [{ ...TASK, phase: 'needs_input' }],
  });
  await page.goto('/app');
  const stream = page.getByTestId('home-c').getByTestId('chief-stream');
  await expect(stream.getByTestId('chief-sub-thread')).toHaveCount(0);
  await expect(stream.getByTestId('chief-task-started-said')).toHaveCount(0);
  await expect(stream).not.toContainText('Which export format?');
  await expect(stream).not.toContainText('Use CSV instead');
  await expect(stream).not.toContainText('JSON please');
  await expect(stream.getByTestId('thread-report-reply')).toHaveCount(0);
  await expect(stream.getByTestId('thread-report-marker')).toHaveCount(0);
  await expect(stream.getByTestId('chief-bubble')).toHaveText('Add an export');
});

test('a task the reply names in its sentence adds no line, then or for its later reports', async ({
  page,
}) => {
  await mockLive(page, {
    threads: [THREAD],
    messages: [
      { id: 'request', role: 'user', content: 'Add an export', createdAt: 10 },
      createTodoRow('create', TASK, 15),
      {
        id: 'started',
        role: 'assistant',
        content: `Started [#${TASK.seqNum}](todo:${TASK.id}).`,
        createdAt: 20,
      },
      report('q1', 'needs-you', 30, 'Which export format?'),
      {
        id: 'later',
        role: 'assistant',
        content: `[#${TASK.seqNum}](todo:${TASK.id}) is waiting on you.`,
        createdAt: 40,
      },
    ],
    todos: [{ ...TASK, phase: 'needs_input' }],
  });
  await page.goto('/app');
  const stream = page.getByTestId('home-c').getByTestId('chief-stream');
  await expect(stream.getByTestId('chief-task-started-said')).toHaveCount(0);
  await expect(stream.getByTestId('chief-sub-thread')).toHaveCount(0);
  const first = stream.getByTestId('chief-msg').filter({ hasText: 'Started' });
  await expect(first.locator('a[data-slot="task-mention"]')).toHaveText(TASK.title);
  await expect(stream.locator('a[data-slot="task-mention"]')).toHaveCount(2);
});

test('a split request hangs both tasks on the trunk above the reply, in order; the code task says what it waits for', async ({
  page,
}) => {
  const research = {
    ...TASK,
    id: 'todo-research',
    seqNum: 10,
    title: 'Research export formats',
    phase: 'building',
    output: 'info',
  };
  await mockLive(page, {
    threads: [THREAD],
    messages: [
      { id: 'request', role: 'user', content: 'Research export formats first, then add an export', createdAt: 10 },
      createTodoRow('create-research', research, 14),
      createTodoRow('create', TASK, 15),
      {
        id: 'started',
        role: 'assistant',
        content: 'Split in two: the research first, then the export.',
        createdAt: 20,
      },
    ],
    todos: [research, { ...TASK, phase: 'queued', blockedBy: [research.id] }],
  });
  await page.goto('/app');
  const stream = page.getByTestId('home-c').getByTestId('chief-stream');
  await expect(stream.getByTestId('chief-task-started-said')).toHaveCount(0);
  await expect(stream).not.toContainText('已建任务');
  const trunk = stream.getByTestId('chief-task-trunk');
  await expect(trunk).toHaveCount(1);
  const refs = trunk.getByTestId('chief-task-ref');
  await expect(refs).toHaveText([/Research export formats/, new RegExp(TASK.title)]);
  await expect(page.locator('[data-grow]')).toHaveCount(0);
  const reply = stream.getByTestId('chief-reply').filter({ hasText: 'Split in two' });
  expect((await trunk.boundingBox())!.y).toBeLessThan((await reply.boundingBox())!.y);
  await expect(refs.nth(1)).toHaveAccessibleName(/等「Research export formats」/);
  await refs.nth(1).hover();
  await expect(page.getByTestId('chief-task-ref-hover')).toContainText('等「Research export formats」');
});

test('a research report is one card under its research row; hover shows a summary and a click opens the document', async ({
  page,
}) => {
  const research = {
    ...TASK,
    id: 'todo-research',
    seqNum: 10,
    title: 'Research export formats',
    phase: 'needs_input',
    output: 'info',
    latestBuildId: 'build-research',
  };
  const report = {
    id: 'info-report-build-research',
    role: 'system',
    createdAt: 30,
    content: JSON.stringify({
      kind: 'info-report',
      attachmentId: 'att-r',
      attachmentToken: '![report.md](attachment:t1/att-r.md)',
      content: '## Export formats\n\nParquet halves the file size of CSV.\n\n- Parquet keeps types\n- CSV opens anywhere',
    }),
  };
  const state = {
    threads: [THREAD],
    messages: [
      { id: 'request', role: 'user', content: 'Add an export', createdAt: 10 },
      createTodoRow('create-research', research, 14),
      createTodoRow('create', TASK, 15),
      {
        id: 'started',
        role: 'assistant',
        content: 'Started both; the export waits for the research.',
        createdAt: 20,
      },
    ],
    todos: [{ ...TASK, phase: 'queued', blockedBy: [research.id] }, research],
  };
  await mockLive(page, state, (path, route, json) =>
    path === '/api/conversations/build-research/messages'
      ? json({ messages: [report], chips: null, historyEpoch: 0, steerPending: [], activeRun: null, nextCursor: null })
      : path === '/api/attachments/att-r'
        ? route.fulfill({
            status: 200,
            contentType: 'text/markdown; charset=utf-8',
            body: '## Export formats\n\nParquet halves the file size of CSV.\n\n- Parquet keeps types\n- CSV opens anywhere',
          })
        : undefined,
  );
  await page.goto('/app');
  const reply = page.getByTestId('home-c').getByTestId('chief-msg').filter({ hasText: 'Started' });
  const card = reply.getByTestId('chief-reply-bubble').getByTestId('research-report-card');
  await expect(card).toHaveCount(1);
  await expect(card).toHaveText('Research export formats');
  await expect(card).toHaveAttribute('data-stage', 'draft');
  await expect(card).not.toHaveAttribute('data-grow');
  await expect(page.getByTestId('chief-question-report')).toHaveCount(0);

  await card.hover();
  await expect(page.getByTestId('research-report-hover')).toContainText(
    'Parquet halves the file size of CSV.',
  );
  await card.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const panel = page.getByTestId('artifact-panel');
  await expect(panel.locator('[data-testid="artifact-tab"][data-active]')).toHaveText('Research export formats');
  const doc = panel.getByTestId('research-report-doc');
  await expect(doc.getByText('Parquet keeps types')).toBeVisible();
  await expect(doc.getByRole('link', { name: 'report.md' })).toHaveCount(0);
  await expect(panel.locator('[data-testid="artifact-tab"][data-active]')).toHaveText('Research export formats');
});

test('a research card in Made opens its report as a document; one with no report opens its thread', async ({
  page,
}) => {
  const research = {
    ...TASK,
    id: 'todo-research',
    seqNum: 10,
    title: 'Research export formats',
    phase: 'done',
    output: 'info',
    latestBuildId: 'build-research',
  };
  const bare = {
    ...TASK,
    id: 'todo-bare',
    seqNum: 11,
    title: 'Research cache layers',
    phase: 'done',
    output: 'info',
    latestBuildId: 'build-bare',
  };
  const report = {
    id: 'info-report-build-research',
    role: 'system',
    createdAt: 30,
    content: JSON.stringify({
      kind: 'info-report',
      attachmentId: 'att-r',
      attachmentToken: '![report.md](attachment:t1/att-r.md)',
      content: '## Export formats\n\nParquet halves the file size of CSV.\n\n- Parquet keeps types',
    }),
  };
  const page0 = { chips: null, historyEpoch: 0, steerPending: [], activeRun: null, nextCursor: null };
  await mockLive(page, { threads: [THREAD], messages: [], todos: [research, bare] }, (path, route, json) =>
    path === '/api/conversations/build-research/messages'
      ? json({ messages: [report], ...page0 })
      : path === '/api/conversations/build-bare/messages'
        ? json({ messages: [], ...page0 })
        : path === '/api/attachments/att-r'
          ? route.fulfill({
              status: 200,
              contentType: 'text/markdown; charset=utf-8',
              body: '## Export formats\n\nParquet halves the file size of CSV.\n\n- Parquet keeps types',
            })
          : undefined,
  );
  await page.goto('/app?pane=made');
  const made = page.getByRole('complementary', { name: '成果' });
  await made.getByRole('button', { name: 'Research export formats' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const panel = page.getByTestId('artifact-panel');
  await expect(panel.locator('[data-testid="artifact-tab"][data-active]')).toHaveText('Research export formats');
  await expect(panel.getByTestId('research-report-meta')).toContainText('定稿');
  await expect(panel.getByTestId('research-report-doc')).toContainText('Parquet keeps types');
  await expect(panel.getByTestId('research-report-doc').getByRole('link', { name: 'report.md' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);

  await page.goto('/app?pane=made');
  await made.getByRole('button', { name: 'Research cache layers' }).click();
  await expect(page).toHaveURL(/todo-bare/);
  await expect(page.getByTestId('research-report-doc')).toHaveCount(0);
});

test('a task created with no reply after it stands as one task row with its live state', async ({ page }) => {
  await mockLive(page, {
    threads: [THREAD],
    messages: [
      { id: 'ask', role: 'user', content: 'Create HELLO.md', createdAt: 10 },
      createTodoRow('create', { ...TASK, title: 'Create HELLO.md' }, 20),
    ],
    todos: [{ ...TASK, title: 'Create HELLO.md', phase: 'building' }],
  });
  await page.goto('/app');
  const started = page.getByTestId('home-c').getByTestId('chief-task-started');
  await expect(started).not.toContainText('已建任务');
  const ref = started.getByTestId('chief-task-ref');
  await expect(ref).toHaveText(/^Create HELLO\.md/);
  await expect(ref).toHaveAttribute('data-phase', 'building');
});

test('an archived task keeps its word in its task row', async ({ page }) => {
  await mockLive(page, {
    threads: [THREAD],
    messages: [
      { id: 'ask', role: 'user', content: 'Create HELLO.md', createdAt: 10 },
      createTodoRow('create', { ...TASK, title: 'Create HELLO.md' }, 20),
    ],
    todos: [],
    archivedTodos: [{ ...TASK, title: 'Create HELLO.md', phase: 'done', archivedAt: 30 }],
  });
  await page.goto('/app');
  const started = page.getByTestId('home-c').getByTestId('chief-task-started');
  const ref = started.getByTestId('chief-task-ref');
  await expect(ref).toHaveText(/^Create HELLO\.md/);
  await expect(ref).toHaveAttribute('data-phase', 'done');
  await expect(started).not.toContainText('已建任务');
  await expect(page.getByTestId('chief-task-created')).toHaveCount(0);
});

test('a task archived in the same turn leaves no row and the next task hangs on the trunk above the reply', async ({
  page,
}) => {
  const dropped = { ...TASK, id: 'todo-old', seqNum: 9, title: 'Draft the old brief' };
  const kept = { ...TASK, id: 'todo-new', seqNum: 10, title: 'Draft the new brief' };
  await mockLive(page, {
    threads: [THREAD],
    messages: [
      { id: 'ask', role: 'user', content: 'Research the brief', createdAt: 10 },
      createTodoRow('create-old', dropped, 20),
      {
        id: 'archive-old',
        role: 'assistant',
        content: {
          kind: 'toolcall',
          call: {
            id: 'c-archive-old',
            name: 'archive_todos',
            arguments: { todoIds: ['todo-old'], supersededBy: 'todo-new' },
            result: { transitioned: ['todo-old'], skipped: [], archived: ['todo-old'] },
            startedAt: 30,
            endedAt: 31,
          },
        },
        createdAt: 30,
      },
      createTodoRow('create-new', kept, 40),
      {
        id: 'reply',
        role: 'assistant',
        content: 'The old brief was too broad, so I closed it.\n\nThe new one is running.',
        createdAt: 50,
      },
    ],
    todos: [{ ...kept, phase: 'building' }],
    archivedTodos: [{ ...dropped, phase: 'closed', archivedAt: 31 }],
  });
  await page.goto('/app');
  const stream = page.getByTestId('home-c').getByTestId('chief-stream');
  await expect(stream.getByTestId('chief-task-started')).toHaveCount(0);
  await expect(stream.getByTestId('chief-task-created')).toHaveCount(0);
  await expect(stream.getByTestId('chief-task-started-said')).toHaveCount(0);
  const trunk = stream.getByTestId('chief-task-trunk');
  await expect(trunk).toHaveCount(1);
  await expect(trunk.getByTestId('chief-task-ref')).toHaveText([/Draft the new brief/]);
  const line = await trunk.boundingBox();
  const bubble = await stream.getByTestId('chief-reply').first().boundingBox();
  expect((line?.y ?? 0) + (line?.height ?? 0)).toBeLessThanOrEqual(bubble?.y ?? 0);
});

test('C27: a research report copies as its Markdown source from the artifact panel toolbar', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const research = {
    ...TASK,
    id: 'todo-research',
    seqNum: 10,
    title: 'Research export formats',
    phase: 'done',
    output: 'info',
    latestBuildId: 'build-research',
  };
  const source = [
    '## Export formats',
    '',
    'Parquet halves the file size of [CSV](https://example.com/csv).',
    '',
    '| Format | Size |',
    '| --- | --- |',
    '| Parquet | 1x |',
    '| CSV | 2x |',
    '',
    '```sql',
    "COPY t TO 'out.parquet';",
    '```',
  ].join('\n');
  const report = {
    id: 'info-report-build-research',
    role: 'system',
    createdAt: 30,
    content: JSON.stringify({
      kind: 'info-report',
      attachmentId: 'att-r',
      attachmentToken: '![report.md](attachment:t1/att-r.md)',
      content: source,
    }),
  };
  await mockLive(page, { threads: [THREAD], messages: [], todos: [research] }, (path, route, json) =>
    path === '/api/conversations/build-research/messages'
      ? json({ messages: [report], chips: null, historyEpoch: 0, steerPending: [], activeRun: null, nextCursor: null })
      : path === '/api/attachments/att-r'
        ? route.fulfill({ status: 200, contentType: 'text/markdown; charset=utf-8', body: source })
        : undefined,
  );
  await page.goto('/app?pane=made');
  await page.getByRole('complementary', { name: '成果' }).getByRole('button', { name: 'Research export formats' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const panel = page.getByTestId('artifact-panel');
  const copy = panel.getByTestId('artifact-copy');
  await expect(copy, 'C27: one copy action on the report').toHaveCount(1);
  await expect(copy, 'C27: the copy button names itself').toHaveAccessibleName('复制为 Markdown');
  await expect(copy, 'C27: the document action is icon-only').toHaveText('');
  await copy.hover();
  await expect(page.locator('[data-slot="tooltip-content"]'), 'C4: the icon button names itself').toHaveText('复制为 Markdown');
  await copy.click();
  await expect(copy).toHaveAttribute('data-copied', '');
  await expect(copy).toHaveAccessibleName('已复制');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(source);
});

test('a mirrored task row keeps its status word and Open link inside a 390px viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const longName = 'no-deliverable-verify-1795835635071';
  const channelTitle = 'Repair board counts across every column and the empty state';
  await mockLive(page, {
    threads: [
      THREAD,
      { ...THREAD, id: 'chief-long', projectId: 'proj-long', title: longName },
    ],
    projects: [{ ...PROJECT, id: 'proj-long', name: longName }],
    messages: [
      { id: 'request', role: 'user', content: 'Repair the board counts', createdAt: 10 },
      {
        id: 'report',
        role: 'system',
        content: JSON.stringify({
          kind: 'thread-report',
          todoId: TASK.id,
          phase: 'done',
          seqNum: TASK.seqNum,
          title: channelTitle,
          fromThreadId: 'chief-long',
        }),
        createdAt: 20,
      },
    ],
    todos: [{ ...TASK, phase: 'done' }],
  });
  await page.goto('/app');
  const row = page.getByTestId('home-c').getByTestId('chief-channel-mirror');
  await expect(row).toHaveCount(1);
  const open = row.getByRole('link');
  await expect(open, 'one Open link on the row').toHaveText('去看');
  const box = await open.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x, 'the Open link starts inside the row').toBeGreaterThan(0);
  expect(
    Math.round(box!.x + box!.width),
    'the Open link stays inside the 390px viewport',
  ).toBeLessThanOrEqual(390);
  await expect(row).toContainText('已完成');
  const titled = await row
    .locator('[title]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('title')));
  expect(titled, 'the name and the title carry their full text').toEqual([
    `${longName} 频道`,
    channelTitle,
  ]);
  for (const span of await row.locator('[title]').all()) {
    const width = await span.evaluate((node) => ({
      client: node.clientWidth,
      scroll: node.scrollWidth,
    }));
    expect(width.scroll, 'the long parts truncate instead of overflowing the row').toBeGreaterThan(
      width.client,
    );
  }
});

test('a short channel name stays whole at 390px while the task title truncates', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const channelTitle =
    '修复定时任务运行回复按任务自身时区显示，同时处理跨时区的夏令时边界';
  await mockLive(page, {
    threads: [THREAD, { ...THREAD, id: 'chief-cairn', projectId: 'proj-cairn', title: 'Cairn' }],
    projects: [{ ...PROJECT, id: 'proj-cairn', name: 'Cairn' }],
    messages: [
      { id: 'request', role: 'user', content: 'Fix the schedule timezone', createdAt: 10 },
      {
        id: 'report',
        role: 'system',
        content: JSON.stringify({
          kind: 'thread-report',
          todoId: TASK.id,
          phase: 'done',
          seqNum: TASK.seqNum,
          title: channelTitle,
          fromThreadId: 'chief-cairn',
        }),
        createdAt: 20,
      },
    ],
    todos: [{ ...TASK, phase: 'done' }],
  });
  await page.goto('/app');
  const row = page.getByTestId('home-c').getByTestId('chief-channel-mirror');
  await expect(row).toHaveCount(1);
  const name = row.locator('[title="Cairn 频道"]');
  const width = await name.evaluate((node) => ({
    client: node.clientWidth,
    scroll: node.scrollWidth,
  }));
  expect(width.scroll, 'a short channel name is never abbreviated').toBe(width.client);
  const title = row.locator(`[title="${channelTitle}"]`);
  const titleWidth = await title.evaluate((node) => ({
    client: node.clientWidth,
    scroll: node.scrollWidth,
  }));
  expect(titleWidth.scroll, 'the long task title truncates so the row fits').toBeGreaterThan(
    titleWidth.client,
  );
  const box = await row.getByRole('link').boundingBox();
  expect(box).not.toBeNull();
  expect(Math.round(box!.x + box!.width), 'the Open link stays inside 390px').toBeLessThanOrEqual(
    390,
  );
  const line = await row.evaluate((node) => node.scrollWidth - node.clientWidth);
  expect(line, 'the row does not overflow horizontally').toBeLessThanOrEqual(0);
});

test('a settled task offers Details beside its reply, and only for the settle echo that names it', async ({
  page,
}) => {
  const notice = (id: string, provenance: string, createdAt: number) => ({
    id,
    role: 'system',
    content: JSON.stringify({
      kind: 'chief_notice',
      message: 'Q3 复盘那页补好了，现在能直接发给客户。',
      provenance,
    }),
    createdAt,
  });
  await mockLive(page, {
    threads: [THREAD],
    messages: [
      { id: 'ask', role: 'user', content: '给周报补一页 Q3 复盘', createdAt: 10 },
      notice('plain', 'user', 20),
      {
        id: 'user-wake-step',
        role: 'user',
        content: `[wake:settle] provenance=watch:${TASK.id}\nInternal settle instructions`,
        createdAt: 30,
      },
      notice('settled', `watch:${TASK.id}`, 32),
    ],
    todos: [{ ...TASK, phase: 'done' }],
  });
  await page.goto('/app');
  const stream = page.getByTestId('home-c').getByTestId('chief-stream');
  const replies = stream.getByTestId('chief-msg').filter({ hasText: 'Q3 复盘那页补好了' });
  await expect(replies).toHaveCount(2);
  await expect(replies.first().getByTestId('chief-reply-details')).toHaveCount(0);
  const details = replies.last().getByTestId('chief-reply-details');
  await expect(details).toHaveText('详情');
  await expect(details.locator('xpath=ancestor::*[@data-slot="message-bubble"]')).toHaveCount(0);
  await details.click();
  await expect(page).toHaveURL(new RegExp(`[?&]thread=${TASK.id}`));
});
