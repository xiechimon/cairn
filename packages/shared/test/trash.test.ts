import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { isCairnTrashPath, moveToTrash } from '../src/node/trash.js';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function home(tag: string): string {
  const root = makeTestTempDir(`cairn-trash-${tag}-`);
  roots.push(root);
  return root;
}

function skillDir(root: string, name: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), '---\nname: deploy\n---\n');
  return dir;
}

describe('moveToTrash', () => {
  test('macOS: the folder lands in ~/.Trash under its own name and a second copy gets a counting suffix', () => {
    const root = home('mac');
    const dir = skillDir(root, 'deploy');
    const first = moveToTrash(dir, { platform: 'darwin', homeDir: root });
    expect(first).toBe(join(root, '.Trash', 'deploy'));
    expect(existsSync(dir)).toBe(false);
    expect(existsSync(join(first, 'SKILL.md'))).toBe(true);

    const again = skillDir(root, 'deploy');
    const second = moveToTrash(again, { platform: 'darwin', homeDir: root });
    expect(second).toBe(join(root, '.Trash', 'deploy 2'));
    expect(readFileSync(join(second, 'SKILL.md'), 'utf8')).toContain('name: deploy');
  });

  test('linux: files go to the XDG Trash and the .trashinfo records the original path so a file manager can restore it', () => {
    const root = home('linux');
    const dir = skillDir(root, 'deploy');
    const dest = moveToTrash(dir, {
      platform: 'linux',
      homeDir: root,
      xdgDataHome: join(root, 'share'),
    });
    expect(dest).toBe(join(root, 'share', 'Trash', 'files', 'deploy'));
    expect(existsSync(join(dest, 'SKILL.md'))).toBe(true);
    expect(existsSync(dir)).toBe(false);
    const info = readFileSync(join(root, 'share', 'Trash', 'info', 'deploy.trashinfo'), 'utf8');
    expect(info).toContain('[Trash Info]');
    expect(info).toContain('DeletionDate=');
    const recorded = /^Path=(.+)$/m.exec(info)?.[1];
    expect(recorded).toBe(dir);
  });

  test('linux: an existing .trashinfo for the same name moves the folder to a counting suffix instead of overwriting the restore record', () => {
    const root = home('linux-info-clash');
    mkdirSync(join(root, 'share', 'Trash', 'info'), { recursive: true });
    const staleInfo = join(root, 'share', 'Trash', 'info', 'deploy.trashinfo');
    writeFileSync(
      staleInfo,
      '[Trash Info]\nPath=/somewhere/else/deploy\nDeletionDate=2026-01-01T00:00:00\n',
    );
    const dir = skillDir(root, 'deploy');
    const dest = moveToTrash(dir, {
      platform: 'linux',
      homeDir: root,
      xdgDataHome: join(root, 'share'),
    });
    expect(dest).toBe(join(root, 'share', 'Trash', 'files', 'deploy 2'));
    expect(readFileSync(staleInfo, 'utf8')).toContain('/somewhere/else/deploy');
    expect(
      readFileSync(join(root, 'share', 'Trash', 'info', 'deploy 2.trashinfo'), 'utf8'),
    ).toContain(`Path=${dir}`);
  });

  test('linux without XDG_DATA_HOME falls back to ~/.local/share/Trash', () => {
    const root = home('linux-default');
    const dir = skillDir(root, 'deploy');
    const saved = process.env.XDG_DATA_HOME;
    delete process.env.XDG_DATA_HOME;
    try {
      const dest = moveToTrash(dir, { platform: 'linux', homeDir: root });
      expect(dest).toBe(join(root, '.local', 'share', 'Trash', 'files', 'deploy'));
      expect(existsSync(join(dest, 'SKILL.md'))).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = saved;
    }
  });

  test('linux honours XDG_DATA_HOME from the environment when no option is given', () => {
    const root = home('linux-env');
    const dir = skillDir(root, 'deploy');
    const saved = process.env.XDG_DATA_HOME;
    process.env.XDG_DATA_HOME = join(root, 'from-env');
    try {
      const dest = moveToTrash(dir, { platform: 'linux', homeDir: root });
      expect(dest).toBe(join(root, 'from-env', 'Trash', 'files', 'deploy'));
    } finally {
      if (saved === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = saved;
    }
  });

  test('the fallback Trash lives under the configured Cairn home, not a hardcoded ~/.cairn', () => {
    const root = home('cairn-home');
    const dir = skillDir(root, 'deploy');
    const dest = moveToTrash(dir, {
      platform: 'win32',
      homeDir: root,
      cairnHome: join(root, 'custom-home'),
      now: new Date('2026-11-28T12:34:56Z'),
    });
    expect(dest.startsWith(join(root, 'custom-home', 'trash'))).toBe(true);
    expect(isCairnTrashPath(dest, { cairnHome: join(root, 'custom-home') })).toBe(true);
    expect(
      isCairnTrashPath(join(root, '.Trash', 'deploy'), { cairnHome: join(root, 'custom-home') }),
    ).toBe(false);
  });

  test('other platforms keep a dated folder under the Cairn home instead of losing the files', () => {
    const root = home('win');
    const dir = skillDir(root, 'deploy');
    const dest = moveToTrash(dir, {
      platform: 'win32',
      homeDir: root,
      now: new Date('2026-11-28T12:34:56Z'),
    });
    expect(dest.startsWith(join(root, '.cairn', 'trash'))).toBe(true);
    expect(dest.endsWith('deploy')).toBe(true);
    expect(existsSync(join(dest, 'SKILL.md'))).toBe(true);
    expect(existsSync(dir)).toBe(false);
  });

  test('macOS: when the system refuses the Trash move the folder lands in ~/.cairn/trash instead of failing', () => {
    const root = home('mac-refused');
    const trashDir = join(root, '.Trash');
    mkdirSync(trashDir, { recursive: true });
    const dir = skillDir(root, 'deploy');
    chmodSync(trashDir, 0o500);
    try {
      const dest = moveToTrash(dir, {
        platform: 'darwin',
        homeDir: root,
        now: new Date('2026-11-28T12:34:56Z'),
      });
      expect(dest.startsWith(join(root, '.cairn', 'trash'))).toBe(true);
      expect(dest.endsWith('deploy')).toBe(true);
      expect(existsSync(join(dest, 'SKILL.md'))).toBe(true);
      expect(existsSync(dir)).toBe(false);
    } finally {
      chmodSync(trashDir, 0o700);
    }
  });

  test('a symlink moves as a link: the folder it points at keeps its files', () => {
    const root = home('link');
    const target = skillDir(root, 'real-skill');
    const link = join(root, 'linked-skill');
    symlinkSync(target, link);
    const dest = moveToTrash(link, { platform: 'darwin', homeDir: root });
    expect(existsSync(link)).toBe(false);
    expect(existsSync(join(target, 'SKILL.md'))).toBe(true);
    expect(existsSync(dest)).toBe(true);
  });
});
