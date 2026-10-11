// 步执行全链（02 §5.7 生命周期行 + journal 端点词表）（#1128 自 machine-loop.test.ts 拆分；共享 harness 收编位
// = ./machine-loop-harness.ts，每个测试自 boot 自停）。

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolCallRecord } from '@pacman/shared';
import {
  appendPlanLocationNote,
  buildPlanFirstRoundInstruction,
  buildTaskPromptText,
  composeTaskPromptWithInstruction,
  PLAN_FILE_NAME,
} from '@pacman/shared';
import { describe, expect, test } from 'vitest';
import { boot, CLAIMED, FakeMachineApi, fakeBackend, waitFor } from './machine-loop-harness.js';

describe('步执行全链（02 §5.7 生命周期行 + journal 端点词表）', () => {
  test('claim → token → session → events → tool relay → upload → done', async () => {
    const api = new FakeMachineApi();
    const toolCall: ToolCallRecord = {
      id: 'call-1',
      name: 'edit',
      arguments: { path: 'README.md' },
      result: { ok: true },
      isError: false,
    };
    const { backend, created } = fakeBackend([
      { type: 'text_delta', text: '方案' },
      { type: 'toolcall_end', call: toolCall },
      {
        type: 'message_end',
        message: { role: 'assistant', content: [{ type: 'text', text: '方案' }] },
      },
      {
        type: 'done',
        usage: [
          { model: 'stub-gw/stub-model', input: 12, output: 980, cacheRead: 0, cacheWrite: 0 },
        ],
      },
    ]);
    const { handle, lines, paths } = await boot({ api, backend });
    await waitFor(() => api.parked !== null);
    api.parked?.(CLAIMED);
    await waitFor(() => api.doneBodies.length === 1);

    // 生命周期行序 canon（02 §5.7）。
    expect(lines).toContain('claim step=s1');
    expect(lines).toContain('step s1 for conv conv-1 (1 running)');
    expect(lines).toContain('using model stub-gw/stub-model');
    expect(lines).toContain('[workspace] 准备工作区...');
    expect(lines).toContain('new session conv-1');
    expect(lines).toContain('finished (0 running)');

    // backend 收到 SessionOpts（provider 凭证内存态 + prompt + cwd + systemPrompt）。
    const opts = created[0]?.opts as {
      prompt?: string;
      cwd: string;
      systemPrompt?: string;
      provider: { providerId: string };
      modelId: string;
    };
    // #1025：plan 步（无 instruction）首轮任务 prompt = 任务文本 + plan.md 契约
    // 指令组合串（buildTaskPrompt 注入；compose 单源形状）；#1203 起尾部附
    // 交接位置注记行（路径 = <home>/plans/<convId>/plan.md，repo 检出之外）。
    expect(opts.prompt).toBe(
      appendPlanLocationNote(
        composeTaskPromptWithInstruction(
          buildTaskPromptText('探针任务', '写一行探针'),
          buildPlanFirstRoundInstruction(),
        ),
        join(paths.home, 'plans', 'conv-1', PLAN_FILE_NAME),
      ),
    );
    // agent.description 注入（02 §4.4 同缝）+ spec 15 #394 元信息回填指令块
    // （todo 语境步注入,词表 = FIXED_TAGS 单源）。
    expect(opts.systemPrompt).toContain('职责说明');
    expect(opts.systemPrompt).toContain('set_task_meta');
    expect(opts.systemPrompt).toContain('bug');
    expect(opts.provider.providerId).toBe('stub-gw');
    expect(opts.modelId).toBe('stub-model');
    expect(opts.cwd).toBe(join(paths.workspacesDir, 'conv-1'));

    // tool live 回传 + transcript 终稿（upload-urls → PUT）+ done body。
    expect(api.toolCalls.map((t) => t.call.id)).toEqual(['call-1']);
    const upload = api.uploads[0];
    expect(upload?.url).toBe('http://server/up/1');
    const ids = upload?.body.messages.map((m) => m.id);
    // #955 段序：正文段先落、工具行随后——封口在工具到达那一刻发生，段行必须
    // 排在它之后的工具行**之前**（否则流式期工具会显示在自己前导文本的上方）。
    expect(ids).toEqual(['user-s1', 'msg-s1-1', 'call-1']);
    expect(api.doneBodies[0]?.body).toMatchObject({
      status: 'success',
      sessionId: 'pi-sess-1',
      hasChanges: true, // edit 工具行（[推断] 骨架判定）
    });
    // journal 收尾清空。
    expect(existsSync(join(paths.outboxDir, 'step-s1.json'))).toBe(false);
    await handle.stop();
    await handle.done;
  });

  test('skillsAllowlist 透传（#372→#1169）：worker 数组原样传；null（不限制）不传；chief 步不传', async () => {
    // 失败方式（先于实现固化）：
    // 1. null 被误读成全拒 → SessionOpts 收到 []，不限制 agent 整库被拒（#1169 主修位）。
    // 2. 数组被过滤/吞掉 → deny 闸（#917 吃 allowlist）失去名单。
    // 3. chief 步误传 → 信任面被绑定 Agent 勾选约束。
    // worker 步：数组白名单原样进 SessionOpts.skillsAllowlist（含 [] = 显式全拒）。
    for (const skillsAllowlist of [['alpha', 'beta'], []] as string[][]) {
      const api = new FakeMachineApi();
      const { backend, created } = fakeBackend([{ type: 'done', usage: [] }]);
      const { handle } = await boot({ api, backend });
      await waitFor(() => api.parked !== null);
      api.parked?.({
        ...CLAIMED,
        agent: { ...CLAIMED.agent!, skillsAllowlist },
      });
      await waitFor(() => api.doneBodies.length === 1);
      const opts = created[0]?.opts as { skillsAllowlist?: string[] };
      expect(opts.skillsAllowlist).toEqual(skillsAllowlist);
      await handle.stop();
      await handle.done;
    }

    // null（不限制）与缺省（旧 server 未携带）都不传——SessionOpts 无 allowlist =
    // 全量直通；[] 与 null 两态不得在这里塌缩。
    for (const agent of [null, undefined]) {
      const api = new FakeMachineApi();
      const { backend, created } = fakeBackend([{ type: 'done', usage: [] }]);
      const { handle } = await boot({ api, backend });
      await waitFor(() => api.parked !== null);
      if (agent === null) {
        api.parked?.({
          ...CLAIMED,
          agent: { ...CLAIMED.agent!, skillsAllowlist: null, defaultSkill: null },
        });
      } else {
        api.parked?.(CLAIMED);
      }
      await waitFor(() => api.doneBodies.length === 1);
      const opts = created[0]?.opts as { skillsAllowlist?: string[] };
      expect(opts.skillsAllowlist).toBeUndefined();
      await handle.stop();
      await handle.done;
    }

    // chief 步：绑定 Agent 即使带 allowlist 也不传——chief 是信任面，全量 catalog。
    {
      const api = new FakeMachineApi();
      const { backend, created } = fakeBackend([{ type: 'done', usage: [] }]);
      const { handle } = await boot({ api, backend });
      await waitFor(() => api.parked !== null);
      api.parked?.({
        ...CLAIMED,
        step: { ...CLAIMED.step, kind: 'chief' as const },
        conversationId: 'chief-t1',
        agent: { ...CLAIMED.agent!, skillsAllowlist: ['alpha'], defaultSkill: 'alpha' },
        chief: { threadId: 't1', systemPrompt: '总管 charter', trigger: 'user' as const },
      });
      await waitFor(() => api.doneBodies.length === 1);
      const opts = created[0]?.opts as { skillsAllowlist?: string[] };
      expect(opts.skillsAllowlist).toBeUndefined();
      await handle.stop();
      await handle.done;
    }
  });

  test('defaultSkill（#1169）排进 #1116 注入绑定序首位（选择集收窄面）', async () => {
    // 失败方式（先于实现固化）：
    // 1. defaultSkill 非空但没排首位 → 携带语义让位给 id 字典序。
    // 2. 排序时没去重 → [default, default, ...] 重复条目进注入面。
    // 3. injectedSkills 缺省（旧 server）时编造集 → 违背「目录注入回落全量」
    //    的既有律（defaultSkill 只在 injectedSkills 在位时重排，不造集）。
    const api = new FakeMachineApi();
    const { backend, created } = fakeBackend([{ type: 'done', usage: [] }]);
    const { handle } = await boot({ api, backend });
    await waitFor(() => api.parked !== null);
    api.parked?.({
      ...CLAIMED,
      agent: {
        ...CLAIMED.agent!,
        skillsAllowlist: ['alpha', 'beta'],
        defaultSkill: 'beta',
        injectedSkills: ['alpha', 'beta'],
      },
    });
    await waitFor(() => api.doneBodies.length === 1);
    const opts = created[0]?.opts as { injectedSkills?: string[] };
    // 首位 = defaultSkill；余集保序去重；allowlist 不因排序收窄。
    expect(opts.injectedSkills).toEqual(['beta', 'alpha']);
    await handle.stop();
    await handle.done;

    // defaultSkill 缺省（null/未携带）= 注入集原样（id 字典序不动）。
    {
      const api = new FakeMachineApi();
      const { backend, created } = fakeBackend([{ type: 'done', usage: [] }]);
      const { handle } = await boot({ api, backend });
      await waitFor(() => api.parked !== null);
      api.parked?.({
        ...CLAIMED,
        agent: {
          ...CLAIMED.agent!,
          skillsAllowlist: ['alpha', 'beta'],
          defaultSkill: null,
          injectedSkills: ['alpha', 'beta'],
        },
      });
      await waitFor(() => api.doneBodies.length === 1);
      const opts = created[0]?.opts as { injectedSkills?: string[] };
      expect(opts.injectedSkills).toEqual(['alpha', 'beta']);
      await handle.stop();
      await handle.done;
    }

    // injectedSkills 缺省（旧 server）+ defaultSkill 在位 = 不造集（回落 allowlist
    // 全量注入，defaultSkill 在其内——排序只在集在位时起效）。
    {
      const api = new FakeMachineApi();
      const { backend, created } = fakeBackend([{ type: 'done', usage: [] }]);
      const { handle } = await boot({ api, backend });
      await waitFor(() => api.parked !== null);
      api.parked?.({
        ...CLAIMED,
        agent: {
          ...CLAIMED.agent!,
          skillsAllowlist: ['alpha', 'beta'],
          defaultSkill: 'beta',
        },
      });
      await waitFor(() => api.doneBodies.length === 1);
      const opts = created[0]?.opts as { injectedSkills?: string[] };
      expect(opts.injectedSkills).toBeUndefined();
      await handle.stop();
      await handle.done;
    }
  });

  test('backend error 事件 → done failed（步级失败无自动重跑，02 §4.2）', async () => {
    const api = new FakeMachineApi();
    const { backend } = fakeBackend([
      { type: 'error', error: { message: 'invalid prompt', retryable: false } },
      { type: 'done', usage: [] },
    ]);
    const { handle } = await boot({ api, backend });
    await waitFor(() => api.parked !== null);
    api.parked?.(CLAIMED);
    await waitFor(() => api.doneBodies.length === 1);
    expect(api.doneBodies[0]?.body).toMatchObject({
      status: 'failed',
      errorMessage: 'invalid prompt',
    });
    await handle.stop();
    await handle.done;
  });
});
