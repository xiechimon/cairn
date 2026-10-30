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
          }),
          createdAt: 20,
        },
        {
          id: 'user-wake-step',
          role: 'user',
          content: `[wake:${phase === 'done' ? 'settle' : phase === 'failed' ? 'failed' : 'gate'}] Internal worker reporting instructions`,
          createdAt: 21,
        },
        {
          id: 'summary',
          role: 'assistant',
          content: `The worker has reported ${phase}.`,
          createdAt: 22,
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
