import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { PassThrough } from 'node:stream';
import type { ComputerScreenRequest } from '@cairn/shared';
import { afterEach, expect, test, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import {
  type ComputerScreenProvider,
  OutboundComputerScreens,
} from '../../daemon/src/computer/screen-channel.js';

let server: Server;
let sockets: WebSocketServer;
let adapter: OutboundComputerScreens;

const request = {
  id: 'c'.repeat(64),
  computerId: 'screen-unit',
  scopeKey: 'chief:screen-unit',
  generation: 1,
  kind: 'terminal',
  controlLeaseId: 'control-unit',
  controlFence: 1,
  expiresAt: Date.now() + 60000,
} satisfies ComputerScreenRequest;

async function start(provider: ComputerScreenProvider, kind: 'view' | 'terminal' = 'terminal') {
  server = createServer();
  sockets = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    expect(req.url).toBe(`/api/machine/computer-screen/${request.id}`);
    expect(req.headers.authorization).toBe('Bearer unit-machine-token');
    sockets.handleUpgrade(req, socket, head, (ws) => sockets.emit('connection', ws));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing test port');
  adapter = new OutboundComputerScreens({
    serverUrl: `http://127.0.0.1:${address.port}`,
    getToken: () => 'unit-machine-token',
    provider,
  });
  const connected = once(sockets, 'connection');
  const running = adapter.dispatch({ ...request, kind, expiresAt: Date.now() + 60000 });
  const [peer] = await connected;
  return { peer, running };
}

afterEach(async () => {
  for (const socket of sockets?.clients ?? []) socket.terminate();
  await adapter?.close();
  if (sockets) await new Promise<void>((resolve) => sockets.close(() => resolve()));
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('text-encoded provider streams are still forwarded as binary bytes', async () => {
  const stream = new PassThrough();
  stream.setEncoding('utf8');
  let ready = false;
  const { peer, running } = await start(
    {
      async connectScreen() {
        ready = true;
        return {
          stream,
          close: () => {
            stream.destroy();
          },
        };
      },
    },
    'view',
  );
  await vi.waitFor(() => expect(ready).toBe(true));
  expect(adapter.hasUserControl(request.scopeKey)).toBe(false);
  const received = once(peer, 'message');
  stream.write(Buffer.from('display-bytes'));
  expect((await received)[0]).toEqual(Buffer.from('display-bytes'));
  peer.close();
  await running;
});

test('a failed resource close keeps the local mutation fence closed', async () => {
  let ready = false;
  const { peer, running } = await start({
    async connectScreen() {
      ready = true;
      return {
        stream: new PassThrough(),
        close: () => {
          throw new Error('cleanup failed');
        },
      };
    },
  });
  await vi.waitFor(() => expect(ready).toBe(true));
  peer.close();
  await running;
  expect(adapter.hasUserControl(request.scopeKey)).toBe(true);
});
