import { ENGINE_SCROLLBACK_BYTES, ENGINE_SCROLLBACK_CHUNK_BYTES } from '@cairn/shared';

const RESYNC_CLEAR = Buffer.from('\x1b[2J\x1b[H');

export class EngineScrollback {
  private chunks: { endSeq: number; bytes: Buffer }[] = [];
  private endSeq = 0;

  append(data: Buffer): void {
    for (let offset = 0; offset < data.length; offset += ENGINE_SCROLLBACK_CHUNK_BYTES) {
      const bytes = Buffer.from(data.subarray(offset, offset + ENGINE_SCROLLBACK_CHUNK_BYTES));
      this.endSeq += bytes.length;
      this.chunks.push({ endSeq: this.endSeq, bytes });
    }
    while (this.chunks.length > 1 && this.endSeq - this.oldestSeq() > ENGINE_SCROLLBACK_BYTES) {
      this.chunks.shift();
    }
  }

  private oldestSeq(): number {
    const first = this.chunks[0];
    return first === undefined ? this.endSeq : first.endSeq - first.bytes.length;
  }

  get seq(): number {
    return this.endSeq;
  }

  replay(fromSeq: number): Buffer[] {
    if (fromSeq < this.oldestSeq() || fromSeq > this.endSeq) {
      return [RESYNC_CLEAR, ...this.chunks.map((chunk) => chunk.bytes)];
    }
    return this.chunks.filter((chunk) => chunk.endSeq > fromSeq).map((chunk) => chunk.bytes);
  }

  contents(): Buffer {
    return Buffer.concat(this.chunks.map((chunk) => chunk.bytes));
  }
}
