import type { ClaimedStep, LocalMergeCommand } from '@cairn/shared';
import { describe, expect, it } from 'vitest';
import { localMergeDoneBody } from '../src/step-local-merge.js';

const command = {
  projectId: 'proj_1',
  buildId: 'bld_1',
  defaultBranch: 'main',
  workBranch: 'cairn/work',
  judgedBase: 'a'.repeat(40),
  judgedHead: 'b'.repeat(40),
  judgedPatchDigest: `pd2:${'c'.repeat(64)}`,
} as LocalMergeCommand;

function claim(over: { kind?: string; buildId?: string; tools?: string[] }): ClaimedStep {
  return {
    step: { kind: over.kind ?? 'merge', buildId: over.buildId ?? 'bld_1' },
    project: { id: 'proj_1', repo: { kind: 'local', cloneUrl: '/nonexistent' } },
    ...(over.tools !== undefined ? { agent: { tools: over.tools } } : {}),
  } as unknown as ClaimedStep;
}

describe('localMergeDoneBody', () => {
  it('fails a command that names another build', async () => {
    const body = await localMergeDoneBody(claim({ buildId: 'bld_2' }), command, () => false);
    expect(body).toEqual({
      status: 'failed',
      errorMessage: 'Local merge command does not match the claim',
    });
  });

  it('fails an agent without merge and push permission', async () => {
    const body = await localMergeDoneBody(claim({ tools: ['merge'] }), command, () => false);
    expect(body).toEqual({
      status: 'failed',
      errorMessage: 'Local merge requires merge and push permission',
    });
  });

  it('holds without touching the repository when a stop is already requested', async () => {
    const body = await localMergeDoneBody(claim({}), command, () => true);
    expect(body).toEqual({
      status: 'success',
      localMerge: { command, result: { outcome: 'held', reason: 'stopped' } },
    });
  });
});
