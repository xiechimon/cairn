import { otlpTraceIdOfTurn } from '@cairn/shared/otel';
import { eq } from 'drizzle-orm';
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
import { ownershipOf } from '../../../apps/server/src/services/owner.js';
import { type ReplayInput, replayInput, replayThread, replayTodo } from './contract.mts';

export function harvestReplayInput(db: Db, sourceTurnId: string): ReplayInput {
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
    const thread = db.select().from(chiefThread).where(eq(chiefThread.id, message.threadId)).get();
    if (!thread) throw new Error('Missing harvest source thread');
    const projects = db.select().from(project).where(eq(project.teamId, thread.teamId)).all();
    if (message.projectId !== null && !projects.some((p) => p.id === message.projectId))
      throw new Error('Missing harvest project chip');
    const todos = db.select().from(todo).where(eq(todo.teamId, thread.teamId)).all();
    const ids = new Set(todos.map((t) => t.id));
    return replayInput.parse({
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
          const ownership = ownershipOf(db, row);
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
        threads: db
          .select()
          .from(build)
          .all()
          .filter((b) => ids.has(b.todoId))
          .map((row) =>
            replayThread.parse(
              Object.fromEntries(
                Object.keys(replayThread.shape).map((key) => [key, row[key as keyof typeof row]]),
              ),
            ),
          ),
      },
    });
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
