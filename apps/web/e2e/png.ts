import { inflateSync } from 'node:zlib';

/**
 * Minimal PNG decoder for screenshot pixel probes (#391). Handles exactly
 * what Chromium's page.screenshot() emits — 8-bit RGB/RGBA, non-interlaced —
 * and throws on anything else so an encoder change fails loud instead of
 * feeding garbage pixels into geometry assertions.
 */
export interface DecodedPng {
  readonly width: number;
  readonly height: number;
  /** rgb triplet at (x, y); origin top-left */
  px(x: number, y: number): [number, number, number];
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

export function decodePng(buf: Buffer): DecodedPng {
  const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (buf[i] !== SIGNATURE[i]) throw new Error('decodePng: bad signature');
  }
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Buffer[] = [];
  let offset = SIGNATURE.length;
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      const colorType = data[9];
      const interlace = data[12];
      if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || interlace !== 0) {
        throw new Error(
          `decodePng: unsupported format (bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace})`,
        );
      }
      channels = colorType === 6 ? 4 : 3;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  if (width === 0 || height === 0 || channels === 0 || idat.length === 0) {
    throw new Error('decodePng: missing IHDR or IDAT');
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const rowStart = y * (stride + 1) + 1;
    const outStart = y * stride;
    for (let x = 0; x < stride; x++) {
      const cur = raw[rowStart + x];
      const left = x >= channels ? pixels[outStart + x - channels] : 0;
      const up = y > 0 ? pixels[outStart + x - stride] : 0;
      const upLeft = y > 0 && x >= channels ? pixels[outStart + x - stride - channels] : 0;
      let value: number;
      switch (filter) {
        case 0:
          value = cur;
          break;
        case 1:
          value = cur + left;
          break;
        case 2:
          value = cur + up;
          break;
        case 3:
          value = cur + ((left + up) >> 1);
          break;
        case 4:
          value = cur + paethPredictor(left, up, upLeft);
          break;
        default:
          throw new Error(`decodePng: unknown row filter ${filter}`);
      }
      pixels[outStart + x] = value & 0xff;
    }
  }
  return {
    width,
    height,
    px(x, y) {
      const base = (y * width + x) * channels;
      return [pixels[base], pixels[base + 1], pixels[base + 2]];
    },
  };
}

/** Mean Rec. 709 luma over the pixel rect [x0,x1) × [y0,y1), rounded in and
 *  clamped to the image bounds. Averaging a strip keeps rasterizer sub-pixel
 *  noise well under a luma step. */
export function stripLuma(
  img: DecodedPng,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const cx0 = Math.max(0, Math.round(x0));
  const cy0 = Math.max(0, Math.round(y0));
  const cx1 = Math.min(img.width, Math.round(x1));
  const cy1 = Math.min(img.height, Math.round(y1));
  if (cx1 <= cx0 || cy1 <= cy0) {
    throw new Error(`stripLuma: empty strip [${cx0},${cy0})–[${cx1},${cy1})`);
  }
  let sum = 0;
  let count = 0;
  for (let y = cy0; y < cy1; y++) {
    for (let x = cx0; x < cx1; x++) {
      const [r, g, b] = img.px(x, y);
      sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      count++;
    }
  }
  return sum / count;
}
