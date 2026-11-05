import { Duplex, PassThrough } from 'node:stream';
import { openUserControlPty } from './control-pty.js';
import type { ComputerScreenConnection, ComputerScreenProvider } from './screen-channel.js';
import { ReadOnlyViewGate } from './view-input.js';

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

export const hostComputerScreen: ComputerScreenProvider = {
  async connectScreen(request) {
    if (request.kind === 'view') return openReadOnlyView();
    if (!request.controlLeaseId) throw new Error('a live control lease is required');
    if (request.kind === 'terminal') return openUserControlPty(request.signal);
    const bridge = new PassThrough();
    return {
      stream: bridge,
      close() {
        bridge.destroy();
      },
    };
  },
};
