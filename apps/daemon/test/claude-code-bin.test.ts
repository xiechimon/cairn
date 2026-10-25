import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { parseClaudeVersion, probeClaudeBin, resolveCommandPath } from '../src/claude-code-bin.js';

function makeStub(dir: string, name: string, script: string): string {
  const p = join(dir, name);
  writeFileSync(p, script);
  chmodSync(p, 0o755);
  return p;
}

describe('parseClaudeVersion', () => {
  test('failure mode 6: `2.1.289 (Claude Code)` → 2.1.289', () => {
    expect(parseClaudeVersion('2.1.289 (Claude Code)\n')).toBe('2.1.289');
  });

  test('failure mode 7: leading v stripped', () => {
    expect(parseClaudeVersion('v2.1.289')).toBe('2.1.289');
  });

  test('failure mode 5: surrounding whitespace trimmed', () => {
    expect(parseClaudeVersion('  2.1.289  \n\n')).toBe('2.1.289');
  });

  test('failure mode 4: no version number → null (installed but version unreadable)', () => {
    for (const raw of ['', '   ', 'not a version', '(Claude Code)']) {
      expect(parseClaudeVersion(raw)).toBeNull();
    }
  });

  test('version with a prerelease suffix kept in full', () => {
    expect(parseClaudeVersion('2.1.289-beta.3 (Claude Code)')).toBe('2.1.289-beta.3');
  });
});

describe('resolveCommandPath', () => {
  test('failure mode 1: not on PATH → null', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-cc-bin-'));
    try {
      expect(resolveCommandPath('claude', { PATH: dir })).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('PATH hit → absolute path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-cc-bin-'));
    try {
      const stub = makeStub(dir, 'claude', '#!/bin/sh\necho 2.1.289\n');
      expect(resolveCommandPath('claude', { PATH: `${dir}:/nowhere` })).toBe(stub);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('failure mode 1b: hit file without the execute bit → skipped', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-cc-bin-'));
    try {
      writeFileSync(join(dir, 'claude'), '#!/bin/sh\necho 2.1.289\n');
      expect(resolveCommandPath('claude', { PATH: dir })).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('failure mode 9: absolute path skips the PATH scan — returned as-is when it exists and is executable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-cc-bin-'));
    try {
      const stub = makeStub(dir, 'claude', '#!/bin/sh\necho 2.1.289\n');
      expect(resolveCommandPath(stub, { PATH: '/nowhere' })).toBe(stub);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('failure mode 9b: absolute path missing → null (explicit paths are existence-checked too, else false green stands)', () => {
    expect(resolveCommandPath('/no/such/claude', { PATH: '/nowhere' })).toBeNull();
  });
});

describe('probeClaudeBin well-known fallback (#1290)', () => {
  test('failure mode 10: empty PATH + fake claude in well-known → found, source names well-known', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-cc-bin-'));
    try {
      const stub = makeStub(dir, 'claude', '#!/bin/sh\necho "2.1.289 (Claude Code)"\n');
      const info = await probeClaudeBin({
        env: { PATH: '/nowhere' },
        wellKnownDirs: [dir],
      });
      expect(info).toEqual({ path: stub, version: '2.1.289', source: 'well-known' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('failure mode 11: on PATH → no fallback (stubs in well-known dirs are not hit)', async () => {
    const pathDir = mkdtempSync(join(tmpdir(), 'cairn-cc-bin-path-'));
    const fallbackDir = mkdtempSync(join(tmpdir(), 'cairn-cc-bin-fallback-'));
    try {
      const pathStub = makeStub(pathDir, 'claude', '#!/bin/sh\necho 2.1.289\n');
      makeStub(fallbackDir, 'claude', '#!/bin/sh\necho 9.9.9\n');
      const info = await probeClaudeBin({
        env: { PATH: pathDir },
        wellKnownDirs: [fallbackDir],
      });
      expect(info).toEqual({ path: pathStub, version: '2.1.289', source: 'PATH' });
    } finally {
      rmSync(pathDir, { recursive: true, force: true });
      rmSync(fallbackDir, { recursive: true, force: true });
    }
  });

  test('failure mode 12: empty PATH + empty well-known → null (no throw)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-cc-bin-'));
    try {
      const info = await probeClaudeBin({
        command: 'cairn-no-such-claude',
        env: { PATH: '/nowhere' },
        wellKnownDirs: [dir],
      });
      expect(info).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('failure mode 13: file in a well-known dir without the execute bit → skipped', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-cc-bin-'));
    try {
      writeFileSync(join(dir, 'claude'), '#!/bin/sh\necho 2.1.289\n');
      const info = await probeClaudeBin({
        env: { PATH: '/nowhere' },
        wellKnownDirs: [dir],
      });
      expect(info).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('absolute-path commands skip the fallback (explicit-path criterion unchanged)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-cc-bin-'));
    try {
      makeStub(dir, 'claude', '#!/bin/sh\necho 2.1.289\n');
      const info = await probeClaudeBin({
        command: '/no/such/claude',
        env: { PATH: '/nowhere' },
        wellKnownDirs: [dir],
      });
      expect(info).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('probeClaudeBin', () => {
  test('success: real subprocess stub → {path, version}', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-cc-bin-'));
    try {
      const stub = makeStub(dir, 'claude', '#!/bin/sh\necho "2.1.289 (Claude Code)"\n');
      const info = await probeClaudeBin({ command: stub, env: { PATH: dir } });
      expect(info).toEqual({ path: stub, version: '2.1.289', source: 'PATH' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('failure mode 8: non-zero exit but version on stdout → taken as usual', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-cc-bin-'));
    try {
      const stub = makeStub(dir, 'claude', '#!/bin/sh\necho 2.1.289\nexit 1\n');
      const info = await probeClaudeBin({ command: stub, env: { PATH: dir } });
      expect(info).toEqual({ path: stub, version: '2.1.289', source: 'PATH' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('failure modes 1/2: command missing → null (no throw)', async () => {
    expect(await probeClaudeBin({ command: 'cairn-no-such-claude', timeoutMs: 2_000 })).toBeNull();
  });

  test('failure mode 3: timeout → null (a hung process must not stall the presence beat)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-cc-bin-'));
    try {
      const stub = makeStub(dir, 'claude', '#!/bin/sh\nsleep 10\n');
      const started = Date.now();
      const info = await probeClaudeBin({ command: stub, env: { PATH: dir }, timeoutMs: 300 });
      expect(info).toBeNull();
      expect(Date.now() - started).toBeLessThan(3_000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('failure mode 4: output but no version number → path still reported, version null', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-cc-bin-'));
    try {
      const stub = makeStub(dir, 'claude', '#!/bin/sh\necho "hello from a wrapper"\n');
      const info = await probeClaudeBin({ command: stub, env: { PATH: dir } });
      expect(info).toEqual({ path: stub, version: null, source: 'PATH' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('injected run: parsing goes through parse (success path spawns no real CLI)', async () => {
    const info = await probeClaudeBin({
      command: '/fake/claude',
      run: async () => ({ stdout: '2.1.289 (Claude Code)\n' }),
    });
    expect(info).toEqual({ path: '/fake/claude', version: '2.1.289' });
  });

  test('injected run: run throws → null (reason not leaked, no throw)', async () => {
    const info = await probeClaudeBin({
      command: '/fake/claude',
      run: async () => {
        throw new Error('spawn /fake/claude ENOENT');
      },
    });
    expect(info).toBeNull();
  });

  test('CAIRN_CLAUDE_BIN override: command name taken from the env var (bare names resolved via PATH)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-cc-bin-'));
    const prev = process.env.CAIRN_CLAUDE_BIN;
    try {
      const stub = makeStub(dir, 'my-claude', '#!/bin/sh\necho 2.1.289\n');
      process.env.CAIRN_CLAUDE_BIN = 'my-claude';
      const info = await probeClaudeBin({ env: { PATH: dir } });
      expect(info).toEqual({ path: stub, version: '2.1.289', source: 'PATH' });
    } finally {
      if (prev === undefined) delete process.env.CAIRN_CLAUDE_BIN;
      else process.env.CAIRN_CLAUDE_BIN = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
