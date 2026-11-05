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
  lastPort(name: string): Promise<number | null>;
  savePort(name: string, port: number): Promise<void>;
  now(): number;
  sleep(ms: number): Promise<void>;
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
  const port = service.port ?? (await deps.lastPort(service.name)) ?? (await deps.allocatePort());
  await deps.savePort(service.name, port);
  const env = { ...service.env, PORT: String(port) };
  let pid = existing[0] ?? null;
  if (pid === null) pid = await deps.start(service, env);
  const url = `http://127.0.0.1:${port}${service.health ?? '/'}`;
  const deadline = deps.now() + deps.readinessMs;
  const opened = await deps.waitForPort(port, deadline);
  if (!opened) {
    return { name: service.name, ready: false, pid, url, error: 'NOT RESPONDING' };
  }
  if (service.health !== undefined) {
    const status = await waitForHealth(deps, url, deadline);
    if (status === null || status < 200 || status >= 400) {
      return { name: service.name, ready: false, pid, url };
    }
  }
  return { name: service.name, ready: true, pid, url };
}

function isReadyStatus(status: number | null): boolean {
  return status !== null && status >= 200 && status < 400;
}

async function waitForHealth(
  deps: OrbEnsureDeps,
  url: string,
  deadlineMs: number,
): Promise<number | null> {
  let last: number | null = null;
  for (;;) {
    last = await deps.healthStatus(url);
    if (isReadyStatus(last) || deps.now() >= deadlineMs) return last;
    await deps.sleep(20);
    if (deps.now() >= deadlineMs) return last;
  }
}
