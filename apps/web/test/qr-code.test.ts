import { describe, expect, test } from 'vitest';
import { encodeQr, qrPathData } from '../src/lib/qr-code.js';
import { QR_REFERENCE_CASES } from './qr-reference-cases.js';

const rowsOf = (text: string, mask?: number): string[] =>
  encodeQr(text, mask).modules.map((row) => row.map((dark) => (dark ? '1' : '0')).join(''));

describe('qr encoder: with the right mask, every module equals libqrencode output at level M', () => {
  test.each(QR_REFERENCE_CASES.map((c) => [c.text.slice(0, 24), c] as const))(
    'byte-mode case %s',
    (_label, reference) => {
      const masks = [0, 1, 2, 3, 4, 5, 6, 7];
      const matching = masks.filter(
        (mask) => rowsOf(reference.text, mask).join() === reference.rows.join(),
      );
      expect(matching).toHaveLength(1);
    },
  );
});

describe('qr encoder limits', () => {
  test('text beyond version 10 is refused instead of truncated', () => {
    expect(() => encodeQr('z'.repeat(400))).toThrow(RangeError);
  });

  test('multi-byte text is encoded as UTF-8 bytes', () => {
    const matrix = encodeQr('配对');
    expect(matrix.size).toBe(21);
  });

  test('the path draws only dark modules', () => {
    const matrix = encodeQr('hello');
    const dark = matrix.modules.flat().filter(Boolean).length;
    const drawn = [...qrPathData(matrix).matchAll(/h(\d+)v1/g)].reduce(
      (sum, match) => sum + Number(match[1]),
      0,
    );
    expect(drawn).toBe(dark);
  });
});
