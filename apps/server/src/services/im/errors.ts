export type ImSendErrorKind = 'permanent' | 'drop' | 'retry';

export class ImSendError extends Error {
  readonly kind: ImSendErrorKind;
  readonly retryAfterMs: number | undefined;
  readonly authExpired: boolean;

  constructor(
    kind: ImSendErrorKind,
    message: string,
    opts: { retryAfterMs?: number; authExpired?: boolean } = {},
  ) {
    super(message);
    this.name = 'ImSendError';
    this.kind = kind;
    this.retryAfterMs = opts.retryAfterMs;
    this.authExpired = opts.authExpired ?? false;
  }
}

export function asSendError(err: unknown): ImSendError {
  if (err instanceof ImSendError) return err;
  return new ImSendError('retry', err instanceof Error ? err.message : String(err));
}

export function scrubSecrets(message: string, ...secrets: string[]): string {
  let out = message;
  for (const secret of secrets) {
    if (secret !== '') out = out.split(secret).join('<redacted>');
  }
  return out;
}

export function classifyHttpSendError(input: {
  status: number;
  detail: string;
  retryAfterMs?: number;
  authExpired?: boolean;
  permanent?: boolean;
  rateLimited?: boolean;
}): ImSendError {
  if (input.authExpired === true) {
    return new ImSendError('permanent', input.detail, {
      retryAfterMs: input.retryAfterMs,
      authExpired: true,
    });
  }
  if (input.rateLimited === true || input.status === 429) {
    return new ImSendError('retry', input.detail, { retryAfterMs: input.retryAfterMs });
  }
  if (input.permanent === true) {
    return new ImSendError('permanent', input.detail);
  }
  if (input.status === 0 || input.status >= 500) {
    return new ImSendError('retry', input.detail);
  }
  return new ImSendError('drop', input.detail);
}
