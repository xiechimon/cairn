import { expect, test } from '@playwright/test';
import { mockLive, TASK, THREAD } from './chief-home-mock';

for (const phase of ['done', 'failed', 'review']) {
  test(`${phase}: task report links to its task before the assistant summary`, async ({ page }) => {
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
          }),
          createdAt: 20,
        },
        {
          id: 'busy-reply',
          role: 'assistant',
          content: 'The current turn has finished.',
          createdAt: 21,
        },
        {
          id: 'user-wake-step',
          role: 'user',
          content: `[wake:${phase === 'done' ? 'settle' : phase === 'failed' ? 'failed' : 'gate'}] Internal worker reporting instructions`,
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
    const stream = page.getByTestId('chief-home').getByTestId('chief-stream');
    const marker = stream.getByTestId('thread-report-marker');
    await expect(marker).toHaveText('来自任务 #9 Repair board counts 的消息');
    await expect(marker.getByRole('link')).toHaveAttribute('href', `/app/todo/${TASK.id}`);
    await expect(stream.getByTestId('chief-msg').last()).toContainText(`The worker has reported ${phase}.`);
    const text = await stream.innerText();
    expect(text.indexOf('来自任务')).toBeLessThan(text.indexOf('The worker has reported'));
    await expect(stream.getByTestId('chief-bubble')).toHaveCount(1);
    await expect(stream).not.toContainText('[wake:');
    await expect(stream).not.toContainText('Internal worker reporting instructions');
  });
}

test('two queued reports hide their own prompts while a non-report wake stays visible', async ({ page }) => {
  await mockLive(page, {
    threads: [THREAD],
    messages: [
      ...['first', 'second'].map((name, index) => ({
        id: `report-${name}`,
        role: 'system',
        content: JSON.stringify({
          kind: 'thread-report',
          todoId: `todo-${name}`,
          phase: 'done',
          seqNum: 9 + index,
          title: `${name} task`,
          wakeStepId: `${name}-step`,
        }),
        createdAt: 10 + index,
      })),
      { id: 'busy-reply', role: 'assistant', content: 'The current turn has finished.', createdAt: 20 },
      { id: 'user-first-step', role: 'user', content: '[wake:settle] Internal first task instructions', createdAt: 30 },
      { id: 'first-reply', role: 'assistant', content: 'The first task has finished.', createdAt: 31 },
      { id: 'user-second-step', role: 'user', content: '[wake:settle] Internal second task instructions', createdAt: 40 },
      { id: 'second-reply', role: 'assistant', content: 'The second task has finished.', createdAt: 41 },
      { id: 'user-other-step', role: 'user', content: '[wake:settle] Check another task', createdAt: 50 },
    ],
    todos: [],
  });
  await page.goto('/app');
  const stream = page.getByTestId('chief-home').getByTestId('chief-stream');
  await expect(stream.getByTestId('thread-report-marker')).toHaveCount(2);
  await expect(stream).toContainText('来自任务 #9 first task 的消息');
  await expect(stream).toContainText('来自任务 #10 second task 的消息');
  await expect(stream).toContainText('The first task has finished.');
  await expect(stream).toContainText('The second task has finished.');
  await expect(stream.getByTestId('chief-bubble')).toHaveCount(1);
  await expect(stream.getByTestId('chief-bubble')).toHaveText('Check another task');
  await expect(stream).not.toContainText('Internal first task instructions');
  await expect(stream).not.toContainText('Internal second task instructions');
  await expect(stream).not.toContainText('[wake:');
});
