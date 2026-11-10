import { sql } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { isCorrectionTask } from '../src/services/correction.js';
import { deleteProject } from '../src/services/projects.js';
import {
  createAutonomousTodo,
  deleteTodo,
  getTodo,
  updateAutonomousTodo,
} from '../src/services/todos.js';
import { bootServer, postProject, req } from './helpers.js';

async function labelWorld() {
  const s = bootServer();
  const created = await req(s.app, 'POST', '/api/projects', {
    name: 'Labels',
    kind: 'github',
    githubRepo: 'octo/demo',
  });
  const projectId = ((await created.json()) as { id: string }).id;
  s.db.run(sql`INSERT INTO github_label (id, projectId, name, color)
    VALUES ('correction-label', ${projectId}, 'CoRrEcTiOn', '#112233')`);
  s.db.run(sql`INSERT INTO tag (id, projectId, name, color)
    VALUES ('ordinary-category', ${projectId}, 'regular', '#445566')`);
  const task = createAutonomousTodo(s.svc, {
    teamId: s.team.id,
    projectId,
    title: 'Label task',
    spec: 'Preserve classification.',
    createdBy: s.user.id,
    ownerId: s.user.id,
    githubLabelIds: ['correction-label'],
  });
  return { s, projectId, taskId: task.id };
}

function state(s: ReturnType<typeof bootServer>, taskId: string) {
  return {
    task: s.db.get(sql`SELECT * FROM todo WHERE id = ${taskId}`),
    labels: s.db.all(
      sql`SELECT * FROM todo_github_label WHERE todoId = ${taskId} ORDER BY labelId`,
    ),
    categories: s.db.all(sql`SELECT * FROM todo_tag WHERE todoId = ${taskId} ORDER BY tagId`),
    schedules: s.db.all(sql`SELECT * FROM schedule WHERE todoId = ${taskId}`),
  };
}

describe('dedicated GitHub-label state', () => {
  test('projection and generic category replacement do not conflate labels or weaken correction', async () => {
    const { s, taskId } = await labelWorld();
    expect(getTodo(s.svc, taskId)).toMatchObject({
      tagIds: [],
      githubLabelIds: ['correction-label'],
    });
    const patched = await req(s.app, 'PATCH', `/api/todos/${taskId}`, {
      title: 'Public edit',
      tagIds: ['ordinary-category'],
      githubLabelIds: [],
    });
    expect(patched.status).toBe(200);
    expect(getTodo(s.svc, taskId)).toMatchObject({
      title: 'Public edit',
      tagIds: ['ordinary-category'],
      githubLabelIds: ['correction-label'],
    });
    expect(isCorrectionTask(s.db, taskId)).toBe(true);
    expect((await req(s.app, 'PATCH', `/api/todos/${taskId}`, { phase: 'done' })).status).toBe(409);
    updateAutonomousTodo(s.svc, taskId, { githubLabelIds: [] });
    expect(isCorrectionTask(s.db, taskId)).toBe(false);
    s.db.run("UPDATE tag SET name = 'correction' WHERE id = 'ordinary-category'");
    updateAutonomousTodo(s.svc, taskId, {
      tagIds: ['ordinary-category'],
      githubLabelIds: ['correction-label'],
    });
    updateAutonomousTodo(s.svc, taskId, { githubLabelIds: [] });
    expect(isCorrectionTask(s.db, taskId)).toBe(true);
  });

  test('MCP generic updates preserve dedicated labels and their completion guard', async () => {
    const { s, taskId } = await labelWorld();
    const keyResponse = await req(s.app, 'POST', `/api/teams/${s.team.id}/api-keys`, {
      name: 'Label isolation',
      gitAccess: false,
      mcpAccess: true,
      toolGrants: { read: ['Todos'], write: ['Update Todo'] },
    });
    expect(keyResponse.status).toBe(201);
    const key = ((await keyResponse.json()) as { plaintext: string }).plaintext;
    const response = await s.app.request('/api/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'update_todo',
          arguments: { todoId: taskId, title: 'MCP edit', tagIds: [] },
        },
      }),
    });
    expect(response.status).toBe(200);
    expect(getTodo(s.svc, taskId)).toMatchObject({
      title: 'MCP edit',
      githubLabelIds: ['correction-label'],
    });
    expect(isCorrectionTask(s.db, taskId)).toBe(true);
  });

  test.each(['missing-first', 'missing-last', 'foreign'])(
    'invalid %s label replacement preserves all state',
    async (kind) => {
      const { s, taskId } = await labelWorld();
      const other = await postProject(s.app, 'Other');
      s.db.run(
        sql`INSERT INTO github_label (id, projectId, name, color) VALUES ('foreign-label', ${other}, 'correction', '#000000')`,
      );
      const ids =
        kind === 'foreign'
          ? ['foreign-label']
          : kind === 'missing-first'
            ? ['missing-label', 'correction-label']
            : ['correction-label', 'missing-label'];
      const before = state(s, taskId);
      expect(() =>
        updateAutonomousTodo(s.svc, taskId, { title: 'Must not persist', githubLabelIds: ids }),
      ).toThrow();
      expect(state(s, taskId)).toEqual(before);
    },
  );

  test('duplicate labels are normalized; failed creation leaves no orphan task', async () => {
    const { s, projectId, taskId } = await labelWorld();
    updateAutonomousTodo(s.svc, taskId, {
      githubLabelIds: ['correction-label', 'correction-label'],
    });
    expect(state(s, taskId).labels).toHaveLength(1);
    const before = s.db.all('SELECT * FROM todo ORDER BY id');
    s.db.run(sql`CREATE TRIGGER reject_label_write BEFORE INSERT ON todo_github_label
      BEGIN SELECT RAISE(ABORT, 'label write blocked'); END`);
    expect(() =>
      createAutonomousTodo(s.svc, {
        teamId: s.team.id,
        projectId,
        title: 'Must not exist',
        spec: 'Rollback.',
        createdBy: s.user.id,
        ownerId: s.user.id,
        githubLabelIds: ['correction-label'],
      }),
    ).toThrow();
    expect(s.db.all('SELECT * FROM todo ORDER BY id')).toEqual(before);
  });

  test.each([false, true])(
    'association failure rolls back metadata and schedule (move: %s)',
    async (moving) => {
      const { s, projectId, taskId } = await labelWorld();
      const target = moving ? await postProject(s.app, 'Target') : projectId;
      s.db.run(
        sql`INSERT INTO github_label (id, projectId, name, color) VALUES ('target-label', ${target}, 'regular', '#000000')`,
      );
      s.db.run(sql`INSERT INTO schedule (id, teamId, projectId, todoId, kind, tz, createdBy)
      VALUES ('label-schedule', ${s.team.id}, ${projectId}, ${taskId}, 'daily', 'UTC', ${s.user.id})`);
      const before = state(s, taskId);
      s.db.run(sql`CREATE TRIGGER reject_label_write BEFORE INSERT ON todo_github_label
      BEGIN SELECT RAISE(ABORT, 'label write blocked'); END`);
      expect(() =>
        updateAutonomousTodo(s.svc, taskId, {
          title: 'Must not persist',
          projectId: target,
          githubLabelIds: ['target-label'],
        }),
      ).toThrow();
      expect(state(s, taskId)).toEqual(before);
    },
  );

  test('project movement resets labels and correction while moving its schedule', async () => {
    const { s, projectId, taskId } = await labelWorld();
    const target = await postProject(s.app, 'Target');
    s.db.run(sql`INSERT INTO schedule (id, teamId, projectId, todoId, kind, tz, createdBy)
      VALUES ('label-schedule', ${s.team.id}, ${projectId}, ${taskId}, 'daily', 'UTC', ${s.user.id})`);
    updateAutonomousTodo(s.svc, taskId, { projectId: target });
    expect(getTodo(s.svc, taskId)).toMatchObject({ projectId: target, githubLabelIds: [] });
    expect(isCorrectionTask(s.db, taskId)).toBe(false);
    expect(state(s, taskId).schedules).toMatchObject([{ projectId: target }]);
  });

  test('task and project deletion cascade only owned labels and links', async () => {
    const { s, projectId, taskId } = await labelWorld();
    expect(deleteTodo(s.svc, taskId)).toBe(true);
    expect(s.db.all('SELECT * FROM todo_github_label')).toEqual([]);
    expect(s.db.all('SELECT * FROM github_label')).toHaveLength(1);
    const other = await postProject(s.app, 'Other');
    const survivor = createAutonomousTodo(s.svc, {
      teamId: s.team.id,
      projectId: other,
      title: 'Survivor',
      spec: '',
      createdBy: s.user.id,
      ownerId: s.user.id,
    });
    s.db.run(
      sql`INSERT INTO github_label (id, projectId, name, color) VALUES ('other-label', ${other}, 'bug', '#000000')`,
    );
    s.db.run(sql`INSERT INTO todo_github_label (todoId, labelId)
      VALUES (${survivor.id}, 'correction-label'), (${survivor.id}, 'other-label')`);
    expect(deleteProject({ db: s.db, reposDir: s.reposDir }, projectId)).toBe(true);
    expect(getTodo(s.svc, survivor.id)).toMatchObject({ githubLabelIds: ['other-label'] });
    expect(s.db.all('SELECT id FROM github_label')).toEqual([{ id: 'other-label' }]);
    expect(s.db.all('PRAGMA foreign_key_check')).toEqual([]);
  });
});
