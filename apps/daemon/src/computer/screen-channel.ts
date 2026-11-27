import type { Duplex } from 'node:stream';
import {
  COMPUTER_SCREEN_CAP_TTL_MS,
  COMPUTER_SCREEN_MAX_BUFFER_BYTES,
  COMPUTER_SCREEN_MAX_FRAME_BYTES,
  type ComputerScreenRequest,
  computerScreenRequestSchema,
} from '@cairn/shared';
import { WebSocket } from 'undici';
import { ReadOnlyViewGate } from './view-input.js';

export interface ComputerScreenConnection {
  stream: Duplex;
  close(): void | Promise<void>;
}

export interface ComputerScreenProvider {
  connectScreen(
    request: ComputerScreenRequest & { signal: AbortSignal },
  ): Promise<ComputerScreenConnection>;
}

export interface OutboundComputerScreenOptions {
  serverUrl: string;
  getToken: () => string;
  provider: ComputerScreenProvider;
  log?: (msg: string) => void;
}

function closeReason(reason: unknown): string {
  if (typeof reason === 'string') return reason;
  if (reason instanceof DOMException && reason.name === 'TimeoutError') return 'capability expired';
  return 'unknown';
}

export class OutboundComputerScreens {
  private readonly unclosedControlScopes = new Set<string>();
  private readonly calls = new Map<
    string,
    { request: ComputerScreenRequest; controller: AbortController; settled: Promise<void> }
  >();
  private closing = false;

  constructor(private readonly options: OutboundComputerScreenOptions) {}

  hasUserControl(scopeKey: string): boolean {
    return (
      [...this.calls.values()].some(
        ({ request }) => request.scopeKey === scopeKey && request.kind !== 'view',
      ) || this.unclosedControlScopes.has(scopeKey)
    );
  }

  activeCount(): number {
    return this.calls.size;
  }

  dispatch(request: ComputerScreenRequest): Promise<void> {
    if (this.closing) return Promise.resolve();
    const existing = this.calls.get(request.id);
    if (existing) return existing.settled;
    const parsed = computerScreenRequestSchema.safeParse(request);
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

  private async run(request: ComputerScreenRequest, controller: AbortController): Promise<void> {
    const url = new URL(this.options.serverUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
      throw new Error('computer screen requires an HTTP server origin');
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = `/api/machine/computer-screen/${request.id}`;
    url.search = '';
    url.hash = '';
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(
        Math.max(1, Math.min(COMPUTER_SCREEN_CAP_TTL_MS, request.expiresAt - Date.now())),
      ),
    ]);
    const websocket = new WebSocket(url, {
      headers: { authorization: `Bearer ${this.options.getToken()}` },
    });
    websocket.binaryType = 'arraybuffer';
    const openedAt = Date.now();
    let sentBytes = 0;
    let peakBuffered = 0;
    const abort = (reason: string) => controller.abort(reason);
    websocket.addEventListener(
      'close',
      (event) =>
        abort(
          `server closed the websocket (code ${event.code}${event.reason ? `, ${event.reason}` : ''})`,
        ),
      { once: true },
    );
    let connection: ComputerScreenConnection | undefined;
    let provider: Promise<ComputerScreenConnection> | undefined;
    const released = new WeakSet<ComputerScreenConnection>();
    const release = async (resource: ComputerScreenConnection): Promise<void> => {
      if (released.has(resource)) return;
      released.add(resource);
      resource.stream.destroy();
      await resource.close();
    };
    let stopped = (): void => {};
    const closed = new Promise<void>((resolve) => {
      stopped = resolve;
      if (signal.aborted) resolve();
      else signal.addEventListener('abort', stopped, { once: true });
    });
    const cancelled = closed.then(() => {
      throw new Error('computer screen closed');
    });
    let pendingBytes = 0;
    const pending: Buffer[] = [];
    const viewGate = request.kind === 'view' ? new ReadOnlyViewGate() : undefined;
    const write = (bytes: Buffer): void => {
      if (!connection || signal.aborted) return;
      let outgoing = bytes;
      if (viewGate) {
        try {
          outgoing = viewGate.accept(bytes);
        } catch {
          abort('view-only input rejected');
          return;
        }
        if (outgoing.length === 0) {
          pendingBytes -= bytes.length;
          return;
        }
      }
      connection.stream.write(outgoing, (error) => {
        pendingBytes -= bytes.length;
        if (error) abort(`desktop write failed (${error.message})`);
      });
    };
    const receive = (event: MessageEvent): void => {
      if (
        !(event.data instanceof ArrayBuffer) ||
        event.data.byteLength > COMPUTER_SCREEN_MAX_FRAME_BYTES
      ) {
        abort('server sent an oversized or non-binary frame');
        return;
      }
      const bytes = Buffer.from(event.data);
      pendingBytes += bytes.length;
      if (pendingBytes > COMPUTER_SCREEN_MAX_BUFFER_BYTES) {
        abort(`input to the desktop backed up (${pendingBytes} bytes pending)`);
        return;
      }
      if (connection) write(bytes);
      else pending.push(bytes);
    };
    websocket.addEventListener('message', receive);
    try {
      const opened = new Promise<void>((resolve) =>
        websocket.addEventListener('open', () => resolve(), { once: true }),
      );
      await Promise.race([opened, cancelled]);
      if (signal.aborted) return;
      provider = this.options.provider.connectScreen({ ...request, signal });
      connection = await Promise.race([provider, cancelled]);
      if (signal.aborted) return;
      connection.stream.on('error', (error: Error) =>
        abort(`desktop stream failed (${error.message})`),
      );
      connection.stream.on('end', () => abort('desktop stream ended'));
      connection.stream.on('close', () => abort('desktop stream closed'));
      connection.stream.on('data', (chunk: unknown) => {
        if (signal.aborted || websocket.readyState !== WebSocket.OPEN) return;
        const bytes = Buffer.isBuffer(chunk)
          ? chunk
          : typeof chunk === 'string'
            ? Buffer.from(chunk)
            : undefined;
        if (!bytes) {
          abort('desktop stream sent a non-byte chunk');
          return;
        }
        for (let offset = 0; offset < bytes.length; offset += COMPUTER_SCREEN_MAX_FRAME_BYTES) {
          const frame = bytes.subarray(offset, offset + COMPUTER_SCREEN_MAX_FRAME_BYTES);
          if (websocket.bufferedAmount + frame.length > COMPUTER_SCREEN_MAX_BUFFER_BYTES) {
            abort(
              `output to the server backed up (${websocket.bufferedAmount} bytes buffered, next frame ${frame.length})`,
            );
            return;
          }
          websocket.send(frame);
          sentBytes += frame.length;
          peakBuffered = Math.max(peakBuffered, websocket.bufferedAmount);
        }
      });
      for (const bytes of pending.splice(0)) write(bytes);
      await closed;
    } catch (error) {
      abort(`failed (${error instanceof Error ? error.message : String(error)})`);
    } finally {
      this.options.log?.(
        `computer screen ${request.kind} ${request.id.slice(0, 8)} closed after ${Math.round((Date.now() - openedAt) / 1000)}s: ${closeReason(signal.reason)}; sent ${sentBytes} bytes, buffered peak ${peakBuffered}, at close ${websocket.bufferedAmount}`,
      );
      controller.abort();
      signal.removeEventListener('abort', stopped);
      websocket.removeEventListener('message', receive);
      try {
        websocket.close();
      } catch {}
      if (!connection && provider) connection = await provider.catch(() => undefined);
      if (connection) {
        try {
          await release(connection);
        } catch {
          if (request.kind !== 'view') this.unclosedControlScopes.add(request.scopeKey);
        }
      }
    }
  }
}
