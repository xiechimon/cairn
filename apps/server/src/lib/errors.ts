import type { z } from 'zod';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly reason?: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function notFound(what: string): HttpError {
  return new HttpError(404, `${what} not found`);
}

export function conflict(message: string): HttpError {
  return new HttpError(409, message);
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
