import { redactSecrets } from '@cairn/shared';

export interface SanitizeOptions {
  home?: string;
}

const ABSOLUTE_HOME_RE = /(?:^|[\s"'=`])(\/(?:home|Users)\/[^/\s"'`]+)(?=$|[\s/"'`])/g;

function replaceHomePaths(text: string, home: string): string {
  let out = text;
  if (home !== '') {
    const trimmed = home.replace(/\/+$/, '');
    if (trimmed !== '') out = out.split(trimmed).join('~');
  }
  return out.replace(ABSOLUTE_HOME_RE, (match, absolute: string) => match.replace(absolute, '~'));
}

export function sanitizeSnapshotText(text: string, options: SanitizeOptions = {}): string {
  const home = options.home ?? process.env.HOME ?? '';
  const withoutHome = replaceHomePaths(text, home);
  return redactSecrets(withoutHome).value as string;
}

export function sanitizeSnapshotValue(value: unknown, options: SanitizeOptions = {}): unknown {
  if (typeof value === 'string') return sanitizeSnapshotText(value, options);
  if (Array.isArray(value)) return value.map((entry) => sanitizeSnapshotValue(entry, options));
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      sanitizeSnapshotText(key, options),
      sanitizeSnapshotValue(child, options),
    ]),
  );
}
