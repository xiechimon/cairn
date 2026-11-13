import {
  type ClaimedStep,
  LocalRepoUnreachableError,
  type PreparedWorkspace,
  type WorktreeOps,
} from '@cairn/shared';
import { describe, expect, it } from 'vitest';
import { prepareStepWorkspace, prepareVerifyClone, type StepRepo } from '../src/step-workspace.js';

const claimed = {
  conversationId: 'conv_1',
  project: { id: 'proj_1' },
} as unknown as ClaimedStep;

const repo = {
  kind: 'github',
  cloneUrl: 'https://example.invalid/r.git',
  baseBranch: 'main',
} as StepRepo;

function ops(prepare: WorktreeOps['prepare']): WorktreeOps {
  return { prepare, headCommit: async () => 'a'.repeat(40) } as unknown as WorktreeOps;
}

const input = (workspace: WorktreeOps) => ({
  workspace,
  claimed,
  repo,
  workspacesRoot: '/tmp/ws',
  credentials: null,
  readonly: true,
  refresh: undefined,
  machineName: 'box',
});

describe('prepareStepWorkspace', () => {
  it('passes the claim and readonly flag to prepare and returns the workspace', async () => {
    const seen: unknown[] = [];
    const ws = { cwd: '/tmp/ws/conv_1' } as PreparedWorkspace;
    const result = await prepareStepWorkspace(
      input(
        ops(async (args) => {
          seen.push(args);
          return ws;
        }),
      ),
    );
    expect(result).toEqual({ ws });
    expect(seen[0]).toMatchObject({
      projectId: 'proj_1',
      conversationId: 'conv_1',
      machineCredentialFallback: true,
      readonly: true,
    });
  });

  it('names the machine when the local repository is unreachable', async () => {
    const result = await prepareStepWorkspace(
      input(
        ops(async () => {
          throw new LocalRepoUnreachableError('/repo', 'not_found');
        }),
      ),
    );
    expect('error' in result && result.error).toContain('box');
  });

  it('returns the message of any other failure', async () => {
    const result = await prepareStepWorkspace(
      input(
        ops(async () => {
          throw new Error('clone failed');
        }),
      ),
    );
    expect(result).toEqual({ error: 'clone failed' });
  });
});

describe('prepareVerifyClone', () => {
  const ws = { cwd: '/tmp/ws/conv_1' } as PreparedWorkspace;
  const base = {
    workspace: ops(async () => ws),
    ws,
    headAtStart: 'a'.repeat(40),
    evidenceDirectory: '.cairn-verify/run_1/',
    expectedHeadSha: undefined,
    cleanups: [],
  };

  it('rejects an evidence directory outside the verify root', async () => {
    const result = await prepareVerifyClone({ ...base, evidenceDirectory: '../escape/' });
    expect(result).toEqual({ error: 'Verify evidence directory unavailable or invalid' });
  });

  it('rejects a read-only workspace', async () => {
    const result = await prepareVerifyClone({ ...base, ws: { ...ws, readonly: true } });
    expect(result).toEqual({ error: 'Verify delivery commit unavailable' });
  });

  it('rejects a missing start head', async () => {
    const result = await prepareVerifyClone({ ...base, headAtStart: null });
    expect(result).toEqual({ error: 'Verify delivery commit unavailable' });
  });
});
