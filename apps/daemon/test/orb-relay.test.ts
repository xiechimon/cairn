import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { type MachineApi, MachineApiError, MachineClient } from '../src/machine-client.js';
import { ORB_STEP_METHODS } from '../src/orb/protocol.js';
import { RelayMachineApi, RelayMachineError, RelayMachineServer } from '../src/orb/relay.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'relay-'));
  const socketPath = join(home, 'step.sock');
  const forwarded = vi.fn(async (method: string, args: unknown[]): Promise<unknown> => {
    if (method === 'skillFile') return Buffer.from('skill');
    if (method === 'uploadUrls')
      return { uploads: [{ url: 'https://upload.test/step', headers: {}, method: 'PUT' }] };
    return { method, args };
  });
  const upstream = new Proxy(
    {},
    {
      get:
        (_target, method: string) =>
        (...args: unknown[]) =>
          forwarded(method, args),
    },
  ) as MachineApi;
  const server = new RelayMachineServer({
    socketPath,
    stepId: 'step',
    machineId: 'host',
    upstream,
  });
  await server.listen();
  const client = await RelayMachineApi.connect(socketPath);
  cleanup.push(async () => {
    client.close();
    await server.close();
    rmSync(home, { recursive: true, force: true });
  });
  return { server, client, forwarded, socketPath };
}

test.each(ORB_STEP_METHODS)(
  'forwards %s with an identical body over a Unix socket',
  async (method) => {
    const { client, forwarded } = await fixture();
    if (method === 'putUpload') await client.call('uploadUrls', ['step', []]);
    const args =
      method === 'putUpload'
        ? ['https://upload.test/step', { 'x-upload': 'value' }, 'payload', 'text/plain']
        : method === 'reportClaudeRateLimit'
          ? [{ machineId: 'host', status: 'rejected', resetsAt: Date.now() + 1000 }]
          : ['step', { nested: ['unchanged', 42, false], text: 'body' }];
    await client.call(method, args);
    expect(forwarded).toHaveBeenLastCalledWith(method, args);
  },
);

test.each([
  'claim',
  'recover',
  'me',
  'presence',
  'enroll',
  'enrollStart',
  'enrollPoll',
  'syncResult',
  'stream',
  'constructor',
  '__proto__',
])('refuses %s without reaching upstream', async (method) => {
  const { client, forwarded } = await fixture();
  await expect(client.call(method, ['step'])).rejects.toBeInstanceOf(RelayMachineError);
  expect(forwarded).not.toHaveBeenCalled();
});

test.each(
  ORB_STEP_METHODS.filter((method) => !['putUpload', 'reportClaudeRateLimit'].includes(method)),
)('refuses %s for another step', async (method) => {
  const { client, forwarded } = await fixture();
  await expect(client.call(method, ['victim', { content: 'forged' }])).rejects.toBeInstanceOf(
    RelayMachineError,
  );
  expect(forwarded).not.toHaveBeenCalled();
});

test('refuses arbitrary uploads and returns binary skills intact', async () => {
  const { client, forwarded, socketPath } = await fixture();
  await expect(
    client.call('putUpload', ['https://attacker.test', {}, 'private']),
  ).rejects.toBeInstanceOf(RelayMachineError);
  expect(forwarded).not.toHaveBeenCalled();
  expect(await client.api.skillFile('step', 'skill', 'SKILL.md')).toEqual(Buffer.from('skill'));
  expect(statSync(socketPath).mode & 0o777).toBe(0o666);
  expect(statSync(join(socketPath, '..')).mode & 0o777).toBe(0o700);
});

test('closing the relay rejects pending calls and removes the socket', async () => {
  const { client, server, forwarded, socketPath } = await fixture();
  forwarded.mockImplementation(async () => new Promise(() => {}));
  const pending = client.call('token', ['step']);
  const rejected = expect(pending).rejects.toThrow('closed');
  await vi.waitFor(() => expect(forwarded).toHaveBeenCalled());
  await server.close();
  await rejected;
  expect(() => statSync(socketPath)).toThrow();
});

test('preserves typed upstream ownership errors', async () => {
  const { client, forwarded } = await fixture();
  forwarded.mockRejectedValue(new MachineApiError(410, 'step released'));
  await expect(client.api.heartbeat('step')).rejects.toMatchObject({
    status: 410,
    body: 'step released',
  });
});

test('cancels a held tool call over the socket', async () => {
  const { client, forwarded } = await fixture();
  let upstreamSignal: AbortSignal | undefined;
  forwarded.mockImplementation(async (_method, args) => {
    upstreamSignal = (args[3] as { signal: AbortSignal }).signal;
    return new Promise((_resolve, reject) =>
      upstreamSignal?.addEventListener('abort', () => reject(new Error('cancelled'))),
    );
  });
  const controller = new AbortController();
  const pending = client.api.relayTool(
    'step',
    'tool',
    { body: 'unchanged' },
    { signal: controller.signal },
  );
  const rejected = expect(pending).rejects.toThrow('aborted');
  await vi.waitFor(() => expect(upstreamSignal).toBeDefined());
  controller.abort();
  await rejected;
  await vi.waitFor(() => expect(upstreamSignal?.aborted).toBe(true));
});

test('refuses a second completion while the first is in flight and after it settles', async () => {
  const { client, forwarded } = await fixture();
  let finish: (value: unknown) => void = () => {};
  forwarded.mockImplementation(
    async () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = client.api.done('step', { status: 'success' });
  await vi.waitFor(() => expect(forwarded).toHaveBeenCalledTimes(1));
  await expect(client.api.done('step', { status: 'failed' })).rejects.toBeInstanceOf(
    RelayMachineError,
  );
  finish(undefined);
  await first;
  await expect(client.api.done('step', { status: 'failed' })).rejects.toBeInstanceOf(
    RelayMachineError,
  );
  expect(forwarded).toHaveBeenCalledTimes(1);
});

test('reclaims a socket left by a dead process', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orb-stale-relay-'));
  const socketPath = join(root, 'step.sock');
  execFileSync(process.execPath, [
    '-e',
    'require("node:net").createServer().listen(process.argv[1], () => process.exit(0))',
    socketPath,
  ]);
  expect(statSync(socketPath).isSocket()).toBe(true);
  const upstream = new Proxy({}, { get: () => vi.fn(async () => undefined) }) as MachineApi;
  const server = new RelayMachineServer({
    socketPath,
    stepId: 'step',
    machineId: 'host',
    upstream,
  });
  try {
    await server.listen();
    const client = await RelayMachineApi.connect(socketPath);
    await expect(client.api.heartbeat('step')).resolves.toBeUndefined();
    client.close();
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('does not remove a live listener when another server tries to use its path', async () => {
  const { socketPath, client, forwarded } = await fixture();
  const duplicate = new RelayMachineServer({
    socketPath,
    stepId: 'other',
    upstream: {} as MachineApi,
  });
  await expect(duplicate.listen()).rejects.toThrow();
  await duplicate.close();
  await client.api.heartbeat('step');
  expect(forwarded).toHaveBeenCalledWith('heartbeat', ['step']);
  expect(statSync(socketPath).isSocket()).toBe(true);
});

test('retries a rejected finish report over the same connection', async () => {
  const { client, forwarded } = await fixture();
  forwarded.mockRejectedValueOnce(new MachineApiError(503, 'retry finish'));
  await expect(client.api.done('step', { status: 'success' })).rejects.toThrow('retry finish');
  await expect(client.api.done('step', { status: 'failed' })).resolves.toBeDefined();
  expect(forwarded).toHaveBeenCalledTimes(2);
});

test('validates rate-limit reports before forwarding', async () => {
  const { client, forwarded } = await fixture();
  await expect(
    client.call('reportClaudeRateLimit', [{ machineId: 'host', status: 'forged' }]),
  ).rejects.toBeInstanceOf(RelayMachineError);
  expect(forwarded).not.toHaveBeenCalled();
});

test.each([Date.now() + 100 * 86400000, Math.floor((Date.now() + 100 * 86400000) / 1000)])(
  'binds rate-limit machine identity and caps reset timestamps %s',
  async (resetsAt) => {
    const { client, forwarded } = await fixture();
    const before = Date.now();
    await client.call('reportClaudeRateLimit', [
      { machineId: 'victim', status: 'rejected', resetsAt },
    ]);
    const report = forwarded.mock.calls[0]?.[1][0] as { machineId: string; resetsAt: number };
    expect(report.machineId).toBe('host');
    expect(report.resetsAt).toBeGreaterThanOrEqual(before + 8 * 86400000);
    expect(report.resetsAt).toBeLessThanOrEqual(Date.now() + 8 * 86400000);
  },
);

test('throttles rate-limit reports per step even after upstream rejection', async () => {
  const { client, forwarded } = await fixture();
  const now = vi.spyOn(Date, 'now').mockReturnValue(1800000000000);
  try {
    const report = { machineId: 'host', status: 'rejected' };
    forwarded.mockRejectedValueOnce(new MachineApiError(503, 'unavailable'));
    await expect(client.call('reportClaudeRateLimit', [report])).rejects.toThrow('unavailable');
    await expect(client.call('reportClaudeRateLimit', [report])).rejects.toThrow('throttled');
    now.mockReturnValue(1800000030000);
    await client.call('reportClaudeRateLimit', [report]);
    expect(forwarded).toHaveBeenCalledTimes(2);
  } finally {
    now.mockRestore();
  }
});

test('accepts exactly one connection for the lifetime of a step socket', async () => {
  const { client, socketPath, forwarded } = await fixture();
  const second = createConnection(socketPath);
  second.on('error', () => {});
  cleanup.push(async () => {
    second.destroy();
  });
  await vi.waitFor(() => expect(second.destroyed).toBe(true));
  await client.api.heartbeat('step');
  expect(forwarded).toHaveBeenCalledTimes(1);
  client.close();
  const third = createConnection(socketPath);
  third.on('error', () => {});
  cleanup.push(async () => {
    third.destroy();
  });
  await vi.waitFor(() => expect(third.destroyed).toBe(true));
});

test.each(['x', 'é'])(
  'disconnects an oversized complete frame with %s content',
  async (character) => {
    const { client, forwarded } = await fixture();
    client.send({
      type: 'log',
      message: character.repeat((character === 'x' ? 17 : 9) * 1024 * 1024),
    });
    await vi.waitFor(() => expect(client.call('heartbeat', ['step'])).rejects.toThrow('closed'));
    expect(forwarded).not.toHaveBeenCalled();
  },
);

test.each([
  { type: 'session', live: 'yes' },
  { type: 'cancel', id: 'bad' },
  { type: 'steered', id: -1 },
  { type: 'log', message: {} },
  { type: 'failed', error: [] },
  { type: 'finished', extra: true },
  { type: 'stop', discard: true },
  { type: 'checkpoint', checkpoint: { state: 'forged' } },
])('disconnects invalid worker frame %j', async (frame) => {
  const { client, forwarded } = await fixture();
  client.send(frame as Parameters<typeof client.send>[0]);
  await vi.waitFor(() => expect(client.api.heartbeat('step')).rejects.toThrow('closed'));
  expect(forwarded).not.toHaveBeenCalled();
});

test('destroys a socket when an unterminated frame exceeds the byte limit', async () => {
  const home = mkdtempSync(join(tmpdir(), 'relay-limit-'));
  const socketPath = join(home, 'step.sock');
  const server = new RelayMachineServer({ socketPath, stepId: 'step', upstream: {} as MachineApi });
  await server.listen();
  const socket = createConnection(socketPath);
  socket.on('error', () => {});
  try {
    await new Promise<void>((resolve) => socket.once('connect', resolve));
    socket.resume();
    for (let index = 0; index < 17; index++) socket.write(Buffer.alloc(1024 * 1024, 120));
    await vi.waitFor(() => expect(socket.destroyed).toBe(true), { timeout: 5000 });
  } finally {
    socket.destroy();
    await server.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('disconnects a non-reading worker when queued output exceeds the frame budget', async () => {
  const home = mkdtempSync(join(tmpdir(), 'relay-output-limit-'));
  const socketPath = join(home, 'step.sock');
  const upstream = new MachineClient({ serverUrl: 'http://unused.test' });
  const heartbeat = vi.spyOn(upstream, 'heartbeat').mockResolvedValue(undefined);
  const server = new RelayMachineServer({
    socketPath,
    stepId: 'step',
    upstream,
  });
  await server.listen();
  const socket = createConnection(socketPath);
  socket.on('error', () => {});
  try {
    await new Promise<void>((resolve) => socket.once('connect', resolve));
    socket.write('cairn-orb-rpc:{"type":"call","id":0,"method":"heartbeat","args":["step"]}\n');
    await vi.waitFor(() => expect(heartbeat).toHaveBeenCalledTimes(1));
    const message = 'x'.repeat(1024 * 1024);
    for (let index = 0; index < 20; index++) server.send({ type: 'log', message });
    socket.resume();
    await vi.waitFor(() => expect(socket.destroyed).toBe(true));
  } finally {
    socket.destroy();
    await server.close();
    rmSync(home, { recursive: true, force: true });
  }
});
