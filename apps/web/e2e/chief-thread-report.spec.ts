import { expect, test } from '@playwright/test';
import { mockLive, TASK, THREAD } from './chief-home-mock';

for (const [label, phase, verified] of [
  ['done', 'done', false],
  ['verified', 'done', true],
  ['failed', 'failed', undefined],
  ['review', 'review', undefined],
] as const) {
  test(`${label}: the task report is one title-only sub-thread row and the event turn stays silent`, async ({
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
    const row = stream.getByTestId('chief-sub-thread').getByTestId('chief-task-ref');
    await expect(row).toHaveCount(1);
    await expect(row).toHaveText(/^Repair board counts/);
    await expect(row).toHaveAttribute('href', `/app?thread=${TASK.id}`);
    await expect(row.locator('[data-slot="task-ref-elbow"]')).toHaveCount(0);
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

test('reports and relayed messages of one thread show one sub-thread row with no text, no reply and no report icon', async ({
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
  const row = stream.getByTestId('chief-sub-thread');
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId('chief-task-ref')).toHaveAttribute('data-phase', 'needs_input');
  await expect(stream).not.toContainText('Which export format?');
  await expect(stream).not.toContainText('Use CSV instead');
  await expect(stream).not.toContainText('JSON please');
  await expect(stream.getByTestId('thread-report-reply')).toHaveCount(0);
  await expect(stream.getByTestId('thread-report-marker')).toHaveCount(0);
  await expect(stream.getByTestId('chief-bubble')).toHaveText('Add an export');
});

test('a thread already shown under the reply that started it adds no row for its later reports', async ({
  page,
}) => {
  await mockLive(page, {
    threads: [THREAD],
    messages: [
      { id: 'request', role: 'user', content: 'Add an export', createdAt: 10 },
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
  await expect(stream.getByTestId('chief-task-ref')).toHaveCount(1);
  await expect(stream.getByTestId('chief-sub-thread')).toHaveCount(0);
  const first = stream.getByTestId('chief-msg').filter({ hasText: 'Started' });
  await expect(first.getByTestId('chief-task-ref')).toHaveCount(1);
});

test('research opened before planning hangs under its code task as a nested row', async ({
  page,
}) => {
  const research = {
    ...TASK,
    id: 'todo-research',
    seqNum: 10,
    title: 'Research export formats',
    phase: 'building',
    output: 'info',
    sourceKind: 'research-before-plan',
    sourceRef: `before-plan:${TASK.id}`,
  };
  await mockLive(page, {
    threads: [THREAD],
    messages: [
      { id: 'request', role: 'user', content: 'Add an export', createdAt: 10 },
      {
        id: 'started',
        role: 'assistant',
        content: `Started [#${TASK.seqNum}](todo:${TASK.id}); it researches first.`,
        createdAt: 20,
      },
    ],
    todos: [{ ...TASK, phase: 'queued' }, research],
  });
  await page.goto('/app');
  const refs = page.getByTestId('home-c').getByTestId('chief-task-refs');
  await expect(refs.getByTestId('chief-task-ref')).toHaveText([
    new RegExp(`^${TASK.title}`),
    /^Research export formats/,
  ]);
  const [parent, child] = await refs
    .getByTestId('chief-task-ref')
    .evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().left));
  expect(child! - parent!).toBe(24);
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
    sourceKind: 'research-before-plan',
    sourceRef: `before-plan:${TASK.id}`,
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
      {
        id: 'started',
        role: 'assistant',
        content: `Started [#${TASK.seqNum}](todo:${TASK.id}); it researches first.`,
        createdAt: 20,
      },
    ],
    todos: [{ ...TASK, phase: 'queued' }, research],
  };
  await mockLive(page, state, (path, _route, json) =>
    path === '/api/conversations/build-research/messages'
      ? json({ messages: [report], chips: null, historyEpoch: 0, steerPending: [], activeRun: null, nextCursor: null })
      : undefined,
  );
  await page.goto('/app');
  const refs = page.getByTestId('home-c').getByTestId('chief-task-refs');
  const card = refs.getByTestId('research-report-card');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('调研报告已生成');
  await expect(card).toContainText('Research export formats');
  await expect(card).toHaveAttribute('data-stage', 'draft');
  await expect(card.getByText('初稿')).toBeVisible();
  await expect(page.getByTestId('chief-question-report')).toHaveCount(0);

  await card.hover();
  await expect(page.getByTestId('research-report-hover')).toContainText(
    'Parquet halves the file size of CSV.',
  );
  await card.click();
  const doc = page.getByTestId('research-report-doc');
  await expect(doc.getByText('Parquet keeps types')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Research export formats' })).toBeVisible();
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
  await mockLive(page, { threads: [THREAD], messages: [], todos: [research, bare] }, (path, _route, json) =>
    path === '/api/conversations/build-research/messages'
      ? json({ messages: [report], ...page0 })
      : path === '/api/conversations/build-bare/messages'
        ? json({ messages: [], ...page0 })
        : undefined,
  );
  await page.goto('/app?pane=made');
  const made = page.getByRole('complementary', { name: '成果' });
  await made.getByRole('button', { name: 'Research export formats' }).click();
  const dialog = page.getByRole('dialog', { name: 'Research export formats' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('定稿');
  await expect(page.getByTestId('research-report-doc').getByText('Parquet keeps types')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  await made.getByRole('button', { name: 'Research cache layers' }).click();
  await expect(page).toHaveURL(/todo-bare/);
  await expect(page.getByTestId('research-report-doc')).toHaveCount(0);
});
