import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendBlockerHandoff,
  appendPlanLocationNote,
  type BlockerHandoffRecord,
  buildPlanFirstRoundInstruction,
  buildTaskPromptText,
  type ClaimedStep,
  composeTaskPromptWithInstruction,
  PLAN_FILE_NAME,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { StepJournal } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import { buildTaskPrompt, runStep } from '../src/runner.js';
import { statePaths } from '../src/state.js';
import { FakeMachineApi, fakeBackend } from './machine-loop-harness.js';

const silent: DaemonLogger = {
  raw: () => {},
  prefixed: () => {},
  supervisor: () => {},
  machine: () => {},
  step: () => {},
  workspace: () => {},
  recover: () => {},
  wake: () => {},
  mcp: () => {},
  skills: () => {},
  gate: () => {},
  trust: () => {},
};

const HANDOFF: BlockerHandoffRecord = {
  blockers: [
    {
      todoId: 't0',
      title: '加登录接口',
      phase: 'done',
      delivery: {
        kind: 'pr',
        number: 41,
        url: 'https://github.com/octo/alpha/pull/41',
        title: 'feat',
      },
      changedFiles: ['src/login.ts'],
      omittedFiles: 0,
      summary: '完成',
    },
  ],
};

function claimed(opts: {
  kind: 'plan' | 'build';
  blockerHandoff?: BlockerHandoffRecord;
  source?: { sourceKind: string; sourceRef: string };
}): ClaimedStep {
  return {
    step: { id: 's1', buildId: 'conv-1', kind: opts.kind, machineId: 'm1', createdAt: 1 },
    conversationId: 'conv-1',
    session: { action: 'new', sessionId: null },
    todo: {
      id: 't1',
      seqNum: 7,
      title: '接线',
      spec: '把登录接到页面',
      ...opts.source,
      ...(opts.blockerHandoff !== undefined ? { blockerHandoff: opts.blockerHandoff } : {}),
    },
    project: { id: 'p1', name: 'demo', repo: null },
    agent: {
      id: 'a1',
      displayName: 'Implementer',
      description: '角色：Implementer（执行者）。',
      provider: 'stub-gw',
      modelId: 'stub-model',
      thinkingLevel: null,
      memories: [{ title: '偏好', content: '提交前先跑 lint' }],
    },
  };
}

async function deliver(
  step: ClaimedStep,
): Promise<{ prompt: string; systemPrompt: string; home: string }> {
  const home = mkdtempSync(join(tmpdir(), 'cairn-blocker-handoff-'));
  const workspacesDir = join(home, 'workspaces');
  const paths = statePaths(home, workspacesDir);
  const { backend, created } = fakeBackend([{ type: 'done', usage: [] }]);
  await runStep(
    {
      client: new FakeMachineApi(),
      journal: new StepJournal(paths.outboxDir),
      backendFor: () => backend,
      logger: silent,
      paths,
      workspacesDir,
      mcpConfigPath: join(home, 'claude.json'),
      heartbeatIntervalMs: 60_000,
    },
    step,
  );
  expect(created).toHaveLength(1);
  const sent = created[0]?.opts as { prompt?: string; systemPrompt?: string };
  return { prompt: sent.prompt ?? '', systemPrompt: sent.systemPrompt ?? '', home };
}

describe('#1624 daemon delivery: prior-card handoff goes into the first-round prompt, not the system layer', () => {
  test('D1 build step new session: prompt = task text + handoff section; systemPrompt contains no handoff content', async () => {
    const step = claimed({ kind: 'build', blockerHandoff: HANDOFF });
    const { prompt, systemPrompt } = await deliver(step);
    expect(prompt).toBe(
      appendBlockerHandoff(buildTaskPromptText('接线', '把登录接到页面'), HANDOFF),
    );
    expect(prompt).toContain('> ## 前置卡 1：加登录接口');
    expect(systemPrompt).not.toContain('前置卡');
    expect(systemPrompt).not.toContain('加登录接口');
    expect(buildTaskPrompt(step)).toBe(prompt);
  });

  test('D2 no blockerHandoff: prompt unchanged byte for byte', async () => {
    const { prompt } = await deliver(claimed({ kind: 'build' }));
    expect(prompt).toBe(buildTaskPromptText('接线', '把登录接到页面'));
  });

  test('D3 plan step first round: handoff section before the contract instruction, contract and handoff-location annotation after it', async () => {
    const { prompt, home } = await deliver(claimed({ kind: 'plan', blockerHandoff: HANDOFF }));
    const withHandoff = appendBlockerHandoff(
      buildTaskPromptText('接线', '把登录接到页面'),
      HANDOFF,
    );
    expect(prompt).toBe(
      appendPlanLocationNote(
        composeTaskPromptWithInstruction(withHandoff, buildPlanFirstRoundInstruction()),
        join(home, 'plans', 'conv-1', PLAN_FILE_NAME),
      ),
    );
  });

  test('D4 GitHub-issue-imported child card: issue fence first, handoff section outside the fence', async () => {
    const step = claimed({
      kind: 'build',
      blockerHandoff: HANDOFF,
      source: { sourceKind: 'github-issue', sourceRef: 'github:octo/alpha#7' },
    });
    const { prompt } = await deliver(step);
    const fenceEnd = prompt.indexOf('【GitHub issue 原文结束');
    const handoffStart = prompt.indexOf('【前置卡交付');
    expect(fenceEnd).toBeGreaterThan(0);
    expect(handoffStart).toBeGreaterThan(fenceEnd);
  });
});
