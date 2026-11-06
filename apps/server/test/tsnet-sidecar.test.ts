import { EventEmitter } from 'node:events';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import {
  restartDelayMs,
  type SidecarLaunch,
  type SidecarProcess,
  type SidecarStatus,
  sidecarArgs,
  sidecarEnv,
  superviseSidecar,
} from '../src/lib/tsnet-sidecar.js';

const tmpDirs: string[] = [];

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

afterAll(() => {
  for (const dir of tmpDirs.splice(0)) releaseTestTempDir(dir);
});

const LAUNCH: SidecarLaunch = {
  binaryPath: '/opt/cairn/tsnet-sidecar',
  stateDir: '/home/owner/.cairn/tsnet/state',
  socketPath: '/home/owner/.cairn/tsnet/tailnet.sock',
  hostname: 'cairn',
  controlUrl: null,
  uploadLogs: false,
};

const silentLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

class FakeSidecar extends EventEmitter implements SidecarProcess {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly written: string[] = [];
  readonly signals: NodeJS.Signals[] = [];
  readonly stdin = new Writable({
    write: (chunk: Buffer, _encoding, done) => {
      this.written.push(chunk.toString('utf8'));
      done();
    },
  });

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.signals.push(signal);
    return true;
  }

  async emitLine(value: unknown): Promise<void> {
    await this.emitRaw(`${JSON.stringify(value)}\n`);
  }

  async emitRaw(text: string): Promise<void> {
    this.stdout.write(text);
    await flush();
  }

  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.emit('exit', code, signal);
  }
}

interface Harness {
  spawned: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv; child: FakeSidecar }>;
  statuses: SidecarStatus[];
  supervisor: ReturnType<typeof superviseSidecar>;
  latest(): FakeSidecar;
}

function harness(
  overrides: Partial<SidecarLaunch> = {},
  parentEnv: NodeJS.ProcessEnv = {},
): Harness {
  const spawned: Harness['spawned'] = [];
  const statuses: SidecarStatus[] = [];
  const supervisor = superviseSidecar({
    launch: { ...LAUNCH, ...overrides },
    parentEnv,
    logger: silentLogger,
    onStatus: (status) => statuses.push(status),
    spawnProcess: (command, args, env) => {
      const child = new FakeSidecar();
      spawned.push({ command, args, env, child });
      return child;
    },
    backoff: { initialMs: 1_000, maxMs: 8_000, stableMs: 30_000 },
    stopGraceMs: 5_000,
    killGraceMs: 2_000,
  });
  return {
    spawned,
    statuses,
    supervisor,
    latest: () => {
      const last = spawned.at(-1);
      if (last === undefined) throw new Error('nothing spawned');
      return last.child;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('sidecar command line (D116 log upload, state, upstream)', () => {
  test('the default command carries the state dir, upstream socket and no log opt-in', async () => {
    const args = sidecarArgs(LAUNCH);
    expect(args).toEqual([
      '--state-dir',
      LAUNCH.stateDir,
      '--tailnet-upstream',
      `unix:${LAUNCH.socketPath}`,
      '--hostname',
      'cairn',
    ]);
    expect(args).not.toContain('--upload-logs');
    expect(args).not.toContain('--funnel-upstream');
  });

  test('log upload and a custom control URL appear only when configured', async () => {
    const args = sidecarArgs({ ...LAUNCH, uploadLogs: true, controlUrl: 'https://control.test' });
    expect(args).toContain('--upload-logs');
    expect(args.slice(args.indexOf('--control-url'), args.indexOf('--control-url') + 2)).toEqual([
      '--control-url',
      'https://control.test',
    ]);
  });

  test('without the opt-in the child env forces TS_NO_LOGS_NO_SUPPORT=true over any inherited value', async () => {
    expect(sidecarEnv({}, false).TS_NO_LOGS_NO_SUPPORT).toBe('true');
    expect(sidecarEnv({ TS_NO_LOGS_NO_SUPPORT: 'false' }, false).TS_NO_LOGS_NO_SUPPORT).toBe(
      'true',
    );
  });

  test('with the opt-in the child env does not add the disable', async () => {
    expect(sidecarEnv({}, true)).not.toHaveProperty('TS_NO_LOGS_NO_SUPPORT');
  });

  test('the child env never inherits server secrets or unrelated variables', async () => {
    const env = sidecarEnv(
      {
        PATH: '/usr/bin',
        HOME: '/home/owner',
        HTTPS_PROXY: 'http://proxy.test:3128',
        TS_AUTHKEY: 'tskey-auth-test',
        CAIRN_TOKEN: 'cairn-secret-token',
        CAIRN_API_KEY: 'cairn_key',
        ANTHROPIC_API_KEY: 'sk-test',
        GITHUB_TOKEN: 'ghp_test',
      },
      false,
    );
    expect(env).toMatchObject({
      PATH: '/usr/bin',
      HOME: '/home/owner',
      HTTPS_PROXY: 'http://proxy.test:3128',
      TS_AUTHKEY: 'tskey-auth-test',
    });
    expect(Object.keys(env).filter((name) => /TOKEN|API_KEY|CAIRN_/.test(name))).toEqual([]);
  });
});

describe('restart backoff', () => {
  const backoff = { initialMs: 1_000, maxMs: 8_000, stableMs: 30_000 };

  test('doubles per consecutive failure and stops at the cap', async () => {
    expect([1, 2, 3, 4, 5, 20].map((n) => restartDelayMs(n, backoff))).toEqual([
      1_000, 2_000, 4_000, 8_000, 8_000, 8_000,
    ]);
  });

  test('never returns less than the initial delay', async () => {
    expect(restartDelayMs(0, backoff)).toBe(1_000);
  });
});

describe('sidecar events become status', () => {
  test('starts in starting, then needs-login with the URL, then ready with the node address', async () => {
    const h = harness();
    expect(h.supervisor.status().state).toBe('starting');
    await h.latest().emitLine({ type: 'authUrl', url: 'https://login.tailscale.com/a/abc' });
    expect(h.supervisor.status()).toMatchObject({
      state: 'needs-login',
      authUrl: 'https://login.tailscale.com/a/abc',
    });
    await h.latest().emitLine({ type: 'ready', ips: ['100.64.0.2'], dnsName: 'cairn.tail.ts.net' });
    expect(h.supervisor.status()).toMatchObject({
      state: 'ready',
      authUrl: null,
      ips: ['100.64.0.2'],
      dnsName: 'cairn.tail.ts.net',
    });
  });

  test('a non-fatal error event is recorded without changing state', async () => {
    const h = harness();
    await h.latest().emitLine({ type: 'error', error: 'status: control unreachable' });
    expect(h.supervisor.status()).toMatchObject({
      state: 'starting',
      lastError: 'status: control unreachable',
    });
  });

  test('lines split across chunks are reassembled', async () => {
    const h = harness();
    const line = `${JSON.stringify({ type: 'ready', ips: ['100.64.0.2'], dnsName: 'cairn.ts.net' })}\n`;
    await h.latest().emitRaw(line.slice(0, 10));
    await h.latest().emitRaw(line.slice(10));
    expect(h.supervisor.status().state).toBe('ready');
  });

  test('garbage, unknown types and malformed events never change state or throw', async () => {
    const h = harness();
    await h.latest().emitRaw('not json\n');
    await h.latest().emitRaw('{"type":"mystery"}\n');
    await h.latest().emitRaw('{"type":"ready","ips":"nope","dnsName":7}\n');
    await h.latest().emitRaw('{"type":"authUrl","url":"javascript:alert(1)"}\n');
    expect(h.supervisor.status()).toMatchObject({ state: 'starting', authUrl: null });
  });

  test('a runaway line without a newline is dropped instead of buffered forever', async () => {
    const h = harness();
    await h.latest().emitRaw('x'.repeat(200_000));
    await h.latest().emitRaw('\n');
    await h.latest().emitLine({ type: 'ready', ips: [], dnsName: 'cairn.ts.net' });
    expect(h.supervisor.status().state).toBe('ready');
  });
});

describe('F10: a crash restarts the sidecar with backoff', () => {
  test('an exit drops the node data and respawns after the initial delay', async () => {
    const h = harness();
    await h.latest().emitLine({ type: 'ready', ips: ['100.64.0.2'], dnsName: 'cairn.ts.net' });
    h.latest().exit(1);
    expect(h.supervisor.status()).toMatchObject({
      state: 'restarting',
      ips: [],
      dnsName: null,
      restarts: 0,
    });
    expect(h.spawned).toHaveLength(1);
    vi.advanceTimersByTime(999);
    expect(h.spawned).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(h.spawned).toHaveLength(2);
    expect(h.supervisor.status()).toMatchObject({ state: 'starting', restarts: 1 });
  });

  test('a crash loop backs off exponentially up to the cap and never gives up', async () => {
    const h = harness();
    const gaps: number[] = [];
    for (let i = 0; i < 6; i++) {
      const before = h.spawned.length;
      h.latest().exit(1);
      let waited = 0;
      while (h.spawned.length === before && waited < 20_000) {
        vi.advanceTimersByTime(1_000);
        waited += 1_000;
      }
      gaps.push(waited);
    }
    expect(gaps).toEqual([1_000, 2_000, 4_000, 8_000, 8_000, 8_000]);
    expect(h.supervisor.status().restarts).toBe(6);
  });

  test('a run that stays up past the stable window resets the backoff', async () => {
    const h = harness();
    h.latest().exit(1);
    vi.advanceTimersByTime(1_000);
    h.latest().exit(1);
    vi.advanceTimersByTime(2_000);
    expect(h.spawned).toHaveLength(3);
    vi.advanceTimersByTime(30_000);
    h.latest().exit(1);
    vi.advanceTimersByTime(999);
    expect(h.spawned).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(h.spawned).toHaveLength(4);
  });

  test('reaching ready resets the backoff even when the run is short', async () => {
    const h = harness();
    h.latest().exit(1);
    vi.advanceTimersByTime(1_000);
    h.latest().exit(1);
    vi.advanceTimersByTime(2_000);
    await h.latest().emitLine({ type: 'ready', ips: [], dnsName: 'cairn.ts.net' });
    h.latest().exit(1);
    vi.advanceTimersByTime(1_000);
    expect(h.spawned).toHaveLength(4);
  });

  test('the last sidecar error survives the restart as lastError', async () => {
    const h = harness();
    await h.latest().emitLine({ type: 'error', error: 'listen tcp :443: bind: permission denied' });
    h.latest().exit(1);
    expect(h.supervisor.status().lastError).toBe('listen tcp :443: bind: permission denied');
  });

  test('each respawn uses the same command, args and env', async () => {
    const h = harness({}, { PATH: '/usr/bin', CAIRN_TOKEN: 'secret' });
    h.latest().exit(1);
    vi.advanceTimersByTime(1_000);
    expect(h.spawned[1]?.command).toBe(LAUNCH.binaryPath);
    expect(h.spawned[1]?.args).toEqual(h.spawned[0]?.args);
    expect(h.spawned[1]?.env).toEqual(h.spawned[0]?.env);
    expect(h.spawned[1]?.env).not.toHaveProperty('CAIRN_TOKEN');
  });
});

describe('binary and spawn failures', () => {
  test('a spawn error (binary missing or not executable) is permanent and never retried', async () => {
    const h = harness();
    const error = Object.assign(new Error('spawn /opt/cairn/tsnet-sidecar ENOENT'), {
      code: 'ENOENT',
    });
    h.latest().emit('error', error);
    expect(h.supervisor.status()).toMatchObject({
      state: 'failed',
      lastError: 'spawn /opt/cairn/tsnet-sidecar ENOENT',
    });
    vi.advanceTimersByTime(120_000);
    expect(h.spawned).toHaveLength(1);
  });

  test('a throwing spawn is a permanent failure, not an uncaught exception', async () => {
    const supervisor = superviseSidecar({
      launch: LAUNCH,
      parentEnv: {},
      logger: silentLogger,
      spawnProcess: () => {
        throw new Error('EACCES');
      },
    });
    expect(supervisor.status()).toMatchObject({ state: 'failed', lastError: 'EACCES' });
  });

  test('every status change is reported to the observer', async () => {
    const h = harness();
    await h.latest().emitLine({ type: 'ready', ips: [], dnsName: 'cairn.ts.net' });
    h.latest().exit(1);
    expect(h.statuses.map((status) => status.state)).toEqual(['starting', 'ready', 'restarting']);
  });
});

describe('clean shutdown', () => {
  test('stop sends the shutdown command, closes stdin and resolves once the sidecar exits', async () => {
    const h = harness();
    const child = h.latest();
    const stopped = h.supervisor.stop();
    expect(child.written.join('')).toBe('{"cmd":"shutdown"}\n');
    expect(child.stdin.writableEnded).toBe(true);
    child.exit(0);
    await stopped;
    expect(child.signals).toEqual([]);
    expect(h.supervisor.status().state).toBe('stopped');
  });

  test('an exit during stop is not restarted', async () => {
    const h = harness();
    const stopped = h.supervisor.stop();
    h.latest().exit(0);
    await stopped;
    vi.advanceTimersByTime(120_000);
    expect(h.spawned).toHaveLength(1);
  });

  test('a sidecar that ignores the shutdown command gets SIGTERM then SIGKILL', async () => {
    const h = harness();
    const child = h.latest();
    const stopped = h.supervisor.stop();
    vi.advanceTimersByTime(5_000);
    expect(child.signals).toEqual(['SIGTERM']);
    vi.advanceTimersByTime(2_000);
    expect(child.signals).toEqual(['SIGTERM', 'SIGKILL']);
    child.exit(null, 'SIGKILL');
    await stopped;
  });

  test('stop during a restart delay cancels the respawn', async () => {
    const h = harness();
    h.latest().exit(1);
    await h.supervisor.stop();
    vi.advanceTimersByTime(120_000);
    expect(h.spawned).toHaveLength(1);
    expect(h.supervisor.status().state).toBe('stopped');
  });

  test('stop is idempotent', async () => {
    const h = harness();
    const first = h.supervisor.stop();
    const second = h.supervisor.stop();
    h.latest().exit(0);
    await Promise.all([first, second]);
    expect(h.latest().written.join('')).toBe('{"cmd":"shutdown"}\n');
  });
});

describe('a real child process', () => {
  function fixture(): { binary: string; dump: string } {
    const dir = makeTestTempDir('tn-fix-');
    tmpDirs.push(dir);
    const dump = join(dir, 'dump.json');
    const binary = join(dir, 'fake-sidecar');
    writeFileSync(
      binary,
      `#!/usr/bin/env node
const { writeFileSync } = require('node:fs');
writeFileSync(${JSON.stringify(dump)}, JSON.stringify({ argv: process.argv.slice(2), env: process.env }));
process.stdout.write(JSON.stringify({ type: 'ready', ips: ['100.64.0.9'], dnsName: 'fake.ts.net' }) + '\\n');
let buffered = '';
process.stdin.on('data', (chunk) => {
  buffered += chunk;
  if (buffered.includes('shutdown')) {
    process.stdout.write(JSON.stringify({ type: 'stopped' }) + '\\n');
    process.exit(0);
  }
});
process.stdin.on('end', () => process.exit(0));
`,
    );
    chmodSync(binary, 0o755);
    return { binary, dump };
  }

  test('receives the args and the filtered env, reports ready, and exits on stop', async () => {
    vi.useRealTimers();
    const { binary, dump } = fixture();
    const supervisor = superviseSidecar({
      launch: { ...LAUNCH, binaryPath: binary },
      parentEnv: { ...process.env, CAIRN_TOKEN: 'must-not-leak', TS_AUTHKEY: 'tskey-test' },
      logger: silentLogger,
    });
    await vi.waitFor(() => expect(supervisor.status().state).toBe('ready'), { timeout: 10_000 });
    expect(supervisor.status()).toMatchObject({ ips: ['100.64.0.9'], dnsName: 'fake.ts.net' });
    const seen = JSON.parse(readFileSync(dump, 'utf8')) as {
      argv: string[];
      env: Record<string, string>;
    };
    expect(seen.argv).toEqual(sidecarArgs(LAUNCH));
    expect(seen.env.TS_NO_LOGS_NO_SUPPORT).toBe('true');
    expect(seen.env.TS_AUTHKEY).toBe('tskey-test');
    expect(seen.env.CAIRN_TOKEN).toBeUndefined();
    await supervisor.stop();
    expect(supervisor.status().state).toBe('stopped');
  });

  test('a missing binary fails permanently without throwing', async () => {
    vi.useRealTimers();
    const supervisor = superviseSidecar({
      launch: { ...LAUNCH, binaryPath: join(makeTestTempDir('tn-miss-'), 'absent') },
      parentEnv: process.env,
      logger: silentLogger,
    });
    await vi.waitFor(() => expect(supervisor.status().state).toBe('failed'), { timeout: 10_000 });
    expect(supervisor.status().lastError).toMatch(/ENOENT/);
    await supervisor.stop();
  });
});
