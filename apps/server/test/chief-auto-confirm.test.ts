import type { TodoRecord } from '@cairn/shared';
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

describe('wakeFacts -- #1254 auto-confirm gate text', () => {
  test('ordinary gate (not a split parent) -> includes the three auto-confirm rule tiers', () => {
    const text = wakeFacts('gate', todo(), null, { isSplitParent: false });
    expect(text).toContain('自动确认规则');
    expect(text).toContain('confirm_builds');
    expect(text).toContain('ask_user');
    expect(text).toContain('真决策点');
    expect(text).not.toContain('split_todo 父卡');
  });

  test('gate with no context -> defaults to the ordinary gate (same as isSplitParent: false)', () => {
    const text = wakeFacts('gate', todo(), null);
    expect(text).toContain('自动确认规则');
    expect(text).toContain('confirm_builds');
    expect(text).not.toContain('split_todo 父卡');
  });

  test('split-parent gate -> includes the split_todo parent-card stay instruction', () => {
    const text = wakeFacts('gate', todo(), null, { isSplitParent: true });
    expect(text).toContain('split_todo 父卡');
    expect(text).toContain('拆解方案必须人审');
    expect(text).toContain('confirm_builds');
    expect(text).not.toContain('自动确认规则');
  });

  test('settle unchanged', () => {
    const text = wakeFacts('settle', todo(), null);
    expect(text).toContain('已合并完成（done）');
    expect(text).not.toContain('confirm_builds');
  });

  test('failed unchanged', () => {
    const text = wakeFacts('failed', todo(), 'ENOENT: no such file');
    expect(text).toContain('运行失败');
    expect(text).toContain('machines');
    expect(text).not.toContain('confirm_builds');
  });
});

describe('wakeFacts — #1403 G9 review gate text', () => {
  test('G1 review gate → no auto-confirm rules, no confirm_builds instruction, names the human exit', () => {
    const text = wakeFacts('gate', todo({ phase: 'review' }), null, { isSplitParent: false });
    expect(text).not.toContain('自动确认规则');
    expect(text).not.toMatch(/直接调 confirm_builds/);
    expect(text).toContain('review');
    expect(text).toContain('merge_builds');
    expect(text).toContain('「完成」');
  });

  test('G1 review gate on a todo that has split children → still the review text', () => {
    const text = wakeFacts('gate', todo({ phase: 'review' }), null, { isSplitParent: true });
    expect(text).not.toContain('拆解方案必须人审');
    expect(text).not.toContain('自动确认规则');
    expect(text).toContain('「完成」');
  });

  test('G2 the confirm gate keeps its auto-confirm rules', () => {
    const text = wakeFacts('gate', todo({ phase: 'confirm' }), null, { isSplitParent: false });
    expect(text).toContain('自动确认规则');
    expect(text).not.toContain('「完成」');
  });
});
