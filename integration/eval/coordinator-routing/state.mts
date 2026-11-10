import { otlpTraceIdOfTurn } from '@cairn/shared/otel';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../../../apps/server/src/db/client.js';
import {
  build,
  chiefMessage,
  chiefThread,
  project,
  step,
  todo,
} from '../../../apps/server/src/db/schema.js';
import { blockedNow } from '../../../apps/server/src/services/blockers.js';
import type { MachineDeps } from '../../../apps/server/src/services/machine-deps.js';
import { ownershipOf } from '../../../apps/server/src/services/owner.js';
import { assertReplayContext } from './context.mts';
import {
  parseExpectedOutput,
  type ReplayInput,
  replayInput,
  replayThread,
  replayTodo,
} from './contract.mts';

export function harvestReplayItem(
  db: Db,
  sourceTurnId: string,
  expectation: unknown,
  resources?: MachineDeps,
) {
  const input = harvestReplayInput(db, sourceTurnId, resources);
  const expected = parseExpectedOutput(expectation, input);
  return { input, expectedOutput: expected, sourceTraceId: input.snapshot.sourceTraceId };
}

export function harvestReplayInput(
  db: Db,
  sourceTurnId: string,
  resources?: MachineDeps,
): ReplayInput {
  return db.transaction(() => {
    const turn = db.select().from(step).where(eq(step.id, sourceTurnId)).get();
    const message = db.select().from(chiefMessage).where(eq(chiefMessage.id, sourceTurnId)).get();
    if (
      turn?.kind !== 'chief' ||
      message?.role !== 'user' ||
      turn.buildId !== message.threadId ||
      typeof message.content !== 'string'
    )
      throw new Error('Missing harvest source turn');
    const sourceTime = z.number().int().positive().safeParse(turn.createdAt);
    if (!sourceTime.success) throw new Error('incomplete: unknown source turn time');
    const thread = db.select().from(chiefThread).where(eq(chiefThread.id, message.threadId)).get();
    if (!thread) throw new Error('Missing harvest source thread');
    const projects = db.select().from(project).where(eq(project.teamId, thread.teamId)).all();
    if (message.projectId !== null && !projects.some((p) => p.id === message.projectId))
      throw new Error('Missing harvest project chip');
    const todos = db.select().from(todo).where(eq(todo.teamId, thread.teamId)).all();
    const ids = new Set(todos.map((t) => t.id));
    const threads = db
      .select()
      .from(build)
      .all()
      .filter((b) => ids.has(b.todoId));
    const assertTimes = () => {
      const timestamps = z.object({
        createdAt: z.number().int().positive(),
        updatedAt: z.number().int().positive(),
      });
      for (const [kind, rows] of [
        ['project', projects],
        ['todo', todos],
        ['build', threads],
      ] as const) {
        for (const row of rows) {
          const time = timestamps.safeParse(row);
          if (!time.success) throw new Error(`incomplete: unknown ${kind} time for ${row.id}`);
          if (time.data.createdAt > sourceTime.data || time.data.updatedAt > sourceTime.data)
            throw new Error(`incomplete: ${kind} time newer than source turn for ${row.id}`);
        }
      }
    };
    if (!resources) assertTimes();
    const input = replayInput.parse({
      request: message.content,
      projects: projects.map(({ id, name, description, repoKind, archivedAt }) => ({
        id,
        name,
        description,
        repoKind,
        archivedAt,
      })),
      ...(message.projectId === null
        ? {}
        : { chip: projects.find((p) => p.id === message.projectId)?.name }),
      snapshot: {
        source: 'harvest-db',
        sourceTraceId: otlpTraceIdOfTurn(sourceTurnId),
        capturedAt: Date.now(),
        visible: todos.map((row) => {
          const ownership = ownershipOf(db, row, sourceTime.data);
          return {
            id: row.id,
            ownership:
              ownership === null ? null : { owner: ownership.owner, reason: ownership.reason },
            blocks: blockedNow(db, { blockedBy: [row.id] }),
          };
        }),
        todos: todos.map((row) =>
          replayTodo.parse(
            Object.fromEntries(
              Object.keys(replayTodo.shape).map((key) => [key, row[key as keyof typeof row]]),
            ),
          ),
        ),
        threads: threads.map((row) =>
          replayThread.parse(
            Object.fromEntries(
              Object.keys(replayThread.shape).map((key) => [key, row[key as keyof typeof row]]),
            ),
          ),
        ),
      },
    });
    if (resources) {
      if (resources.db !== db)
        throw new Error('incomplete: replay context resources database mismatch');
      try {
        assertReplayContext(resources, turn, thread, input);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('incomplete:')) throw error;
        throw new Error('incomplete: replay context could not reproduce production inputs');
      }
    }
    assertTimes();
    if (!resources) throw new Error('incomplete: replay context missing source resources');
    return input;
  });
}

export function seedReplayState(db: Db, teamId: string, input: ReplayInput): void {
  replayInput.parse(input);
  for (const p of input.projects)
    db.insert(project)
      .values({ ...p, teamId })
      .run();
  for (const t of input.snapshot.todos)
    db.insert(todo)
      .values({ ...t, teamId })
      .run();
  for (const thread of input.snapshot.threads) db.insert(build).values(thread).run();
  for (const visible of input.snapshot.visible) {
    const row = db.select().from(todo).where(eq(todo.id, visible.id)).get();
    if (!row) throw new Error('Missing seeded todo');
    const ownership = ownershipOf(db, row);
    if (
      (ownership?.owner ?? null) !== (visible.ownership?.owner ?? null) ||
      (ownership?.reason ?? null) !== (visible.ownership?.reason ?? null) ||
      blockedNow(db, { blockedBy: [row.id] }) !== visible.blocks
    )
      throw new Error('Case used uncaptured visible thread state');
  }
}
