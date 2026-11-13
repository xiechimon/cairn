import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { resetFreshSessionWorkspace } from '../src/step-workspace.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) releaseTestTempDir(dir);
});

function tempDir(): string {
  const dir = makeTestTempDir('fresh-reset-');
  dirs.push(dir);
  return dir;
}

function planFile(): string {
  const file = join(tempDir(), 'plan.md');
  writeFileSync(file, 'old plan');
  return file;
}

describe('resetFreshSessionWorkspace', () => {
  it('restores the branch head and removes the stale plan file', async () => {
    const restoreCheckpoint = vi.fn(async () => {});
    const file = planFile();
    const reason = await resetFreshSessionWorkspace({
      workspace: { restoreCheckpoint },
      cwd: '/ws',
      headAtStart: 'abc123',
      planFile: file,
    });
    expect(reason).toBeNull();
    expect(restoreCheckpoint).toHaveBeenCalledWith('/ws', 'abc123');
    expect(existsSync(file)).toBe(false);
  });

  it('returns the failure reason and keeps the plan file when the restore fails', async () => {
    const file = planFile();
    const reason = await resetFreshSessionWorkspace({
      workspace: {
        restoreCheckpoint: async () => {
          throw new Error('dirty index');
        },
      },
      cwd: '/ws',
      headAtStart: 'abc123',
      planFile: file,
    });
    expect(reason).toBe('dirty index');
    expect(existsSync(file)).toBe(true);
  });

  it('succeeds when no plan file exists', async () => {
    const reason = await resetFreshSessionWorkspace({
      workspace: { restoreCheckpoint: async () => {} },
      cwd: '/ws',
      headAtStart: 'abc123',
      planFile: join(tempDir(), 'plan.md'),
    });
    expect(reason).toBeNull();
  });
});
