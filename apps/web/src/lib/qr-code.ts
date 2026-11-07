const MIN_VERSION = 1;
const MAX_VERSION = 10;
const ECC_CODEWORDS_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const ERROR_CORRECTION_BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const PAD_BYTES = [0xec, 0x11];
const BYTE_MODE = 0b0100;
const MEDIUM_FORMAT_BITS = 0b00;
const PENALTY_RUN = 3;
const PENALTY_BLOCK = 3;
const PENALTY_FINDER = 40;
const PENALTY_BALANCE = 10;
const MASK_COUNT = 8;

export interface QrMatrix {
  size: number;
  modules: boolean[][];
}

function bit(value: number, index: number): boolean {
  return ((value >>> index) & 1) !== 0;
}

function rawModuleCount(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const aligns = Math.floor(version / 7) + 2;
    result -= (25 * aligns - 10) * aligns - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

function dataCodewordCapacity(version: number): number {
  return (
    Math.floor(rawModuleCount(version) / 8) -
    (ECC_CODEWORDS_PER_BLOCK[version] ?? 0) * (ERROR_CORRECTION_BLOCKS[version] ?? 0)
  );
}

function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const size = version * 4 + 17;
  const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const result = [6];
  for (let position = size - 7; result.length < count; position -= step) {
    result.splice(1, 0, position);
  }
  return result;
}

function gfMultiply(x: number, y: number): number {
  let product = 0;
  for (let i = 7; i >= 0; i--) {
    product = (product << 1) ^ ((product >>> 7) * 0x11d);
    product ^= ((y >>> i) & 1) * x;
  }
  return product;
}

function reedSolomonDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j] ?? 0, root);
      if (j + 1 < result.length) result[j] = (result[j] ?? 0) ^ (result[j + 1] ?? 0);
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function reedSolomonRemainder(data: number[], divisor: number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ (result.shift() ?? 0);
    result.push(0);
    divisor.forEach((coefficient, i) => {
      result[i] = (result[i] ?? 0) ^ gfMultiply(coefficient, factor);
    });
  }
  return result;
}

function chooseVersion(byteLength: number): number {
  for (let version = MIN_VERSION; version <= MAX_VERSION; version++) {
    const countBits = version < 10 ? 8 : 16;
    if (4 + countBits + byteLength * 8 <= dataCodewordCapacity(version) * 8) return version;
  }
  throw new RangeError(`text of ${byteLength} bytes does not fit a version ${MAX_VERSION} code`);
}

function dataCodewords(bytes: Uint8Array, version: number): number[] {
  const bits: number[] = [];
  const push = (value: number, length: number): void => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(BYTE_MODE, 4);
  push(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) push(byte, 8);
  const capacityBits = dataCodewordCapacity(version) * 8;
  push(0, Math.min(4, capacityBits - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    codewords.push(bits.slice(i, i + 8).reduce((acc, b) => (acc << 1) | b, 0));
  }
  for (let pad = 0; codewords.length < dataCodewordCapacity(version); pad++) {
    codewords.push(PAD_BYTES[pad % 2] ?? 0);
  }
  return codewords;
}

function interleave(data: number[], version: number): number[] {
  const blocks = ERROR_CORRECTION_BLOCKS[version] ?? 1;
  const eccLength = ECC_CODEWORDS_PER_BLOCK[version] ?? 0;
  const rawCodewords = Math.floor(rawModuleCount(version) / 8);
  const shortBlocks = blocks - (rawCodewords % blocks);
  const shortLength = Math.floor(rawCodewords / blocks);
  const divisor = reedSolomonDivisor(eccLength);
  const dataBlocks: number[][] = [];
  const eccBlocks: number[][] = [];
  for (let i = 0, offset = 0; i < blocks; i++) {
    const length = shortLength - eccLength + (i < shortBlocks ? 0 : 1);
    const chunk = data.slice(offset, offset + length);
    offset += length;
    dataBlocks.push(chunk);
    eccBlocks.push(reedSolomonRemainder(chunk, divisor));
  }
  const result: number[] = [];
  const longest = Math.max(...dataBlocks.map((block) => block.length));
  for (let i = 0; i < longest; i++) {
    for (const block of dataBlocks) {
      const value = block[i];
      if (value !== undefined) result.push(value);
    }
  }
  for (let i = 0; i < eccLength; i++) {
    for (const block of eccBlocks) result.push(block[i] ?? 0);
  }
  return result;
}

class Canvas {
  readonly modules: boolean[][];
  readonly isFunction: boolean[][];

  constructor(
    readonly size: number,
    readonly version: number,
  ) {
    this.modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
    this.isFunction = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
    this.drawFunctionPatterns();
  }

  private setFunction(x: number, y: number, dark: boolean): void {
    const row = this.modules[y];
    const flags = this.isFunction[y];
    if (row === undefined || flags === undefined) return;
    row[x] = dark;
    flags[x] = true;
  }

  private drawFinder(cx: number, cy: number): void {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < this.size && y >= 0 && y < this.size) {
          this.setFunction(x, y, distance !== 2 && distance !== 4);
        }
      }
    }
  }

  private drawAlignment(cx: number, cy: number): void {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        this.setFunction(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  private drawFunctionPatterns(): void {
    for (let i = 0; i < this.size; i++) {
      this.setFunction(6, i, i % 2 === 0);
      this.setFunction(i, 6, i % 2 === 0);
    }
    this.drawFinder(3, 3);
    this.drawFinder(this.size - 4, 3);
    this.drawFinder(3, this.size - 4);
    const positions = alignmentPositions(this.version);
    const last = positions.length - 1;
    positions.forEach((cx, i) => {
      positions.forEach((cy, j) => {
        const corner = (i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0);
        if (!corner) this.drawAlignment(cx, cy);
      });
    });
    this.drawFormat(0);
    this.drawVersion();
  }

  drawFormat(mask: number): void {
    const data = (MEDIUM_FORMAT_BITS << 3) | mask;
    let remainder = data;
    for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
    const bits = ((data << 10) | remainder) ^ 0x5412;
    for (let i = 0; i <= 5; i++) this.setFunction(8, i, bit(bits, i));
    this.setFunction(8, 7, bit(bits, 6));
    this.setFunction(8, 8, bit(bits, 7));
    this.setFunction(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i++) this.setFunction(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i++) this.setFunction(this.size - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i++) this.setFunction(8, this.size - 15 + i, bit(bits, i));
    this.setFunction(8, this.size - 8, true);
  }

  private drawVersion(): void {
    if (this.version < 7) return;
    let remainder = this.version;
    for (let i = 0; i < 12; i++) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
    const bits = (this.version << 12) | remainder;
    for (let i = 0; i < 18; i++) {
      const dark = bit(bits, i);
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFunction(a, b, dark);
      this.setFunction(b, a, dark);
    }
  }

  drawCodewords(codewords: number[]): void {
    let index = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < this.size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vert : vert;
          if (this.isFunction[y]?.[x] === false && index < codewords.length * 8) {
            const row = this.modules[y];
            if (row !== undefined) row[x] = bit(codewords[index >>> 3] ?? 0, 7 - (index & 7));
            index++;
          }
        }
      }
    }
  }

  applyMask(mask: number): void {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        let invert: boolean;
        switch (mask) {
          case 0:
            invert = (x + y) % 2 === 0;
            break;
          case 1:
            invert = y % 2 === 0;
            break;
          case 2:
            invert = x % 3 === 0;
            break;
          case 3:
            invert = (x + y) % 3 === 0;
            break;
          case 4:
            invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
            break;
          case 5:
            invert = ((x * y) % 2) + ((x * y) % 3) === 0;
            break;
          case 6:
            invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
            break;
          default:
            invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
        }
        const row = this.modules[y];
        if (row !== undefined && this.isFunction[y]?.[x] === false && invert) row[x] = !row[x];
      }
    }
  }

  private finderPenaltyAdd(runLength: number, history: number[]): void {
    const length = history[0] === 0 ? runLength + this.size : runLength;
    history.pop();
    history.unshift(length);
  }

  private finderPenaltyCount(history: number[]): number {
    const n = history[1] ?? 0;
    const core =
      n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n;
    return (
      Number(core && (history[0] ?? 0) >= n * 4 && (history[6] ?? 0) >= n) +
      Number(core && (history[6] ?? 0) >= n * 4 && (history[0] ?? 0) >= n)
    );
  }

  private finderPenaltyTerminate(color: boolean, runLength: number, history: number[]): number {
    let length = runLength;
    if (color) {
      this.finderPenaltyAdd(length, history);
      length = 0;
    }
    this.finderPenaltyAdd(length + this.size, history);
    return this.finderPenaltyCount(history);
  }

  private linePenalty(read: (major: number, minor: number) => boolean): number {
    let result = 0;
    for (let major = 0; major < this.size; major++) {
      let runColor = false;
      let runLength = 0;
      const history = new Array<number>(7).fill(0);
      for (let minor = 0; minor < this.size; minor++) {
        if (read(major, minor) === runColor) {
          runLength++;
          if (runLength === 5) result += PENALTY_RUN;
          else if (runLength > 5) result++;
        } else {
          this.finderPenaltyAdd(runLength, history);
          if (!runColor) result += this.finderPenaltyCount(history) * PENALTY_FINDER;
          runColor = read(major, minor);
          runLength = 1;
        }
      }
      result += this.finderPenaltyTerminate(runColor, runLength, history) * PENALTY_FINDER;
    }
    return result;
  }

  penalty(): number {
    const at = (x: number, y: number): boolean => this.modules[y]?.[x] === true;
    let result = this.linePenalty((y, x) => at(x, y)) + this.linePenalty((x, y) => at(x, y));
    let dark = 0;
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (at(x, y)) dark++;
        if (
          x < this.size - 1 &&
          y < this.size - 1 &&
          at(x, y) === at(x + 1, y) &&
          at(x, y) === at(x, y + 1) &&
          at(x, y) === at(x + 1, y + 1)
        ) {
          result += PENALTY_BLOCK;
        }
      }
    }
    const total = this.size * this.size;
    result += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * PENALTY_BALANCE;
    return result;
  }
}

export function encodeQr(text: string, forcedMask?: number): QrMatrix {
  const bytes = new TextEncoder().encode(text);
  const version = chooseVersion(bytes.length);
  const size = version * 4 + 17;
  const codewords = interleave(dataCodewords(bytes, version), version);
  let best: Canvas | null = null;
  let bestPenalty = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < MASK_COUNT; mask++) {
    if (forcedMask !== undefined && mask !== forcedMask) continue;
    const canvas = new Canvas(size, version);
    canvas.drawCodewords(codewords);
    canvas.applyMask(mask);
    canvas.drawFormat(mask);
    const penalty = canvas.penalty();
    if (penalty < bestPenalty) {
      best = canvas;
      bestPenalty = penalty;
    }
  }
  if (best === null) throw new Error('no mask evaluated');
  return { size, modules: best.modules };
}

export function qrPathData(matrix: QrMatrix): string {
  const parts: string[] = [];
  matrix.modules.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (row[x] !== true) {
        x++;
        continue;
      }
      let end = x;
      while (row[end] === true) end++;
      parts.push(`M${x} ${y}h${end - x}v1h-${end - x}z`);
      x = end;
    }
  });
  return parts.join('');
}
