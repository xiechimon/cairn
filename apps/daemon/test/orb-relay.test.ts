import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { type MachineApi, MachineApiError } from '../src/machine-client.js';
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
  const server = new RelayMachineServer({ socketPath, stepId: 'step', upstream });
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
          ? [{ providerId: 'claude-code', retryAfterMs: 1000 }]
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
  const server = new RelayMachineServer({ socketPath, stepId: 'step', upstream });
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
