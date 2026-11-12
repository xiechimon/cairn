export type SegmentKind = 'text' | 'thinking';

export interface SealedSegment {
  kind: SegmentKind;
  text: string;
}

export function segmentContent(seg: SealedSegment): Record<string, string>[] {
  return seg.kind === 'thinking'
    ? [{ type: 'thinking', thinking: seg.text }]
    : [{ type: 'text', text: seg.text }];
}

export class SegmentBuffer {
  private kind: SegmentKind | null = null;
  private text = '';

  append(kind: SegmentKind, text: string): SealedSegment | null {
    if (text === '') return null;
    const sealed = this.kind !== null && this.kind !== kind ? this.seal() : null;
    this.kind = kind;
    this.text += text;
    return sealed;
  }

  replace(kind: SegmentKind, text: string): SealedSegment | null {
    if (text === '') return null;
    const sealed = this.kind !== null && this.kind !== kind ? this.seal() : null;
    this.kind = kind;
    this.text = text;
    return sealed;
  }

  seal(): SealedSegment | null {
    if (this.kind === null || this.text === '') {
      this.kind = null;
      this.text = '';
      return null;
    }
    const seg: SealedSegment = { kind: this.kind, text: this.text };
    this.kind = null;
    this.text = '';
    return seg;
  }

  current(): SealedSegment | null {
    return this.kind === null || this.text === '' ? null : { kind: this.kind, text: this.text };
  }
}

export class SegmentEmitter {
  private readonly buffer = new SegmentBuffer();
  private emittedInMessage = false;

  constructor(private readonly emit: (seg: SealedSegment) => Promise<void>) {}

  async append(kind: SegmentKind, text: string): Promise<void> {
    await this.deliver(this.buffer.append(kind, text));
  }

  async replace(kind: SegmentKind, text: string): Promise<void> {
    await this.deliver(this.buffer.replace(kind, text));
  }

  async seal(): Promise<void> {
    await this.deliver(this.buffer.seal());
  }

  async endAssistantMessage(content: unknown): Promise<void> {
    const hadRows = this.emittedInMessage;
    this.emittedInMessage = false;
    const trailing = this.buffer.seal();
    if (hadRows || trailing !== null) {
      await this.deliver(trailing);
      this.emittedInMessage = false;
      return;
    }
    const blocks = Array.isArray(content) ? content : [content];
    for (const block of blocks) {
      if (typeof block === 'string') {
        await this.append('text', block);
        continue;
      }
      if (block === null || typeof block !== 'object') continue;
      const b = block as { type?: string; text?: string; thinking?: string };
      if (b.type === 'thinking' && typeof b.thinking === 'string') {
        await this.replace('thinking', b.thinking);
      } else if (b.type === 'text' && typeof b.text === 'string') {
        await this.append('text', b.text);
      }
    }
    await this.seal();
    this.emittedInMessage = false;
  }

  private async deliver(seg: SealedSegment | null): Promise<void> {
    if (seg === null) return;
    this.emittedInMessage = true;
    await this.emit(seg);
  }
}
