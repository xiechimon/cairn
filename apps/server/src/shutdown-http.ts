import type { Socket } from 'node:net';
import type { ServerType } from '@hono/node-server';

interface DrainingResponse {
  getHeader(name: string): string | number | string[] | undefined;
  end(): unknown;
  once(event: 'close', listener: () => void): unknown;
  writeHead?: (...args: unknown[]) => unknown;
}

interface DrainingRequest {
  destroy?: () => unknown;
}

function hasEventStreamHeader(headers: unknown): boolean {
  if (headers === null || typeof headers !== 'object') return false;
  if (Array.isArray(headers)) {
    for (let i = 0; i + 1 < headers.length; i += 2) {
      if (
        typeof headers[i] === 'string' &&
        headers[i].toLowerCase() === 'content-type' &&
        String(headers[i + 1]).startsWith('text/event-stream')
      ) {
        return true;
      }
    }
    return false;
  }
  for (const [name, value] of Object.entries(headers as Record<string, unknown>)) {
    if (name.toLowerCase() === 'content-type' && String(value).startsWith('text/event-stream')) {
      return true;
    }
  }
  return false;
}

export function createHttpDrain(server: ServerType, graceMs = 5_000) {
  const active = new Map<DrainingResponse, { request: DrainingRequest; sse: boolean }>();
  const sockets = new Set<Socket>();
  const trackSocket = (socket: Socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  };
  server.on('connection', trackSocket);
  const track = (request: DrainingRequest, response: DrainingResponse) => {
    const entry = { request, sse: false };
    active.set(response, entry);
    const originalWriteHead = response.writeHead;
    if (typeof originalWriteHead === 'function') {
      response.writeHead = (...args: unknown[]) => {
        for (const arg of args.slice(1)) {
          if (hasEventStreamHeader(arg)) entry.sse = true;
        }
        return Reflect.apply(originalWriteHead, response, args);
      };
    }
    response.once('close', () => active.delete(response));
  };
  server.on('request', track);
  return async (): Promise<void> => {
    for (const [response, entry] of active) {
      if (entry.sse || String(response.getHeader('content-type')).startsWith('text/event-stream')) {
        response.end();
        entry.request.destroy?.();
      }
    }
    if ('closeIdleConnections' in server && typeof server.closeIdleConnections === 'function') {
      server.closeIdleConnections();
    }
    const deadline = setTimeout(() => {
      for (const socket of sockets) socket.destroy();
    }, graceMs);
    try {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
            reject(error);
            return;
          }
          resolve();
        });
      });
    } finally {
      clearTimeout(deadline);
      server.off('request', track);
      server.off('connection', trackSocket);
    }
  };
}
