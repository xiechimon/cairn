import { expect, test } from '@playwright/test';
import { mockLive, TASK as BASE_TASK, THREAD } from './chief-home-mock';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn.locale', 'en'));
});

const TASK = { ...BASE_TASK, title: 'Read the cairn repo', phase: 'building' };

test('a reply that mentions a task gets a reference row and a status chip that open the thread', async ({
  page,
}) => {
  await mockLive(page, {
    threads: [THREAD],
    messages: [
      { id: 'm1', role: 'user', content: 'Look at the repo', createdAt: 10 },
      {
        id: 'm2',
        role: 'assistant',
        content: `Started [#${TASK.seqNum}](todo:${TASK.id}) and it is reading the repo.`,
        createdAt: 13,
      },
    ],
    todos: [TASK],
    tasks: [],
  });
  await page.goto('/app');
  const stream = page.getByTestId('chief-stream');
  const ref = stream.getByTestId('chief-task-ref');
  await expect(ref).toHaveCount(1);
  await expect(ref).toContainText('Read the cairn repo');
  await expect(ref.locator('svg[data-glyph]')).toHaveCount(1);
  await expect(stream.locator('a.mention-chip svg[data-glyph]')).toHaveCount(1);
  await ref.click();
  await expect(page).toHaveURL(new RegExp(`thread=${TASK.id}`));
});

test('a reply with no task reference has no reference row', async ({ page }) => {
  await mockLive(page, {
    threads: [THREAD],
    messages: [{ id: 'm2', role: 'assistant', content: 'Nothing to dispatch.', createdAt: 13 }],
    todos: [TASK],
    tasks: [],
  });
  await page.goto('/app');
  await expect(page.getByTestId('chief-stream').getByText('Nothing to dispatch.')).toBeVisible();
  await expect(page.getByTestId('chief-task-ref')).toHaveCount(0);
});
