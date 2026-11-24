import type { StepEvent } from '@cairn/shared';
import { writePrivateFile } from './private-fs.js';
import { readSessionJsonlForUpload } from './session-jsonl.js';

const GITHUB_TOKEN_PATTERN = /(?:gh[opsu]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})/g;
const GITHUB_TOKEN_PREFIXES = ['gho_', 'ghp_', 'ghs_', 'ghu_', 'github_pat_'];

export class CredentialRegistry {
  private readonly entries = new Map<string, number>();
  private readonly timer: ReturnType<typeof setInterval>;
  private disposed = false;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly capacity = 128,
  ) {
    this.timer = setInterval(() => this.prune(), 60_000);
    this.timer.unref?.();
  }

  remember(value: string | undefined, expiresAt = Infinity): void {
    if (this.disposed) throw new Error('Credential registry disposed');
    this.prune();
    if (!value || expiresAt <= this.now()) return;
    if (!this.entries.has(value) && this.entries.size >= this.capacity)
      throw new Error('Credential registry capacity exceeded');
    this.entries.set(value, Math.max(this.entries.get(value) ?? 0, expiresAt));
  }

  values(): string[] {
    this.prune();
    return [...this.entries.keys()];
  }

  redact<T>(value: T): T {
    return credentialRedactor(...this.values())(value);
  }

  dispose(): void {
    this.disposed = true;
    clearInterval(this.timer);
    this.entries.clear();
  }

  private prune(): void {
    for (const [value, expiresAt] of this.entries) {
      if (expiresAt <= this.now()) this.entries.delete(value);
    }
  }
}

export function credentialRedactor(...values: (string | undefined)[]): <T>(value: T) => T {
  const tokens = values.filter((value): value is string => Boolean(value));
  const visit = (value: unknown): unknown => {
    if (typeof value === 'string')
      return tokens
        .reduce((text, token) => text.split(token).join('[REDACTED]'), value)
        .replace(GITHUB_TOKEN_PATTERN, '[REDACTED]');
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
        let cut = pending.length;
        for (const value of [...tokens, ...GITHUB_TOKEN_PREFIXES]) {
          for (let length = 1; length < value.length && length <= pending.length; length++) {
            if (pending.endsWith(value.slice(0, length)))
              cut = Math.min(cut, pending.length - length);
          }
        }
        const githubSuffix = /(?:gh[opsu]_[A-Za-z0-9]{0,255}|github_pat_[A-Za-z0-9_]{0,255})$/.exec(
          pending,
        );
        if (githubSuffix !== null) cut = Math.min(cut, githubSuffix.index);
        for (const value of [...tokens, ...pending.matchAll(GITHUB_TOKEN_PATTERN)].map((value) =>
          typeof value === 'string' ? value : value[0],
        )) {
          const start = pending.lastIndexOf(value, cut);
          if (start >= 0 && start + value.length > cut) cut = start;
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
