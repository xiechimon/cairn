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
  await expect(ref.locator('svg[data-glyph="progress"]')).toHaveCount(1);
  await expect(ref).toContainText('In progress');
  await expect(stream.locator('a.mention-chip svg[data-glyph="progress"]')).toHaveCount(1);
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

test('the status word shows only while the task works, and chips keep the line height', async ({
  page,
}) => {
  const done = { ...TASK, phase: 'done' };
  await mockLive(page, {
    threads: [THREAD],
    messages: [
      {
        id: 'm2',
        role: 'assistant',
        content: `Started [#${done.seqNum}](todo:${done.id}) and it is reading the repo.`,
        createdAt: 13,
      },
    ],
    todos: [done],
    tasks: [],
  });
  await page.goto('/app');
  const stream = page.getByTestId('chief-stream');
  const ref = stream.getByTestId('chief-task-ref');
  await expect(ref).toContainText('Read the cairn repo');
  await expect(ref).not.toContainText('In progress');
  await expect(ref.locator('svg[data-glyph="done"]')).toHaveCount(1);
  const chip = stream.locator('a.mention-chip--todo');
  const tile = ref.locator('span.grid');
  await expect(tile).toHaveCSS('width', '20px');
  const heights = await chip.evaluate((el) => {
    const p = el.closest('p');
    if (p === null) return null;
    const clone = p.cloneNode(true) as HTMLElement;
    clone.querySelector('a.mention-chip--todo')?.replaceWith(document.createTextNode('x'));
    p.after(clone);
    const result = [p.getBoundingClientRect().height, clone.getBoundingClientRect().height];
    clone.remove();
    return result;
  });
  expect(heights?.[0]).toBe(heights?.[1]);
  await ref.focus();
  await expect(ref).toBeFocused();
  await expect(ref).toHaveAccessibleName(/Done|已完成|Read the cairn repo/);
});
