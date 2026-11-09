import type { Socket } from 'node:net';
import type { ServerType } from '@hono/node-server';

interface DrainingResponse {
  getHeader(name: string): string | number | string[] | undefined;
  end(): unknown;
  once(event: 'close', listener: () => void): unknown;
}

export function createHttpDrain(server: ServerType, graceMs = 5_000) {
  const responses = new Set<DrainingResponse>();
  const sockets = new Set<Socket>();
  const trackSocket = (socket: Socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  };
  server.on('connection', trackSocket);
  const track = (_request: unknown, response: DrainingResponse) => {
    responses.add(response);
    response.once('close', () => responses.delete(response));
  };
  server.on('request', track);
  return async (shutdownTracing: () => Promise<void>): Promise<void> => {
    for (const response of responses) {
      if (String(response.getHeader('content-type')).startsWith('text/event-stream'))
        response.end();
    }
    const deadline = setTimeout(() => {
      for (const socket of sockets) socket.destroy();
    }, graceMs);
    try {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    } finally {
      clearTimeout(deadline);
      server.off('request', track);
      server.off('connection', trackSocket);
    }
    await shutdownTracing();
  };
}
