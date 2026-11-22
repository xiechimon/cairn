import { deflateRawSync } from 'node:zlib';
import { expect, test } from 'vitest';
import { readZipEntryText, type ZipEntry } from '../src/vendor-open-design/zip-entries.js';

function zipEntry(method: number, text: string): { buffer: Buffer; entry: ZipEntry } {
  const bytes = Buffer.from(text);
  const raw = method === 8 ? deflateRawSync(bytes) : bytes;
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50);
  return {
    buffer: Buffer.concat([header, raw]),
    entry: {
      name: 'section.xml',
      method,
      compressedSize: raw.length,
      uncompressedSize: bytes.length,
      localHeaderOffset: 0,
    },
  };
}

test.each([0, 8])('charges each ZIP entry read to the shared byte budget (method %i)', (method) => {
  const text = '<t>Résumé</t>';
  const size = Buffer.byteLength(text);
  const budget = { maxEntryBytes: size, remainingBytes: size * 2 - 1 };
  const { buffer, entry } = zipEntry(method, text);

  expect(readZipEntryText(buffer, entry, budget)).toBe(text);
  expect(budget.remainingBytes).toBe(size - 1);
  expect(() => readZipEntryText(buffer, entry, budget)).toThrow(
    expect.objectContaining({ statusCode: 413 }),
  );
});

test('accepts an empty DEFLATE entry with no output budget left', () => {
  const { buffer, entry } = zipEntry(8, '');
  const budget = { maxEntryBytes: 4, remainingBytes: 0 };
  expect(readZipEntryText(buffer, entry, budget)).toBe('');
  expect(budget.remainingBytes).toBe(0);
});
