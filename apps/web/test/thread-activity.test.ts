import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, test } from 'vitest';
import { mapChiefStream, type MessageRow } from '../src/api/mappers.js';
import { ChiefStreamRow } from '../src/chief/chief-message-rows.js';
import {
  foldTaskCards,
  placeReportCards,
  placeUnmentionedTasks,
  todoGlanceOf,
} from '../src/chief/chief-task-refs.js';
import { collapseThinkingRuns, groupThreadEvents } from '../src/chief/thread-activity.js';
import { ThinkingRow } from '../src/components/chat/agent-rows.js';
import { MessageScroller, MessageScrollerProvider } from '../src/components/ui/message-scroller.js';
import type { TodoGlance } from '../src/detail/segments.js';
import type { ChiefStreamItem } from '../src/fixtures/records.js';
import { I18nProvider } from '../src/i18n/provider.js';

let counter = 0;
const nextId = () => `row-${counter++}`;

function report(todoId: string, phase: 'done' | 'needs-you' = 'done') {
  return {
    kind: 'thread-report',
    id: nextId(),
    todoId,
    seqNum: 1,
    title: todoId,
    phase,
  } satisfies ChiefStreamItem;
}

function message(todoId: string) {
  return {
    kind: 'thread-message',
    id: nextId(),
    todoId,
    seqNum: 1,
    title: todoId,
    excerpt: 'hi',
    delivered: 'steer',
    conversationId: 'conv-1',
    by: 'coordinator',
  } satisfies ChiefStreamItem;
}

const glances = new Map<string, TodoGlance>([
  ['code', todoGlanceOf({ phase: 'queued', title: 'code' })],
  [
    'research',
    todoGlanceOf({
      phase: 'needs_input',
      title: 'research',
      sourceKind: 'research-before-plan',
      sourceRef: 'before-plan:code',
    }),
  ],
  ['other', todoGlanceOf({ phase: 'building', title: 'other' })],
]);

describe('groupThreadEvents', () => {
  test('non-mirrored thread reports, relayed messages, and report acks add no bare row', () => {
    const user: ChiefStreamItem = { kind: 'user', id: nextId(), text: 'hi' };
    const ack: ChiefStreamItem = { kind: 'report-ack', id: nextId(), todoId: 'other', buildId: 'b1' };
    const rows = [user, report('other'), message('other'), ack, report('other', 'needs-you')].map(
      (item, i) => ({ item, i }),
    );
    expect(groupThreadEvents(rows)).toEqual([{ item: user, i: 0 }]);
  });
});

describe('a report mirrored from a project channel', () => {
  test('stands as its own line each time while own-thread reports drop', () => {
    const first = { ...report('other', 'needs-you'), fromThreadId: 'chief-cairn' };
    const own = report('other');
    const done = { ...report('other'), fromThreadId: 'chief-cairn' };
    const rows = [first, own, done].map((item, i) => ({ item, i }));
    expect(
      groupThreadEvents(rows).map(({ item }) => [item.kind, 'id' in item ? item.id : null]),
    ).toEqual([
      ['channel-mirror', first.id],
      ['channel-mirror', done.id],
    ]);
  });
});

describe('research a stuck retry opened', () => {
  const stuck = todoGlanceOf({
    phase: 'review',
    title: 'Research: export keeps failing',
    output: 'info',
    latestBuildId: 'b-stuck',
    sourceKind: 'research-stuck',
    sourceRef: 'build-1:1',
  });
  const code = todoGlanceOf({ phase: 'building', title: 'Export the board' });
  const legacy = todoGlanceOf({
    phase: 'done',
    title: 'Research: Export the board',
    output: 'info',
    sourceKind: 'research-before-plan',
    sourceRef: 'before-plan:code',
  });
  const map = new Map<string, TodoGlance>([
    ['stuck', stuck],
    ['code', code],
    ['legacy', legacy],
  ]);
  const reply = mapChiefStream([
    {
      id: 'a-1',
      role: 'assistant',
      content: JSON.stringify([{ type: 'text', text: 'Started both.' }]),
      createdAt: 90,
    },
  ])[0]!;
  const rows = [{ item: reply, i: 0 }];
  const startedBy = new Map([[reply, ['code', 'stuck', 'legacy']]]);

  test('adds no task line, while the code task and an old research task are named under the reply', () => {
    expect(placeUnmentionedTasks(rows, startedBy, map).get(reply)).toEqual(['code', 'legacy']);
  });

  test('adds no report line to the reply', () => {
    const reports = placeReportCards(rows, startedBy, map, new Set()).get(reply) ?? [];
    expect(reports).not.toContain('stuck');
  });
});

describe('a research report the Coordinator delivered shows once, inside its notice', () => {
  const row = (id: string, content: unknown): MessageRow => ({
    id,
    role: 'system',
    content: JSON.stringify(content),
    createdAt: 100,
  });
  const threadReport = (id: string, todoId: string, buildId: string, phase: string) =>
    row(id, { kind: 'thread-report', todoId, buildId, phase, seqNum: 1, title: todoId });
  const notice = (id: string, todoId: string, buildId: string) =>
    row(id, {
      kind: 'chief_notice',
      message: `[#1](todo:${todoId}) found the answer.`,
      provenance: `report:${todoId}`,
      report: { todoId, buildId },
    });
  const research = (buildId: string) =>
    todoGlanceOf({ phase: 'done', title: 'research', output: 'info', latestBuildId: buildId });
  const reportGlances = new Map<string, TodoGlance>([
    ['told', research('b-told')],
    ['silent', research('b-silent')],
    ['unanswered', research('b-unanswered')],
    ['reworked', research('b-new')],
  ]);
  const stream = mapChiefStream([
    threadReport('r-told', 'told', 'b-told', 'review'),
    notice('n-told', 'told', 'b-told'),
    threadReport('d-told', 'told', 'b-told', 'done'),
    threadReport('r-silent', 'silent', 'b-silent', 'review'),
    row('ack-silent', { kind: 'report_ack', mode: 'silent', todoId: 'silent', buildId: 'b-silent' }),
    threadReport('r-unanswered', 'unanswered', 'b-unanswered', 'review'),
    notice('n-reworked', 'reworked', 'b-old'),
    threadReport('r-reworked', 'reworked', 'b-new', 'review'),
  ]);
  const { rows, startedBy } = foldTaskCards(
    groupThreadEvents(stream.map((item, i) => ({ item, i }))),
    reportGlances,
  );
  const reports = placeReportCards(rows, startedBy, reportGlances, new Set());
  const bubble = (id: string) => rows.find(({ item }) => 'id' in item && item.id === id)?.item;

  test('only Coordinator notice bubbles stay after dropping report and ack rows', () => {
    expect(rows.map(({ item }) => item.kind)).toEqual(['robot', 'robot']);
  });

  test('the notice carries the report line only while its build is still the delivered one', () => {
    expect(reports.get(bubble('n-told')!)).toEqual(['told']);
    expect(reports.has(bubble('n-reworked')!)).toBe(false);
  });

  test('a report asked for in this conversation shows under its conclusion, not under the reply that dispatched it', () => {
    const [dispatch, conclusion] = mapChiefStream([
      {
        id: 'a-asked',
        role: 'assistant',
        content: JSON.stringify([{ type: 'text', text: 'Dispatched [#1](todo:asked).' }]),
        createdAt: 90,
      },
      notice('n-asked', 'asked', 'b-asked'),
    ]);
    const placed = placeReportCards(
      [dispatch!, conclusion!].map((item, i) => ({ item, i })),
      new Map([[dispatch!, ['asked']]]),
      new Map([['asked', research('b-asked')]]),
      new Set(),
    );
    expect(placed.get(conclusion!)).toEqual(['asked']);
    expect(placed.has(dispatch!)).toBe(false);
  });
});

describe('consecutive thinking collapse in a Coordinator turn', () => {
  const thinkRow = (id: string, thinking: string, createdAt: number): MessageRow => ({
    id,
    role: 'assistant',
    content: [{ type: 'thinking', thinking }],
    createdAt,
  });
  const toolRow = (id: string, name: string, createdAt: number): MessageRow => ({
    id,
    role: 'assistant',
    content: {
      kind: 'toolcall',
      call: { id: `call-${id}`, name, arguments: {}, startedAt: createdAt, endedAt: createdAt + 100 },
    },
    createdAt,
  });

  test('collapses consecutive thinking traces from repeated tool errors into one thinking-group while preserving non-consecutive thinking', () => {
    const stream = mapChiefStream([
      { id: 'u-1', role: 'user', content: '查一下 MCP 工具', createdAt: 10 },
      thinkRow('th-1', '先列出可用 MCP 工具', 11),
      toolRow('tc-1', 'mcp_list_tools', 12),
      thinkRow('th-2', '工具报错，用 grep 查定义', 13),
      toolRow('tc-2', 'grep', 14),
      thinkRow('th-3', '换个关键词再 grep 一次', 15),
      toolRow('tc-3', 'grep', 16),
      { id: 'r-1', role: 'assistant', content: [{ type: 'text', text: '已找到问题。' }], createdAt: 17 },
      thinkRow('th-4', '单独一条后续思考', 18),
    ]);
    const folded = foldTaskCards(
      groupThreadEvents(stream.map((item, i) => ({ item, i }))),
      glances,
    ).rows;
    const collapsed = collapseThinkingRuns(folded);

    expect(collapsed.map(({ item }) => item.kind)).toEqual([
      'user',
      'thinking-group',
      'robot',
      'thinking',
    ]);
    expect(collapsed[1]).toEqual({
      item: {
        kind: 'thinking-group',
        id: 'th-1',
        texts: ['先列出可用 MCP 工具', '工具报错，用 grep 查定义', '换个关键词再 grep 一次'],
      },
      i: 1,
    });
    expect(collapsed[3]?.item).toEqual({ kind: 'thinking', text: '单独一条后续思考', id: 'th-4' });
  });

  test('ThinkingRow omits preview text when collapsed and shows full steps when expanded', () => {
    const traces = ['先列出 MCP 工具', '第一次 grep 报错', 'English internal reasoning step'];
    const collapsedHtml = renderToStaticMarkup(
      createElement(I18nProvider, {
        initialLocale: 'zh',
        children: createElement(ThinkingRow, { text: traces }),
      }),
    );
    expect(collapsedHtml).toContain('思考 3 步');
    expect(collapsedHtml).not.toContain('English internal reasoning step');
    expect(collapsedHtml).not.toContain('先列出 MCP 工具');

    const singleCollapsedHtml = renderToStaticMarkup(
      createElement(I18nProvider, {
        initialLocale: 'zh',
        children: createElement(ThinkingRow, { text: 'The task has been created.' }),
      }),
    );
    expect(singleCollapsedHtml).toContain('思考');
    expect(singleCollapsedHtml).not.toContain('The task has been created.');

    const expandedHtml = renderToStaticMarkup(
      createElement(I18nProvider, {
        initialLocale: 'zh',
        children: createElement(ThinkingRow, { text: traces, defaultOpen: true }),
      }),
    );
    expect(expandedHtml).toContain('思考 3 步');
    expect(expandedHtml).toContain('第 1 步');
    expect(expandedHtml).toContain('先列出 MCP 工具');
    expect(expandedHtml).toContain('第 2 步');
    expect(expandedHtml).toContain('第一次 grep 报错');
    expect(expandedHtml).toContain('第 3 步');
    expect(expandedHtml).toContain('English internal reasoning step');
  });

  test('ChiefStreamRow hides thinking and thinking-group rows while keeping streaming live pulse', () => {
    const renderChiefRow = (item: Parameters<typeof ChiefStreamRow>[0]['item']) =>
      renderToStaticMarkup(
        createElement(MemoryRouter, {
          children: createElement(I18nProvider, {
            initialLocale: 'en',
            children: createElement(MessageScrollerProvider, {
              children: createElement(MessageScroller, {
                children: createElement(ChiefStreamRow, {
                  item,
                  index: 0,
                  onCopy: () => {},
                  onRewindRequest: () => {},
                }),
              }),
            }),
          }),
        }),
      );

    const emptyWrapper = renderToStaticMarkup(
      createElement(MemoryRouter, {
        children: createElement(I18nProvider, {
          initialLocale: 'en',
          children: createElement(MessageScrollerProvider, {
            children: createElement(MessageScroller, { children: null }),
          }),
        }),
      }),
    );

    expect(renderChiefRow({ kind: 'thinking', id: 'th-1', text: 'The task has been created.' })).toBe(
      emptyWrapper,
    );
    expect(
      renderChiefRow({
        kind: 'thinking-group',
        id: 'th-g',
        texts: ['Step 1', 'The task has been created.'],
      }),
    ).toBe(emptyWrapper);
    expect(renderChiefRow({ kind: 'streaming', label: '正在思考' })).toContain('data-testid="typing-dots"');
  });
});
