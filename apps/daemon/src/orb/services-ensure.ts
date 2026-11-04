export type OrbEnsureService = {
  name: string;
  command: string;
  cwd?: string;
  port?: number;
  env?: Record<string, string>;
  health?: string;
};

export type OrbEnsureStatus = {
  name: string;
  ready: boolean;
  pid: number | null;
  url?: string;
  error?: string;
};

export type OrbEnsureDeps = {
  listPids(name: string): Promise<number[]>;
  start(service: OrbEnsureService, env: Record<string, string>): Promise<number>;
  waitForPort(port: number, deadlineMs: number): Promise<boolean>;
  healthStatus(url: string): Promise<number | null>;
  allocatePort(): Promise<number>;
  now(): number;
  readinessMs: number;
};

export async function ensureOrbServices(
  services: OrbEnsureService[],
  deps: OrbEnsureDeps,
): Promise<{ services: OrbEnsureStatus[]; ok: boolean }> {
  const results: OrbEnsureStatus[] = [];
  for (const service of services) {
    results.push(await ensureOne(service, deps));
  }
  return { services: results, ok: results.every((row) => row.ready) };
}

async function ensureOne(service: OrbEnsureService, deps: OrbEnsureDeps): Promise<OrbEnsureStatus> {
  const existing = await deps.listPids(service.name);
  const port = service.port ?? (await deps.allocatePort());
  const env = { ...service.env, PORT: String(port) };
  let pid = existing[0] ?? null;
  if (pid === null) pid = await deps.start(service, env);
  const url = `http://127.0.0.1:${port}${service.health ?? '/'}`;
  const opened = await deps.waitForPort(port, deps.now() + deps.readinessMs);
  if (!opened) {
    return { name: service.name, ready: false, pid, url, error: 'NOT RESPONDING' };
  }
  if (service.health !== undefined) {
    const status = await deps.healthStatus(url);
    if (status === null || status < 200 || status >= 400) {
      return { name: service.name, ready: false, pid, url };
    }
  }
  return { name: service.name, ready: true, pid, url };
}
