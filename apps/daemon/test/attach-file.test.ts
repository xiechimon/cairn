import { mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { prepareFileAttachment } from '../src/attach-file.js';

const roots: string[] = [];
function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'cairn-attach-file-'));
  roots.push(root);
  const cwd = join(root, 'worktree');
  mkdirSync(cwd);
  writeFileSync(join(root, 'outside.txt'), 'private');
  writeFileSync(join(cwd, 'report.txt'), 'workspace report');
  return { root, cwd };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('attach_file workspace boundary', () => {
  test('reads relative and in-worktree absolute paths and discards supplied metadata', () => {
    const { cwd } = workspace();
    for (const path of ['report.txt', join(cwd, 'report.txt')]) {
      expect(
        prepareFileAttachment(cwd, {
          path,
          caption: 'Report',
          sha256: 'forged',
          mimeType: 'image/png',
          teamId: 'foreign',
        }),
      ).toEqual({
        fileName: 'report.txt',
        caption: 'Report',
        contentBase64: Buffer.from('workspace report').toString('base64'),
      });
    }
  });
  test.each(['parent', 'absolute', 'symlink', 'directory symlink'])('rejects %s escape', (mode) => {
    const { root, cwd } = workspace();
    symlinkSync(join(root, 'outside.txt'), join(cwd, 'escape.txt'));
    symlinkSync(root, join(cwd, 'external'));
    const path =
      mode === 'parent'
        ? '../outside.txt'
        : mode === 'absolute'
          ? join(root, 'outside.txt')
          : mode === 'symlink'
            ? 'escape.txt'
            : 'external/outside.txt';
    expect(() => prepareFileAttachment(cwd, { path })).toThrow(/outside.*worktree/i);
  });
  test('rejects oversized sparse files before allocating their content', () => {
    const { cwd } = workspace();
    truncateSync(join(cwd, 'report.txt'), 10 * 1024 * 1024 + 1);
    expect(() => prepareFileAttachment(cwd, { path: 'report.txt' })).toThrow(/10 MiB.*cap/i);
  });
  test.each([{}, { path: '' }, { path: 123 }, { path: 'report.txt', caption: 123 }, { path: '.' }])(
    'rejects invalid parameters or non-file: %j',
    (params) => {
      const { cwd } = workspace();
      expect(() => prepareFileAttachment(cwd, params)).toThrow();
    },
  );
});
