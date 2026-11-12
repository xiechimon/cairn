import { ISSUE_FENCE_OPEN } from '@cairn/shared';
import { afterEach, describe, expect, test } from 'vitest';
import { executeWorkerMemoryTool } from '../src/services/chief-tools.js';
import { AGENT_ID, AGENT2_ID, H, registerChiefHarness, relay } from './chief-harness.js';

registerChiefHarness();
afterEach(() => H.s.dispose());

const saveIndependent = async (params: Record<string, unknown>) =>
  JSON.parse(
    await executeWorkerMemoryTool(
      H.s.db,
      {
        teamId: H.teamId,
        agentId: AGENT2_ID,
        sourceName: null,
        todoId: 'source',
        projectId: H.projectId,
        buildId: 'build',
        attachmentsDir: H.s.attachmentsDir,
        teamScoped: false,
      },
      'save_memory',
      { scope: 'team', file: params.title, content: params.content },
    ),
  ) as { id: string };

for (const mode of ['chief', 'worker'] as const) {
  const invoke = async (name: string, params: Record<string, unknown>) => {
    params = { scope: 'team', ...params };
    if (mode === 'chief') return relay(name, params);
    return JSON.parse(
      await executeWorkerMemoryTool(
        H.s.db,
        {
          teamId: H.teamId,
          agentId: AGENT_ID,
          sourceName: null,
          todoId: 'source',
          projectId: H.projectId,
          buildId: 'build',
          attachmentsDir: H.s.attachmentsDir,
        },
        name,
        params,
      ),
    ) as unknown;
  };
  const save = (params: Record<string, unknown>) => invoke('save_memory', params);

  describe(`${mode} memory dedupe`, () => {
    test('updating a nonexistent or an independent agent memory returns 404', async () => {
      await saveIndependent({ title: '他人', content: '不可改' });
      for (const memoryId of ['他人', 'missing']) {
        await expect(
          invoke('update_memory', { file: memoryId, baseVersion: 'missing', content: '覆盖' }),
        ).rejects.toMatchObject({
          status: 404,
        });
      }
      await expect(
        relay(
          'update_memory',
          { scope: 'team', file: '他人', baseVersion: 'missing', content: '覆盖' },
          { chiefAgentId: null },
        ),
      ).rejects.toMatchObject({ status: 409 });
    });

    test('issue fence cannot enter memory via save or update', async () => {
      const original = (await save({ file: '安全约定', content: '可信内容' })) as {
        id: string;
        baseVersion: string;
      };
      for (const field of ['file', 'content']) {
        await expect(
          save({
            file: 'new-file',
            content: '可信内容',
            [field]: `${ISSUE_FENCE_OPEN}untrusted`,
          }),
        ).rejects.toMatchObject({ status: 400 });
      }
      await expect(
        invoke('update_memory', {
          file: '安全约定',
          baseVersion: original.baseVersion,
          content: `${ISSUE_FENCE_OPEN}untrusted`,
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect(await invoke('memories', { file: '安全约定' })).toMatchObject({
        id: original.id,
        content: '可信内容',
      });
    });
  });
}

test('only exact names conflict, content overlap never needs confirmation', async () => {
  await relay('save_memory', { scope: 'team', file: 'one.md', content: 'same lesson' });
  await expect(
    relay('save_memory', { scope: 'team', file: 'two.md', content: 'same lesson' }),
  ).resolves.toMatchObject({ content: 'same lesson' });
  await expect(
    relay('save_memory', { scope: 'team', file: 'one.md', content: 'other' }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    relay('save_memory', { scope: H.projectId, file: 'one.md', content: 'other' }),
  ).resolves.toMatchObject({ content: 'other' });
});
