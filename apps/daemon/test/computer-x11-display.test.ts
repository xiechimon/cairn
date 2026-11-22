import { chmodSync, mkdirSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import {
  x11DisplayAnswers,
  x11SocketAnswers,
  x11SocketPath,
  x11SocketPaths,
} from '../src/computer/x11-display.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function sockets() {
  const directory = makeTestTempDir('x11-display-');
  cleanups.push(() => releaseTestTempDir(directory));
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const listen = (name: string, reply?: number): Promise<Server> => {
    const socket = createServer((connection) => {
      connection.once('data', () => {
        if (reply !== undefined) connection.end(Buffer.from([reply, 0]));
      });
    });
    return new Promise((resolve) => socket.listen(join(directory, name), () => resolve(socket)));
  };
  return { path: (name: string) => join(directory, name), listen };
}

describe('x11SocketAnswers', () => {
  test('a display that completes the setup handshake answers', async () => {
    const server = sockets();
    const socket = await server.listen('answering', 1);
    cleanups.push(() => socket.close());
    expect(await x11SocketAnswers(server.path('answering'), 1_000)).toBe(true);
  });

  test('a socket that accepts the connection but never replies does not answer', async () => {
    const server = sockets();
    const socket = await server.listen('silent');
    cleanups.push(() => socket.close());
    expect(await x11SocketAnswers(server.path('silent'), 200)).toBe(false);
  });

  test('a display that refuses the connection does not answer', async () => {
    const server = sockets();
    const socket = await server.listen('refusing', 0);
    cleanups.push(() => socket.close());
    expect(await x11SocketAnswers(server.path('refusing'), 1_000)).toBe(false);
  });

  test('a missing socket does not answer', async () => {
    const server = sockets();
    expect(await x11SocketAnswers(server.path('missing'), 1_000)).toBe(false);
  });
});

describe('the local display address', () => {
  test.each([
    [':1', '/tmp/.X11-unix/X1'],
    ['1', '/tmp/.X11-unix/X1'],
    [':97', '/tmp/.X11-unix/X97'],
    [':3.0', '/tmp/.X11-unix/X3'],
  ])('%s maps to %s', (display, path) => {
    expect(x11SocketPath(display)).toBe(path);
    expect(x11SocketPaths(display)).toEqual([path, `\0${path}`]);
  });

  test('a display that answers nowhere does not answer', async () => {
    expect(await x11DisplayAnswers('198', 100)).toBe(false);
  });
});
