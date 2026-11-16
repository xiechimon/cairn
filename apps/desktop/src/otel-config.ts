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

export function withOtelEnv(env: NodeJS.ProcessEnv, otel: OtelEnv): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...env };
  for (const key of OTEL_KEYS) delete next[key];
  return { ...next, ...otel };
}
