import { request } from 'node:http';
import { Readable } from 'node:stream';

export function useModelSocket(socketPath: string): void {
  globalThis.fetch = async (input, init) => {
    const target =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return new Promise<Response>((resolve, reject) => {
      const req = request(
        {
          socketPath,
          path: `/?target=${encodeURIComponent(target)}`,
          method: init?.method ?? 'GET',
          headers: Object.fromEntries(new Headers(init?.headers)),
          signal: init?.signal ?? undefined,
        },
        (res) => {
          resolve(
            new Response(Readable.toWeb(res) as ReadableStream<Uint8Array>, {
              status: res.statusCode,
              headers: Object.fromEntries(
                Object.entries(res.headers).filter(([, v]) => typeof v === 'string') as [
                  string,
                  string,
                ][],
              ),
            }),
          );
        },
      );
      req.on('error', reject);
      req.end(init?.body);
    });
  };
}
