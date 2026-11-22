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
const SECRET_SHAPED_ENV = /(?:_TOKEN|_SECRET|_PASSWORD|_KEY|_CREDENTIALS?)$/;
const SCRUB_EXEMPT = new Set(['CAIRN_REQUIRE_TOKEN']);

export function scrubSpawnEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...env };
  for (const key of Object.keys(next)) {
    if (SCRUB_EXEMPT.has(key)) continue;
    if (
      SECRET_SHAPED_ENV.test(key) ||
      key.startsWith('CAIRN_OTEL_') ||
      key.startsWith('OTEL_') ||
      key === 'CAIRN_GITHUB_OAUTH_CLIENT_ID' ||
      key === 'CAIRN_ALERT_SMTP_URL'
    )
      delete next[key];
  }
  return next;
}

export function withOtelFileEnv(env: NodeJS.ProcessEnv, file: string | null): NodeJS.ProcessEnv {
  const next = scrubSpawnEnv(env);
  if (file !== null) next[OTEL_ENV_FILE] = file;
  return next;
}
