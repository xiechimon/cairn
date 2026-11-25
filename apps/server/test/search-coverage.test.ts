import { searchResponseSchema } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { agentMemory, chief, chiefMessage, chiefThread, project, todo } from '../src/db/schema.js';
import { ensurePersonalSpace, PERSONAL_SPACE_NAME } from '../src/services/personal-space.js';
import { bootServer, req, type TestServer } from './helpers.js';

let seq = 0;

function addProject(s: TestServer, name: string, extra: Partial<typeof project.$inferInsert> = {}) {
  seq += 1;
  const id = `proj-${seq}`;
  s.db
    .insert(project)
    .values({
      id,
      teamId: s.team.id,
      name,
      ...extra,
    })
    .run();
  return id;
}

function addTodo(
  s: TestServer,
  projectId: string,
  title: string,
  extra: Partial<typeof todo.$inferInsert> = {},
) {
  seq += 1;
  const id = `todo-${seq}`;
  s.db
    .insert(todo)
    .values({
      id,
      teamId: s.team.id,
      projectId,
      title,
      spec: '',
      phase: 'todo',
      phaseAt: 1_700_000_000_000 + seq * 1_000,
      seqNum: seq,
      ...extra,
    })
    .run();
  return id;
}

async function runSearch(s: TestServer, q: string) {
  const res = await req(s.app, 'GET', `/api/search?q=${encodeURIComponent(q)}`);
  expect(res.status).toBe(200);
  return searchResponseSchema.parse(await res.json());
}

describe('C20 search coverage, unified plain syntax, ordering, limits, and archive flags', () => {
  test('matches todo.spec, #seqNum, and plain seqNum', async () => {
    const s = bootServer();
    const p = addProject(s, 'billing');
    addTodo(s, p, 'Cleanup job', {
      seqNum: 42,
      spec: 'Migrate webhook retries to PostgreSQL advisory locks',
    });
    addTodo(s, p, 'Unrelated task', { seqNum: 43, spec: 'Nothing here' });

    const bySpec = await runSearch(s, 'advisory locks');
    expect(bySpec.todos.map((t) => t.title)).toEqual(['Cleanup job']);

    const byHashSeq = await runSearch(s, '#42');
    expect(byHashSeq.todos.map((t) => t.seqNum)).toEqual([42]);

    const byPlainSeq = await runSearch(s, '42');
    expect(byPlainSeq.todos.map((t) => t.seqNum)).toEqual([42]);

    const byFullWidthSeq = await runSearch(s, '＃４２');
    expect(byFullWidthSeq.todos.map((t) => t.seqNum)).toEqual([42]);
  });

  test('matches project.githubRepo and marks archived projects and tasks', async () => {
    const s = bootServer();
    const active = addProject(s, 'Checkout', { githubRepo: 'acme/checkout-service' });
    const archivedProject = addProject(s, 'Legacy Shop', {
      githubRepo: 'acme/legacy-shop',
      archivedAt: 1_700_000_500_000,
    });
    addTodo(s, active, 'Active payment fix');
    addTodo(s, active, 'Old payment fix', { archivedAt: 1_700_000_600_000 });

    const byRepo = await runSearch(s, 'checkout-service');
    expect(byRepo.projects).toEqual([{ id: active, name: 'Checkout' }]);

    const byArchivedRepo = await runSearch(s, 'legacy-shop');
    expect(byArchivedRepo.projects).toEqual([
      { id: archivedProject, name: 'Legacy Shop', archived: true },
    ]);

    const todosHit = await runSearch(s, 'payment fix');
    const activeHit = todosHit.todos.find((t) => t.title === 'Active payment fix');
    const archivedHit = todosHit.todos.find((t) => t.title === 'Old payment fix');
    expect(activeHit?.archived).toBeUndefined();
    expect(archivedHit?.archived).toBe(true);
  });

  test('unifies multi-word AND, -exclude negation, and NFKC folding in plain search', async () => {
    const s = bootServer();
    const p = addProject(s, 'Équipe');
    addTodo(s, p, 'Fix login oauth flow');
    addTodo(s, p, 'Fix login legacy flow');
    addTodo(s, p, 'ＦＩＸ billing');

    expect((await runSearch(s, 'oauth fix')).todos.map((t) => t.title)).toEqual([
      'Fix login oauth flow',
    ]);
    expect((await runSearch(s, 'login -legacy')).todos.map((t) => t.title)).toEqual([
      'Fix login oauth flow',
    ]);
    expect((await runSearch(s, 'ＦＩＸ oauth')).todos.map((t) => t.title)).toEqual([
      'Fix login oauth flow',
    ]);
    expect((await runSearch(s, 'fix billing')).todos.map((t) => t.title)).toEqual([
      'ＦＩＸ billing',
    ]);
    expect((await runSearch(s, 'équipe')).projects.map((item) => item.name)).toEqual(['Équipe']);
  });

  test('orders todos newest-first and applies a per-category limit', async () => {
    const s = bootServer();
    const p = addProject(s, 'bulk');
    for (let i = 1; i <= 60; i += 1) {
      addTodo(s, p, `bulk item ${i}`, {
        seqNum: i,
        phaseAt: 1_700_000_000_000 + i * 10_000,
      });
    }

    const hit = await runSearch(s, 'bulk item');
    expect(hit.todos.length).toBeLessThanOrEqual(50);
    expect(hit.todos[0]?.title).toBe('bulk item 60');
    expect(hit.todos[1]?.title).toBe('bulk item 59');
  });

  test('searches chief_message content and agent_memory content newest-first', async () => {
    const s = bootServer();
    const p = addProject(s, 'infra');
    s.db
      .insert(chief)
      .values({ id: 'chief-1', userId: s.user.id, teamId: s.team.id, createdAt: 100 })
      .run();
    s.db
      .insert(chiefThread)
      .values({
        id: 'ct-1',
        chiefId: 'chief-1',
        userId: s.user.id,
        teamId: s.team.id,
        projectId: p,
        title: 'Infra chat',
        createdAt: 100,
        updatedAt: 200,
        sessionId: 'sess-1',
        sessionOpenedAt: 100,
      })
      .run();
    s.db
      .insert(chiefMessage)
      .values([
        {
          id: 'cm-old',
          threadId: 'ct-1',
          role: 'user',
          content: [{ type: 'text', text: 'Check terraform state older note' }],
          projectId: p,
          createdAt: 1_000,
        },
        {
          id: 'cm-new',
          threadId: 'ct-1',
          role: 'assistant',
          content: { text: 'Updated terraform state newer note' },
          projectId: p,
          createdAt: 2_000,
        },
        {
          id: 'cm-sys',
          threadId: 'ct-1',
          role: 'system',
          content: { text: 'terraform system noise' },
          projectId: p,
          createdAt: 3_000,
        },
      ])
      .run();

    s.db
      .insert(agentMemory)
      .values([
        {
          id: 'mem-old',
          agentId: 'chief',
          teamId: s.team.id,
          title: 'Terraform guide',
          content: 'Always run terraform plan before apply',
          projectId: p,
          createdAt: 1_000,
          updatedAt: 1_000,
        },
        {
          id: 'mem-new',
          agentId: 'chief',
          teamId: s.team.id,
          title: 'Terraform lock',
          content: 'Terraform state bucket uses S3 locking',
          projectId: p,
          createdAt: 1_500,
          updatedAt: 3_000,
        },
        {
          id: 'mem-invalid',
          agentId: 'chief',
          teamId: s.team.id,
          title: 'Stale terraform',
          content: 'Invalidated terraform note',
          projectId: p,
          invalidAt: 4_000,
          createdAt: 1_000,
          updatedAt: 4_000,
        },
      ])
      .run();

    const hit = await runSearch(s, 'terraform');
    expect(hit.messages?.map((m) => m.id)).toEqual(['cm-new', 'cm-old']);
    expect(hit.messages?.[0]?.projectName).toBe('infra');
    expect(hit.memories?.map((m) => m.id)).toEqual(['mem-new', 'mem-old']);
    expect(hit.memories?.[0]?.title).toBe('Terraform lock');

    const excluded = await runSearch(s, 'terraform -older');
    expect(excluded.messages?.map((m) => m.id)).toEqual(['cm-new']);

    const noJsonKeyLeak = await runSearch(s, 'type');
    expect(noJsonKeyLeak.messages ?? []).toEqual([]);
  });

  test('searching personal space does not error or leak space id', async () => {
    const s = bootServer();
    const space = await ensurePersonalSpace(
      { db: s.db, reposDir: s.reposDir },
      s.team.id,
      s.user.id,
    );
    for (const q of [PERSONAL_SPACE_NAME, `project:${PERSONAL_SPACE_NAME}`]) {
      const hit = await runSearch(s, q);
      expect(JSON.stringify(hit)).not.toContain(space.id);
    }
  });
});
