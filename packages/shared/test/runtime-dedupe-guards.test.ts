import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');

function readRepo(relPath: string): string {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

describe('runtime and server service deduplication guards', () => {
  test('server and daemon OTel share createTracingPool and otelJsonText from @cairn/shared/otel', () => {
    for (const rel of ['apps/server/src/runtime-otel.ts', 'apps/daemon/src/backend/otel.ts']) {
      const source = readRepo(rel);
      expect(source, rel).not.toMatch(/function\s+jsonText\s*\(/);
      expect(source, rel).not.toContain('new Map<string, CairnTracing>()');
      expect(source, rel).toContain('createTracingPool');
      expect(source, rel).toContain('otelJsonText');
    }
  });

  test('daemon and coordinator image-text share caption prompt and model ranking from @cairn/shared', () => {
    for (const rel of [
      'apps/daemon/src/backend/image-text.ts',
      'apps/server/src/coordinator/runtime/image-text.ts',
    ]) {
      const source = readRepo(rel);
      expect(source, rel).not.toContain('Transcribe all visible text verbatim');
      expect(source, rel).toContain('rankImageCaptionModels');
      expect(source, rel).toContain('extractCaptionReplyText');
    }
  });

  test('coordinator models and daemon pi share stream retry helpers from @cairn/shared', () => {
    for (const rel of [
      'apps/server/src/coordinator/runtime/models.ts',
      'apps/daemon/src/backend/pi.ts',
    ]) {
      const source = readRepo(rel);
      expect(source, rel).not.toMatch(/function\s+carriesContent\s*\(/);
      expect(source, rel).toContain('pipeStreamRetriedBeforeContent');
    }
  });

  test('codex and xai device login services share device-login-helpers.ts', () => {
    for (const rel of [
      'apps/server/src/services/codex-device-login.ts',
      'apps/server/src/services/xai-device-login.ts',
    ]) {
      const source = readRepo(rel);
      expect(source, rel).not.toMatch(/function\s+refreshInflightOf\s*\(/);
      expect(source, rel).not.toMatch(/function\s+sweep\s*\(/);
      expect(source, rel).not.toMatch(/function\s+ownState\s*\(/);
      expect(source, rel).toContain("from './device-login-helpers.js'");
    }
  });

  test('slack and telegram adapters share classifyHttpSendError from im/errors.ts', () => {
    for (const rel of [
      'apps/server/src/services/im/slack.ts',
      'apps/server/src/services/im/telegram.ts',
    ]) {
      const source = readRepo(rel);
      expect(source, rel).toContain('classifyHttpSendError');
    }
  });
});
