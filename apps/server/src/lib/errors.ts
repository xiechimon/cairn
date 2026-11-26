import { TASK_ARCHIVED } from '@cairn/shared';
import type { z } from 'zod';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly reason?: string,
    readonly fields?: { code?: string; running?: number; conflictJournalId?: string },
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function notFound(what: string): HttpError {
  return new HttpError(404, `${what} not found`);
}

export function forbidden(message: string): HttpError {
  return new HttpError(403, message);
}

export function conflict(message: string): HttpError {
  return new HttpError(409, message);
}

export function taskArchived(): HttpError {
  return new HttpError(409, 'Unarchive to continue', TASK_ARCHIVED);
}

export function parseWith<T extends z.ZodType>(
  schema: T,
  value: unknown,
  label: string,
): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const at = issue?.path.length ? ` at ${issue.path.join('.')}` : '';
    throw new HttpError(400, `invalid ${label}${at}: ${issue?.message ?? 'validation failed'}`);
  }
  return result.data;
}
