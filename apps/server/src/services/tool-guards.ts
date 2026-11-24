import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, project, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { listedProjects } from './personal-space.js';

export type ToolParams = Record<string, unknown>;

export function json(result: unknown): string {
  return JSON.stringify(result ?? null);
}

export function str(params: ToolParams, key: string): string {
  const value = params[key];
  if (typeof value !== 'string' || value === '') {
    throw new HttpError(400, `invalid params.${key}: expected non-empty string`);
  }
  return value;
}

export function optStr(params: ToolParams, key: string): string | undefined {
  const value = params[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new HttpError(400, `invalid params.${key}: expected string`);
  return value;
}

export function requireProjectRow(db: Db, projectId: string, teamId: string) {
  const row = db
    .select()
    .from(project)
    .where(and(eq(project.id, projectId), listedProjects(teamId)))
    .get();
  if (!row) throw new HttpError(404, `project ${projectId}`);
  return row;
}

export function requireTeamTodo(db: Db, todoId: string, teamId: string) {
  const row = db
    .select()
    .from(todo)
    .where(and(eq(todo.id, todoId), eq(todo.teamId, teamId)))
    .get();
  if (!row) throw new HttpError(404, `todo ${todoId}`);
  return row;
}

export function requireTeamBuild(db: Db, buildId: string, teamId: string) {
  const row = db.select({ todoId: build.todoId }).from(build).where(eq(build.id, buildId)).get();
  if (!row) throw new HttpError(404, `build ${buildId}`);
  const owned = db
    .select({ id: todo.id })
    .from(todo)
    .where(and(eq(todo.id, row.todoId), eq(todo.teamId, teamId)))
    .get();
  if (!owned) throw new HttpError(404, `build ${buildId}`);
  return row;
}
