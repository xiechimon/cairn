import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

import { join } from 'node:path';
import { BRIEF_MARKER_BEGIN, BRIEF_MARKER_END } from '@cairn/shared';
import { afterEach, describe, expect, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import {
  cleanupBriefFile,
  locateMarkerBlock,
  reconcileBriefLeftovers,
  writeBrief,
} from '../src/brief-file.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function freshDir(): string {
  const dir = makeTestTempDir('cairn-brief-');
  dirs.push(dir);
  return dir;
}

const CI = true;
const BRIEF = '# 简报\n\n任务文本。';

function blockOf(brief: string): string {
  return `${BRIEF_MARKER_BEGIN}\n${brief}\n${BRIEF_MARKER_END}\n`;
}

describe('writeBrief: three-state write', () => {
  test('empty dir → created, block at offset 0, no leading separator (failure mode 5 discriminator)', () => {
    const cwd = freshDir();
    const h = writeBrief({ cwd, backendId: 'pi', content: BRIEF, caseInsensitiveFs: CI });
    expect(h.file).toBe('AGENTS.md');
    expect(h.mode).toBe('create');
    expect(readFileSync(h.path, 'utf8')).toBe(blockOf(BRIEF));
  });

  test('existing user file (no block) → append "separator + block", user body preserved verbatim', () => {
    const cwd = freshDir();
    writeFileSync(join(cwd, 'CLAUDE.md'), '用户的约定，没有尾换行');
    const h = writeBrief({ cwd, backendId: 'pi', content: BRIEF, caseInsensitiveFs: CI });
    expect(h.file).toBe('CLAUDE.md');
    expect(h.mode).toBe('append');
    expect(readFileSync(h.path, 'utf8')).toBe(`用户的约定，没有尾换行\n\n${blockOf(BRIEF)}`);
  });

  test('existing block → replaced in place, no stacked copies (failure mode 2)', () => {
    const cwd = freshDir();
    const first = writeBrief({ cwd, backendId: 'pi', content: '第一轮', caseInsensitiveFs: CI });
    const second = writeBrief({ cwd, backendId: 'pi', content: '第二轮', caseInsensitiveFs: CI });
    expect(second.path).toBe(first.path);
    const text = readFileSync(second.path, 'utf8');
    expect(text).toBe(blockOf('第二轮'));
    expect(text.split(BRIEF_MARKER_BEGIN).length - 1).toBe(1);
  });

  test('rerun on appended state: still exactly one block, user body untouched', () => {
    const cwd = freshDir();
    const userText = '用户正文\n';
    writeFileSync(join(cwd, 'CLAUDE.md'), userText);
    writeBrief({ cwd, backendId: 'pi', content: '第一轮', caseInsensitiveFs: CI });
    const h = writeBrief({ cwd, backendId: 'pi', content: '第二轮', caseInsensitiveFs: CI });
    expect(readFileSync(h.path, 'utf8')).toBe(`${userText}\n\n${blockOf('第二轮')}`);
    expect(readFileSync(h.path, 'utf8').split(BRIEF_MARKER_BEGIN).length - 1).toBe(1);
  });

  test('case-insensitive lookup writes the on-disk real spelling (failure mode 5 variant)', () => {
    const cwd = freshDir();
    writeFileSync(join(cwd, 'CLAUDE.MD'), '用户正文');
    const h = writeBrief({ cwd, backendId: 'pi', content: BRIEF, caseInsensitiveFs: CI });
    expect(h.file).toBe('CLAUDE.MD');
    expect(readdirSync(cwd)).toEqual(['CLAUDE.MD']);
  });

  test('body containing the marker string → throws, never writes an unerasable file (failure mode 8)', () => {
    const cwd = freshDir();
    expect(() =>
      writeBrief({
        cwd,
        backendId: 'pi',
        content: `${BRIEF_MARKER_BEGIN} 伪造`,
        caseInsensitiveFs: CI,
      }),
    ).toThrow(/must not contain the runtime markers/);
    expect(readdirSync(cwd)).toEqual([]);
  });
});

describe('cleanupBriefFile: byte-for-byte rollback', () => {
  const tails: [string, string][] = [
    ['no trailing newline', 'user body'],
    ['one trailing newline', 'user body\n'],
    ['two trailing newlines', 'user body\n\n'],
    ['CRLF body', 'user body\r\n'],
  ];
  for (const [label, userText] of tails) {
    test(`appended-state erase is byte-for-byte identical to pre-injection (${label})`, () => {
      const cwd = freshDir();
      const path = join(cwd, 'CLAUDE.md');
      writeFileSync(path, userText);
      writeBrief({ cwd, backendId: 'pi', content: BRIEF, caseInsensitiveFs: CI });
      expect(cleanupBriefFile(path)).toBe('excised');
      expect(readFileSync(path, 'utf8')).toBe(userText);
    });
  }

  test('created-state erase → file disappears (existence rolled back too)', () => {
    const cwd = freshDir();
    const h = writeBrief({ cwd, backendId: 'pi', content: BRIEF, caseInsensitiveFs: CI });
    expect(cleanupBriefFile(h.path)).toBe('removed');
    expect(existsSync(h.path)).toBe(false);
  });

  test('idempotent: a second pass after a clean erase is a noop', () => {
    const cwd = freshDir();
    const h = writeBrief({ cwd, backendId: 'pi', content: BRIEF, caseInsensitiveFs: CI });
    expect(cleanupBriefFile(h.path)).toBe('removed');
    expect(cleanupBriefFile(h.path)).toBe('noop');
  });

  test('files without a block are untouched (failure mode 5: never delete user files)', () => {
    const cwd = freshDir();
    const path = join(cwd, 'CLAUDE.md');
    writeFileSync(path, '用户的文件，没有我们的块\n');
    expect(cleanupBriefFile(path)).toBe('noop');
    expect(readFileSync(path, 'utf8')).toBe('用户的文件，没有我们的块\n');
  });

  test('a stray END string in the user body is not treated as a block (failure mode 3)', () => {
    const cwd = freshDir();
    const path = join(cwd, 'CLAUDE.md');
    const userText = `正文里提到 ${BRIEF_MARKER_END} 这个词\n`;
    writeFileSync(path, userText);
    expect(cleanupBriefFile(path)).toBe('noop');
    expect(readFileSync(path, 'utf8')).toBe(userText);
  });
});

describe('locateMarkerBlock: malformed shapes', () => {
  test('crash half-written block (BEGIN present, END missing) → remainder treated as the block (failure mode 4)', () => {
    const text = `用户正文\n\n${BRIEF_MARKER_BEGIN}\n半写的内容没有收尾`;
    const span = locateMarkerBlock(text);
    expect(span).not.toBeNull();
    expect(span!.end).toBe(text.length);
  });

  test('write over a half-written remnant → wholesale replacement, remnant does not persist', () => {
    const cwd = freshDir();
    const path = join(cwd, 'AGENTS.md');
    writeFileSync(path, `用户正文\n\n${BRIEF_MARKER_BEGIN}\n半写残骸`);
    const h = writeBrief({ cwd, backendId: 'pi', content: '新一轮', caseInsensitiveFs: CI });
    expect(readFileSync(h.path, 'utf8')).toBe(`用户正文\n\n${blockOf('新一轮')}`);
  });

  test('the single newline after the block is consumed: two consecutive rounds accumulate no blank lines', () => {
    const cwd = freshDir();
    writeFileSync(join(cwd, 'CLAUDE.md'), '用户正文');
    const h = writeBrief({ cwd, backendId: 'pi', content: 'A', caseInsensitiveFs: CI });
    writeBrief({ cwd, backendId: 'pi', content: 'B', caseInsensitiveFs: CI });
    expect(readFileSync(h.path, 'utf8')).toBe(`用户正文\n\n${blockOf('B')}`);
  });
});

describe('reconcileBriefLeftovers: crash-leftover reconciliation', () => {
  test('leftover created-state files deleted, leftover appended blocks stripped, marker-free artifacts never touched (failure mode 6)', () => {
    const cwd = freshDir();
    writeFileSync(join(cwd, 'AGENTS.md'), blockOf('上一轮的简报'));
    writeFileSync(join(cwd, 'CLAUDE.md'), `用户正文\n\n${blockOf('更早的简报')}`);
    writeFileSync(join(cwd, 'NOTES.md'), 'agent 的产物\n');

    const touched = reconcileBriefLeftovers(cwd, CI, 'AGENTS.md');
    expect(touched).toEqual(['CLAUDE.md']);
    expect(readFileSync(join(cwd, 'CLAUDE.md'), 'utf8')).toBe('用户正文');
    expect(readFileSync(join(cwd, 'NOTES.md'), 'utf8')).toBe('agent 的产物\n');
  });

  test('created-state leftovers in non-target candidates are deleted (worktree reused across backends)', () => {
    const cwd = freshDir();
    writeFileSync(join(cwd, 'AGENTS.md'), blockOf('上一轮 pi 的简报'));
    const touched = reconcileBriefLeftovers(cwd, CI, 'CLAUDE.md');
    expect(touched).toEqual(['AGENTS.md']);
    expect(existsSync(join(cwd, 'AGENTS.md'))).toBe(false);
  });

  test('unrelated files are never touched', () => {
    const cwd = freshDir();
    writeFileSync(join(cwd, 'README.md'), '# readme\n');
    writeFileSync(join(cwd, 'package.json'), '{}\n');
    expect(reconcileBriefLeftovers(cwd, CI, 'AGENTS.md')).toEqual([]);
    expect(readFileSync(join(cwd, 'README.md'), 'utf8')).toBe('# readme\n');
  });
});

describe('end-to-end: full write → erase cycle', () => {
  test('pi in a repo with CLAUDE.md: writes into CLAUDE.md, byte-identical after the cycle', () => {
    const cwd = freshDir();
    const path = join(cwd, 'CLAUDE.md');
    const userText = '# 本仓库约定\n\n- 用 pnpm\n';
    writeFileSync(path, userText);
    const h = writeBrief({ cwd, backendId: 'pi', content: BRIEF, caseInsensitiveFs: CI });
    expect(h.file).toBe('CLAUDE.md');
    expect(readFileSync(path, 'utf8')).toContain('本仓库约定');
    cleanupBriefFile(h.path);
    expect(readFileSync(path, 'utf8')).toBe(userText);
  });

  test('claude-code in a repo with only AGENTS.md: creates CLAUDE.md, clean with no residue after the cycle', () => {
    const cwd = freshDir();
    writeFileSync(join(cwd, 'AGENTS.md'), 'pi 形态的约定\n');
    const h = writeBrief({ cwd, backendId: 'claude-code', content: BRIEF, caseInsensitiveFs: CI });
    expect(h.file).toBe('CLAUDE.md');
    expect(h.mode).toBe('create');
    cleanupBriefFile(h.path);
    expect(existsSync(join(cwd, 'CLAUDE.md'))).toBe(false);
    expect(readFileSync(join(cwd, 'AGENTS.md'), 'utf8')).toBe('pi 形态的约定\n');
  });
});
