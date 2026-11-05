import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { createConnection, type Socket } from 'node:net';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { ComputerInputFence } from '../src/computer/input-fence.js';
import { OrbComputerProvider } from '../src/computer/orb.js';
import {
  decodeOrbComputerFrame,
  encodeOrbComputerFrame,
  type OrbComputerHostFrame,
  readOrbComputerLines,
} from '../src/computer/orb-protocol.js';
import { ComputerRefusal } from '../src/computer/provider.js';
import { ensurePrivateDir } from '../src/private-fs.js';

const RELEASE = '1.0.0-abcd1234-dist-0123456789abcdef';

let allocatedRoot: string;
let root: string;
let runtime: string;
let locks: string;
let first: OrbComputerProvider | undefined;
let second: OrbComputerProvider | undefined;
let socket: Socket | undefined;

beforeEach(() => {
  allocatedRoot = makeTestTempDir('cif-');
  root = realpathSync(allocatedRoot);
  runtime = join(root, 'r');
  locks = join(root, 'locks');
  mkdirSync(join(runtime, 'c1'), { recursive: true, mode: 0o700 });
  ensurePrivateDir(locks);
});

afterEach(async () => {
  socket?.destroy();
  socket = undefined;
  await first?.close();
  await second?.close();
  first = undefined;
  second = undefined;
  expect(releaseTestTempDir(allocatedRoot)).toBe(true);
});

function provider(machineId: string | (() => string)): OrbComputerProvider {
  return new OrbComputerProvider({
    runtimeRoot: runtime,
    orbs: {
      ensure: async () => 'c1',
      touch: () => {},
    },
    expectedRelease: () => RELEASE,
    connectTimeoutMs: 5_000,
    inputFence: new ComputerInputFence(locks, machineId),
  });
}

async function connectGuest(
  socketPath = join(runtime, 'c1', 'computer.sock'),
): Promise<OrbComputerHostFrame[]> {
  const received: OrbComputerHostFrame[] = [];
  await vi.waitFor(() => {
    expect(existsSync(`${socketPath}.token`)).toBe(true);
  });
  socket = createConnection(socketPath);
  socket.on('error', () => {});
  readOrbComputerLines(socket, (line) => {
    received.push(decodeOrbComputerFrame(line) as OrbComputerHostFrame);
  });
  socket.write(
    encodeOrbComputerFrame({
      type: 'auth',
      token: readFileSync(`${socketPath}.token`, 'utf8'),
      release: RELEASE,
    }),
  );
  return received;
}

async function answerRead(orb: OrbComputerProvider, scope: string, value: string): Promise<string> {
  const reading = orb.forScope(scope).readFile('/readme');
  const received = await connectGuest();
  await vi.waitFor(() => expect(received.some((frame) => 'method' in frame)).toBe(true));
  const request = received.find((frame) => 'method' in frame);
  if (!request || !('id' in request)) throw new Error('No file request was received');
  socket?.write(encodeOrbComputerFrame({ id: request.id, value }));
  socket?.write(encodeOrbComputerFrame({ id: request.id, done: true }));
  return reading;
}

describe.skipIf(process.platform !== 'linux')(
  'Orb computer input ownership across daemon instances',
  () => {
    test('a second provider cannot open the same scope until the first releases ownership', async () => {
      first = provider('machine-one');
      second = provider('machine-one');
      expect(await answerRead(first, 'chief:one', 'owned')).toBe('owned');
      await expect(second.forScope('chief:one').readFile('/readme')).rejects.toBeInstanceOf(
        ComputerRefusal,
      );
      await expect(second.forScope('chief:one').readFile('/readme')).rejects.toThrow(
        'already has an input owner',
      );
      expect(existsSync(join(runtime, 'c1', 'computer.sock'))).toBe(true);
      await first.close();
      first = undefined;
      socket?.destroy();
      socket = undefined;
      expect(await answerRead(second, 'chief:one', 'released')).toBe('released');
    });

    test('an unenrolled machine identity refuses before the Orb starts', async () => {
      const machineId = '';
      first = provider(() => machineId);
      await expect(first.forScope('chief:one').readFile('/readme')).rejects.toBeInstanceOf(
        ComputerRefusal,
      );
      await expect(first.forScope('chief:one').readFile('/readme')).rejects.toThrow(
        'enrolled machine',
      );
      expect(existsSync(join(runtime, 'c1', 'computer.sock'))).toBe(false);
    });

    test('a cancelled caller never keeps the input fence or opens a socket', async () => {
      first = provider('machine-one');
      second = provider('machine-one');
      const controller = new AbortController();
      controller.abort(new Error('call expired'));
      await expect(
        first.forScope('chief:one').readFile('/readme', { signal: controller.signal }),
      ).rejects.toBeInstanceOf(ComputerRefusal);
      expect(existsSync(join(runtime, 'c1', 'computer.sock'))).toBe(false);
      expect(await answerRead(second, 'chief:one', 'free')).toBe('free');
    });
  },
);
