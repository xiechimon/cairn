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
