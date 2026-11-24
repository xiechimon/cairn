import { readFileSync, statSync } from 'node:fs';
import { parseEnv } from 'node:util';

const ENDPOINT = 'CAIRN_OTEL_ENDPOINT';
const HEADERS = 'CAIRN_OTEL_HEADERS';
const ENVIRONMENT = 'CAIRN_OTEL_ENVIRONMENT';
const OTEL_KEYS = [ENDPOINT, HEADERS, ENVIRONMENT] as const;
const DEFAULT_ENVIRONMENT = 'mac';
const GROUP_OR_OTHER_BITS = 0o077;

export type OtelEnv = Partial<Record<(typeof OTEL_KEYS)[number], string>>;

export function desktopOtelEnv(path: string, log: (line: string) => void): OtelEnv {
  let text: string;
  try {
    if ((statSync(path).mode & GROUP_OR_OTHER_BITS) !== 0) {
      log(`Cairn telemetry is off: ${path} is readable by others; run chmod 600 on it.`);
      return {};
    }
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      log(`Cairn telemetry is off: ${path} could not be read (${String(error)}).`);
    }
    return {};
  }
  const parsed = parseEnv(text);
  const endpoint = parsed[ENDPOINT]?.trim();
  if (!endpoint) return {};
  const headers = parsed[HEADERS]?.trim();
  return {
    [ENDPOINT]: endpoint,
    ...(headers ? { [HEADERS]: headers } : {}),
    [ENVIRONMENT]: parsed[ENVIRONMENT]?.trim() || DEFAULT_ENVIRONMENT,
  };
}

const OTEL_ENV_FILE = 'CAIRN_OTEL_ENV_FILE';
const CAIRN_INTERNAL_ENV = new Set([
  'CAIRN_TOKEN',
  'CAIRN_AUTH',
  'CAIRN_API_KEY',
  'CAIRN_GIT_CRED_PASSWORD',
  'CAIRN_GITHUB_OAUTH_CLIENT_SECRET',
  'CAIRN_GITHUB_OAUTH_CLIENT_ID',
  'CAIRN_ALERT_SMTP_URL',
]);

export function scrubSpawnEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...env };
  for (const key of Object.keys(next)) {
    if (CAIRN_INTERNAL_ENV.has(key) || key.startsWith('CAIRN_OTEL_') || key.startsWith('OTEL_'))
      delete next[key];
  }
  return next;
}

export function withOtelFileEnv(env: NodeJS.ProcessEnv, file: string | null): NodeJS.ProcessEnv {
  const next = scrubSpawnEnv(env);
  if (file !== null) next[OTEL_ENV_FILE] = file;
  return next;
}
