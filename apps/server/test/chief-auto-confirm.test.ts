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
    latestBuildId: null,
    lastRunAt: null,
    hasChanges: false,
    hasPlan: false,
    sourceTodo: null,
    tagIds: [],
    v: 1,
    createdBy: null,
    ownerId: 'u1',
    sourceBuildId: null,
    buildHistory: [],
    ...over,
  } as TodoRecord;
}

describe('wakeFacts gate text', () => {
  test.each(['confirm', 'review'] as const)(
    '%s gate parks for a person and carries no auto-confirm instruction',
    (phase) => {
      const text = wakeFacts('gate', todo({ phase }), null);
      expect(text).toContain(`停驻在 ${phase} 关口，等人处理`);
      expect(text).toContain('不要自己放行');
      expect(text).not.toContain('自动确认规则');
      expect(text).not.toContain('confirm_builds');
    },
  );

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
