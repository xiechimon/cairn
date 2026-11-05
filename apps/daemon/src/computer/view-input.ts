const FIXED_MESSAGE_BYTES: Readonly<Record<number, number>> = {
  0: 20,
  3: 10,
  4: 8,
  5: 6,
};

type GatePhase = 'version' | 'security' | 'clientInit' | 'messages';

export class ReadOnlyViewGate {
  private pending = Buffer.alloc(0);
  private phase: GatePhase = 'version';

  accept(chunk: Buffer): Buffer {
    this.pending = Buffer.concat([this.pending, chunk]);
    const kept: Buffer[] = [];
    while (this.pending.length > 0) {
      if (this.phase === 'version') {
        const nl = this.pending.indexOf(0x0a);
        if (nl < 0) break;
        const line = this.pending.subarray(0, nl + 1);
        if (!/^RFB \d{3}\.\d{3}\n$/.test(line.toString('latin1'))) {
          throw new Error('malicious computer view input');
        }
        kept.push(Buffer.from(line));
        this.pending = this.pending.subarray(nl + 1);
        this.phase = 'security';
        continue;
      }
      if (this.phase === 'security' || this.phase === 'clientInit') {
        const byte = this.pending.subarray(0, 1);
        kept.push(Buffer.from(byte));
        this.pending = this.pending.subarray(1);
        this.phase = this.phase === 'security' ? 'clientInit' : 'messages';
        continue;
      }
      const type = this.pending[0] ?? 0;
      const size = this.messageSize();
      if (size === null) break;
      if (size < 0) throw new Error('malicious computer view input');
      const message = this.pending.subarray(0, size);
      this.pending = this.pending.subarray(size);
      if (type === 4 || type === 5 || type === 6) continue;
      kept.push(Buffer.from(message));
    }
    return kept.length === 0 ? Buffer.alloc(0) : Buffer.concat(kept);
  }

  private messageSize(): number | null {
    const type = this.pending[0] ?? 0;
    const fixed = FIXED_MESSAGE_BYTES[type];
    if (fixed !== undefined) return this.pending.length < fixed ? null : fixed;
    if (type === 2) {
      if (this.pending.length < 4) return null;
      const count = this.pending.readUInt16BE(2);
      const size = 4 + count * 4;
      return this.pending.length < size ? null : size;
    }
    if (type === 6) {
      if (this.pending.length < 8) return null;
      const length = this.pending.readInt32BE(4);
      if (length < 0) return -1;
      const size = 8 + length;
      return this.pending.length < size ? null : size;
    }
    return -1;
  }
}
