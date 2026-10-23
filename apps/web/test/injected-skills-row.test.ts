// #1106 注入选择回查行（mapper 缝）：step.skillInjection 落库记录 → 头部
// injected-skills 行（票面验收 4「选择过程在任务详情面可查」）。失败方式：
//   F1 有记录的步存在 → 头部出 injected-skills 行，run 行之后
//   F2 多步同技能去重（首见序），reason 取首见条目
//   F3 hits=[]（已计算零命中）→ 行仍在、skills 空（零注入是可查事实）
//   F4 全部步 null（chief 面 / 旧 server）→ 不产行零噪声
//   F5 无 build → 不产行（行随 run 行走）

import type { BuildRecord, SkillInjectionRecord, StepJournalRow } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { mapTranscript } from '../src/api/mappers.js';
import type { TodoRecord, TranscriptItem } from '../src/fixtures/records.js';
import { NOW, todo } from './helpers.js';

const BUILD: BuildRecord = {
  id: 'build-1',
  todoId: 'todo-1',
  withPlan: false,
  prevPhase: null,
  triggerSource: 'user',
  planDocId: null,
  errorMessage: null,
  prUrl: null,
  prNumber: null,
  diffHash: null,
  createdAt: NOW - 60_000,
};

function step(
  id: string,
  skillInjection: SkillInjectionRecord | null,
  kind: StepJournalRow['kind'] = 'build',
): StepJournalRow {
  return {
    id,
    buildId: BUILD.id,
    kind,
    machineId: null,
    createdAt: NOW - 30_000,
    status: 'done',
    checkpointCommit: null,
    skillInjection,
  };
}

function render(steps: StepJournalRow[], build: BuildRecord | null = BUILD): TranscriptItem[] {
  const base = todo(1, 'review') as TodoRecord;
  return mapTranscript({
    messages: [],
    steps,
    plans: [],
    build,
    todo: base,
    machineName: null,
    userName: 'Xmon Dai',
    liveText: '',
  });
}

function injectedItems(items: TranscriptItem[]) {
  return items.filter((i): i is Extract<TranscriptItem, { kind: 'injected-skills' }> =>
    i.kind === 'injected-skills' ? true : false,
  );
}

describe('#1106 注入选择回查行（mapper 缝）', () => {
  test('F1：有记录 → 头部出 injected-skills 行（run 行之后）', () => {
    const items = render([
      step('s1', {
        hits: [
          { id: 'better-typography', rule: 'domain', reason: '任务文本与技能同域「前端界面」' },
        ],
      }),
    ]);
    const rows = injectedItems(items);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.skills).toEqual([
      { id: 'better-typography', reason: '任务文本与技能同域「前端界面」' },
    ]);
    // 位置：run 行之后（head 序）。
    expect(items[0]?.kind).toBe('run');
    expect(items[1]?.kind).toBe('injected-skills');
  });

  test('F2：多步同技能去重（首见序），reason 取首见条目', () => {
    const items = render([
      step('s1', { hits: [{ id: 'a', rule: 'domain', reason: '首见原因' }] }, 'plan'),
      step('s2', { hits: [{ id: 'a', rule: 'domain', reason: '第二原因' }] }),
      step('s3', { hits: [{ id: 'b', rule: 'explicit-mention', reason: '点名' }] }),
    ]);
    expect(injectedItems(items)[0]?.skills).toEqual([
      { id: 'a', reason: '首见原因' },
      { id: 'b', reason: '点名' },
    ]);
  });

  test('F3：hits=[]（已计算零命中）→ 行在、skills 空（零注入是可查事实）', () => {
    const items = render([step('s1', { hits: [] })]);
    const rows = injectedItems(items);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.skills).toEqual([]);
  });

  test('F4：全部步 null（chief 面 / 旧 server）→ 不产行', () => {
    expect(injectedItems(render([step('s1', null)])).length === 0 ? 0 : 1).toBe(0);
    expect(injectedItems(render([])).length === 0 ? 0 : 1).toBe(0);
  });

  test('F5：无 build → 不产行（行随 run 行走）', () => {
    const items = render(
      [
        step('s1', {
          hits: [{ id: 'a', rule: 'domain', reason: 'r' }],
        }),
      ],
      null,
    );
    expect(injectedItems(items)).toHaveLength(0);
    // 无 build = 无 run 行也无注入行。
    expect(items.length).toBe(0);
  });
});
