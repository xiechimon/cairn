import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { resetFreshSessionWorkspace } from '../src/step-workspace.js';

function planFile(): string {
  const file = join(mkdtempSync(join(tmpdir(), 'fresh-reset-')), 'plan.md');
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
      planFile: join(tmpdir(), 'missing-dir-for-fresh-reset', 'plan.md'),
    });
    expect(reason).toBeNull();
  });
});
