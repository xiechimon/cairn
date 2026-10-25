import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
// macOS spawn cwd is symlink-resolved; transcript slug must match or resume misses.
import { sdkTranscriptPath } from '../src/backend/claude-code.js';

function cliProjectSlug(resolved: string): string {
  const flat = resolved.replace(/[^a-zA-Z0-9]/g, '-');
  if (flat.length <= 200) return flat;
  let hash = 0;
  for (let i = 0; i < resolved.length; i++) {
    hash = ((hash << 5) - hash + resolved.charCodeAt(i)) | 0;
  }
  return `${flat.slice(0, 200)}-${Math.abs(hash).toString(36)}`;
}

describe('sdkTranscriptPath path resolution (A7 resume preflight)', () => {
  test('failure mode 10: slug of a symlinked cwd = slug of the real path', () => {
    const real = mkdtempSync(join(tmpdir(), 'cairn-cc-path-'));
    const link = join(tmpdir(), `cairn-cc-link-${randomUUID()}`);
    symlinkSync(real, link);
    const throughLink = sdkTranscriptPath(link, 'sess-1');
    const direct = sdkTranscriptPath(real, 'sess-1');
    expect(throughLink).toBe(direct);
    expect(sdkTranscriptPath(link, 'sess-1')).toContain('sess-1.jsonl');
  });

  test('failure mode 11: missing cwd does not throw (path joined as-is, miss decided by existence)', () => {
    expect(() =>
      sdkTranscriptPath(join(tmpdir(), `no-such-${randomUUID()}`), 'sess-1'),
    ).not.toThrow();
  });

  test('failure mode 12: non-alphanumeric cwd characters replaced with - per the CLI rule', () => {
    const parent = mkdtempSync(join(tmpdir(), 'cairn-cc-slug-'));
    const cwd = join(parent, 'dot.hidden_dir');
    mkdirSync(cwd);
    const resolved = realpathSync(cwd);
    const sessionId = 'sess-slug';
    const slug = resolved.replace(/[^a-zA-Z0-9]/g, '-');
    const slashOnly = resolved.replaceAll('/', '-');
    expect(slug).not.toBe(slashOnly);
    expect(sdkTranscriptPath(cwd, sessionId)).toBe(
      join(homedir(), '.claude', 'projects', slug, `${sessionId}.jsonl`),
    );
  });

  test('failure mode 13: sanitized cwd over 200 truncated with a path hash appended', () => {
    const parent = mkdtempSync(join(tmpdir(), 'cairn-cc-long-'));
    const cwd = join(parent, 'p'.repeat(220));
    mkdirSync(cwd);
    const resolved = realpathSync(cwd);
    const flat = resolved.replace(/[^a-zA-Z0-9]/g, '-');
    const sessionId = 'sess-long';
    expect(flat.length).toBeGreaterThan(200);
    const slug = cliProjectSlug(resolved);
    expect(slug.length).toBeLessThan(flat.length);
    expect(sdkTranscriptPath(cwd, sessionId)).toBe(
      join(homedir(), '.claude', 'projects', slug, `${sessionId}.jsonl`),
    );
  });

  test('failure mode 14: config dir overrides a valid project name; invalid names and missing config dir do not override', () => {
    const parent = mkdtempSync(join(tmpdir(), 'cairn-cc-over-'));
    const cwd = join(parent, 'dot.hidden_dir');
    mkdirSync(cwd);
    const resolved = realpathSync(cwd);
    const sessionId = 'sess-over';
    const configDir = join(parent, 'claude-config');
    const prevConfig = process.env.CLAUDE_CONFIG_DIR;
    const prevName = process.env.CLAUDE_CODE_PROJECT_DIR_NAME;
    try {
      process.env.CLAUDE_CONFIG_DIR = configDir;
      process.env.CLAUDE_CODE_PROJECT_DIR_NAME = 'resume_ok-1';
      expect(sdkTranscriptPath(cwd, sessionId)).toBe(
        join(configDir.normalize('NFC'), 'projects', 'resume_ok-1', `${sessionId}.jsonl`),
      );

      process.env.CLAUDE_CODE_PROJECT_DIR_NAME = 'bad.name';
      expect(sdkTranscriptPath(cwd, sessionId)).toBe(
        join(
          configDir.normalize('NFC'),
          'projects',
          cliProjectSlug(resolved),
          `${sessionId}.jsonl`,
        ),
      );

      process.env.CLAUDE_CODE_PROJECT_DIR_NAME = 'CON';
      expect(sdkTranscriptPath(cwd, sessionId)).toBe(
        join(
          configDir.normalize('NFC'),
          'projects',
          cliProjectSlug(resolved),
          `${sessionId}.jsonl`,
        ),
      );

      delete process.env.CLAUDE_CONFIG_DIR;
      process.env.CLAUDE_CODE_PROJECT_DIR_NAME = 'resume_ok-1';
      expect(sdkTranscriptPath(cwd, sessionId)).toBe(
        join(homedir(), '.claude', 'projects', cliProjectSlug(resolved), `${sessionId}.jsonl`),
      );
    } finally {
      if (prevConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = prevConfig;
      if (prevName === undefined) delete process.env.CLAUDE_CODE_PROJECT_DIR_NAME;
      else process.env.CLAUDE_CODE_PROJECT_DIR_NAME = prevName;
    }
  });
});
