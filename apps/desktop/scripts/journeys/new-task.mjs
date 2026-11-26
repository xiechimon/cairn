import assert from 'node:assert/strict';
import { join } from 'node:path';

export default async function newTask({ window, mode, evidenceDir }) {
  const title = `packaged ${mode} ${Date.now() % 100000}`;
  const created = await window.evaluate(async () => {
    const response = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'packaged journey', repoKind: 'hosted' }),
    });
    return { status: response.status, body: await response.text() };
  });
  assert.ok(
    created.status >= 200 && created.status < 300,
    `seed project ${created.status}: ${created.body}`,
  );
  await window.goto(new URL('/app', window.url()).toString());
  await window.getByTestId('home-c').waitFor({ timeout: 15_000 });
  await window.getByTestId('tasks-toggle').click();
  const panel = window.getByRole('complementary').filter({ has: window.getByTestId('tasks-new') });
  await panel.waitFor({ timeout: 15_000 });
  await panel.getByTestId('tasks-new').click();
  await panel.getByTestId('tasks-add-input').fill(title);
  await panel.getByTestId('tasks-add-submit').click();
  const row = panel.locator('[data-section="up_next"] [data-slot="task-row-title"]', {
    hasText: title,
  });
  await row.waitFor({ timeout: 15_000 });
  const api = await window.evaluate(async (wanted) => {
    const response = await fetch('/api/todos');
    const body = await response.json();
    return {
      status: response.status,
      found: body.some((todo) => todo.title === wanted && todo.phase === 'todo'),
    };
  }, title);
  assert.equal(api.status, 200);
  assert.equal(
    api.found,
    true,
    'GET /api/todos did not contain the task created through the packaged app',
  );
  await window.screenshot({ path: join(evidenceDir, `${mode}-new-task.png`) });
}
