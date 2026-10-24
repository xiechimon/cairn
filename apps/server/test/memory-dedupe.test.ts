import { ISSUE_FENCE_OPEN } from '@cairn/shared';
import { afterEach, describe, expect, test } from 'vitest';
import { executeWorkerMemoryTool } from '../src/services/chief-tools.js';
import { AGENT_ID, AGENT2_ID, H, registerChiefHarness, relay } from './chief-harness.js';
import { postProject } from './helpers.js';

registerChiefHarness();
afterEach(() => H.s.dispose());

for (const mode of ['chief', 'worker'] as const) {
  const invoke = async (name: string, params: Record<string, unknown>) => {
    if (mode === 'chief') return relay(name, params);
    return JSON.parse(
      await executeWorkerMemoryTool(
        H.s.db,
        {
          teamId: H.teamId,
          agentId: AGENT_ID,
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
  const save = (params: Record<string, unknown>) =>
    invoke('save_memory', { projectId: H.projectId, ...params });

  describe(`${mode} memory dedupe`, () => {
    test.each([
      ['本仓包管理器', '本仓使用 npm 安装依赖', '本仓包管理器', '改成使用 pnpm'],
      ['旧约定', '本仓使用 npm 安装依赖', '安装方式', '本仓使用 pnpm 安装依赖'],
      [
        'Runtime commands',
        'Use npm for dependency installation',
        'Dependencies',
        'Use pnpm for dependency installation',
      ],
    ])('候选提示不落库：%s', async (title, content, nextTitle, nextContent) => {
      const old = (await save({ title, content })) as { id: string };
      const result = await save({ title: nextTitle, content: nextContent });
      expect(result).toMatchObject({
        status: 'candidates',
        candidates: [{ id: old.id, title, content }],
      });
      expect((result as { hint: string }).hint).toContain('update_memory');
      expect(await invoke('memories', {})).toHaveLength(1);
    });

    test('候选只含同 Agent 同项目与全局，显式项目优先', async () => {
      const otherProject = await postProject(H.s.app, 'other');
      const global = (await relay('save_memory', {
        title: '包管理器',
        content: '全局使用 npm',
      })) as { id: string };
      const local = (await save({ title: '包管理器', content: '本仓使用 npm', force: true })) as {
        id: string;
      };
      await relay('save_memory', {
        title: '包管理器',
        content: '别仓使用 yarn',
        projectId: otherProject,
        force: true,
      });
      await relay(
        'save_memory',
        { title: '包管理器', content: '别人使用 bun', projectId: H.projectId },
        { chiefAgentId: AGENT2_ID },
      );
      const result = (await save({ title: '包管理器', content: '本仓使用 pnpm' })) as {
        candidates: { id: string }[];
      };
      expect(result.candidates.map((c) => c.id).sort()).toEqual([global.id, local.id].sort());
      const other = (await save({
        projectId: otherProject,
        title: '包管理器',
        content: '切换安装工具',
      })) as { candidates: { id: string }[] };
      expect(other.candidates.map((c) => c.id)).not.toContain(local.id);
      const globalOnly = (await relay('save_memory', {
        title: '包管理器',
        content: '通用安装工具',
      })) as { candidates: { id: string }[] };
      expect(globalOnly.candidates.map((c) => c.id)).toEqual([global.id]);
    });

    test('不同主题直接新增，候选只有 force:true 才新增', async () => {
      await save({ title: '包管理器', content: '使用 npm 安装依赖' });
      await save({ title: '界面配色', content: '按钮采用蓝色' });
      await expect(
        save({ title: '包管理器', content: '使用 pnpm 安装依赖', force: 'true' }),
      ).rejects.toMatchObject({ status: 400 });
      expect(await save({ title: '包管理器', content: '使用 pnpm 安装依赖' })).toMatchObject({
        status: 'candidates',
      });
      const added = (await save({
        title: '包管理器',
        content: '使用 pnpm 安装依赖',
        force: true,
      })) as { id: string };
      expect(added.id).toEqual(expect.any(String));
      expect(await invoke('memories', {})).toHaveLength(3);
      await expect(
        save({ title: '包管理器', content: '使用 pnpm 安装依赖', force: true }),
      ).rejects.toMatchObject({ status: 409 });
    });

    test('候选请求相同内容重试返回 409，已保存内容重试也返回 409', async () => {
      await save({ title: '包管理器', content: '使用 npm 安装依赖' });
      const input = { title: '包管理器', content: '使用 pnpm 安装依赖' };
      expect(await save(input)).toMatchObject({ status: 'candidates' });
      await expect(save(input)).rejects.toMatchObject({ status: 409 });
      await expect(save({ ...input, title: '安装工具' })).rejects.toMatchObject({ status: 409 });
      await expect(save({ title: '包管理器', content: '使用 npm 安装依赖' })).rejects.toMatchObject(
        { status: 409 },
      );
      expect(await invoke('memories', {})).toHaveLength(1);
    });

    test('同内容改掉标题、不再命中候选也不能绕过重试 409', async () => {
      await save({ title: '工作规则', content: '蓝色按钮' });
      expect(await save({ title: '工作规则', content: '部署使用容器' })).toMatchObject({
        status: 'candidates',
      });
      await expect(save({ title: '发布环境', content: '部署使用容器' })).rejects.toMatchObject({
        status: 409,
      });
    });

    test('update_memory 保持 id 与溯源，多次更新保留可查询旧值，无变化不添历史', async () => {
      const original = (await save({ title: '包管理器', content: '使用 npm' })) as {
        id: string;
        updatedAt: number;
      };
      const updated = await invoke('update_memory', {
        memoryId: original.id,
        content: '使用 pnpm',
      });
      expect(updated).toMatchObject({
        ...original,
        content: '使用 pnpm',
        updatedAt: expect.any(Number),
        history: [{ title: '包管理器', content: '使用 npm', updatedAt: original.updatedAt }],
      });
      await invoke('update_memory', { memoryId: original.id, content: '使用 bun' });
      await invoke('update_memory', { memoryId: original.id, content: '使用 bun' });
      const rows = (await invoke('memories', {})) as {
        content: string;
        history: { content: string }[];
      }[];
      expect(rows).toHaveLength(1);
      expect(rows[0]?.content).toBe('使用 bun');
      expect(rows[0]?.history.map((h) => h.content)).toEqual(['使用 npm', '使用 pnpm']);
    });

    test('更新不存在或其他 Agent 的记忆返回 404', async () => {
      const other = (await relay(
        'save_memory',
        { title: '他人', content: '不可改' },
        { chiefAgentId: AGENT2_ID },
      )) as { id: string };
      for (const memoryId of [other.id, 'missing']) {
        await expect(invoke('update_memory', { memoryId, content: '覆盖' })).rejects.toMatchObject({
          status: 404,
        });
      }
      await expect(
        relay('update_memory', { memoryId: other.id, content: '覆盖' }, { chiefAgentId: null }),
      ).rejects.toMatchObject({ status: 404 });
    });

    test('issue 围栏不能经 save force 或 update 进入记忆', async () => {
      const original = (await save({ title: '安全约定', content: '可信内容' })) as { id: string };
      for (const field of ['title', 'content']) {
        await expect(
          save({
            title: '安全约定',
            content: '可信内容',
            [field]: `${ISSUE_FENCE_OPEN}untrusted`,
            force: true,
          }),
        ).rejects.toMatchObject({ status: 400 });
      }
      await expect(
        invoke('update_memory', { memoryId: original.id, content: `${ISSUE_FENCE_OPEN}untrusted` }),
      ).rejects.toMatchObject({ status: 400 });
      expect(await invoke('memories', {})).toMatchObject([
        { id: original.id, content: '可信内容' },
      ]);
    });
  });
}
