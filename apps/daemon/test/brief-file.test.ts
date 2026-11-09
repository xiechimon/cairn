import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { composeBrief } from '../src/brief-file.js';
import { testTempDir } from './test-temp-dir.js';

describe('in-memory runtime guidance', () => {
  test.each(['pi', 'claude-code', 'gemini'] as const)(
    '%s never creates a context file',
    (backendId) => {
      const cwd = testTempDir('cairn-brief-');
      expect(composeBrief({ cwd, backendId, content: 'runtime-memory' })).toBe('runtime-memory');
      expect(readdirSync(cwd)).toEqual([]);
    },
  );

  test('Claude receives AGENTS.md fallback without creating CLAUDE.md', () => {
    const cwd = testTempDir('cairn-brief-');
    writeFileSync(join(cwd, 'AGENTS.md'), 'repository guidance\n');
    for (const content of ['first-memory', 'second-memory']) {
      expect(composeBrief({ cwd, backendId: 'claude-code', content })).toBe(
        `repository guidance\n\n${content}`,
      );
      expect(readFileSync(join(cwd, 'AGENTS.md'), 'utf8')).toBe('repository guidance\n');
      expect(readdirSync(cwd)).toEqual(['AGENTS.md']);
    }
  });

  test('native CLAUDE.md guidance is left to the SDK without duplicating AGENTS.md', () => {
    const cwd = testTempDir('cairn-brief-');
    writeFileSync(join(cwd, 'AGENTS.md'), 'agents guidance\n');
    writeFileSync(join(cwd, 'CLAUDE.md'), 'claude guidance\n');
    expect(composeBrief({ cwd, backendId: 'claude-code', content: 'runtime' })).toBe('runtime');
    expect(readFileSync(join(cwd, 'AGENTS.md'), 'utf8')).toBe('agents guidance\n');
    expect(readFileSync(join(cwd, 'CLAUDE.md'), 'utf8')).toBe('claude guidance\n');
  });
});
