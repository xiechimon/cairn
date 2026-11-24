const STRIPPED_ENV_KEYS = new Set(
  ['PI_CODING_AGENT_DIR', 'PI_OFFLINE', 'PI_TELEMETRY', 'PI_SKIP_VERSION_CHECK'].map((name) =>
    name.toUpperCase(),
  ),
);

const STRIPPED_ENV_PREFIXES = [
  'CAIRN_',
  'OTEL_',
  'ANT_OTEL_',
  'BETA_TRACING_',
  'ENABLE_BETA_TRACING_',
] as const;

function stripped(name: string): boolean {
  const key = name.toUpperCase();
  if (STRIPPED_ENV_KEYS.has(key)) return true;
  return STRIPPED_ENV_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export function childEnv(
  extra: NodeJS.ProcessEnv = {},
  parent: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(parent)) {
    if (value !== undefined && !stripped(name)) env[name] = value;
  }
  for (const [name, value] of Object.entries(extra)) {
    if (value === undefined) delete env[name];
    else env[name] = value;
  }
  return env;
}
