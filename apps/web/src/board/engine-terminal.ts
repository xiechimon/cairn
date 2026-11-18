const COLS = 160;
const ROWS = 50;
const HISTORY_ROWS = 4000;

interface Cell {
  ch: string;
}

const blank = (): Cell => ({ ch: ' ' });

const DEC_SPECIAL: Record<string, string> = {
  q: '─',
  x: '│',
  l: '┌',
  k: '┐',
  m: '└',
  j: '┘',
  t: '├',
  u: '┤',
  v: '┴',
  w: '┬',
  n: '┼',
  a: '▒',
  f: '°',
  g: '±',
  '`': '◆',
  '~': '·',
};

export class EngineTerminal {
  private grid: Cell[][];
  private history: string[] = [];
  private cx = 0;
  private cy = 0;
  private saved = { cx: 0, cy: 0 };
  private esc = '';
  private decCharset = false;
  private scrollBottom = ROWS - 1;
  version = 0;

  constructor() {
    this.grid = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, blank));
  }

  feed(chunk: string): void {
    for (const ch of chunk) this.write(ch);
  }

  private write(ch: string): void {
    if (this.esc !== '') {
      this.escape(ch);
      return;
    }
    if (ch === '\x1b') {
      this.esc = ch;
      return;
    }
    if (ch === '\r') {
      this.cx = 0;
      return;
    }
    if (ch === '\n' || ch === '\x0b' || ch === '\x0c') {
      this.lineFeed();
      return;
    }
    if (ch === '\b') {
      if (this.cx > 0) this.cx -= 1;
      return;
    }
    if (ch === '\t') {
      this.cx = Math.min(COLS - 1, (this.cx | 7) + 1);
      return;
    }
    if (ch === '\x07' || ch === '\x00' || ch === '\x0e' || ch === '\x0f') return;
    if (ch < ' ' && ch !== ' ') return;
    const glyph = this.decCharset ? (DEC_SPECIAL[ch] ?? ch) : ch;
    const row = this.grid[this.cy];
    if (row !== undefined && this.cx < COLS) row[this.cx] = { ch: glyph };
    if (this.cx === COLS - 1) {
      this.cx = 0;
      this.lineFeed();
    } else {
      this.cx += 1;
    }
  }

  private lineFeed(): void {
    if (this.cy === this.scrollBottom) {
      this.history.push(this.rowText(0));
      if (this.history.length > HISTORY_ROWS) this.history.splice(0, 500);
      this.grid.shift();
      this.grid.push(Array.from({ length: COLS }, blank));
      this.cy =
        Math.max(0, this.scrollBottom - 1) === this.scrollBottom - 1 ? this.scrollBottom : this.cy;
      this.cy = this.scrollBottom;
    } else if (this.cy < ROWS - 1) {
      this.cy += 1;
    }
  }

  private escape(ch: string): void {
    this.esc += ch;
    const seq = this.esc;
    if (seq.length > 64) {
      this.esc = '';
      return;
    }
    if (seq[1] === ']') {
      if (ch === '\x07' || seq.endsWith('\x1b\\')) this.esc = '';
      return;
    }
    if (seq[1] === '(' || seq[1] === ')') {
      if (seq.length === 3) {
        if (seq[1] === '(') this.decCharset = seq[2] === '0';
        this.esc = '';
      }
      return;
    }
    if (seq[1] !== '[') {
      this.simpleEscape(seq);
      return;
    }
    if (!/[A-Za-z@`~]/.test(ch)) return;
    this.csi(seq.slice(2, -1), ch);
    this.esc = '';
  }

  private simpleEscape(seq: string): void {
    if (seq === '\x1b7' || seq === '\x1bD') {
      if (seq === '\x1b7') this.saved = { cx: this.cx, cy: this.cy };
      else this.lineFeed();
    } else if (seq === '\x1b8') {
      this.cx = this.saved.cx;
      this.cy = this.saved.cy;
    } else if (seq === '\x1bM') {
      if (this.cy > 0) this.cy -= 1;
    } else if (seq === '\x1bc') {
      this.reset();
    } else if (seq === '\x1b=' || seq === '\x1b>') {
    } else if (seq.length > 1) {
      return;
    }
    this.esc = '';
  }

  private csi(param: string, final: string): void {
    const priv = param.startsWith('?');
    const nums = (priv ? param.slice(1) : param)
      .split(';')
      .map((value) => (value === '' ? 0 : Number(value)));
    const n = nums[0] ?? 0;
    if (priv) {
      if (final === 'h' || final === 'l') {
        if (nums.includes(1049) || nums.includes(47) || nums.includes(1047)) {
          if (final === 'h') {
            this.grid = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, blank));
          }
          this.cx = 0;
          this.cy = 0;
        }
      }
      return;
    }
    switch (final) {
      case 'A':
        this.cy = Math.max(0, this.cy - Math.max(1, n));
        break;
      case 'B':
      case 'e':
        this.cy = Math.min(ROWS - 1, this.cy + Math.max(1, n));
        break;
      case 'C':
      case 'a':
        this.cx = Math.min(COLS - 1, this.cx + Math.max(1, n));
        break;
      case 'D':
        this.cx = Math.max(0, this.cx - Math.max(1, n));
        break;
      case 'E':
        this.cy = Math.min(ROWS - 1, this.cy + Math.max(1, n));
        this.cx = 0;
        break;
      case 'F':
        this.cy = Math.max(0, this.cy - Math.max(1, n));
        this.cx = 0;
        break;
      case 'G':
      case '`':
        this.cx = Math.min(COLS - 1, Math.max(0, n - 1));
        break;
      case 'd':
        this.cy = Math.min(ROWS - 1, Math.max(0, n - 1));
        break;
      case 'H':
      case 'f':
        this.cy = Math.min(ROWS - 1, Math.max(0, n - 1));
        this.cx = Math.min(COLS - 1, Math.max(0, (nums[1] ?? 1) - 1));
        break;
      case 'J':
        if (n === 2 || n === 3) {
          this.grid = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, blank));
          if (n === 2) {
            this.cx = 0;
            this.cy = 0;
          }
        } else if (n === 0) {
          this.eraseInLine(0);
          for (let row = this.cy + 1; row < ROWS; row += 1)
            this.grid[row] = Array.from({ length: COLS }, blank);
        } else if (n === 1) {
          this.eraseInLine(1);
          for (let row = 0; row < this.cy; row += 1)
            this.grid[row] = Array.from({ length: COLS }, blank);
        }
        break;
      case 'K':
        this.eraseInLine(n);
        break;
      case 'L': {
        const count = Math.min(Math.max(1, n), ROWS - this.cy);
        for (let i = 0; i < count; i += 1)
          this.grid.splice(this.cy, 0, Array.from({ length: COLS }, blank));
        this.grid.length = ROWS;
        break;
      }
      case 'M': {
        const count = Math.min(Math.max(1, n), ROWS - this.cy);
        this.grid.splice(this.cy, count);
        while (this.grid.length < ROWS) this.grid.push(Array.from({ length: COLS }, blank));
        break;
      }
      case 'P': {
        const row = this.grid[this.cy];
        if (row !== undefined) {
          const count = Math.min(Math.max(1, n), COLS - this.cx);
          row.splice(this.cx, count, ...Array.from({ length: count }, blank));
          row.length = COLS;
        }
        break;
      }
      case 'X': {
        const row = this.grid[this.cy];
        if (row !== undefined) {
          for (let i = 0; i < Math.max(1, n) && this.cx + i < COLS; i += 1)
            row[this.cx + i] = blank();
        }
        break;
      }
      case 'S': {
        const count = Math.max(1, n);
        for (let i = 0; i < count; i += 1) {
          this.history.push(this.rowText(0));
          this.grid.shift();
          this.grid.push(Array.from({ length: COLS }, blank));
        }
        break;
      }
      case 'r':
        this.scrollBottom = Math.min(ROWS - 1, Math.max(0, (nums[1] ?? ROWS) - 1));
        this.cx = 0;
        this.cy = 0;
        break;
      case 's':
        this.saved = { cx: this.cx, cy: this.cy };
        break;
      case 'u':
        this.cx = this.saved.cx;
        this.cy = this.saved.cy;
        break;
      case 'm':
        break;
      default:
        break;
    }
  }

  private eraseInLine(mode: number): void {
    const row = this.grid[this.cy];
    if (row === undefined) return;
    if (mode === 0) {
      for (let col = this.cx; col < COLS; col += 1) row[col] = blank();
    } else if (mode === 1) {
      for (let col = 0; col <= this.cx; col += 1) row[col] = blank();
    } else {
      for (let col = 0; col < COLS; col += 1) row[col] = blank();
    }
  }

  private reset(): void {
    this.grid = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, blank));
    this.cx = 0;
    this.cy = 0;
    this.scrollBottom = ROWS - 1;
    this.version += 1;
  }

  private rowText(row: number): string {
    const cells = this.grid[row];
    if (cells === undefined) return '';
    return cells
      .map((cell) => cell.ch)
      .join('')
      .replace(/\s+$/, '');
  }

  text(): string {
    const rows = this.grid.map((_, row) => this.rowText(row));
    const last = rows.reduce((end, row, index) => (row === '' ? end : index), -1);
    return [...this.history, ...rows.slice(0, last + 1)].join('\n');
  }
}

export function keyToBytes(event: {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): string | null {
  const { key, ctrlKey, altKey, metaKey } = event;
  if (metaKey) return null;
  const alt = altKey ? '\x1b' : '';
  if (key.length === 1) {
    if (ctrlKey) {
      const code = key.toUpperCase().charCodeAt(0);
      if (code >= 64 && code <= 95) return String.fromCharCode(code - 64);
      return null;
    }
    return alt + key;
  }
  const named: Record<string, string> = {
    Enter: '\r',
    Backspace: '\x7f',
    Tab: event.shiftKey ? '\x1b[Z' : '\t',
    Escape: '\x1b',
    ArrowUp: '\x1b[A',
    ArrowDown: '\x1b[B',
    ArrowRight: '\x1b[C',
    ArrowLeft: '\x1b[D',
    Home: '\x1b[H',
    End: '\x1b[F',
    PageUp: '\x1b[5~',
    PageDown: '\x1b[6~',
    Delete: '\x1b[3~',
    Insert: '\x1b[2~',
  };
  const bytes = named[key];
  return bytes === undefined ? null : alt + bytes;
}
