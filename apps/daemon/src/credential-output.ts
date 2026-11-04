import type { StepEvent } from '@cairn/shared';
import { writePrivateFile } from './private-fs.js';
import { readSessionJsonlForUpload } from './session-jsonl.js';

export function credentialRedactor(token: string | undefined): <T>(value: T) => T {
  const visit = (value: unknown): unknown => {
    if (!token) return value;
    if (typeof value === 'string') return value.split(token).join('[REDACTED]');
    if (Array.isArray(value)) return value.map(visit);
    if (
      value !== null &&
      typeof value === 'object' &&
      Object.getPrototypeOf(value) === Object.prototype
    ) {
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [String(visit(key)), visit(child)]),
      );
    }
    return value;
  };
  return <T>(value: T): T => visit(value) as T;
}

export function guardCredentialOutputs<T extends object>(target: T, redact: <V>(value: V) => V): T {
  return new Proxy(target, {
    get(object, key) {
      const member: unknown = Reflect.get(object, key);
      if (typeof member !== 'function') return member;
      return (...args: unknown[]) => Reflect.apply(member, object, args.map(redact));
    },
  });
}

export async function* credentialSafeEvents(
  events: AsyncIterable<StepEvent>,
  token: string | undefined,
): AsyncGenerator<StepEvent> {
  const redact = credentialRedactor(token);
  let pending = '';
  let type: 'text_delta' | 'thinking_delta' | null = null;
  try {
    for await (const event of events) {
      if (!token) {
        yield event;
        continue;
      }
      if (event.type === 'text_delta' || event.type === 'thinking_delta') {
        if (type !== null && type !== event.type && pending !== '') {
          yield { type, text: redact(pending) };
          pending = '';
        }
        type = event.type;
        pending += event.text;
        let cut = Math.max(0, pending.length - token.length + 1);
        const start = pending.lastIndexOf(token, cut);
        if (start >= 0 && start + token.length > cut) cut = start;
        if (cut > 0) {
          yield { type, text: redact(pending.slice(0, cut)) };
          pending = pending.slice(cut);
        }
      } else {
        if (type !== null && pending !== '') yield { type, text: redact(pending) };
        pending = '';
        type = null;
        yield redact(event);
      }
    }
  } catch (error) {
    throw new Error(redact(error instanceof Error ? error.message : String(error)));
  } finally {
    if (type !== null && pending !== '') yield { type, text: redact(pending) };
  }
}

export function prepareCredentialSessionUpload(
  sessionFile: string | undefined,
  token: string | undefined,
  destination: string,
  log: (message: string) => void,
): string | undefined {
  if (!token) return sessionFile;
  const redact = credentialRedactor(token);
  const content = readSessionJsonlForUpload(sessionFile, (message) => log(redact(message)));
  if (content === null) return undefined;
  try {
    writePrivateFile(destination, redact(content));
    return destination;
  } catch {
    log('session jsonl skipped: could not prepare a redacted upload');
    return undefined;
  }
}
