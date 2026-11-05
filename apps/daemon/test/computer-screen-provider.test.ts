import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdirSync, rmSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { dirname, join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import {
  computerScreenSocketPath,
  createComputerScreenProvider,
} from '../src/computer/screen-provider.js';
import { computerMachineName } from '../src/orb/computer.js';

let dir: string | undefined;
let runtimeRoot: string | undefined;
let server: Server | undefined;
const sockets: Socket[] = [];

function shortRuntimeRoot(owned: string): string {
  const path = join('/tmp', `csp-${createHash('sha256').update(owned).digest('hex').slice(0, 8)}`);
  mkdirSync(path, { recursive: true, mode: 0o700 });
  return path;
}

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = undefined;
  if (runtimeRoot) rmSync(runtimeRoot, { recursive: true, force: true });
  runtimeRoot = undefined;
  if (dir) releaseTestTempDir(dir);
  dir = undefined;
});

async function listen(path: string, greeting = 'RFB 003.008\n'): Promise<Buffer[]> {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const input: Buffer[] = [];
  server = createServer((socket) => {
    sockets.push(socket);
    socket.write(greeting);
    socket.on('data', (chunk) => input.push(Buffer.from(chunk)));
  });
  await new Promise<void>((resolve, reject) => {
    server?.once('error', reject);
    server?.listen(path, resolve);
  });
  return input;
}

function request(
  kind: 'view' | 'control' | 'terminal',
  scopeKey = 'chief:test',
  signal = new AbortController().signal,
) {
  return {
    id: 'a'.repeat(64),
    computerId: 'computer-1',
    scopeKey,
    generation: 1,
    kind,
    expiresAt: Date.now() + 60_000,
    controlLeaseId: kind === 'view' ? null : 'lease-1',
    controlFence: kind === 'view' ? 0 : 1,
    signal,
  };
}

test('view connects to the x11vnc view.sock and carries raw RFB bytes', async () => {
  dir = makeTestTempDir('s');
  runtimeRoot = shortRuntimeRoot(dir);
  const scopeKey = 'chief:view';
  const path = computerScreenSocketPath(runtimeRoot, scopeKey, 'view');
  expect(path.length).toBeLessThan(108);
  expect(path).toBe(join(runtimeRoot, computerMachineName(scopeKey), 'computer', 'view.sock'));
  const input = await listen(path);
  const provider = createComputerScreenProvider({
    runtimeRoot,
    socketWaitMs: 1_000,
  });
  const connection = await provider.connectScreen(request('view', scopeKey));
  const greeting = once(connection.stream, 'data');
  expect((await greeting)[0].toString()).toBe('RFB 003.008\n');
  const framebuffer = Buffer.from([3, 1, 0, 0, 0, 0, 0, 100, 0, 80]);
  connection.stream.write(framebuffer);
  await expect.poll(() => Buffer.concat(input).equals(framebuffer), { timeout: 1_000 }).toBe(true);
  connection.close();
});

test('control connects to vnc.sock after ensureComputer resolves the Orb', async () => {
  dir = makeTestTempDir('s');
  runtimeRoot = shortRuntimeRoot(dir);
  const scopeKey = 'chief:control';
  const path = computerScreenSocketPath(runtimeRoot, scopeKey, 'control');
  let ensured = 0;
  const provider = createComputerScreenProvider({
    runtimeRoot,
    socketWaitMs: 2_000,
    ensureComputer: async () => {
      ensured += 1;
      await listen(path);
      return computerMachineName(scopeKey);
    },
  });
  const connection = await provider.connectScreen(request('control', scopeKey));
  expect(ensured).toBe(1);
  const greeting = once(connection.stream, 'data');
  expect((await greeting)[0].toString()).toBe('RFB 003.008\n');
  connection.close();
});

test('a missing screen socket times out instead of hanging', async () => {
  dir = makeTestTempDir('s');
  runtimeRoot = shortRuntimeRoot(dir);
  const provider = createComputerScreenProvider({
    runtimeRoot,
    socketWaitMs: 80,
  });
  await expect(provider.connectScreen(request('view'))).rejects.toThrow(
    /ENOENT|EINVAL|socket missing/,
  );
});
