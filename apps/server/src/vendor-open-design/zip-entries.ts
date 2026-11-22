import { inflateRawSync } from 'node:zlib';

export class ZipReadError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'ZipReadError';
  }
}

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

export interface ZipReadBudget {
  maxEntryBytes: number;
  remainingBytes: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

function findEndOfCentralDirectory(buffer: Buffer): number {
  const floor = Math.max(0, buffer.length - 0xffff - 22);
  for (let at = buffer.length - 22; at >= floor; at -= 1) {
    if (buffer.readUInt32LE(at) === EOCD_SIGNATURE) return at;
  }
  throw new ZipReadError('not a zip archive', 415);
}

export function readZipEntries(buffer: Buffer): Map<string, ZipEntry> {
  if (buffer.length < 22) throw new ZipReadError('not a zip archive', 415);
  const eocd = findEndOfCentralDirectory(buffer);
  const count = buffer.readUInt16LE(eocd + 10);
  let at = buffer.readUInt32LE(eocd + 16);
  const entries = new Map<string, ZipEntry>();
  for (let i = 0; i < count; i += 1) {
    if (at + 46 > buffer.length || buffer.readUInt32LE(at) !== CENTRAL_SIGNATURE) {
      throw new ZipReadError('corrupt zip directory', 415);
    }
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const name = buffer.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    entries.set(name, {
      name,
      method: buffer.readUInt16LE(at + 10),
      compressedSize: buffer.readUInt32LE(at + 20),
      uncompressedSize: buffer.readUInt32LE(at + 24),
      localHeaderOffset: buffer.readUInt32LE(at + 42),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function readZipEntryText(buffer: Buffer, entry: ZipEntry, budget: ZipReadBudget): string {
  const limit = Math.min(budget.maxEntryBytes, budget.remainingBytes);
  if (entry.uncompressedSize > limit) {
    throw new ZipReadError('document section too large to preview', 413);
  }
  const at = entry.localHeaderOffset;
  if (at + 30 > buffer.length || buffer.readUInt32LE(at) !== LOCAL_SIGNATURE) {
    throw new ZipReadError('corrupt zip entry', 415);
  }
  const start = at + 30 + buffer.readUInt16LE(at + 26) + buffer.readUInt16LE(at + 28);
  const end = start + entry.compressedSize;
  if (end > buffer.length) throw new ZipReadError('corrupt zip entry', 415);
  const raw = buffer.subarray(start, end);
  let decoded: Buffer;
  if (entry.method === 0) {
    decoded = raw;
  } else if (entry.method === 8) {
    decoded = inflateRawSync(raw, { maxOutputLength: Math.max(1, entry.uncompressedSize) });
  } else {
    throw new ZipReadError('unsupported zip compression', 415);
  }
  if (decoded.byteLength > limit) {
    throw new ZipReadError('document section too large to preview', 413);
  }
  if (decoded.byteLength !== entry.uncompressedSize) {
    throw new ZipReadError('corrupt zip entry', 415);
  }
  budget.remainingBytes -= decoded.byteLength;
  return decoded.toString('utf8');
}
