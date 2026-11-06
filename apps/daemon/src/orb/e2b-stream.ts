import { Duplex } from 'node:stream';
import { ORB_MAX_FRAME_BYTES, ORB_RPC_PREFIX } from './protocol.js';

const STDIN_PIECE_BYTES = 64 * 1024;

export interface E2bStdioPipe {
  sendStdin(data: Uint8Array): Promise<void>;
  closeStdin(): Promise<void>;
  kill(): Promise<void>;
}

export class E2bStdioStream extends Duplex {
  private remote: E2bStdioPipe | undefined;
  private pending = '';
  private scanned = 0;

  constructor() {
    super();
    this.on('error', () => {});
  }

  bind(pipe: E2bStdioPipe): void {
    this.remote = pipe;
    if (this.destroyed) void pipe.kill().catch(() => {});
  }

  receive(text: string): void {
    if (this.destroyed) return;
    this.pending += text;
    let newline = this.pending.indexOf('\n', this.scanned);
    while (newline >= 0) {
      const line = this.pending.slice(0, newline);
      this.pending = this.pending.slice(newline + 1);
      if (line.startsWith(ORB_RPC_PREFIX)) this.push(Buffer.from(`${line}\n`));
      newline = this.pending.indexOf('\n');
    }
    this.scanned = this.pending.length;
    if (this.pending.length > ORB_MAX_FRAME_BYTES + ORB_RPC_PREFIX.length) {
      if (this.pending.startsWith(ORB_RPC_PREFIX))
        this.destroy(new Error('Orb relay frame exceeds the size cap'));
      else {
        this.pending = '';
        this.scanned = 0;
      }
    }
  }

  finish(error?: Error): void {
    if (error) {
      this.destroy(error);
      return;
    }
    this.once('end', () => this.destroy());
    this.push(null);
  }

  override _read(): void {}

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    const remote = this.remote;
    if (!remote) {
      callback(new Error('E2B relay stream is not connected'));
      return;
    }
    void (async () => {
      for (let offset = 0; offset < chunk.length; offset += STDIN_PIECE_BYTES)
        await remote.sendStdin(chunk.subarray(offset, offset + STDIN_PIECE_BYTES));
    })().then(
      () => callback(),
      (error: unknown) =>
        callback(error instanceof Error ? error : new Error(`E2B stdin write failed: ${error}`)),
    );
  }

  override _final(callback: (error?: Error | null) => void): void {
    void (this.remote?.closeStdin() ?? Promise.resolve()).then(
      () => callback(),
      () => callback(),
    );
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    void this.remote?.kill().catch(() => {});
    callback(error);
  }
}
