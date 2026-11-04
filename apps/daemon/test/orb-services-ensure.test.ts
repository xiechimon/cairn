import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { buildProgram } from '../src/cli.js';
import {
  ensureOrbServices,
  type OrbEnsureDeps,
  type OrbEnsureService,
} from '../src/orb/services-ensure.js';
import {
  type EnsureCommandIo,
  fetchHealthStatus,
  orbServiceStateDir,
  processStartTime,
  readLiveServicePid,
  runOrbServicesEnsure,
  withEnsureFileLock,
} from '../src/orb/services-runtime.js';
import { loadEnsureServicesFile } from '../src/orb/services-yaml.js';

function webService(port: number, health = '/healthz'): OrbEnsureService {
  return { name: 'web', command: 'pnpm dev', port, health };
}

function fakeDeps(opts: {
  pids?: number[];
  startPid?: number;
  portOpen?: boolean;
  health?: number | null;
  healthSeq?: Array<number | null>;
  readinessMs?: number;
  lastPorts?: Record<string, number>;
  nextPort?: number;
  listeningPid?: number | null;
  ownsPort?: boolean;
}): { deps: OrbEnsureDeps; getStarts: () => number } {
  const state = {
    starts: 0,
    pids: [...(opts.pids ?? [])],
    ports: new Map<string, number>(Object.entries(opts.lastPorts ?? {})),
    clock: 0,
    nextPort: opts.nextPort ?? 4000,
    healthCalls: 0,
  };
  const deps: OrbEnsureDeps = {
    listPids: async () => state.pids,
    start: async () => {
      state.starts += 1;
      const pid = opts.startPid ?? 1000 + state.starts;
      state.pids = [pid];
      return pid;
    },
    waitForPort: async () => opts.portOpen !== false,
    healthStatus: async () => {
      state.healthCalls += 1;
      if (opts.healthSeq !== undefined) {
        return opts.healthSeq[Math.min(state.healthCalls - 1, opts.healthSeq.length - 1)] ?? null;
      }
      return opts.health === undefined ? 200 : opts.health;
    },
    allocatePort: async () => {
      const port = state.nextPort;
      state.nextPort += 1;
      return port;
    },
    lastPort: async (name) => state.ports.get(name) ?? null,
    savePort: async (name, port) => {
      state.ports.set(name, port);
    },
    listeningPid: async () => opts.listeningPid ?? null,
    ownsPort: async () => opts.ownsPort !== false,
    now: () => state.clock,
    sleep: async (ms) => {
      state.clock += ms;
    },
    readinessMs: opts.readinessMs ?? 60_000,
    withLock: async (fn) => fn(),
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
    const { deps } = fakeDeps({ portOpen: true, health: 500, readinessMs: 20 });
    const result = await ensureOrbServices([webService(3000)], deps);
    expect(result.services[0]?.ready).toBe(false);
    expect(result.ok).toBe(false);
  });

  it('reuses an auto-assigned port on the second ensure', async () => {
    const service: OrbEnsureService = { name: 'web', command: 'pnpm dev', health: '/healthz' };
    const first = fakeDeps({ portOpen: true, health: 200 });
    const once = await ensureOrbServices([service], first.deps);
    const again = await ensureOrbServices([service], first.deps);
    expect(first.getStarts()).toBe(1);
    expect(once.services[0]?.url).toBe('http://127.0.0.1:4000/healthz');
    expect(again.services[0]?.url).toBe('http://127.0.0.1:4000/healthz');
  });

  it('retries health 503 until a 200 within the readiness deadline', async () => {
    const { deps } = fakeDeps({
      portOpen: true,
      healthSeq: [503, 503, 200],
      readinessMs: 100,
    });
    const result = await ensureOrbServices([webService(3000)], deps);
    expect(result.ok).toBe(true);
    expect(result.services[0]?.ready).toBe(true);
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

  it('reports not ready when the listener is not in the started process tree', async () => {
    const { deps } = fakeDeps({ portOpen: true, health: 200, ownsPort: false });
    const result = await ensureOrbServices([webService(3000)], deps);
    expect(result.ok).toBe(false);
    expect(result.services[0]?.ready).toBe(false);
  });

  it('allocates a new auto-port when the remembered port is already bound', async () => {
    const { deps } = fakeDeps({
      portOpen: true,
      health: 200,
      lastPorts: { web: 3000 },
      nextPort: 5000,
      listeningPid: 9999,
    });
    const result = await ensureOrbServices(
      [{ name: 'web', command: 'pnpm dev', health: '/healthz' }],
      deps,
    );
    expect(result.services[0]?.url).toBe('http://127.0.0.1:5000/healthz');
    expect(result.ok).toBe(true);
  });

  it('serializes overlapping ensure calls so a missing service starts once', async () => {
    const state = { starts: 0, pids: [] as number[] };
    let firstStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    let releaseFirst: () => void = () => {};
    const hold = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let chain = Promise.resolve();
    const { deps } = fakeDeps({ portOpen: true, health: 200 });
    deps.listPids = async () => state.pids;
    deps.start = async () => {
      state.starts += 1;
      if (state.starts === 1) {
        firstStarted();
        await hold;
      }
      state.pids = [1000];
      return 1000;
    };
    deps.withLock = (fn) => {
      const run = chain.then(fn, fn);
      chain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    };
    const first = ensureOrbServices([webService(3000)], deps);
    await started;
    const second = ensureOrbServices([webService(3000)], deps);
    releaseFirst();
    await Promise.all([first, second]);
    expect(state.starts).toBe(1);
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

  it('folds a >- command block into one command string', () => {
    const [web] = loadEnsureServicesFile(`
services:
  web:
    command: >-
      php artisan serve
      --host=0.0.0.0
      --port=$PORT
`);
    expect(web?.command).toBe('php artisan serve --host=0.0.0.0 --port=$PORT');
  });

  it('strips an inline comment after a port value', () => {
    const [web] = loadEnsureServicesFile(`
services:
  web:
    command: pnpm dev
    port: 3000 # local dev
`);
    expect(web?.port).toBe(3000);
  });

  it('keeps an unseparated hash inside a folded command', () => {
    const [web] = loadEnsureServicesFile(`
services:
  web:
    command: >-
      echo foo#bar
      --port=$PORT
`);
    expect(web?.command).toBe('echo foo#bar --port=$PORT');
  });

  it('keeps hash lines and blanks inside a literal command block', () => {
    const [web] = loadEnsureServicesFile(`
services:
  web:
    command: |
      cat <<'EOF'
      # heading

      body
      EOF
`);
    expect(web?.command).toBe("cat <<'EOF'\n# heading\n\nbody\nEOF");
  });

  it('decodes escaped quotes so a hash stays inside the command', () => {
    const [web] = loadEnsureServicesFile(`
services:
  web:
    command: "printf \\" #tag\\""
`);
    expect(web?.command).toBe('printf " #tag"');
  });

  it('rejects a port outside 1 through 65535', () => {
    for (const port of [0, -1, 65536]) {
      expect(() =>
        loadEnsureServicesFile(`
services:
  web:
    command: ./serve
    port: ${port}
`),
      ).toThrow('port is invalid');
    }
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

describe('service pid identity (#2280)', () => {
  it('reuses a live pid only when the recorded start time matches', () => {
    const dir = makeTestTempDir('orb-pid-');
    try {
      const path = join(dir, 'web.pid');
      const start = processStartTime(process.pid);
      expect(start).not.toBeNull();
      writeFileSync(path, `${process.pid} ${start}\n`);
      expect(readLiveServicePid(path)).toBe(process.pid);
      writeFileSync(path, `${process.pid} ${Number(start) - 1}\n`);
      expect(readLiveServicePid(path)).toBeNull();
      writeFileSync(path, `${process.pid}\n`);
      expect(readLiveServicePid(path)).toBeNull();
    } finally {
      releaseTestTempDir(dir);
    }
  });
});

describe('withEnsureFileLock (#2280)', () => {
  it('runs overlapping lock holders one after another', async () => {
    const dir = makeTestTempDir('orb-lock-');
    const lockPath = join(dir, 'ensure.lock');
    const order: number[] = [];
    let claimed: () => void = () => {};
    const claimedP = new Promise<void>((resolve) => {
      claimed = resolve;
    });
    let release: () => void = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = withEnsureFileLock(lockPath, async () => {
      order.push(1);
      claimed();
      await hold;
      order.push(2);
    });
    await claimedP;
    const second = withEnsureFileLock(lockPath, async () => {
      order.push(3);
    });
    release();
    try {
      await Promise.all([first, second]);
      expect(order).toEqual([1, 2, 3]);
    } finally {
      releaseTestTempDir(dir);
    }
  });
});

describe('orbServiceStateDir (#2280)', () => {
  it('namespaces pid/port state by the services file path', () => {
    const a = orbServiceStateDir('/tmp/home', '/ws-a/.agents/services.yaml');
    const b = orbServiceStateDir('/tmp/home', '/ws-b/.agents/services.yaml');
    expect(a).not.toBe(b);
    expect(a.startsWith('/tmp/home/orb-services/')).toBe(true);
    expect(b.startsWith('/tmp/home/orb-services/')).toBe(true);
  });
});

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

  it('keeps a 302 health status instead of following the redirect', async () => {
    const server = createServer((req, res) => {
      if (req.url === '/healthz') {
        res.writeHead(302, { Location: '/gone' });
        res.end();
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    try {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      expect(await fetchHealthStatus(`http://127.0.0.1:${port}/healthz`)).toBe(302);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  it('registers cairn-daemon orb services ensure --json', () => {
    const orb = buildProgram().commands.find((command) => command.name() === 'orb');
    const services = orb?.commands.find((command) => command.name() === 'services');
    const ensure = services?.commands.find((command) => command.name() === 'ensure');
    expect(ensure?.options.some((option) => option.long === '--json')).toBe(true);
  });
});
