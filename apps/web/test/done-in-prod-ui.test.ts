import type { TodoRecord as WireTodo } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { toDisplayTodo } from '../src/api/mappers.js';
import { statusLineMeta } from '../src/board/side-chat.js';
import { taskRowCopy, type TaskEntry, type TaskSection } from '../src/board/tasks-sections.js';
import type { TodoRecord } from '../src/fixtures/records.js';
import { EN } from '../src/i18n/en.js';
import { todo } from './helpers.js';

const entry = (
  seq: number,
  phase: TodoRecord['phase'],
  section: TaskSection,
  extra: Partial<TodoRecord> = {},
): TaskEntry => ({ todo: { ...todo(seq, phase), ...extra }, section });

describe('done-in-prod one-line missingEvidence UI', () => {
  test('toDisplayTodo maps missingEvidence from server record', () => {
    const wire = {
      ...todo(1, 'needs_input'),
      ownerId: null,
      createdBy: null,
      sourceBuildId: null,
      sourceKind: null,
      sourceRef: null,
      output: 'code' as const,
      owner: 'owner' as const,
      buildHistory: [],
      missingEvidence: 'Attach live request/response JSON via attach_file',
    } as unknown as WireTodo;
    expect(toDisplayTodo(wire).missingEvidence).toBe(
      'Attach live request/response JSON via attach_file',
    );
  });

  test('taskRowCopy surfaces missingEvidence in needs_input and working with retry/quota precedence', () => {
    const missing = 'Attach live screenshot via attach_file';
    expect(
      taskRowCopy(entry(1, 'needs_input', 'needs_input', { missingEvidence: missing })),
    ).toMatchObject({
      word: '待回答',
      what: { key: '还缺：{missing}', params: { missing } },
      where: '到任务里回答',
    });

    expect(
      taskRowCopy(entry(2, 'building', 'working', { missingEvidence: missing })),
    ).toMatchObject({
      word: '进行中',
      what: { key: '还缺：{missing}', params: { missing } },
    });

    expect(
      taskRowCopy(
        entry(3, 'building', 'working', {
          missingEvidence: missing,
          waitingOn: { on: 'quota', retryAt: null },
          quotaWait: {
            kind: 'quota',
            providerId: 'anthropic',
            label: null,
            retryAfterMs: null,
            probeAt: 2,
          },
        }),
      ).what.key,
    ).not.toBe('还缺：{missing}');

    expect(
      taskRowCopy(entry(4, 'done', 'resolved', { missingEvidence: missing })).what.key,
    ).not.toBe('还缺：{missing}');
  });

  test('statusLineMeta follows platformWait > retry > quota > missingEvidence > default and EN translates template', () => {
    const missing = 'Deployed target is running an older commit';
    const t = (key: string, params?: Record<string, string | number>) => {
      const base = EN[key] ?? key;
      return params ? base.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? '')) : base;
    };

    expect(
      statusLineMeta({
        todo: { ...todo(1, 'needs_input'), missingEvidence: missing },
        platformWait: null,
        now: 1_758_000_060_000,
        updates: null,
        t,
      }),
    ).toBe(`Missing: ${missing}`);

    expect(
      statusLineMeta({
        todo: {
          ...todo(2, 'building'),
          missingEvidence: missing,
          waitingOn: { on: 'quota', retryAt: null },
        },
        platformWait: null,
        now: 1_758_000_060_000,
        updates: null,
        t,
      }),
    ).not.toContain(missing);

    expect(EN['还缺：{missing}']).toBe('Missing: {missing}');
  });
});
