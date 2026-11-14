import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ClaimedStep, PreparedWorkspace } from '@cairn/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import {
  resetFreshSessionWorkspace,
  resetReusedWorkspaceForFreshSession,
} from '../src/step-workspace.js';

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

describe('resetReusedWorkspaceForFreshSession', () => {
  function run(overrides: {
    action?: 'new' | 'continue';
    reused?: boolean;
    skip?: boolean;
    fail?: boolean;
  }) {
    const restored: string[] = [];
    const notes: string[] = [];
    const lines: string[] = [];
    const promise = resetReusedWorkspaceForFreshSession({
      workspace: {
        restoreCheckpoint: async (_cwd: string, commit: string) => {
          if (overrides.fail === true) throw new Error('dirty index');
          restored.push(commit);
        },
      },
      ws: { cwd: '/ws', reused: overrides.reused ?? true } as PreparedWorkspace,
      claimed: {
        session: { action: overrides.action ?? 'new', sessionId: null },
      } as unknown as ClaimedStep,
      headAtStart: 'abc123',
      skip: overrides.skip ?? false,
      planFile: join(tempDir(), 'plan.md'),
      stepId: 's1',
      transcript: { upsert: (message) => notes.push(message.id) },
      now: () => 1,
      log: { workspace: (line) => lines.push(line), step: (line) => lines.push(line) },
    });
    return { promise, restored, notes, lines };
  }

  it('rewinds a reused workspace for a new session', async () => {
    const h = run({});
    await h.promise;
    expect(h.restored).toEqual(['abc123']);
    expect(h.notes).toEqual([]);
  });

  it('leaves a continued session, a fresh workspace or a skipped step alone', async () => {
    for (const overrides of [{ action: 'continue' as const }, { reused: false }, { skip: true }]) {
      const h = run(overrides);
      await h.promise;
      expect(h.restored).toEqual([]);
    }
  });

  it('a failed rewind leaves a transcript note', async () => {
    const h = run({ fail: true });
    await h.promise;
    expect(h.notes).toEqual(['fresh-reset-s1']);
    expect(h.lines).toEqual(['fresh-session worktree reset failed: dirty index']);
  });
});
