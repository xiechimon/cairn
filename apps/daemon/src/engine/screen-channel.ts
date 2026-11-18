import type { Duplex } from 'node:stream';
import {
  ENGINE_SCREEN_CAP_TTL_MS,
  ENGINE_SCREEN_MAX_BUFFER_BYTES,
  ENGINE_SCREEN_MAX_FRAME_BYTES,
  type EngineScreenRequest,
  engineScreenRequestSchema,
} from '@cairn/shared';
import { WebSocket } from 'undici';

export interface EngineScreenConnection {
  stream: Duplex;
  close(): void | Promise<void>;
}

export interface EngineScreenProvider {
  connectScreen(
    request: EngineScreenRequest & { signal: AbortSignal },
  ): Promise<EngineScreenConnection>;
}

export interface OutboundEngineScreenOptions {
  serverUrl: string;
  getToken: () => string;
  provider: EngineScreenProvider;
  log?: (msg: string) => void;
}

export class OutboundEngineScreens {
  private readonly calls = new Map<
    string,
    { request: EngineScreenRequest; controller: AbortController; settled: Promise<void> }
  >();
  private closing = false;

  constructor(private readonly options: OutboundEngineScreenOptions) {}

  dispatch(request: EngineScreenRequest): Promise<void> {
    if (this.closing) return Promise.resolve();
    const existing = this.calls.get(request.id);
    if (existing) return existing.settled;
    const parsed = engineScreenRequestSchema.safeParse(request);
    if (!parsed.success || parsed.data.expiresAt <= Date.now()) return Promise.resolve();
    const controller = new AbortController();
    const settled = this.run(parsed.data, controller)
      .catch(() => {})
      .finally(() => this.calls.delete(request.id));
    this.calls.set(request.id, { request: parsed.data, controller, settled });
    return settled;
  }

  async close(): Promise<void> {
    this.closing = true;
    const calls = [...this.calls.values()];
    for (const call of calls) call.controller.abort('daemon shutting down');
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        Promise.allSettled(calls.map((call) => call.settled)),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 3000);
          timer.unref();
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async run(request: EngineScreenRequest, controller: AbortController): Promise<void> {
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(
        Math.max(1, Math.min(ENGINE_SCREEN_CAP_TTL_MS, request.expiresAt - Date.now())),
      ),
    ]);
    let connection: EngineScreenConnection | undefined;
    const provider = this.options.provider.connectScreen({ ...request, signal }).then((value) => {
      connection = value;
      return value;
    });
    const openedAt = Date.now();
    try {
      await provider;
    } catch (error) {
      this.options.log?.(
        `engine screen ${request.kind} ${request.id.slice(0, 8)} refused before connect: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    const url = new URL(this.options.serverUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
      throw new Error('engine screen requires an HTTP server origin');
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = `/api/machine/engine-screen/${request.id}`;
    url.search = '';
    url.hash = '';
    const websocket = new WebSocket(url, {
      headers: { authorization: `Bearer ${this.options.getToken()}` },
    });
    websocket.binaryType = 'arraybuffer';
    let sentBytes = 0;
    const abort = (reason: string) => controller.abort(reason);
    websocket.addEventListener(
      'close',
      (event) =>
        abort(
          `server closed the websocket (code ${event.code}${event.reason ? `, ${event.reason}` : ''})`,
        ),
      { once: true },
    );
    let stopped = (): void => {};
    const closed = new Promise<void>((resolve) => {
      stopped = resolve;
      if (signal.aborted) resolve();
      else signal.addEventListener('abort', stopped, { once: true });
    });
    const cancelled = closed.then(() => {
      throw new Error('engine screen closed');
    });
    let pendingBytes = 0;
    const receive = (event: MessageEvent): void => {
      if (
        !(event.data instanceof ArrayBuffer) ||
        event.data.byteLength > ENGINE_SCREEN_MAX_FRAME_BYTES
      ) {
        abort('server sent an oversized or non-binary frame');
        return;
      }
      const bytes = Buffer.from(event.data);
      pendingBytes += bytes.length;
      if (pendingBytes > ENGINE_SCREEN_MAX_BUFFER_BYTES) {
        abort(`input to the engine backed up (${pendingBytes} bytes pending)`);
        return;
      }
      connection?.stream.write(bytes, (error) => {
        pendingBytes -= bytes.length;
        if (error) abort(`engine write failed (${error.message})`);
      });
    };
    websocket.addEventListener('message', receive);
    try {
      const opened = new Promise<void>((resolve) =>
        websocket.addEventListener('open', () => resolve(), { once: true }),
      );
      await Promise.race([opened, cancelled]);
      if (signal.aborted) return;
      const bound = connection;
      if (bound === undefined) return;
      bound.stream.on('error', (error: Error) => abort(`engine stream failed (${error.message})`));
      bound.stream.on('end', () => abort('engine stream ended'));
      bound.stream.on('close', () => abort('engine stream closed'));
      bound.stream.on('data', (chunk: unknown) => {
        if (signal.aborted || websocket.readyState !== WebSocket.OPEN) return;
        const bytes = Buffer.isBuffer(chunk)
          ? chunk
          : typeof chunk === 'string'
            ? Buffer.from(chunk)
            : undefined;
        if (bytes === undefined) {
          abort('engine stream sent a non-byte chunk');
          return;
        }
        for (let offset = 0; offset < bytes.length; offset += ENGINE_SCREEN_MAX_FRAME_BYTES) {
          const frame = bytes.subarray(offset, offset + ENGINE_SCREEN_MAX_FRAME_BYTES);
          if (websocket.bufferedAmount + frame.length > ENGINE_SCREEN_MAX_BUFFER_BYTES) {
            abort(`output to the server backed up (${websocket.bufferedAmount} bytes buffered)`);
            return;
          }
          websocket.send(frame);
          sentBytes += frame.length;
        }
      });
      await closed;
    } catch (error) {
      abort(`failed (${error instanceof Error ? error.message : String(error)})`);
    } finally {
      this.options.log?.(
        `engine screen ${request.kind} ${request.id.slice(0, 8)} closed after ${Math.round((Date.now() - openedAt) / 1000)}s: ${typeof signal.reason === 'string' ? signal.reason : 'closed'}; sent ${sentBytes} bytes`,
      );
      controller.abort();
      signal.removeEventListener('abort', stopped);
      websocket.removeEventListener('message', receive);
      try {
        websocket.close();
      } catch {}
      const bound = connection ?? (await provider.catch(() => undefined));
      if (bound !== undefined) {
        try {
          bound.stream.destroy();
          await bound.close();
        } catch {}
      }
    }
  }
}
