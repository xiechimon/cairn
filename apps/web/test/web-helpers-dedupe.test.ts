import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const WEB_SRC = join(import.meta.dirname, '..', 'src');

function readWeb(relPath: string): string {
  return readFileSync(join(WEB_SRC, relPath), 'utf8');
}

describe('web helper deduplication guards', () => {
  test('interval clock hooks reuse hooks/use-interval-now.ts', () => {
    for (const rel of [
      'overlay/token-gate.tsx',
      'chief/memory-edit-composer.tsx',
      'chief/takeover-card.tsx',
    ]) {
      const source = readWeb(rel);
      expect(source, rel).not.toMatch(/function\s+use(?:Clock|Now)\s*\(/);
      expect(source, rel).toContain("from '../hooks/use-interval-now.js'");
    }
    expect(readWeb('chief/context-meter-ring.tsx')).not.toMatch(/function\s+use(?:Clock|Now)\s*\(/);
  });

  test('baseName and dirName live only in lib/path-name.ts', () => {
    for (const rel of ['board/side-chat.tsx', 'pages/dir-browser.tsx']) {
      const source = readWeb(rel);
      expect(source, rel).not.toMatch(/function\s+baseName\s*\(/);
      expect(source, rel).toContain("from '../lib/path-name.js'");
    }
    expect(readWeb('detail/docpane.tsx')).not.toMatch(/function\s+baseName\s*\(/);
  });

  test('clockTime formatters delegate to formatClockTime in lib/date-format.ts', () => {
    for (const rel of [
      'lib/message-time.ts',
      'board/thread-panel-model.ts',
      'api/mappers.ts',
    ]) {
      const source = readWeb(rel);
      expect(source, rel).toContain('formatClockTime');
    }
    expect(readWeb('lib/message-time.ts')).not.toMatch(/function\s+clockTime\s*\(/);
  });

  test('GitHub device dialogs share polling and ended-copy helpers from lib/github-device-flow.ts', () => {
    for (const rel of [
      'pages/github-connection-device-dialog.tsx',
      'resources/mcp-github-device-dialog.tsx',
    ]) {
      const source = readWeb(rel);
      expect(source, rel).toContain("from '../lib/github-device-flow.js'");
      expect(source, rel).toContain('useGithubDevicePoll');
      expect(source, rel).toContain('githubDeviceEndedCopy');
    }
  });
});
