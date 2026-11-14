import { crc32, deflateSync, inflateSync } from 'node:zlib';

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function encodePng({ width, height, pixels }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1)
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('not a PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  let bytes = 1;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const [depth, colorType, , , interlace] = data.subarray(8);
      channels = { 2: 3, 6: 4 }[colorType] ?? 0;
      bytes = depth / 8;
      if ((depth !== 8 && depth !== 16) || channels === 0 || interlace !== 0)
        throw new Error(`unsupported PNG: depth ${depth}, color type ${colorType}`);
    }
    if (type === 'IDAT') idat.push(data);
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const pixelBytes = channels * bytes;
  const stride = width * pixelBytes;
  const rows = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x += 1) {
      const value = raw[y * (stride + 1) + 1 + x];
      const left = x >= pixelBytes ? rows[y * stride + x - pixelBytes] : 0;
      const up = y > 0 ? rows[(y - 1) * stride + x] : 0;
      const upLeft = x >= pixelBytes && y > 0 ? rows[(y - 1) * stride + x - pixelBytes] : 0;
      const predicted = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][filter];
      rows[y * stride + x] = (value + predicted) & 255;
    }
  }
  const pixels = Buffer.alloc(width * height * 4, 255);
  for (let p = 0; p < width * height; p += 1)
    for (let c = 0; c < channels; c += 1) pixels[p * 4 + c] = rows[(p * channels + c) * bytes];
  return { width, height, pixels };
}

export function encodeIcns(entries) {
  const parts = entries.map(([type, png]) => {
    const head = Buffer.alloc(8);
    head.write(type, 0, 'ascii');
    head.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([head, png]);
  });
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'ascii');
  head.writeUInt32BE(8 + parts.reduce((sum, part) => sum + part.length, 0), 4);
  return Buffer.concat([head, ...parts]);
}

export function decodeIcns(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'icns') throw new Error('not an icns file');
  const entries = [];
  for (let offset = 8; offset < buffer.length; ) {
    const length = buffer.readUInt32BE(offset + 4);
    entries.push([
      buffer.toString('ascii', offset, offset + 4),
      buffer.subarray(offset + 8, offset + length),
    ]);
    offset += length;
  }
  return entries;
}
