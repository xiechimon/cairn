import { ORB_SERVICE_NAME_RE, ORB_SERVICE_RESERVED_ENV } from '@cairn/shared';
import { parseYamlMapping } from '@cairn/shared/yaml';
import type { OrbEnsureService } from './services-ensure.js';

const RESERVED_ENV: ReadonlySet<string> = new Set(ORB_SERVICE_RESERVED_ENV);

export { parseYamlMapping };

export function loadEnsureServicesFile(text: string): OrbEnsureService[] {
  const parsed = parseYamlMapping(text);
  const services = parsed.services;
  if (
    services === undefined ||
    services === null ||
    typeof services !== 'object' ||
    Array.isArray(services)
  ) {
    throw new Error('services.yaml must contain a nonempty services mapping');
  }
  const records = services as Record<string, unknown>;
  const names = Object.keys(records);
  if (names.length === 0) throw new Error('services.yaml must contain a nonempty services mapping');
  return names.map((name) => serviceFromUnknown(name, records[name]));
}

function serviceFromUnknown(name: string, raw: unknown): OrbEnsureService {
  if (!ORB_SERVICE_NAME_RE.test(name)) throw new Error(`service name ${name} is invalid`);
  if (raw === undefined || raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`service ${name} must be a mapping`);
  }
  const spec = raw as Record<string, unknown>;
  const command = typeof spec.command === 'string' ? spec.command.replace(/\r?\n$/, '') : '';
  if (command.length === 0) {
    throw new Error(`service ${name} requires command`);
  }
  const env = spec.env;
  if (env !== undefined) {
    if (typeof env !== 'object' || env === null || Array.isArray(env)) {
      throw new Error(`service ${name} env is invalid`);
    }
    const envRecord = env as Record<string, unknown>;
    for (const key of Object.keys(envRecord)) {
      if (RESERVED_ENV.has(key) || typeof envRecord[key] !== 'string') {
        throw new Error(`service ${name} env is invalid`);
      }
    }
  }
  if (
    spec.port !== undefined &&
    (typeof spec.port !== 'number' ||
      !Number.isInteger(spec.port) ||
      spec.port < 1 ||
      spec.port > 65535)
  ) {
    throw new Error(`service ${name} port is invalid`);
  }
  if (
    spec.health !== undefined &&
    (typeof spec.health !== 'string' || !spec.health.startsWith('/'))
  ) {
    throw new Error(`service ${name} health is invalid`);
  }
  if (spec.cwd !== undefined && (typeof spec.cwd !== 'string' || spec.cwd.length === 0)) {
    throw new Error(`service ${name} cwd is invalid`);
  }
  return {
    name,
    command,
    ...(typeof spec.cwd === 'string' ? { cwd: spec.cwd } : {}),
    ...(typeof spec.port === 'number' ? { port: spec.port } : {}),
    ...(env !== undefined ? { env: env as Record<string, string> } : {}),
    ...(typeof spec.health === 'string' ? { health: spec.health } : {}),
  };
}
