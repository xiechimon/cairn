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
