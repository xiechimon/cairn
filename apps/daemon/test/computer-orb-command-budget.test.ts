import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { createConnection, type Socket } from 'node:net';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { OrbComputerProvider } from '../src/computer/orb.js';
import {
  decodeOrbComputerFrame,
  encodeOrbComputerFrame,
  type OrbComputerHostFrame,
  readOrbComputerLines,
} from '../src/computer/orb-protocol.js';
import { type ComputerProcessEvent, ComputerRefusal } from '../src/computer/provider.js';

let allocatedRoot: string;
let root: string;
let provider: OrbComputerProvider | undefined;
let socket: Socket | undefined;

beforeEach(() => {
  allocatedRoot = makeTestTempDir('cb-');
  root = realpathSync(allocatedRoot);
  mkdirSync(join(root, 'c1'), { mode: 0o700 });
});

afterEach(async () => {
  vi.restoreAllMocks();
  socket?.destroy();
  socket = undefined;
  await provider?.close();
  provider = undefined;
  expect(releaseTestTempDir(allocatedRoot)).toBe(true);
});

async function connectGuest(): Promise<OrbComputerHostFrame[]> {
  const received: OrbComputerHostFrame[] = [];
  await vi.waitFor(() => {
    expect(existsSync(join(root, 'c1', 'computer.sock.token'))).toBe(true);
  });
  socket = createConnection(join(root, 'c1', 'computer.sock'));
  socket.on('error', () => {});
  readOrbComputerLines(socket, (line) => {
    received.push(decodeOrbComputerFrame(line) as OrbComputerHostFrame);
  });
  socket.write(
    encodeOrbComputerFrame({
      type: 'auth',
      token: readFileSync(join(root, 'c1', 'computer.sock.token'), 'utf8'),
      release: '1.0.0-abcd1234-dist-0123456789abcdef',
    }),
  );
  return received;
}

async function collect(
  events: AsyncIterable<ComputerProcessEvent>,
): Promise<ComputerProcessEvent[]> {
  const collected: ComputerProcessEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

test('an unresolved release publication consumes the command budget before delivery', async () => {
  const ensure = vi.fn(async () => 'c1');
  provider = new OrbComputerProvider({
    runtimeRoot: root,
    orbs: { ensure, touch: vi.fn() },
    release: { publish: () => new Promise(() => {}), authenticated: vi.fn() },
  });
  await expect(
    provider.forScope('chief:one').execute({
      argv: ['/usr/bin/true'],
      timeoutMs: 50,
      signal: new AbortController().signal,
    }),
  ).rejects.toBeInstanceOf(ComputerRefusal);
  expect(ensure).not.toHaveBeenCalled();
  expect(existsSync(join(root, 'c1', 'computer.sock'))).toBe(false);
}, 1_000);

test('an unresolved start consumes the command budget and a late start never opens a link', async () => {
  let finishStart: ((name: string) => void) | undefined;
  const start = new Promise<string>((resolve) => {
    finishStart = resolve;
  });
  provider = new OrbComputerProvider({
    runtimeRoot: root,
    orbs: { ensure: () => start, touch: vi.fn() },
  });
  await expect(
    provider.forScope('chief:one').execute({
      argv: ['/usr/bin/true'],
      timeoutMs: 50,
      signal: new AbortController().signal,
    }),
  ).rejects.toBeInstanceOf(ComputerRefusal);
  finishStart?.('c1');
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(existsSync(join(root, 'c1', 'computer.sock'))).toBe(false);
}, 1_000);

test('the guest receives only the original command budget left after preparation', async () => {
  let now = 100_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  provider = new OrbComputerProvider({
    runtimeRoot: root,
    orbs: {
      ensure: async () => {
        now += 2_500;
        return 'c1';
      },
      touch: vi.fn(),
    },
    stopGraceMs: 20,
  });
  const executing = provider.forScope('chief:one').execute({
    argv: ['/usr/bin/true'],
    timeoutMs: 10_000,
    signal: new AbortController().signal,
  });
  const received = await connectGuest();
  const events = await executing;
  await vi.waitFor(() => {
    expect(received.some((frame) => 'method' in frame)).toBe(true);
  });
  const command = received.find((frame) => 'method' in frame && frame.method === 'execute');
  expect(command).toMatchObject({ method: 'execute', params: { timeoutMs: 7_500 } });
  if (!command || !('id' in command)) throw new Error('No command was received');
  socket?.write(encodeOrbComputerFrame({ id: command.id, value: { kind: 'exit', code: 0 } }));
  socket?.write(encodeOrbComputerFrame({ id: command.id, done: true }));
  expect(await collect(events)).toEqual([{ kind: 'exit', code: 0 }]);
});

test('connection waiting consumes the original command budget', async () => {
  provider = new OrbComputerProvider({
    runtimeRoot: root,
    orbs: { ensure: async () => 'c1', touch: vi.fn() },
    connectTimeoutMs: 30_000,
  });
  await expect(
    provider.forScope('chief:one').execute({
      argv: ['/usr/bin/true'],
      timeoutMs: 50,
      signal: new AbortController().signal,
    }),
  ).rejects.toBeInstanceOf(ComputerRefusal);
}, 1_000);

test.each([
  { reason: new DOMException('Deadline elapsed', 'TimeoutError'), code: 124, kind: 'timeout' },
  { reason: new DOMException('Daemon shutdown', 'AbortError'), code: 130, kind: 'aborted' },
])('a delivered command cancellation preserves $kind outcome', async ({ reason, code, kind }) => {
  provider = new OrbComputerProvider({
    runtimeRoot: root,
    orbs: { ensure: async () => 'c1', touch: vi.fn() },
    stopGraceMs: 20,
  });
  const cancellation = new AbortController();
  const executing = provider.forScope('chief:one').execute({
    argv: ['/usr/bin/true'],
    timeoutMs: 10_000,
    signal: cancellation.signal,
  });
  const received = await connectGuest();
  const events = await executing;
  cancellation.abort(reason);
  expect(await collect(events)).toEqual([{ kind: 'exit', code, reason: kind }]);
  await vi.waitFor(() => expect(received.some((frame) => 'cancel' in frame)).toBe(true));
});
