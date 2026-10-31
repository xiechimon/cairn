import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { encodeOrbFrame } from '../src/orb/protocol.js';
import { RelayMachineApi, RelayMachineServer } from '../src/orb/relay.js';
import { CLAIMED, FakeMachineApi } from './machine-loop-harness.js';

const releaseA = '0.2.2-abcd-dist-aaaaaaaaaaaaaaaa';
const releaseB = '0.2.2-abcd-dist-bbbbbbbbbbbbbbbb';
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'orb-release-'));
  const socketPath = join(root, 'relay.sock');
  const api = new FakeMachineApi();
  const onAuthenticated = vi.fn();
  const onDisconnect = vi.fn();
  const onStaleRelease = vi.fn();
  const server = new RelayMachineServer({
    socketPath,
    stepId: 's1',
    release: releaseB,
    upstream: api,
    input: { claimed: CLAIMED, options: {}, methods: ['heartbeat'] },
    onAuthenticated,
    onDisconnect,
    onStaleRelease,
  });
  await server.listen();
  cleanup.push(async () => {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  });
  return { socketPath, api, onAuthenticated, onDisconnect, onStaleRelease };
}

test('stale release refusal preserves the authenticated slot and discloses no step', async () => {
  const { socketPath, api, onAuthenticated, onDisconnect, onStaleRelease } = await fixture();
  const socket = createConnection(socketPath);
  socket.on('error', () => {});
  let received = '';
  socket.on('data', (chunk) => {
    received += chunk.toString();
  });
  await new Promise<void>((resolve) => socket.once('connect', resolve));
  socket.write(
    encodeOrbFrame({
      type: 'auth',
      token: readFileSync(`${socketPath}.token`, 'utf8'),
      release: releaseA,
    }),
  );
  await new Promise<void>((resolve) => socket.once('close', resolve));
  expect(received).toBe(encodeOrbFrame({ type: 'refused', reason: 'stale-release' }));
  expect(onAuthenticated).not.toHaveBeenCalled();
  expect(onDisconnect).not.toHaveBeenCalled();
  expect(onStaleRelease).toHaveBeenCalledExactlyOnceWith(releaseA);
  expect(api.calls).toEqual([]);
  const current = await RelayMachineApi.connect(socketPath, releaseB);
  await current.api.heartbeat('s1');
  current.close();
  expect(onAuthenticated).toHaveBeenCalledExactlyOnceWith(releaseB);
  expect(api.calls).toEqual(['heartbeat:s1']);
});

test.each([undefined, '', '../release', '0.2.2-abcd', 'x'.repeat(1024)])(
  'invalid release identity %j cannot authenticate or reserve the slot',
  async (release) => {
    const { socketPath, onAuthenticated, onStaleRelease } = await fixture();
    const socket = createConnection(socketPath);
    socket.on('error', () => {});
    let received = '';
    socket.on('data', (chunk) => {
      received += chunk.toString();
    });
    await new Promise<void>((resolve) => socket.once('connect', resolve));
    socket.write(
      `cairn-orb-rpc:${JSON.stringify({ type: 'auth', token: readFileSync(`${socketPath}.token`, 'utf8'), release })}\n`,
    );
    await new Promise<void>((resolve) => socket.once('close', resolve));
    expect(received).toBe('');
    expect(onAuthenticated).not.toHaveBeenCalled();
    expect(onStaleRelease).not.toHaveBeenCalled();
    const current = await RelayMachineApi.connect(socketPath, releaseB);
    current.close();
    expect(onAuthenticated).toHaveBeenCalledExactlyOnceWith(releaseB);
  },
);

test('a foreign token with a stale release receives no release refusal', async () => {
  const { socketPath, onStaleRelease } = await fixture();
  const socket = createConnection(socketPath);
  socket.on('error', () => {});
  let received = '';
  socket.on('data', (chunk) => {
    received += chunk.toString();
  });
  await new Promise<void>((resolve) => socket.once('connect', resolve));
  socket.write(encodeOrbFrame({ type: 'auth', token: 'f'.repeat(64), release: releaseA }));
  await new Promise<void>((resolve) => socket.once('close', resolve));
  expect(received).toBe('');
  expect(onStaleRelease).not.toHaveBeenCalled();
});

test('relay client exposes stale release refusal as a distinct error', async () => {
  const { socketPath } = await fixture();
  await expect(RelayMachineApi.connect(socketPath, releaseA)).rejects.toMatchObject({
    name: 'OrbStaleReleaseError',
    message: 'Orb worker refused: stale-release',
  });
});
