import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const SERVER_LOG_MAX_BYTES = 5 * 1024 * 1024;
const MIN_SECRET_LENGTH = 6;
const REDACTED = '[redacted]';

export function serverLogPath(userData: string): string {
  return join(userData, 'logs', 'server.log');
}

export function redactSecrets(line: string, secrets: readonly string[]): string {
  let out = line;
  for (const secret of secrets) {
    if (secret.length >= MIN_SECRET_LENGTH) out = out.split(secret).join(REDACTED);
  }
  return out;
}

export function otelHeaderSecrets(headers: string | undefined): string[] {
  if (!headers) return [];
  const values = headers.split(',').map((pair) => pair.slice(pair.indexOf('=') + 1).trim());
  return [headers, ...values];
}

export interface ServerLog {
  write(chunk: Buffer | string): void;
  close(): void;
}

export function createServerLog(
  path: string,
  secrets: () => readonly string[],
  maxBytes = SERVER_LOG_MAX_BYTES,
): ServerLog {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  let size = 0;
  try {
    size = statSync(path).size;
  } catch (error) {
    console.debug('cairn: recoverable operation failed', error);
  }
  let pending = '';

  function append(text: string): void {
    const bytes = Buffer.byteLength(text);
    if (size > 0 && size + bytes > maxBytes) {
      renameSync(path, `${path}.1`);
      size = 0;
    }
    appendFileSync(path, text, { mode: 0o600 });
    size += bytes;
  }

  function emit(line: string): void {
    try {
      append(`${redactSecrets(line, secrets())}\n`);
    } catch (error) {
      console.debug('cairn: recoverable operation failed', error);
    }
  }

  return {
    write(chunk) {
      pending += chunk.toString();
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) emit(line);
    },
    close() {
      if (pending !== '') emit(pending);
      pending = '';
    },
  };
}
