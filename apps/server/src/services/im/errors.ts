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

export function sleepAbortable(
  sleep: (ms: number) => Promise<void>,
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted === true) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const onAbort = () => resolve();
    signal?.addEventListener('abort', onAbort, { once: true });
    void sleep(ms).then(
      () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      },
      () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      },
    );
  });
}

export function abortWithTimeout(
  timeoutMs: number,
  signal?: AbortSignal,
): { signal: AbortSignal; timedOut: () => boolean; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException('The operation was timed out.', 'TimeoutError')),
    timeoutMs,
  );
  timer.unref?.();
  const combined =
    signal === undefined ? controller.signal : AbortSignal.any([controller.signal, signal]);
  return {
    signal: combined,
    timedOut: () => controller.signal.aborted && signal?.aborted !== true,
    clear: () => clearTimeout(timer),
  };
}
