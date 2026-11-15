const pinnedByDaemon = new Map<string, string>();

export function pinProcessEnv(pins: Record<string, string>): void {
  for (const [key, value] of Object.entries(pins)) {
    process.env[key] = value;
    pinnedByDaemon.set(key, value);
  }
}

export function withoutPinnedEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const childEnv = { ...env };
  for (const [key, value] of pinnedByDaemon) {
    if (childEnv[key] === value) delete childEnv[key];
  }
  return childEnv;
}
