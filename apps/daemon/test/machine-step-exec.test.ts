import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolCallRecord } from '@cairn/shared';
import {
  appendPlanLocationNote,
  buildPlanFirstRoundInstruction,
  buildTaskPromptText,
  composeTaskPromptWithInstruction,
  PLAN_FILE_NAME,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { boot, CLAIMED, FakeMachineApi, fakeBackend, waitFor } from './machine-loop-harness.js';

describe('step execution full chain (02 §5.7 lifecycle lines + journal endpoint vocabulary)', () => {
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

    expect(lines).toContain('claim step=s1');
    expect(lines).toContain('step s1 for conv conv-1 (1 running)');
    expect(lines).toContain('using model stub-gw/stub-model');
    expect(lines).toContain('[workspace] 准备工作区...');
    expect(lines).toContain('new session conv-1');
    expect(lines).toContain('finished (0 running)');

    const opts = created[0]?.opts as {
      prompt?: string;
      cwd: string;
      systemPrompt?: string;
      provider: { providerId: string };
      modelId: string;
    };
    expect(opts.prompt).toBe(
      appendPlanLocationNote(
        composeTaskPromptWithInstruction(
          buildTaskPromptText('探针任务', '写一行探针'),
          buildPlanFirstRoundInstruction(),
        ),
        join(paths.home, 'plans', 'conv-1', PLAN_FILE_NAME),
      ),
    );
    expect(opts.systemPrompt).toContain('职责说明');
    expect(opts.systemPrompt).toContain('set_task_meta');
    expect(opts.systemPrompt).toContain('bug');
    expect(opts.provider.providerId).toBe('stub-gw');
    expect(opts.modelId).toBe('stub-model');
    expect(opts.cwd).toBe(join(paths.workspacesDir, 'conv-1'));

    expect(api.toolCalls.map((t) => t.call.id)).toEqual(['call-1']);
    const upload = api.uploads[0];
    expect(upload?.url).toBe('http://server/up/1');
    const ids = upload?.body.messages.map((m) => m.id);
    expect(ids).toEqual(['user-s1', 'msg-s1-1', 'call-1']);
    expect(api.doneBodies[0]?.body).toMatchObject({
      status: 'success',
      sessionId: 'pi-sess-1',
      hasChanges: true,
    });
    expect(existsSync(join(paths.outboxDir, 'step-s1.json'))).toBe(false);
    await handle.stop();
    await handle.done;
  });

  test('skillsAllowlist passthrough (#372→#1169): worker array passed verbatim; null (unrestricted) not passed; not passed for chief steps', async () => {
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

  test('defaultSkill (#1169) placed first in the #1116 injection binding order (selection-set narrowing surface)', async () => {
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
    expect(opts.injectedSkills).toEqual(['beta', 'alpha']);
    await handle.stop();
    await handle.done;

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

  test('backend error event → done failed (step-level failure has no automatic rerun, 02 §4.2)', async () => {
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
