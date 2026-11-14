import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createConnection, type Socket } from 'node:net';
import path from 'node:path';
import type {
  ComputerCall,
  ComputerFrame,
  MachineComputerFramesBody,
  MachineComputerFramesResponse,
} from '@cairn/shared';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { createComputerDispatcher } from '../src/computer/dispatch.js';
import { HostComputerProvider } from '../src/computer/host.js';
import { OrbComputerProvider, type OrbComputerProviderOptions } from '../src/computer/orb.js';
import { runOrbComputerAgent } from '../src/computer/orb-agent.js';
import {
  decodeOrbComputerFrame,
  encodeOrbComputerFrame,
  readOrbComputerLines,
} from '../src/computer/orb-protocol.js';
import { type ComputerProcessEvent, ComputerRefusal } from '../src/computer/provider.js';

const RELEASE = '1.0.0-abcd1234-dist-0123456789abcdef';
const SCOPE = 'chief:chief-1';
const NAME = 'c1';
const FAST = { flushMs: 20, heartbeatMs: 5_000, retryBaseMs: 5, retryMaxMs: 20 };

let allocatedRoot: string;
let root: string;
let runtime: string;
let home: string;
let socketPath: string;
let provider: OrbComputerProvider | undefined;
let guests: Promise<unknown>[];
let sockets: Socket[];
let touched: string[];
let ensured: string[];

beforeEach(() => {
  allocatedRoot = makeTestTempDir('co-');
  root = realpathSync(allocatedRoot);
  runtime = path.join(root, 'r');
  mkdirSync(path.join(runtime, NAME), { recursive: true, mode: 0o700 });
  home = path.join(root, 'home');
  mkdirSync(home);
  socketPath = path.join(runtime, NAME, 'computer.sock');
  guests = [];
  sockets = [];
  touched = [];
  ensured = [];
});

afterEach(async () => {
  for (const socket of sockets) socket.destroy();
  await provider?.close();
  provider = undefined;
  await Promise.allSettled(guests);
  expect(releaseTestTempDir(allocatedRoot)).toBe(true);
});

function makeProvider(overrides: Partial<OrbComputerProviderOptions> = {}) {
  provider = new OrbComputerProvider({
    orbs: {
      ensure: async (scope) => {
        ensured.push(scope);
        return NAME;
      },
      touch: (scope) => {
        touched.push(scope);
      },
    },
    runtimeRoot: runtime,
    expectedRelease: () => RELEASE,
    connectTimeoutMs: 15_000,
    heartbeatTimeoutMs: 15_000,
    stopGraceMs: 300,
    ...overrides,
  });
  return provider;
}

function hostProvider() {
  return new HostComputerProvider({
    home,
    env: { PATH: process.env.PATH, HOME: home },
    killGraceMs: 200,
  });
}

function startGuest(options: { release?: string; guest?: HostComputerProvider } = {}) {
  const done = runOrbComputerAgent({
    socketPath,
    release: options.release ?? RELEASE,
    provider: options.guest ?? hostProvider(),
    heartbeatMs: 1_000,
  });
  guests.push(done.catch(() => undefined));
  return done;
}

async function until(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not reached');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function fakeGuest(auth: 'good' | 'bad-token' | 'no-token' | 'stale') {
  await until(() => existsSync(socketPath) && existsSync(`${socketPath}.token`));
  const token = readFileSync(`${socketPath}.token`, 'utf8');
  const socket = createConnection(socketPath);
  socket.on('error', () => {});
  sockets.push(socket);
  const frames: unknown[] = [];
  let closed = false;
  socket.on('close', () => {
    closed = true;
  });
  readOrbComputerLines(socket, (line) => frames.push(decodeOrbComputerFrame(line)));
  await new Promise<void>((resolve) => socket.once('connect', () => resolve()));
  const body =
    auth === 'no-token'
      ? { type: 'auth', release: RELEASE }
      : {
          type: 'auth',
          token: auth === 'bad-token' ? 'f'.repeat(64) : token,
          release: auth === 'stale' ? '1.0.0-abcd1234-dist-ffffffffffffffff' : RELEASE,
        };
  socket.write(encodeOrbComputerFrame(body));
  return {
    socket,
    frames,
    isClosed: () => closed,
    send: (frame: unknown) => socket.write(encodeOrbComputerFrame(frame)),
  };
}

type Post = { callId: string; frames: ComputerFrame[] };

function fakeClient(respond?: (post: Post) => MachineComputerFramesResponse) {
  const posts: Post[] = [];
  return {
    posts,
    client: {
      async computerFrames(callId: string, body: MachineComputerFramesBody) {
        const post = { callId, frames: body.frames };
        posts.push(post);
        return respond?.(post) ?? { ok: true as const, cancelled: false };
      },
    },
    get frames() {
      return posts.flatMap((post) => post.frames);
    },
  };
}

let callCounter = 0;
function call(overrides: Partial<ComputerCall> & { command?: string } = {}): ComputerCall {
  const { command, ...rest } = overrides;
  callCounter += 1;
  return {
    callId: callCounter.toString(16).padStart(64, '0'),
    stepId: 'step-1',
    tool: 'shell',
    params: { command: command ?? 'echo hi' },
    deadlineAt: Date.now() + 60_000,
    scopeKey: SCOPE,
    ...rest,
  };
}

function lastFrame(frames: ComputerFrame[]) {
  return frames[frames.length - 1];
}

function stdoutOf(frames: ComputerFrame[]): string {
  return frames.flatMap((frame) => (frame.kind === 'output' ? [frame.text] : [])).join('');
}

async function drain(events: AsyncIterable<ComputerProcessEvent>) {
  const seen: ComputerProcessEvent[] = [];
  for await (const event of events) seen.push(event);
  return seen;
}

describe('orb computer through a real guest agent', () => {
  test('shell output, exit code and file tools travel the unix socket and touch the computer per call', async () => {
    const orb = makeProvider();
    startGuest();
    const fake = fakeClient();
    const dispatcher = createComputerDispatcher({ client: fake.client, orb, ...FAST });
    await dispatcher.dispatch(call({ command: 'echo from-guest; echo err >&2; exit 3' }));
    expect(stdoutOf(fake.frames)).toContain('from-guest');
    expect(lastFrame(fake.frames)).toMatchObject({ kind: 'done', exitCode: 3 });
    await dispatcher.dispatch(
      call({ tool: 'write_file', params: { path: 'notes/a.txt', content: 'héllo' } }),
    );
    expect(readFileSync(path.join(home, 'notes/a.txt'), 'utf8')).toBe('héllo');
    const read = fakeClient();
    const second = createComputerDispatcher({ client: read.client, orb, ...FAST });
    await second.dispatch(call({ tool: 'read_file', params: { path: 'notes/a.txt' } }));
    expect(lastFrame(read.frames)).toMatchObject({ kind: 'done', text: 'héllo' });
    await second.dispatch(call({ tool: 'list_files', params: {} }));
    expect(lastFrame(read.frames)).toMatchObject({ kind: 'done' });
    expect((lastFrame(read.frames) as { text: string }).text).toContain('notes');
    expect(ensured).toEqual(Array(4).fill(SCOPE));
    expect(touched).toEqual(Array(5).fill(SCOPE));
  });

  test('a long quiet command keeps touching the computer while it runs', async () => {
    const orb = makeProvider({ touchMs: 100 });
    startGuest();
    const fake = fakeClient();
    const dispatcher = createComputerDispatcher({ client: fake.client, orb, ...FAST });
    await dispatcher.dispatch(call({ command: 'sleep 1' }));
    expect(touched.length).toBeGreaterThanOrEqual(6);
  });

  test('path escapes in the file tools are refused by the guest and nothing is read or written', async () => {
    const orb = makeProvider();
    startGuest();
    writeFileSync(path.join(root, 'secret.txt'), 'outside');
    const fake = fakeClient();
    const dispatcher = createComputerDispatcher({ client: fake.client, orb, ...FAST });
    await dispatcher.dispatch(call({ tool: 'read_file', params: { path: '../secret.txt' } }));
    await dispatcher.dispatch(
      call({ tool: 'write_file', params: { path: '/tmp/co-escape.txt', content: 'x' } }),
    );
    await dispatcher.dispatch(call({ tool: 'list_files', params: { path: '..' } }));
    expect(fake.frames).toHaveLength(3);
    for (const frame of fake.frames) {
      expect(frame).toMatchObject({ kind: 'error', delivery: 'not_delivered' });
      expect((frame as { message: string }).message).toContain('inside the home folder');
    }
    expect(existsSync('/tmp/co-escape.txt')).toBe(false);
  });

  test('runaway output is capped and a command past its timeout is killed with its tree', async () => {
    const orb = makeProvider();
    startGuest();
    const fake = fakeClient();
    const dispatcher = createComputerDispatcher({
      client: fake.client,
      orb,
      commandTimeoutMs: 1_500,
      outputCapChars: 20_000,
      ...FAST,
    });
    await dispatcher.dispatch(call({ command: 'yes cairn-runaway-test' }));
    expect(stdoutOf(fake.frames).length).toBeLessThan(20_000 + 100);
    expect(stdoutOf(fake.frames)).toContain('[output truncated]');
    expect(lastFrame(fake.frames)).toMatchObject({ kind: 'error', delivery: 'unknown' });
    expect((lastFrame(fake.frames) as { message: string }).message).toContain('timed out');
    await until(() => spawnSync('pgrep', ['-f', 'yes cairn-runaway-test']).status !== 0);
  });

  test('a stale guest release is refused and the agent reports it', async () => {
    const orb = makeProvider({ connectTimeoutMs: 300 });
    const stale = startGuest({ release: '1.0.0-abcd1234-dist-ffffffffffffffff' });
    await expect(
      orb.forScope(SCOPE).execute({
        argv: ['true'],
        timeoutMs: 1_000,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/did not connect/);
    await expect(stale).resolves.toBe('stale-release');
  });

  test('a response frame over the transport cap becomes a refusal, not a dropped connection', async () => {
    const orb = makeProvider();
    startGuest();
    writeFileSync(path.join(home, 'quotes.txt'), '"'.repeat(8 * 1024 * 1024));
    const scoped = orb.forScope(SCOPE);
    await expect(scoped.readFile('quotes.txt')).rejects.toThrow(/too large/);
    await expect(scoped.readFile('missing.txt')).rejects.toBeInstanceOf(ComputerRefusal);
  });

  test('a request over the transport cap is refused before it is sent', async () => {
    const orb = makeProvider();
    startGuest();
    const scoped = orb.forScope(SCOPE);
    await expect(scoped.writeFile('big.txt', 'x'.repeat(17 * 1024 * 1024))).rejects.toThrow(
      /too large/,
    );
    expect(existsSync(path.join(home, 'big.txt'))).toBe(false);
  });

  test('aborting a call cancels the guest command', async () => {
    const orb = makeProvider();
    startGuest();
    const controller = new AbortController();
    const pending = orb.forScope(SCOPE).execute({
      argv: ['bash', '-c', 'sleep 28.123'],
      timeoutMs: 60_000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 300);
    const seen = await drain(await pending);
    expect(seen.at(-1)).toMatchObject({ kind: 'exit', reason: 'aborted' });
    await until(() => spawnSync('pgrep', ['-f', 'sleep 28.123']).status !== 0);
  });
});

describe('orb computer silent commands and file deadlines', () => {
  test('a silent command is observable and cancellable before its first output', async () => {
    const orb = makeProvider();
    const controller = new AbortController();
    const pending = orb.forScope(SCOPE).execute({
      argv: ['sleep', '30'],
      timeoutMs: 60_000,
      signal: controller.signal,
    });
    const guest = await fakeGuest('good');
    const requestFrame = () =>
      guest.frames.find((frame) => (frame as { method?: string })?.method === 'execute') as
        | { id: number }
        | undefined;
    await until(() => requestFrame() !== undefined);
    const events = await Promise.race([
      pending,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1_000)),
    ]);
    expect(events).not.toBeNull();
    controller.abort();
    await until(() =>
      guest.frames.some((frame) => (frame as { cancel?: number })?.cancel === requestFrame()?.id),
    );
  });

  test('a guest that stays silent for two seconds and then exits still delivers the exit', async () => {
    const orb = makeProvider();
    const pending = orb.forScope(SCOPE).execute({
      argv: ['sleep', '2'],
      timeoutMs: 60_000,
      signal: new AbortController().signal,
    });
    const guest = await fakeGuest('good');
    await until(() =>
      guest.frames.some((frame) => (frame as { method?: string })?.method === 'execute'),
    );
    const request = guest.frames.find(
      (frame) => (frame as { method?: string })?.method === 'execute',
    ) as {
      id: number;
    };
    const events = await pending;
    const started = Date.now();
    setTimeout(() => {
      guest.send({ id: request.id, value: { kind: 'exit', code: 0 } });
      guest.send({ id: request.id, done: true });
    }, 2_000);
    const seen = await drain(events);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1_800);
    expect(seen).toEqual([{ kind: 'exit', code: 0 }]);
  }, 15_000);

  test('a guest refusal of a shell cwd is not_delivered with its reason', async () => {
    const orb = makeProvider();
    startGuest();
    const fake = fakeClient();
    const dispatcher = createComputerDispatcher({ client: fake.client, orb, ...FAST });
    await dispatcher.dispatch(call({ params: { command: 'ls', cwd: '../outside' } }));
    expect(lastFrame(fake.frames)).toMatchObject({ kind: 'error', delivery: 'not_delivered' });
    expect((lastFrame(fake.frames) as { message: string }).message).toContain(
      'inside the home folder',
    );
  });

  test('a file request is bounded by the caller deadline, not the 60 s default', async () => {
    const orb = makeProvider();
    const writing = orb.forScope(SCOPE).writeFile('a.txt', 'x', { timeoutMs: 300 });
    const settled = writing.then(
      () => 'resolved',
      (error: Error) => error.message,
    );
    const guest = await fakeGuest('good');
    const started = Date.now();
    expect(await settled).toContain('did not answer in time');
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(guest.isClosed()).toBe(false);
  });

  test('a file request with no time left is refused before it is sent', async () => {
    const orb = makeProvider({ connectTimeoutMs: 100 });
    await expect(orb.forScope(SCOPE).readFile('a.txt', { timeoutMs: 0 })).rejects.toBeInstanceOf(
      ComputerRefusal,
    );
    expect(ensured).toEqual([]);
  });
});

describe('orb computer setup deadlines', () => {
  test('file setup is bounded while the computer is still starting', async () => {
    const orb = makeProvider({
      orbs: {
        ensure: async () => {
          await new Promise((resolve) => setTimeout(resolve, 400));
          return NAME;
        },
        touch: () => {},
      },
    });
    const started = Date.now();
    await expect(orb.forScope(SCOPE).readFile('a.txt', { timeoutMs: 50 })).rejects.toBeInstanceOf(
      ComputerRefusal,
    );
    expect(Date.now() - started).toBeLessThan(250);
    expect(existsSync(socketPath)).toBe(false);
  });

  test('file setup is bounded while the daemon release is being published', async () => {
    const orb = makeProvider({
      release: {
        publish: async () => {
          await new Promise((resolve) => setTimeout(resolve, 400));
          return RELEASE;
        },
        authenticated: () => {},
      },
    });
    const started = Date.now();
    await expect(orb.forScope(SCOPE).readFile('a.txt', { timeoutMs: 50 })).rejects.toBeInstanceOf(
      ComputerRefusal,
    );
    expect(Date.now() - started).toBeLessThan(250);
    expect(ensured).toEqual([]);
  });

  test('connecting the guest does not restart a file request budget', async () => {
    const orb = makeProvider();
    const writing = orb.forScope(SCOPE).writeFile('a.txt', 'x', { timeoutMs: 500 });
    const settled = writing.then(
      () => 'resolved',
      (error: Error) => error.message,
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    await fakeGuest('good');
    const result = await Promise.race([
      settled,
      new Promise<string>((resolve) => setTimeout(() => resolve('still waiting'), 350)),
    ]);
    expect(result).toContain('did not answer in time');
  });

  test('stopping during provisioning never later sends a file write', async () => {
    let started = false;
    let release: () => void = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const orb = makeProvider({
      connectTimeoutMs: 100,
      orbs: {
        ensure: async () => {
          started = true;
          await hold;
          return NAME;
        },
        touch: () => {},
      },
    });
    const fake = fakeClient();
    const dispatcher = createComputerDispatcher({ client: fake.client, orb, ...FAST });
    const writing = dispatcher.dispatch(
      call({ tool: 'write_file', params: { path: 'a.txt', content: 'x' } }),
    );
    await until(() => started);
    const closing = dispatcher.close();
    release();
    await Promise.all([writing, closing]);
    expect(existsSync(socketPath)).toBe(false);
    expect(lastFrame(fake.frames)).toMatchObject({ kind: 'error', delivery: 'not_delivered' });
  });

  test('cancelling a delivered file write sends cancel and reports uncertain delivery', async () => {
    const orb = makeProvider();
    const controller = new AbortController();
    const writing = orb
      .forScope(SCOPE)
      .writeFile('a.txt', 'x', { timeoutMs: 1000, signal: controller.signal });
    const settled = writing.then(
      () => undefined,
      (error: Error) => error,
    );
    const guest = await fakeGuest('good');
    const request = () =>
      guest.frames.find((frame) => (frame as { method?: string })?.method === 'writeFile') as
        | { id: number }
        | undefined;
    await until(() => request() !== undefined);
    controller.abort();
    const result = await settled;
    expect(result?.message).toContain('cancelled after delivery');
    expect(result).not.toBeInstanceOf(ComputerRefusal);
    await until(() =>
      guest.frames.some((frame) => (frame as { cancel?: number })?.cancel === request()?.id),
    );
  });

  test('an aborted execute cannot send a new command to a connected guest', async () => {
    const orb = makeProvider();
    startGuest();
    const scoped = orb.forScope(SCOPE);
    await scoped.listFiles('');
    const controller = new AbortController();
    controller.abort();
    await expect(
      scoped.execute({
        argv: ['touch', 'must-not-run'],
        timeoutMs: 1000,
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(ComputerRefusal);
    expect(existsSync(path.join(home, 'must-not-run'))).toBe(false);
  });
});

describe('orb computer link failures', () => {
  test('a guest that never connects gives not_delivered after the connect timeout, without hanging', async () => {
    const orb = makeProvider({ connectTimeoutMs: 300 });
    const fake = fakeClient();
    const dispatcher = createComputerDispatcher({ client: fake.client, orb, ...FAST });
    const started = Date.now();
    await dispatcher.dispatch(call());
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(fake.frames).toHaveLength(1);
    expect(fake.frames[0]).toMatchObject({ kind: 'error', delivery: 'not_delivered' });
    expect((fake.frames[0] as { message: string }).message).toContain('did not connect');
  });

  test('a computer that cannot be started gives not_delivered', async () => {
    const orb = new OrbComputerProvider({
      orbs: {
        ensure: async () => {
          throw new Error('machinectl exploded');
        },
        touch: () => {},
      },
      runtimeRoot: runtime,
    });
    provider = orb;
    const fake = fakeClient();
    const dispatcher = createComputerDispatcher({ client: fake.client, orb, ...FAST });
    await dispatcher.dispatch(call());
    expect(fake.frames[0]).toMatchObject({ kind: 'error', delivery: 'not_delivered' });
    expect((fake.frames[0] as { message: string }).message).toContain('could not be started');
    expect((fake.frames[0] as { message: string }).message).not.toContain('exploded');
  });

  test('a guest that disconnects mid-shell gives an unknown-delivery error', async () => {
    const orb = makeProvider();
    const fake = fakeClient();
    const dispatcher = createComputerDispatcher({ client: fake.client, orb, ...FAST });
    const running = dispatcher.dispatch(call({ command: 'sleep 30' }));
    const guest = await fakeGuest('good');
    await until(() =>
      guest.frames.some((frame) => (frame as { method?: string })?.method === 'execute'),
    );
    guest.socket.destroy();
    await running;
    expect(lastFrame(fake.frames)).toMatchObject({ kind: 'error', delivery: 'unknown' });
    expect(fake.frames.filter((frame) => frame.kind === 'done')).toHaveLength(0);
  });

  test('a computer restarted outside the daemon gets a fresh socket in its new runtime directory', async () => {
    const orb = makeProvider({ connectTimeoutMs: 3_000 });
    const first = fakeClient();
    const dispatcher = createComputerDispatcher({ client: first.client, orb, ...FAST });
    const running = dispatcher.dispatch(call({ command: 'sleep 30' }));
    const guest = await fakeGuest('good');
    await until(() =>
      guest.frames.some((frame) => (frame as { method?: string })?.method === 'execute'),
    );
    guest.socket.destroy();
    await running;
    const directory = path.join(runtime, NAME);
    rmSync(directory, { recursive: true });
    mkdirSync(directory, { mode: 0o700 });
    startGuest();
    const second = fakeClient();
    await createComputerDispatcher({ client: second.client, orb, ...FAST }).dispatch(
      call({ command: 'echo after-restart' }),
    );
    expect(stdoutOf(second.frames)).toContain('after-restart');
    expect(lastFrame(second.frames)).toMatchObject({ kind: 'done', exitCode: 0 });
  });

  test('a guest that disconnects mid-file-write gives an unknown-delivery error', async () => {
    const orb = makeProvider();
    const fake = fakeClient();
    const dispatcher = createComputerDispatcher({ client: fake.client, orb, ...FAST });
    const running = dispatcher.dispatch(
      call({ tool: 'write_file', params: { path: 'a.txt', content: 'x' } }),
    );
    const guest = await fakeGuest('good');
    await until(() =>
      guest.frames.some((frame) => (frame as { method?: string })?.method === 'writeFile'),
    );
    guest.socket.destroy();
    await running;
    expect(lastFrame(fake.frames)).toMatchObject({ kind: 'error', delivery: 'unknown' });
  });

  test.each(['bad-token', 'no-token'] as const)(
    'a guest with %s is disconnected and never serves the call',
    async (auth) => {
      const orb = makeProvider({ connectTimeoutMs: 600 });
      const fake = fakeClient();
      const dispatcher = createComputerDispatcher({ client: fake.client, orb, ...FAST });
      const running = dispatcher.dispatch(call());
      const guest = await fakeGuest(auth);
      await running;
      await until(() => guest.isClosed());
      expect(guest.frames).toEqual([]);
      expect(fake.frames[0]).toMatchObject({ kind: 'error', delivery: 'not_delivered' });
    },
  );

  test('a guest on a stale release is told so and never serves the call', async () => {
    const orb = makeProvider({ connectTimeoutMs: 400 });
    const fake = fakeClient();
    const dispatcher = createComputerDispatcher({ client: fake.client, orb, ...FAST });
    const running = dispatcher.dispatch(call());
    const guest = await fakeGuest('stale');
    await running;
    expect(guest.frames).toEqual([{ type: 'refused', reason: 'stale-release' }]);
    expect(fake.frames[0]).toMatchObject({ kind: 'error', delivery: 'not_delivered' });
  });

  test('the socket and its token are private to the daemon and removed on close', async () => {
    const orb = makeProvider();
    startGuest();
    await orb.forScope(SCOPE).listFiles('');
    expect(readFileSync(`${socketPath}.token`, 'utf8')).toMatch(/^[a-f0-9]{64}$/);
    expect(statSync(`${socketPath}.token`).mode & 0o777).toBe(0o600);
    expect(statSync(socketPath).mode & 0o777).toBe(0o600);
    await orb.close();
    expect(existsSync(socketPath)).toBe(false);
    expect(existsSync(`${socketPath}.token`)).toBe(false);
  });

  test('a guest that goes silent during a call is dropped after the heartbeat timeout', async () => {
    const orb = makeProvider({ heartbeatTimeoutMs: 150 });
    const fake = fakeClient();
    const dispatcher = createComputerDispatcher({ client: fake.client, orb, ...FAST });
    const running = dispatcher.dispatch(call());
    const guest = await fakeGuest('good');
    await running;
    expect(lastFrame(fake.frames)).toMatchObject({ kind: 'error', delivery: 'unknown' });
    await until(() => guest.isClosed());
  });

  test('a guest that ignores cancel is bounded by the stop grace', async () => {
    const orb = makeProvider({ stopGraceMs: 150 });
    const controller = new AbortController();
    const pending = orb.forScope(SCOPE).execute({
      argv: ['sleep', '30'],
      timeoutMs: 60_000,
      signal: controller.signal,
    });
    const guest = await fakeGuest('good');
    await until(() =>
      guest.frames.some((frame) => (frame as { method?: string })?.method === 'execute'),
    );
    const request = guest.frames.find(
      (frame) => (frame as { method?: string })?.method === 'execute',
    ) as {
      id: number;
    };
    guest.send({ id: request.id, value: { kind: 'stdout', text: 'started\n' } });
    const events = await pending;
    controller.abort();
    const seen = await drain(events);
    expect(seen.at(-1)).toMatchObject({ kind: 'exit', reason: 'aborted' });
    await until(() =>
      guest.frames.some((frame) => (frame as { cancel?: number })?.cancel === request.id),
    );
  });

  test('a guest that ignores a command past its timeout is bounded by timeout plus grace', async () => {
    const orb = makeProvider({ stopGraceMs: 150 });
    const pending = orb.forScope(SCOPE).execute({
      argv: ['sleep', '30'],
      timeoutMs: 100,
      signal: new AbortController().signal,
    });
    const guest = await fakeGuest('good');
    await until(() =>
      guest.frames.some((frame) => (frame as { method?: string })?.method === 'execute'),
    );
    const request = guest.frames.find(
      (frame) => (frame as { method?: string })?.method === 'execute',
    ) as {
      id: number;
    };
    guest.send({ id: request.id, value: { kind: 'stderr', text: 'hung\n' } });
    const seen = await drain(await pending);
    expect(seen.at(-1)).toMatchObject({ kind: 'exit', code: 124, reason: 'timeout' });
  });

  test('execute refuses an environment override instead of dropping it', async () => {
    const orb = makeProvider({ connectTimeoutMs: 200 });
    await expect(
      orb.forScope(SCOPE).execute({
        argv: ['true'],
        env: { A: 'b' },
        timeoutMs: 1_000,
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(ComputerRefusal);
  });
});
