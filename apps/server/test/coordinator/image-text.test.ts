import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../../scripts/test-tmpdir.mjs';
import {
  attachmentImageText,
  tesseractOcrRunner,
} from '../../src/coordinator/runtime/image-text.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) releaseTestTempDir(d);
});

function stubBin(script: string): string {
  const dir = makeTestTempDir('ocr-stub-');
  dirs.push(dir);
  const bin = join(dir, 'tesseract');
  writeFileSync(bin, script);
  chmodSync(bin, 0o755);
  return bin;
}

const image = {
  fileName: 'shot.png',
  mimeType: 'image/png',
  sizeBytes: 67,
  content: Buffer.from('png').toString('base64'),
};

describe('tesseractOcrRunner', () => {
  it('writes the image to a temp file and returns tesseract stdout', async () => {
    const bin = stubBin(
      '#!/bin/sh\nif [ "$1" = "--list-langs" ]; then\nprintf "List of available languages (2):\\neng\\nchi_sim\\n"\nelse\nprintf "ocr-stub-output"\nfi\n',
    );
    const text = await tesseractOcrRunner({ bin })(image);
    expect(text).toBe('ocr-stub-output');
  });

  it('passes only the preferred languages the binary reports', async () => {
    const bin = stubBin(
      '#!/bin/sh\nif [ "$1" = "--list-langs" ]; then\nprintf "List of available languages (1):\\neng\\n"\nelse\nprintf "args:%s" "$*"\nfi\n',
    );
    const text = await tesseractOcrRunner({ bin })(image);
    expect(text).toContain('-l eng');
    expect(text).not.toContain('chi_sim');
  });

  it('returns undefined when the binary is not installed', async () => {
    const text = await tesseractOcrRunner({ bin: '/nonexistent-tesseract-bin' })(image);
    expect(text).toBeUndefined();
  });

  it('returns undefined when tesseract fails on the image', async () => {
    const bin = stubBin(
      '#!/bin/sh\nif [ "$1" = "--list-langs" ]; then\nprintf "eng\\n"\nelse\nexit 1\nfi\n',
    );
    const text = await tesseractOcrRunner({ bin })(image);
    expect(text).toBeUndefined();
  });
});

describe('attachmentImageText', () => {
  const noVision = {
    getModels: () => [],
    completeSimple: async () => {
      throw new Error('unused');
    },
  };
  const prepareImage = async (data: string, mimeType: string) =>
    ({ type: 'image', data, mimeType }) as const;

  it('labels OCR output as machine transcription', async () => {
    const text = await attachmentImageText({
      models: noVision,
      image,
      prepareImage,
      ocr: async () => '  three tasks listed  ',
    });
    expect(text).toContain('OCR transcript');
    expect(text).toContain('shot.png');
    expect(text).toContain('three tasks listed');
  });

  it('says OCR found no text instead of claiming content', async () => {
    const text = await attachmentImageText({
      models: noVision,
      image,
      prepareImage,
      ocr: async () => '   ',
    });
    expect(text).toContain('found no text');
    expect(text).toContain('ask_user');
  });

  it('names the file and points at ask_user when nothing can read the image', async () => {
    const text = await attachmentImageText({
      models: noVision,
      image,
      prepareImage,
      ocr: async () => undefined,
    });
    expect(text).toContain('shot.png');
    expect(text).toContain('cannot see images');
    expect(text).toContain('ask_user');
  });
});
