// #1254 auto-confirm plan：wakeFacts gate 文本 / triggerChiefWakes 拆卡父探测。

import type { TodoRecord } from '@pacman/shared';
import { describe, expect, test } from 'vitest';
import { wakeFacts } from '../src/services/chief.js';

function todo(over: Partial<Record<keyof TodoRecord, unknown>> = {}): TodoRecord {
  return {
    id: 't1',
    teamId: 'team-1',
    projectId: 'p1',
    title: '写一个登录页',
    spec: '',
    phase: 'confirm',
    phaseAt: 0,
    seqNum: 3,
    orderIndex: 0,
    assignment: null,
    latestBuildId: null,
    lastRunAt: null,
    hasChanges: false,
    hasPlan: false,
    sourceTodo: null,
    tagIds: [],
    agent: null,
    v: 1,
    createdBy: null,
    ownerId: 'u1',
    sourceBuildId: null,
    buildHistory: [],
    ...over,
  } as TodoRecord;
}

describe('wakeFacts — #1254 auto-confirm gate 文本', () => {
  test('普通 gate（非拆卡父）→ 含自动确认三档规则', () => {
    const text = wakeFacts('gate', todo(), null, { isSplitParent: false });
    expect(text).toContain('自动确认规则');
    expect(text).toContain('confirm_builds');
    expect(text).toContain('ask_user');
    expect(text).toContain('真决策点');
    expect(text).not.toContain('split_todo 父卡');
  });

  test('gate 无 context → 默认普通 gate（同 isSplitParent: false）', () => {
    const text = wakeFacts('gate', todo(), null);
    expect(text).toContain('自动确认规则');
    expect(text).toContain('confirm_builds');
    expect(text).not.toContain('split_todo 父卡');
  });

  test('拆卡父 gate → 含 split_todo 父卡停驻指引', () => {
    const text = wakeFacts('gate', todo(), null, { isSplitParent: true });
    expect(text).toContain('split_todo 父卡');
    expect(text).toContain('拆解方案必须人审');
    expect(text).toContain('confirm_builds');
    expect(text).not.toContain('自动确认规则');
  });

  test('settle 不变', () => {
    const text = wakeFacts('settle', todo(), null);
    expect(text).toContain('已合并完成（done）');
    expect(text).not.toContain('confirm_builds');
  });

  test('failed 不变', () => {
    const text = wakeFacts('failed', todo(), 'ENOENT: no such file');
    expect(text).toContain('运行失败');
    expect(text).toContain('machines');
    expect(text).not.toContain('confirm_builds');
  });
});

describe('wakeFacts — #1403 G9 review 关口不套 confirm 规则', () => {
  test('review gate → 合并只由人触发，不给自动确认三档规则', () => {
    const text = wakeFacts('gate', todo({ phase: 'review' }), null);
    expect(text).not.toContain('自动确认规则');
    expect(text).not.toContain('直接调 confirm_builds');
    expect(text).toContain('只由人触发');
  });

  test('confirm gate 不受影响', () => {
    const text = wakeFacts('gate', todo({ phase: 'confirm' }), null);
    expect(text).toContain('自动确认规则');
  });
});
