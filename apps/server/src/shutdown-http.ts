import type { ServerType } from '@hono/node-server';

interface DrainingResponse {
  getHeader(name: string): string | number | string[] | undefined;
  end(): unknown;
  once(event: 'close', listener: () => void): unknown;
}

export function createHttpDrain(server: ServerType) {
  const responses = new Set<DrainingResponse>();
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
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    server.off('request', track);
    await shutdownTracing();
  };
}
