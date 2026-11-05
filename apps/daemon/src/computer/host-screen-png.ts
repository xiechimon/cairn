import { crc32, deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_PIXELS = 16_777_216;
const MAX_DECODED_BYTES = MAX_PIXELS * 4 + 16_384;
const CHANNELS: Readonly<Record<number, number>> = { 2: 3, 6: 4 };

export interface ScaledPng {
  png: Buffer;
  width: number;
  height: number;
}

interface Decoded {
  width: number;
  height: number;
  colorType: number;
  channels: number;
  pixels: Buffer;
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const distanceLeft = Math.abs(estimate - left);
  const distanceUp = Math.abs(estimate - up);
  const distanceUpLeft = Math.abs(estimate - upLeft);
  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) return left;
  return distanceUp <= distanceUpLeft ? up : upLeft;
}

function unfilter(
  raw: Buffer,
  width: number,
  height: number,
  channels: number,
): Buffer | undefined {
  const stride = width * channels;
  if (raw.length !== (stride + 1) * height) return undefined;
  const pixels = Buffer.alloc(stride * height);
  for (let row = 0; row < height; row += 1) {
    const filter = raw[row * (stride + 1)];
    const source = row * (stride + 1) + 1;
    const target = row * stride;
    for (let index = 0; index < stride; index += 1) {
      const left = index >= channels ? (pixels[target + index - channels] ?? 0) : 0;
      const up = row > 0 ? (pixels[target - stride + index] ?? 0) : 0;
      const upLeft =
        row > 0 && index >= channels ? (pixels[target - stride + index - channels] ?? 0) : 0;
      const value = raw[source + index] ?? 0;
      let predicted: number;
      if (filter === 0) predicted = 0;
      else if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) predicted = paeth(left, up, upLeft);
      else return undefined;
      pixels[target + index] = (value + predicted) & 0xff;
    }
  }
  return pixels;
}

function decode(png: Buffer): Decoded | undefined {
  if (png.length < 33 || !png.subarray(0, 8).equals(SIGNATURE)) return undefined;
  let header: { width: number; height: number; colorType: number } | undefined;
  const data: Buffer[] = [];
  let offset = 8;
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('latin1', offset + 4, offset + 8);
    const body = png.subarray(offset + 8, offset + 8 + length);
    if (body.length !== length) return undefined;
    if (type === 'IHDR') {
      if (length !== 13 || body[8] !== 8 || body[12] !== 0) return undefined;
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        colorType: body[9] ?? 0,
      };
    } else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  const channels = header ? CHANNELS[header.colorType] : undefined;
  if (
    !header ||
    channels === undefined ||
    header.width === 0 ||
    header.height === 0 ||
    header.width * header.height > MAX_PIXELS
  ) {
    return undefined;
  }
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(data), { maxOutputLength: MAX_DECODED_BYTES });
  } catch {
    return undefined;
  }
  const pixels = unfilter(raw, header.width, header.height, channels);
  return pixels ? { ...header, channels, pixels } : undefined;
}

function chunk(type: string, body: Buffer): Buffer {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 'latin1');
  body.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

export function encodePng(width: number, height: number, colorType: 2 | 6, pixels: Buffer): Buffer {
  const channels = CHANNELS[colorType] ?? 3;
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let row = 0; row < height; row += 1) {
    pixels.copy(raw, row * (stride + 1) + 1, row * stride, (row + 1) * stride);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = colorType;
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function pngSize(png: Buffer): { width: number; height: number } | undefined {
  if (png.length < 24 || !png.subarray(0, 8).equals(SIGNATURE)) return undefined;
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

export function fitPng(png: Buffer, maxEdge: number): ScaledPng | undefined {
  const decoded = decode(png);
  if (!decoded) return undefined;
  const { width, height, channels, pixels } = decoded;
  const factor = Math.min(1, maxEdge / Math.max(width, height));
  if (factor === 1) return { png, width, height };
  const targetWidth = Math.max(1, Math.round(width * factor));
  const targetHeight = Math.max(1, Math.round(height * factor));
  const out = Buffer.alloc(targetWidth * targetHeight * channels);
  for (let y = 0; y < targetHeight; y += 1) {
    const fromY = Math.floor((y * height) / targetHeight);
    const toY = Math.max(fromY + 1, Math.floor(((y + 1) * height) / targetHeight));
    for (let x = 0; x < targetWidth; x += 1) {
      const fromX = Math.floor((x * width) / targetWidth);
      const toX = Math.max(fromX + 1, Math.floor(((x + 1) * width) / targetWidth));
      const sums = new Array<number>(channels).fill(0);
      for (let sy = fromY; sy < toY; sy += 1) {
        for (let sx = fromX; sx < toX; sx += 1) {
          for (let channel = 0; channel < channels; channel += 1) {
            sums[channel] =
              (sums[channel] ?? 0) + (pixels[(sy * width + sx) * channels + channel] ?? 0);
          }
        }
      }
      const count = (toY - fromY) * (toX - fromX);
      for (let channel = 0; channel < channels; channel += 1) {
        out[(y * targetWidth + x) * channels + channel] = Math.round((sums[channel] ?? 0) / count);
      }
    }
  }
  return {
    png: encodePng(targetWidth, targetHeight, decoded.colorType as 2 | 6, out),
    width: targetWidth,
    height: targetHeight,
  };
}
