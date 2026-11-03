import { expect, test } from '@playwright/test';
import { mockLive, TASK, THREAD } from './chief-home-mock';

const STATUS = {
  done: '已完成，未验证',
  verified: '已验证',
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
    await expect(marker).toHaveText(`任务 #9 Repair board counts：${STATUS[label]}`);
    await expect(marker.getByRole('link')).toHaveAttribute('href', `/app?thread=${TASK.id}`);
    await expect(stream.getByTestId('chief-bubble')).toHaveCount(1);
    await expect(stream).not.toContainText('[wake:');
    await expect(stream).not.toContainText('Internal worker reporting instructions');
    await expect(stream).not.toContainText(`The worker has reported ${phase}.`);
  });
}

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
