import type { EnginePtyProcess } from './pty.js';
import { PtyRedactor } from './redactor.js';
import { EngineScrollback } from './scrollback.js';

export interface EnginePtyOptions {
  secrets: () => readonly (string | undefined)[];
  onExit?: () => void;
}

const QUEUED_STDIN_MAX_BYTES = 256 * 1024;

export class EnginePty {
  private readonly ring = new EngineScrollback();
  private readonly redactor: PtyRedactor;
  private readonly sinks = new Set<(chunk: Buffer) => void>();
  private readonly queued: { bytes: Buffer; resolve: () => void; reject: (e: Error) => void }[] =
    [];
  private queuedBytes = 0;
  private hold: { leaseId: string; fence: number } | null = null;
  private ended = false;
  private readonly onExit: (() => void) | undefined;

  constructor(
    private readonly proc: EnginePtyProcess,
    opts: EnginePtyOptions,
  ) {
    this.onExit = opts.onExit;
    this.redactor = new PtyRedactor(opts.secrets);
    proc.stream.on('data', (chunk: Buffer | string) => {
      const out = this.redactor.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      if (out !== null) this.emit(out);
    });
    proc.stream.once('close', () => this.finish());
    proc.stream.once('end', () => this.finish());
    proc.stream.once('error', () => this.finish());
  }

  get closed(): boolean {
    return this.ended;
  }

  get seq(): number {
    return this.ring.seq;
  }

  attach(sink: (chunk: Buffer) => void, fromSeq: number): () => void {
    for (const chunk of this.ring.replay(fromSeq)) sink(chunk);
    if (!this.ended) this.sinks.add(sink);
    return () => {
      this.sinks.delete(sink);
    };
  }

  writeAgent(bytes: Buffer | string): Promise<void> {
    const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    if (this.ended) return Promise.reject(new Error('engine pty closed'));
    if (this.hold !== null) {
      if (this.queuedBytes + data.length > QUEUED_STDIN_MAX_BYTES) {
        return Promise.reject(new Error('engine pty input queue full'));
      }
      return new Promise<void>((resolve, reject) => {
        this.queued.push({ bytes: data, resolve, reject });
        this.queuedBytes += data.length;
      });
    }
    this.proc.stream.write(data);
    return Promise.resolve();
  }

  writeOwner(leaseId: string, fence: number, bytes: Buffer): void {
    const hold = this.hold;
    if (this.ended || hold === null || hold.leaseId !== leaseId || hold.fence !== fence) return;
    this.proc.stream.write(bytes);
  }

  acquireHold(leaseId: string, fence: number): boolean {
    if (this.ended) return false;
    this.hold = { leaseId, fence };
    return true;
  }

  releaseHold(leaseId?: string, fence?: number): boolean {
    const hold = this.hold;
    if (hold === null) return false;
    if (leaseId !== undefined && (hold.leaseId !== leaseId || hold.fence !== fence)) return false;
    this.hold = null;
    const pending = this.queued.splice(0);
    this.queuedBytes = 0;
    for (const entry of pending) {
      try {
        this.proc.stream.write(entry.bytes);
        entry.resolve();
      } catch (error) {
        entry.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
    return true;
  }

  interrupt(): void {
    if (this.ended) return;
    try {
      this.proc.stream.write('\x03');
    } catch {}
  }

  close(): void {
    this.proc.close();
    this.finish();
  }

  scrollback(): Buffer {
    return this.ring.contents();
  }

  private emit(bytes: Buffer): void {
    this.ring.append(bytes);
    for (const sink of this.sinks) sink(bytes);
  }

  private finish(): void {
    if (this.ended) return;
    this.ended = true;
    const out = this.redactor.flush();
    if (out !== null) this.emit(out);
    for (const entry of this.queued.splice(0)) {
      entry.reject(new Error('engine pty closed while input was held'));
    }
    this.queuedBytes = 0;
    this.sinks.clear();
    this.onExit?.();
  }
}
