import { redactSecrets } from '@cairn/shared';

const PATTERN_HOLD_CHARS = 64;
const PENDING_CAP_CHARS = 8 * 1024 * 1024;
const TOKEN_CHAR = /[^\s&"'<>\\]/;
const OPEN_MARKER = /(?:Bearer|Basic|#?token=|github_pat_)\s*$/i;

export class PtyRedactor {
  private readonly decoder = new TextDecoder('utf-8');
  private pending = '';

  constructor(private readonly secrets: () => readonly (string | undefined)[]) {}

  push(chunk: Buffer | Uint8Array): Buffer | null {
    this.pending += this.decoder.decode(chunk, { stream: true });
    if (this.pending.length > PENDING_CAP_CHARS) {
      this.pending = this.pending.slice(this.pending.length - PENDING_CAP_CHARS);
    }
    const emit = this.takeEmit();
    return emit === '' ? null : Buffer.from(this.redact(emit), 'utf8');
  }

  flush(): Buffer | null {
    this.pending += this.decoder.decode();
    if (this.pending === '') return null;
    const emit = this.pending;
    this.pending = '';
    return Buffer.from(this.redact(emit), 'utf8');
  }

  private takeEmit(): string {
    const tokens = this.secrets().filter((value): value is string => Boolean(value));
    const hold = Math.max(PATTERN_HOLD_CHARS, ...tokens.map((value) => value.length - 1), 0);
    let cut = Math.max(0, this.pending.length - hold);
    while (
      cut > 0 &&
      cut < this.pending.length &&
      TOKEN_CHAR.test(this.pending[cut - 1] ?? '') &&
      TOKEN_CHAR.test(this.pending[cut] ?? '')
    ) {
      cut -= 1;
    }
    const marker = OPEN_MARKER.exec(this.pending.slice(0, cut));
    if (marker !== null) cut -= marker[0].length;
    for (const token of tokens) {
      const start = this.pending.lastIndexOf(token, Math.max(0, cut - 1));
      if (start >= 0 && start + token.length > cut) cut = start;
    }
    const emit = this.pending.slice(0, cut);
    this.pending = this.pending.slice(cut);
    return emit;
  }

  private redact(text: string): string {
    const { value } = redactSecrets(
      text,
      this.secrets().filter((value): value is string => Boolean(value)),
    );
    return typeof value === 'string' ? value : String(value);
  }
}
