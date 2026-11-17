import { rmSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { expect, onTestFinished, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import * as schema from '../src/db/schema.js';
import { build, message, step, todo } from '../src/db/schema.js';
import { finishStep } from '../src/services/machines.js';
import {
  bootServer,
  insertMachineIntoOldSchema,
  insertStepIntoOldSchema,
  postProject,
  stepRowsRaw,
} from './helpers.js';
import { migrateAll, migrateUpTo } from './migrate-helpers.js';

test('an upgrade stops only active retired research steps and discards their late results', async () => {
  const directory = makeTestTempDir('research-retirement-');
  const sqlite = new Database(join(directory, 'server.db'));
  onTestFinished(() => {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });
  migrateUpTo(sqlite, directory, '0175_step_usage');
  const s = bootServer({ db: drizzle(sqlite, { schema }) });
  onTestFinished(() => s.dispose());
  const projectId = await postProject(s.app, 'research');
  const machineId = insertMachineIntoOldSchema(sqlite, s.team.id);
  const sources = ['research-intake', 'research-citation-check', 'research-stuck', null] as const;
  for (const [index, sourceKind] of sources.entries()) {
    const id = `research-${index}`;
    s.db
      .insert(todo)
      .values({
        id,
        projectId,
        teamId: s.team.id,
        title: id,
        sourceKind,
        seqNum: index + 1,
        phase: 'building',
        phaseAt: 1,
        latestBuildId: id,
      })
      .run();
    s.db
      .insert(build)
      .values({
        id,
        todoId: id,
        withPlan: false,
        triggerSource: 'chief',
        createdAt: 1,
      })
      .run();
    for (const status of [
      'pending',
      'claimed',
      'waiting_quota',
      'done',
      'failed',
      'stopped',
    ] as const) {
      insertStepIntoOldSchema(sqlite, [
        {
          id: `${id}-${status}`,
          buildId: id,
          kind: 'session',
          status,
          machineId: status === 'pending' ? null : machineId,
          claimedAt: status === 'pending' ? null : 123,
          createdAt: 1,
        },
      ]);
    }
  }
  const tasks = s.db.select().from(todo).all();
  const builds = s.db.select().from(build).all();
  const before = stepRowsRaw(sqlite);
  migrateAll(sqlite);
  for (const row of before) {
    const retired = row.buildId === 'research-0' || row.buildId === 'research-1';
    const active = row.status === 'pending' || row.status === 'claimed';
    const current = stepRowsRaw(sqlite).find((entry) => entry.id === row.id);
    expect(current).toMatchObject(
      retired && active ? { ...row, status: 'stopped', finishedAt: expect.any(Number) } : row,
    );
  }
  const stopped = s.db.select().from(step).all();
  const messages = s.db.select().from(message).all();
  for (const id of ['research-0-claimed', 'research-1-claimed']) {
    await finishStep(
      { ...s.svc, box: s.secretBox, reposDir: s.reposDir, attachmentsDir: s.attachmentsDir },
      machineId,
      id,
      { status: 'success', generation: 123, hasChanges: true },
    );
  }
  migrateAll(sqlite);
  expect(s.db.select().from(todo).all()).toEqual(tasks);
  expect(s.db.select().from(build).all()).toEqual(builds);
  expect(s.db.select().from(step).all()).toEqual(stopped);
  expect(s.db.select().from(message).all()).toEqual(messages);
});
