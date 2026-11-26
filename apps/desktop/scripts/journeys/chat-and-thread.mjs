import assert from 'node:assert/strict';
import { join } from 'node:path';

export default async function chatAndThread({ window, mode, evidenceDir }) {
  const title = `packaged chat-thread ${Date.now() % 100000}`;
  const seeded = await window.evaluate(async () => {
    const response = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'packaged chat-and-thread', repoKind: 'hosted' }),
    });
    return { status: response.status, body: await response.text() };
  });
  assert.ok(
    seeded.status >= 200 && seeded.status < 300,
    `seed project ${seeded.status}: ${seeded.body}`,
  );

  await window.goto(new URL('/app', window.url()).toString());
  await window.getByTestId('home-c').waitFor({ timeout: 15_000 });
  await window.getByTestId('chief-composer-block').waitFor({ timeout: 15_000 });

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
  await row.click();

  await window.getByTestId('side-chat').waitFor({ timeout: 15_000 });
  await window.getByTestId('transcript-col').waitFor({ timeout: 15_000 });

  const engineRunCount = await window.getByTestId('engine-run').count();
  assert.equal(engineRunCount, 0, 'engine-view');

  const chiefStatus = await window.evaluate(async () => {
    const teams = await fetch('/api/teams');
    const list = await teams.json();
    const teamId = list[0]?.id;
    if (!teamId) return 0;
    const res = await fetch(`/api/teams/${teamId}/chief`);
    return res.status;
  });
  assert.equal(chiefStatus, 200, 'GET /api/teams/:id/chief did not return 200');

  await window.screenshot({ path: join(evidenceDir, `${mode}-chat-and-thread.png`) });
}
