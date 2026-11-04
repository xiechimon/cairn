import { describe, expect, it } from 'vitest';
import { buildProgram } from '../src/cli.js';
import {
  ensureOrbServices,
  type OrbEnsureDeps,
  type OrbEnsureService,
} from '../src/orb/services-ensure.js';
import { type EnsureCommandIo, runOrbServicesEnsure } from '../src/orb/services-runtime.js';
import { loadEnsureServicesFile } from '../src/orb/services-yaml.js';

function webService(port: number, health = '/healthz'): OrbEnsureService {
  return { name: 'web', command: 'pnpm dev', port, health };
}

function fakeDeps(opts: {
  pids?: number[];
  startPid?: number;
  portOpen?: boolean;
  health?: number | null;
  readinessMs?: number;
}): { deps: OrbEnsureDeps; getStarts: () => number } {
  const state = { starts: 0, pids: [...(opts.pids ?? [])] };
  const deps: OrbEnsureDeps = {
    listPids: async () => state.pids,
    start: async () => {
      state.starts += 1;
      const pid = opts.startPid ?? 1000 + state.starts;
      state.pids = [pid];
      return pid;
    },
    waitForPort: async () => opts.portOpen !== false,
    healthStatus: async () => (opts.health === undefined ? 200 : opts.health),
    allocatePort: async () => 4000,
    now: () => 0,
    readinessMs: opts.readinessMs ?? 60_000,
  };
  return { deps, getStarts: () => state.starts };
}

describe('ensureOrbServices (#2280)', () => {
  it('starts a missing service once and does not spawn again on the second ensure', async () => {
    const first = fakeDeps({ portOpen: true, health: 200 });
    const once = await ensureOrbServices([webService(3000)], first.deps);
    expect(first.getStarts()).toBe(1);
    expect(once.services[0]?.ready).toBe(true);
    expect(once.services[0]?.url).toBe('http://127.0.0.1:3000/healthz');
    expect(once.ok).toBe(true);

    const again = await ensureOrbServices([webService(3000)], first.deps);
    expect(first.getStarts()).toBe(1);
    expect(again.services[0]?.pid).toBe(once.services[0]?.pid);
    expect(again.ok).toBe(true);
  });

  it('reports ready false when health returns 500', async () => {
    const { deps } = fakeDeps({ portOpen: true, health: 500 });
    const result = await ensureOrbServices([webService(3000)], deps);
    expect(result.services[0]?.ready).toBe(false);
    expect(result.ok).toBe(false);
  });

  it('returns NOT RESPONDING when the port never opens', async () => {
    const { deps } = fakeDeps({ portOpen: false, readinessMs: 20 });
    const result = await ensureOrbServices([webService(1)], deps);
    expect(result.ok).toBe(false);
    expect(result.services[0]?.ready).toBe(false);
    expect(result.services[0]?.error).toBe('NOT RESPONDING');
  });

  it('treats a 302 health status as ready', async () => {
    const { deps } = fakeDeps({ portOpen: true, health: 302 });
    const result = await ensureOrbServices([webService(3000)], deps);
    expect(result.ok).toBe(true);
    expect(result.services[0]?.ready).toBe(true);
  });
});

const ampWebYaml = `
services:
  web:
    command: pnpm dev -- --host 0.0.0.0 --port "$PORT"
    cwd: app
    health: /healthz
    env:
      API_MODE: development
    review: true
    agent: observe
    portal:
      url: /
      title: App
    portals:
      - url: /admin
        title: Admin
`;

const groupedPortalsYaml = `
services:
  web:
    command: pnpm dev
    portal: true
    portals:
      - folder: Marketing site
        links:
          - url: /home
            title: Homepage
          - url: /pricing
            title: Pricing
      - url: /storybook
        title: Storybook
`;

describe('loadEnsureServicesFile (#2280)', () => {
  it('loads command, cwd, health, and env from the Amp web example and ignores portal fields', () => {
    const [web] = loadEnsureServicesFile(ampWebYaml);
    expect(web).toEqual({
      name: 'web',
      command: 'pnpm dev -- --host 0.0.0.0 --port "$PORT"',
      cwd: 'app',
      health: '/healthz',
      env: { API_MODE: 'development' },
    });
  });

  it('loads grouped portal yaml without requiring a yaml package', () => {
    const [web] = loadEnsureServicesFile(groupedPortalsYaml);
    expect(web?.name).toBe('web');
    expect(web?.command).toBe('pnpm dev');
  });

  it('rejects env that sets PORT', () => {
    expect(() =>
      loadEnsureServicesFile(`
services:
  web:
    command: ./serve
    env:
      PORT: "3000"
`),
    ).toThrow('env is invalid');
  });
});

function commandIo(opts: { files?: Record<string, string>; deps: OrbEnsureDeps }): {
  io: EnsureCommandIo;
  out: string[];
  err: string[];
} {
  const out: string[] = [];
  const err: string[] = [];
  const files = opts.files ?? {};
  return {
    out,
    err,
    io: {
      cwd: '/workspace',
      home: '/tmp/cairn-test-home',
      exists: (path) => path in files,
      readFile: (path) => files[path] ?? '',
      writeOut: (text) => {
        out.push(text);
      },
      writeErr: (text) => {
        err.push(text);
      },
      deps: opts.deps,
    },
  };
}

describe('runOrbServicesEnsure (#2280)', () => {
  it('prints JSON ready true and does not start twice', async () => {
    const first = fakeDeps({ portOpen: true, health: 200 });
    const yaml = `
services:
  web:
    command: pnpm dev
    port: 3000
    health: /healthz
`;
    const once = commandIo({
      files: { '/workspace/.agents/services.yaml': yaml },
      deps: first.deps,
    });
    expect(await runOrbServicesEnsure({ json: true }, once.io)).toBe(0);
    expect(JSON.parse(once.out.join('')).services[0].ready).toBe(true);
    expect(first.getStarts()).toBe(1);

    const again = commandIo({
      files: { '/workspace/.agents/services.yaml': yaml },
      deps: first.deps,
    });
    expect(await runOrbServicesEnsure({ json: true }, again.io)).toBe(0);
    expect(first.getStarts()).toBe(1);
  });

  it('exits 1 with NOT RESPONDING on stderr when the port never opens', async () => {
    const { deps } = fakeDeps({ portOpen: false, readinessMs: 20 });
    const { io, err } = commandIo({
      files: {
        '/workspace/.agents/services.yaml': `
services:
  web:
    command: ./serve
    port: 1
    health: /healthz
`,
      },
      deps,
    });
    expect(await runOrbServicesEnsure({}, io)).toBe(1);
    expect(err.join('')).toContain('NOT RESPONDING');
  });

  it('registers cairn-daemon orb services ensure --json', () => {
    const orb = buildProgram().commands.find((command) => command.name() === 'orb');
    const services = orb?.commands.find((command) => command.name() === 'services');
    const ensure = services?.commands.find((command) => command.name() === 'ensure');
    expect(ensure?.options.some((option) => option.long === '--json')).toBe(true);
  });
});
