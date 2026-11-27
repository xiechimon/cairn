import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import { machine as machineTable, team as teamTable, todo as todoTable } from '../src/db/schema.js';
import { nowMs } from '../src/lib/ids.js';
import { bootServer, insertMachine, postProject, req } from './helpers.js';

describe('create todo with a chosen machine', () => {
  test('a valid team machine id is written as the todo route override', async () => {
    const s = bootServer();
    const projectId = await postProject(s.app, 'machine-create');
    const machineId = insertMachine(s, { name: 'studio' });
    const res = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
      title: '',
      spec: '在 studio 上整理发布脚本',
      machineId,
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string };
    const row = s.db.select().from(todoTable).where(eq(todoTable.id, created.id)).get();
    expect(row?.routeOverride).toEqual({ machineId });
  });

  test('unknown, other-team and retired machines are refused before insertion', async () => {
    const s = bootServer();
    const projectId = await postProject(s.app, 'machine-create-refused');
    const retiredId = insertMachine(s, { name: 'retired' });
    s.db
      .update(machineTable)
      .set({ retiredAt: nowMs() })
      .where(eq(machineTable.id, retiredId))
      .run();
    s.db
      .insert(teamTable)
      .values({ id: 'team-other', name: 'Other team', createdAt: nowMs() })
      .run();
    s.db
      .insert(machineTable)
      .values(
        readyMachine({
          id: 'machine-other-team',
          teamId: 'team-other',
          name: 'other-machine',
          online: true,
        }),
      )
      .run();
    s.db
      .insert(machineTable)
      .values(
        readyMachine({
          id: 'machine-unregistered',
          teamId: s.team.id,
          name: 'unregistered-local',
          kind: 'local',
          online: false,
          lastSeenAt: null,
        }),
      )
      .run();

    for (const machineId of [
      'machine-missing',
      'machine-other-team',
      'machine-unregistered',
      retiredId,
    ]) {
      const before = s.db.select().from(todoTable).all().length;
      const res = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
        title: '',
        spec: '在指定电脑上整理发布脚本',
        machineId,
      });
      expect(res.status).toBe(404);
      expect(s.db.select().from(todoTable).all()).toHaveLength(before);
    }
  });
});
