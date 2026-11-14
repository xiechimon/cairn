import { connect, type Socket } from 'node:net';
import { join } from 'node:path';
import { Duplex, PassThrough } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';
import type { ComputerScreenRequest } from '@cairn/shared';
import { computerMachineName } from '../orb/computer.js';
import { openUserControlPty } from './control-pty.js';
import type { ComputerScreenConnection, ComputerScreenProvider } from './screen-channel.js';
import { ReadOnlyViewGate } from './view-input.js';

export const COMPUTER_SCREEN_SOCKET_WAIT_MS = 60_000;
const DEFAULT_RUNTIME_ROOT = '/run/cairn-orb';

export interface ReadOnlyView extends ComputerScreenConnection {
  accepted: Buffer[];
}

export function openReadOnlyView(): ReadOnlyView {
  const gate = new ReadOnlyViewGate();
  const accepted: Buffer[] = [];
  const readable = new PassThrough();
  const stream = new Duplex({
    write(chunk, _encoding, callback) {
      try {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const safe = gate.accept(bytes);
        if (safe.length > 0) accepted.push(Buffer.from(safe));
        callback();
      } catch (error) {
        callback(error instanceof Error ? error : new Error('malicious computer view input'));
      }
    },
    read() {
      const chunk = readable.read() as Buffer | null;
      if (chunk) this.push(chunk);
    },
  });
  readable.on('data', (chunk: Buffer) => stream.push(chunk));
  return {
    stream,
    accepted,
    close() {
      stream.destroy();
      readable.destroy();
    },
  };
}

export interface ComputerScreenProviderOptions {
  runtimeRoot?: string | (() => string);
  ensureComputer?: (scopeKey: string) => Promise<string>;
  socketPath?: (scopeKey: string, kind: 'view' | 'control') => string;
  socketWaitMs?: number;
  connect?: (path: string) => Socket;
  now?: () => number;
}

export function computerScreenSocketPath(
  runtimeRoot: string,
  scopeKey: string,
  kind: Exclude<ComputerScreenRequest['kind'], 'terminal'>,
): string {
  return join(
    runtimeRoot,
    computerMachineName(scopeKey),
    'computer',
    kind === 'view' ? 'view.sock' : 'vnc.sock',
  );
}

function waitForSocket(socket: Socket, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let immediate: ReturnType<typeof setImmediate> | undefined;
    const finish = (action: () => void) => {
      if (immediate !== undefined) clearImmediate(immediate);
      socket.off('connect', onConnect);
      socket.off('error', onError);
      signal.removeEventListener('abort', onAbort);
      action();
    };
    const onConnect = () => finish(resolve);
    const onError = (error: Error) => finish(() => reject(error));
    const onAbort = () => finish(() => reject(new Error('computer screen closed')));
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    if (socket.errored) {
      onError(socket.errored);
      return;
    }
    socket.once('connect', onConnect);
    socket.once('error', onError);
    if (!socket.connecting) {
      immediate = setImmediate(() => {
        if (socket.errored) onError(socket.errored);
        else if (socket.destroyed) onError(new Error('computer screen socket missing'));
        else onConnect();
      });
    }
  });
}

async function openUnixScreen(
  path: string,
  signal: AbortSignal,
  options: {
    socketWaitMs: number;
    connect: (path: string) => Socket;
    now: () => number;
  },
): Promise<ComputerScreenConnection> {
  const deadline = options.now() + options.socketWaitMs;
  let lastError: unknown;
  while (!signal.aborted) {
    const socket = options.connect(path);
    try {
      await waitForSocket(socket, signal);
      socket.setNoDelay(true);
      return {
        stream: socket,
        close() {
          socket.destroy();
        },
      };
    } catch (error) {
      lastError = error;
      socket.destroy();
      if (signal.aborted || options.now() >= deadline) break;
      await sleep(Math.min(100, Math.max(1, deadline - options.now())), undefined, { signal });
    }
  }
  signal.throwIfAborted();
  throw lastError instanceof Error
    ? lastError
    : new Error(`computer screen socket missing: ${path}`);
}

export function createComputerScreenProvider(
  options: ComputerScreenProviderOptions = {},
): ComputerScreenProvider {
  const socketWaitMs = options.socketWaitMs ?? COMPUTER_SCREEN_SOCKET_WAIT_MS;
  const connectSocket = options.connect ?? connect;
  const now = options.now ?? Date.now;
  return {
    async connectScreen(request) {
      if (request.kind === 'terminal') {
        if (!request.controlLeaseId) throw new Error('a live control lease is required');
        return openUserControlPty(request.signal);
      }
      if (request.kind === 'control' && !request.controlLeaseId) {
        throw new Error('a live control lease is required');
      }
      if (options.ensureComputer) await options.ensureComputer(request.scopeKey);
      const runtimeRoot =
        typeof options.runtimeRoot === 'function'
          ? options.runtimeRoot()
          : (options.runtimeRoot ?? DEFAULT_RUNTIME_ROOT);
      return openUnixScreen(
        options.socketPath
          ? options.socketPath(request.scopeKey, request.kind)
          : computerScreenSocketPath(runtimeRoot, request.scopeKey, request.kind),
        request.signal,
        {
          socketWaitMs,
          connect: connectSocket,
          now,
        },
      );
    },
  };
}

export const hostComputerScreen: ComputerScreenProvider = createComputerScreenProvider();
