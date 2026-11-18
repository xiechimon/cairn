import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../../scripts/test-tmpdir.mjs';
import {
  type AttachmentImageTextDeps,
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
    const result = await attachmentImageText({
      models: noVision,
      image,
      prepareImage,
      ocr: async () => '  three tasks listed  ',
      cache: new Map(),
    });
    expect(result.via).toBe('ocr');
    expect(result.text).toContain('OCR transcript');
    expect(result.text).toContain('shot.png');
    expect(result.text).toContain('three tasks listed');
  });

  it('says OCR found no text instead of claiming content', async () => {
    const result = await attachmentImageText({
      models: noVision,
      image,
      prepareImage,
      ocr: async () => '   ',
      cache: new Map(),
    });
    expect(result.via).toBe('ocr-empty');
    expect(result.text).toContain('found no text');
    expect(result.text).toContain('ask_user');
  });

  it('names the file and points at ask_user when nothing can read the image', async () => {
    const result = await attachmentImageText({
      models: noVision,
      image,
      prepareImage,
      ocr: async () => undefined,
      cache: new Map(),
    });
    expect(result.via).toBe('unreadable');
    expect(result.text).toContain('shot.png');
    expect(result.text).toContain('cannot see images');
    expect(result.text).toContain('ask_user');
  });

  it('reuses a cached extraction for identical bytes', async () => {
    const cache = new Map();
    let calls = 0;
    const ocr = async () => {
      calls += 1;
      return 'cached words';
    };
    const deps = { models: noVision, image, prepareImage, ocr, cache };
    const first = await attachmentImageText(deps);
    const second = await attachmentImageText(deps);
    expect(calls).toBe(1);
    expect(second.text).toBe(first.text);
    expect(second.via).toBe('ocr');
  });

  it('does not cache failed reads', async () => {
    const cache = new Map();
    let calls = 0;
    const deps = {
      models: noVision,
      image,
      prepareImage,
      ocr: async () => {
        calls += 1;
        return undefined;
      },
      cache,
    };
    await attachmentImageText(deps);
    await attachmentImageText(deps);
    expect(calls).toBe(2);
  });

  it('caches vision captions by image bytes', async () => {
    const cache = new Map();
    let calls = 0;
    const models = {
      getModels: () => [{ provider: 'v', id: 'vm', input: ['text', 'image'], cost: { input: 0 } }],
      completeSimple: async () => {
        calls += 1;
        return { stopReason: 'stop', content: [{ type: 'text', text: 'a panel' }] };
      },
    } as unknown as AttachmentImageTextDeps['models'];
    const deps = {
      models,
      image,
      prepareImage,
      ocr: async () => {
        throw new Error('ocr must not run');
      },
      cache,
    };
    const first = await attachmentImageText(deps);
    expect(first.via).toBe('caption');
    expect(first.attribution).toBe('v/vm');
    const second = await attachmentImageText(deps);
    expect(calls).toBe(1);
    expect(second.text).toBe(first.text);
  });
});
