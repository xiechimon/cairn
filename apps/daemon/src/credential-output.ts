import type { StepEvent } from '@cairn/shared';
import { writePrivateFile } from './private-fs.js';
import { readSessionJsonlForUpload } from './session-jsonl.js';

export function credentialSecretValues(value: string | undefined): (string | undefined)[] {
  if (!value?.startsWith('{')) return [value];
  try {
    const credential: unknown = JSON.parse(value);
    if (
      credential === null ||
      typeof credential !== 'object' ||
      !('kind' in credential) ||
      credential.kind !== 'oauth-personal'
    )
      return [value];
    return [
      value,
      ...Object.entries(credential).flatMap(([key, secret]) =>
        ['token', 'refreshToken', 'refresh_token'].includes(key) && typeof secret === 'string'
          ? [secret]
          : [],
      ),
    ];
  } catch {
    return [value];
  }
}

const GOOGLE_OAUTH_TOKEN_PATTERN = /(?:ya29\.[A-Za-z0-9._~-]{12,}|1\/\/[A-Za-z0-9._~+/-]{16,})/g;

function buildAsciiCharTable(extra: string): Uint8Array {
  const table = new Uint8Array(128);
  for (let c = 48; c <= 57; c += 1) table[c] = 1;
  for (let c = 65; c <= 90; c += 1) table[c] = 1;
  for (let c = 97; c <= 122; c += 1) table[c] = 1;
  for (let i = 0; i < extra.length; i += 1) table[extra.charCodeAt(i)] = 1;
  return table;
}

const GOOGLE_OAUTH_SPECS = [
  { prefix: 'ya29.', minLen: 17, table: buildAsciiCharTable('._~-') },
  { prefix: '1//', minLen: 19, table: buildAsciiCharTable('._~+/-') },
] as const;
const MAX_DYNAMIC_TOKEN_HOLD = 4_100;

function isTableChar(text: string, index: number, table: Uint8Array): boolean {
  const code = text.charCodeAt(index);
  return code < 128 && table[code] === 1;
}

function holdGoogleOAuthBoundary(text: string, cut: number): number {
  let base = cut;
  for (const { prefix } of GOOGLE_OAUTH_SPECS) {
    for (let len = Math.min(prefix.length - 1, text.length); len >= 1; len--) {
      if (text.endsWith(prefix.slice(0, len))) {
        base = Math.min(base, text.length - len);
      }
    }
  }
  let adjusted = base;
  for (const { prefix, minLen, table } of GOOGLE_OAUTH_SPECS) {
    const floor = Math.max(0, base - MAX_DYNAMIC_TOKEN_HOLD);
    let runStart = base;
    while (runStart > floor && isTableChar(text, runStart - 1, table)) {
      runStart -= 1;
    }
    const runExceedsLimit =
      runStart === floor && runStart > 0 && isTableChar(text, runStart - 1, table);
    if (!runExceedsLimit) {
      if (runStart < base) {
        const idx = text.indexOf(prefix, runStart);
        if (idx >= 0 && idx <= base) adjusted = Math.min(adjusted, idx);
      }
      continue;
    }
    const windowStart = floor + 1;
    const prefixBefore = text.lastIndexOf(prefix, floor);
    let inSameRun = prefixBefore >= 0 && prefixBefore + minLen > windowStart;
    for (let i = prefixBefore; inSameRun && i < floor; i += 1) {
      if (!isTableChar(text, i, table)) inSameRun = false;
    }
    const searchStart = inSameRun ? prefixBefore + minLen : windowStart;
    const idx = text.indexOf(prefix, searchStart);
    if (idx >= 0 && idx <= base) adjusted = Math.min(adjusted, idx);
  }
  return Math.max(0, adjusted);
}

export function credentialRedactor(...values: (string | undefined)[]): <T>(value: T) => T {
  const tokens = values.filter((value): value is string => Boolean(value));
  const visit = (value: unknown): unknown => {
    if (typeof value === 'string') {
      const literalRedacted = tokens.reduce(
        (text, token) => text.split(token).join('[REDACTED]'),
        value,
      );
      return literalRedacted.replace(GOOGLE_OAUTH_TOKEN_PATTERN, '[REDACTED]');
    }
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

export function stepCredentialRedactor(
  secrets: (() => readonly (string | undefined)[]) | undefined,
  ...values: (string | undefined)[]
): <T>(value: T) => T {
  const snapshot = () => {
    try {
      return secrets?.() ?? [];
    } catch {
      return [];
    }
  };
  return (value) => credentialRedactor(...values, ...snapshot())(value);
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
  token: string | undefined | (() => readonly (string | undefined)[]),
): AsyncGenerator<StepEvent> {
  const values = () =>
    (typeof token === 'function' ? token() : [token]).filter((value): value is string =>
      Boolean(value),
    );
  const redact = <T>(value: T): T => credentialRedactor(...values())(value);
  let pending = '';
  let type: 'text_delta' | 'thinking_delta' | null = null;
  try {
    for await (const event of events) {
      const tokens = values();
      if (event.type === 'text_delta' || event.type === 'thinking_delta') {
        if (type !== null && type !== event.type && pending !== '') {
          yield { type, text: redact(pending) };
          pending = '';
        }
        type = event.type;
        pending += event.text;
        let cut =
          tokens.length === 0
            ? pending.length
            : Math.max(0, pending.length - Math.max(...tokens.map((value) => value.length)) + 1);
        for (;;) {
          const next = holdGoogleOAuthBoundary(pending, cut);
          let adjusted = next;
          for (const value of tokens) {
            const start = pending.lastIndexOf(value, adjusted);
            if (start >= 0 && start + value.length > adjusted) adjusted = start;
          }
          if (adjusted === next) {
            cut = next;
            break;
          }
          cut = adjusted;
        }
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
