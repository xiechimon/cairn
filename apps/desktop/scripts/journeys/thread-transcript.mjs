import assert from 'node:assert/strict';
import { join } from 'node:path';

export default async function threadTranscript({ window, mode, evidenceDir }) {
  const title = `packaged transcript ${mode} ${Date.now() % 100000}`;
  const seeded = await window.evaluate(async (wantedTitle) => {
    const projectRes = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'packaged transcript project', repoKind: 'hosted' }),
    });
    if (!projectRes.ok) {
      return {
        ok: false,
        step: 'project',
        status: projectRes.status,
        body: await projectRes.text(),
      };
    }
    const project = await projectRes.json();
    const todoRes = await fetch(`/api/projects/${project.id}/todos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: wantedTitle, spec: '' }),
    });
    if (!todoRes.ok) {
      return { ok: false, step: 'todo', status: todoRes.status, body: await todoRes.text() };
    }
    const todo = await todoRes.json();
    return { ok: true, todoId: todo.id };
  }, title);
  assert.equal(seeded.ok, true, `seed thread failed: ${JSON.stringify(seeded)}`);

  await window.goto(new URL(`/app?thread=${seeded.todoId}`, window.url()).toString());
  const sideChat = window.getByTestId('side-chat');
  await sideChat.waitFor({ timeout: 15_000 });
  assert.equal(
    await sideChat.getAttribute('data-todo-id'),
    seeded.todoId,
    'side-chat did not open the seeded thread',
  );
  await window.getByTestId('side-chat-status').waitFor({ timeout: 15_000 });
  await window.screenshot({ path: join(evidenceDir, `${mode}-thread-transcript.png`) });
}
