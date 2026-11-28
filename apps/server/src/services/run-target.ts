import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, chiefThread, step, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';

export function teamBuild(db: Db, buildId: string, teamId: string) {
  return db
    .select({
      id: build.id,
      todoId: build.todoId,
      seqNum: todo.seqNum,
      title: todo.title,
      createdAt: build.createdAt,
      errorMessage: build.errorMessage,
      stop: build.stop,
      failureCode: build.failureCode,
      failureDetail: build.failureDetail,
      prNumber: build.prNumber,
      prUrl: build.prUrl,
    })
    .from(build)
    .innerJoin(todo, eq(todo.id, build.todoId))
    .where(and(eq(build.id, buildId), eq(todo.teamId, teamId)))
    .get();
}

export function teamThread(db: Db, threadId: string, teamId: string) {
  return db
    .select({ id: chiefThread.id, title: chiefThread.title })
    .from(chiefThread)
    .where(and(eq(chiefThread.id, threadId), eq(chiefThread.teamId, teamId)))
    .get();
}

export type TeamBuild = NonNullable<ReturnType<typeof teamBuild>>;
export type TeamThread = NonNullable<ReturnType<typeof teamThread>>;

export type RunTarget =
  | { kind: 'thread'; thread: TeamThread }
  | { kind: 'turn'; thread: TeamThread; stepId: string }
  | { kind: 'build'; build: TeamBuild; stepId: string | null }
  | { kind: 'unstarted-task'; todoId: string };

function notFound(id: string): never {
  throw new HttpError(404, `run ${id}`);
}

export function resolveRunTarget(db: Db, teamId: string, id: string): RunTarget {
  const thread = teamThread(db, id, teamId);
  if (thread !== undefined) return { kind: 'thread', thread };
  const stepRow = db
    .select({ id: step.id, buildId: step.buildId, kind: step.kind })
    .from(step)
    .where(eq(step.id, id))
    .get();
  if (stepRow !== undefined) {
    if (stepRow.kind === 'chief') {
      const owner = teamThread(db, stepRow.buildId, teamId);
      if (owner === undefined) notFound(id);
      return { kind: 'turn', thread: owner, stepId: stepRow.id };
    }
    const owner = teamBuild(db, stepRow.buildId, teamId);
    if (owner === undefined) notFound(id);
    return { kind: 'build', build: owner, stepId: stepRow.id };
  }
  const direct = teamBuild(db, id, teamId);
  if (direct !== undefined) return { kind: 'build', build: direct, stepId: null };
  const task = db
    .select({ id: todo.id, latestBuildId: todo.latestBuildId })
    .from(todo)
    .where(and(eq(todo.id, id), eq(todo.teamId, teamId)))
    .get();
  if (task === undefined) notFound(id);
  const buildId =
    task.latestBuildId ??
    db
      .select({ id: build.id })
      .from(build)
      .where(eq(build.todoId, task.id))
      .orderBy(desc(build.createdAt))
      .get()?.id;
  const latest = buildId === undefined ? undefined : teamBuild(db, buildId, teamId);
  return latest === undefined
    ? { kind: 'unstarted-task', todoId: task.id }
    : { kind: 'build', build: latest, stepId: null };
}
