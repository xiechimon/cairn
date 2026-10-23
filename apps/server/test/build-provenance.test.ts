import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRecordSchema } from '@pacman/shared';
import Database from 'better-sqlite3';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { describe, expect, test } from 'vitest';
import { MIGRATIONS_FOLDER } from '../src/db/client.js';
import { build, step, todo } from '../src/db/schema.js';
import { applyBuildStepAction } from '../src/services/builds.js';
import { bootServer, issueApiKey, postProject, req } from './helpers.js';

async function world() {
  const s = bootServer();
  const projectId = await postProject(s.app);
  const t = (await (
    await req(s.app, 'POST', `/api/projects/${projectId}/todos`, { title: 'probe', spec: 'body' })
  ).json()) as { id: string };
  const response = await req(s.app, 'POST', `/api/projects/${projectId}/builds`, {
    todoIds: [t.id],
    assignment: { plan: null, build: null },
    withPlan: true,
  });
  expect(response.status).toBe(201);
  const b = buildRecordSchema.parse(((await response.json()) as { builds: unknown[] }).builds[0]);
  const st = s.db.select().from(step).where(eq(step.buildId, b.id)).get()!;
  return { s, todoId: t.id, buildId: b.id, stepId: st.id };
}

describe('#1513 build provenance and human feedback', () => {
  test('upgrades an existing build without losing its data', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pacman-provenance-migration-'));
    const sqlite = new Database(':memory:');
    try {
      mkdirSync(join(dir, 'meta'));
      const journal = JSON.parse(
        readFileSync(join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8'),
      ) as { entries: { tag: string; when: number }[] };
      const index = journal.entries.findIndex((entry) =>
        readFileSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), 'utf8').includes('ADD `baseSha`'),
      );
      expect(index).toBeGreaterThan(0);
      const entries = journal.entries.slice(0, index);
      for (const entry of entries)
        writeFileSync(
          join(dir, `${entry.tag}.sql`),
          readFileSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`)),
        );
      writeFileSync(join(dir, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
      migrate(drizzle(sqlite), { migrationsFolder: dir });
      sqlite.exec(
        "INSERT INTO team (id, name, createdAt) VALUES ('legacy-team', 'legacy', 1); INSERT INTO project (id, name, teamId) VALUES ('legacy-project', 'legacy', 'legacy-team'); INSERT INTO todo (id, teamId, projectId, title, phaseAt, seqNum) VALUES ('legacy-todo', 'legacy-team', 'legacy-project', 'legacy', 1, 1)",
      );
      sqlite.exec(
        "INSERT INTO build (id, todoId, withPlan, triggerSource, createdAt) VALUES ('legacy-build', 'legacy-todo', 1, 'user', 123)",
      );
      migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS_FOLDER });
      expect(sqlite.prepare('SELECT id, createdAt, baseSha, harnessHash FROM build').all()).toEqual(
        [{ id: 'legacy-build', createdAt: 123, baseSha: null, harnessHash: null }],
      );
    } finally {
      sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('nullable provenance preserves the existing build read contract', async () => {
    const w = await world();
    try {
      expect(
        w.s.db.get(sql`select baseSha, harnessHash from build where id = ${w.buildId}`),
      ).toEqual({ baseSha: null, harnessHash: null });
      const response = await req(w.s.app, 'GET', `/api/builds/${w.buildId}`);
      expect(response.status).toBe(200);
      expect(buildRecordSchema.parse(await response.json()).id).toBe(w.buildId);
    } finally {
      w.s.dispose();
    }
  });

  test.each(['confirm', 'review', 'failed'] as const)(
    '%s feedback is stored against the rejected step',
    async (phase) => {
      const w = await world();
      try {
        w.s.db.update(todo).set({ phase }).where(eq(todo.id, w.todoId)).run();
        w.s.db
          .update(step)
          .set({ status: phase === 'failed' ? 'failed' : 'done' })
          .where(eq(step.id, w.stepId))
          .run();
        await applyBuildStepAction(
          w.s.svc,
          w.buildId,
          phase === 'failed'
            ? {
                action: 'restart',
                feedback: 'keep the exact feedback',
                clientMessageId: 'feedback-1513',
              }
            : {
                action: 'revision',
                side: 'plan',
                feedback: 'keep the exact feedback',
                clientMessageId: 'feedback-1513',
              },
          'reviewer',
        );
        const rows = w.s.db.all(
          sql`select buildId, kind, side, feedback, actor, stepId, createdAt from build_feedback`,
        );
        expect(rows).toEqual([
          {
            buildId: w.buildId,
            kind: phase === 'failed' ? 'restart' : 'revision',
            side: phase === 'confirm' ? 'plan' : 'build',
            feedback: 'keep the exact feedback',
            actor: 'reviewer',
            stepId: w.stepId,
            createdAt: expect.any(Number),
          },
        ]);
      } finally {
        w.s.dispose();
      }
    },
  );

  test('invalid revision leaves no structured feedback', async () => {
    const w = await world();
    try {
      await expect(
        applyBuildStepAction(w.s.svc, w.buildId, {
          action: 'revision',
          side: 'plan',
          feedback: 'bad phase',
          clientMessageId: 'bad',
        }),
      ).rejects.toThrow();
      expect(w.s.db.all(sql`select * from build_feedback`)).toEqual([]);
    } finally {
      w.s.dispose();
    }
  });

  test('authenticated heartbeat captures first-step provenance without later overwrite', async () => {
    const w = await world();
    try {
      const key = await issueApiKey(w.s);
      const enrolled = await w.s.app.request('/api/machine/enroll', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          teamId: w.s.team.id,
          name: 'provenance-machine',
          cliVersion: '0.1.0',
        }),
      });
      const machine = (await enrolled.json()) as { token: string; id: string };
      const machineRow = w.s.db.get<{ id: string }>(
        sql`select id from machine where name = 'provenance-machine'`,
      )!;
      w.s.db
        .update(step)
        .set({ status: 'claimed', machineId: machineRow.id })
        .where(eq(step.id, w.stepId))
        .run();
      const send = (stepId: string, body: unknown) =>
        w.s.app.request(`/api/machine/heartbeat/${stepId}`, {
          method: 'POST',
          headers: { authorization: `Bearer ${machine.token}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
      const metadata = { baseSha: 'a'.repeat(40), harnessHash: 'b'.repeat(64) };
      w.s.db.update(step).set({ machineId: null }).where(eq(step.id, w.stepId)).run();
      expect((await send(w.stepId, metadata)).status).toBe(404);
      expect(w.s.db.select().from(build).where(eq(build.id, w.buildId)).get()).toMatchObject({
        baseSha: null,
        harnessHash: null,
      });
      w.s.db.update(step).set({ machineId: machineRow.id }).where(eq(step.id, w.stepId)).run();
      expect((await send(w.stepId, metadata)).status).toBe(200);
      expect(w.s.db.select().from(build).where(eq(build.id, w.buildId)).get()).toMatchObject(
        metadata,
      );
      expect(
        (await send(w.stepId, { baseSha: 'c'.repeat(40), harnessHash: 'd'.repeat(64) })).status,
      ).toBe(200);
      expect((await send(w.stepId, {})).status).toBe(200);
      expect(w.s.db.select().from(build).where(eq(build.id, w.buildId)).get()).toMatchObject(
        metadata,
      );
      expect((await send(w.stepId, { harnessHash: 'invalid' })).status).toBe(400);
      const later = {
        id: 'later-step',
        buildId: w.buildId,
        kind: 'build' as const,
        status: 'claimed' as const,
        machineId: machineRow.id,
        createdAt: Date.now() + 1,
      };
      w.s.db.insert(step).values(later).run();
      expect(
        (await send(later.id, { baseSha: 'e'.repeat(40), harnessHash: 'f'.repeat(64) })).status,
      ).toBe(200);
      expect(w.s.db.select().from(build).where(eq(build.id, w.buildId)).get()).toMatchObject(
        metadata,
      );
    } finally {
      w.s.dispose();
    }
  });
});
