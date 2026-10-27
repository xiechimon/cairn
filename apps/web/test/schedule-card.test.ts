import type { ScheduleItem, ScheduleReport } from '@cairn/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { I18nProvider } from '../src/i18n/provider.js';
import {
  canExecute,
  isActionable,
  scheduleSelection,
  unparsedDepTexts,
} from '../src/pages/schedule-card-model.js';
import { ScheduleUnparsedDeps } from '../src/pages/project-schedule-card.js';

const item = (over: Partial<ScheduleItem>): ScheduleItem => ({
  issue: 1,
  title: 't',
  group: 'later',
  reason: 'r',
  deps: [],
  executor: null,
  updatedAt: 1,
  evidence: [],
  closeReason: null,
  labelChange: null,
  ...over,
});

const report = (over: Partial<ScheduleReport>): ScheduleReport => ({
  id: 'r1',
  projectId: 'p1',
  generatedAt: 1,
  mainSha: 'a'.repeat(40),
  groups: { now: [], next: [], later: [], close: [] },
  items: [],
  unparsedDeps: [],
  decidedAt: null,
  decidedBy: null,
  appliedAt: null,
  ...over,
});

describe('schedule card model', () => {
  test('only items that would change github are checkable', () => {
    expect(isActionable(item({ group: 'now', labelChange: { add: ['x'], remove: [] } }))).toBe(
      true,
    );
    expect(isActionable(item({ group: 'close', closeReason: 'done' }))).toBe(true);
    expect(isActionable(item({ group: 'later' }))).toBe(false);
    expect(isActionable(item({ group: 'next', deps: [2] }))).toBe(false);
  });

  test('nothing is executable until the human checks something', () => {
    const r = report({ items: [item({ group: 'now', labelChange: { add: ['x'], remove: [] } })] });
    expect(canExecute(r, new Set())).toBe(false);
    expect(canExecute(r, new Set([1]))).toBe(true);
  });

  test('an applied report cannot be executed again', () => {
    const r = report({
      appliedAt: 5,
      items: [item({ group: 'now', labelChange: { add: ['x'], remove: [] } })],
    });
    expect(canExecute(r, new Set([1]))).toBe(false);
  });

  test('the selection sent to the server is only checked actionable items', () => {
    const r = report({
      items: [
        item({ issue: 1, group: 'now', labelChange: { add: ['x'], remove: [] } }),
        item({ issue: 2, group: 'later' }),
        item({ issue: 3, group: 'close', closeReason: 'done' }),
      ],
    });
    expect(scheduleSelection(r, new Set([1, 2, 3]))).toEqual([1, 3]);
  });

  test('a ready-for-agent removal outside now is checkable and stays unlabelled only on confirm', () => {
    const r = report({
      items: [
        item({ issue: 4, group: 'next', labelChange: { add: [], remove: ['ready-for-agent'] } }),
      ],
    });
    expect(isActionable(r.items[0] as ScheduleItem)).toBe(true);
    expect(scheduleSelection(r, new Set([4]))).toEqual([4]);
    expect(canExecute(r, new Set())).toBe(false);
  });
});

describe('schedule card unparsed dependencies', () => {
  test('renders each issue number with its original text instead of an object', () => {
    const markup = renderToStaticMarkup(
      createElement(I18nProvider, {
        initialLocale: 'zh',
        children: createElement(ScheduleUnparsedDeps, {
          unparsedDeps: [
            { issue: 1555, text: '依赖: 调度器先落地' },
            { issue: 1601, text: '等待上游设计确认' },
          ],
        }),
      }),
    );
    expect(markup).not.toContain('[object Object]');
    expect(markup).toContain('#1555');
    expect(markup).toContain('依赖: 调度器先落地');
    expect(markup).toContain('#1601');
    expect(markup).toContain('等待上游设计确认');
  });

  test('unparsed dependency texts keep the issue number attached for copying', () => {
    expect(unparsedDepTexts([{ issue: 7, text: '依赖: x' }])).toEqual(['#7 依赖: x']);
  });
});
