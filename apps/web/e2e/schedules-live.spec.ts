import { expect, test } from '@playwright/test';
import { mockLive, taskEntry, THREAD } from './chief-home-mock';

const LONG_TITLE = 'AnUnbreakableScheduleProbeTitle'.repeat(4);

test('live face: saving a new schedule from the panel fires POST /api/schedules with the form state (#1037)', async ({
  page,
}) => {
  const task = taskEntry({ id: 'todo-0', title: LONG_TITLE, phase: 'todo', seqNum: 1, section: 'up_next' });
  const posts: Record<string, unknown>[] = [];
  await mockLive(page, { threads: [THREAD], messages: [], tasks: [task] }, (path, route, json) => {
    if (!path.startsWith('/api/schedules')) return undefined;
    if (route.request().method() !== 'POST') return json([]);
    const body = route.request().postDataJSON() as Record<string, unknown>;
    posts.push(body);
    return json({ id: 'sched-new', ...body });
  });

  await page.goto('/app?pane=tasks&tab=scheduled');
  const panel = page.getByRole('complementary', { name: '任务' });
  await expect(panel.getByTestId('tasks-schedules-empty')).toBeVisible();
  await panel.getByTestId('schedule-new').click();
  const popover = page.getByTestId('schedule-popover');
  await expect(popover).toContainText('新建定时');

  const taskValue = popover.getByRole('combobox', { name: '任务' });
  await expect(taskValue).toContainText(LONG_TITLE);
  expect(
    await taskValue.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    'long unbreakable title overflows the task select',
  ).toBe(true);
  await expect(popover).toHaveCSS('width', '320px');

  await popover.getByRole('radio', { name: '单次' }).click();
  await popover.getByRole('combobox', { name: '时' }).click();
  await page.getByRole('listbox').getByRole('option', { name: '10', exact: true }).click();
  await popover.getByRole('button', { name: '保存' }).click();

  await expect.poll(() => posts.length).toBe(1);
  const body = posts[0]!;
  expect(body.kind).toBe('once');
  expect(body.todoId).toBe('todo-0');
  expect(body.projectId).toBe('proj-1');
  expect(typeof body.at).toBe('number');
  const at = new Date(body.at as number);
  expect(at.getHours()).toBe(10);
  expect(at.getMinutes()).toBe(0);
  await expect(popover).toBeHidden();
});
