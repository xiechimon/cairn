import { describe, expect, test } from 'vitest';
import { mapChiefStream, type MessageRow } from '../src/api/mappers.js';
import { foldTaskCards, placeReportCards, todoGlanceOf } from '../src/chief/chief-task-refs.js';
import { groupThreadEvents, subThreadRowIds } from '../src/chief/thread-activity.js';
import type { TodoGlance } from '../src/detail/segments.js';
import type { ChiefStreamItem } from '../src/fixtures/records.js';

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

const card = (todoId: string): ChiefStreamItem => ({
  kind: 'task-card',
  projectId: null,
  id: nextId(),
  todoId,
  seq: 1,
  title: todoId,
});

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

describe('subThreadRowIds', () => {
  test('a thread already shown by its task card gets no row from its reports', () => {
    expect(subThreadRowIds([card('code'), report('code'), message('code')], glances).size).toBe(0);
  });

  test('research hangs under its code task, so its reports add no row of their own', () => {
    expect(subThreadRowIds([card('code'), report('research', 'needs-you')], glances).size).toBe(0);
  });

  test('a reply that only mentions a thread does not stand in for its row', () => {
    const reply: ChiefStreamItem = {
      kind: 'robot',
      seconds: '1',
      markdown: '[#1](todo:other) is still queued.',
    };
    const first = report('other');
    expect([...subThreadRowIds([reply, first], glances)]).toEqual([first.id]);
  });

  test('a thread with no task card shows exactly one row, at its first event', () => {
    const first = report('other');
    const stream = [first, message('other'), report('other', 'needs-you')];
    expect([...subThreadRowIds(stream, glances)]).toEqual([first.id]);
  });
});

describe('groupThreadEvents', () => {
  test('report and message rows are dropped and the kept one becomes a title-only row', () => {
    const kept = report('other');
    const user: ChiefStreamItem = { kind: 'user', id: nextId(), text: 'hi' };
    const rows = [user, kept, report('other', 'needs-you')].map((item, i) => ({ item, i }));
    expect(groupThreadEvents(rows, new Set([kept.id]))).toEqual([
      { item: user, i: 0 },
      {
        item: { kind: 'thread-activity', id: kept.id, todoId: 'other', title: 'other' },
        i: 1,
      },
    ]);
  });
});

describe('todoGlanceOf', () => {
  test('only research opened before planning names a parent', () => {
    expect(glances.get('research')?.parentId).toBe('code');
    expect(glances.get('other')?.parentId).toBeUndefined();
    expect(
      todoGlanceOf({
        phase: 'queued',
        title: 'x',
        sourceKind: 'research',
        sourceRef: 'before-plan:code',
      }).parentId,
    ).toBeUndefined();
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
  const kept = subThreadRowIds(stream, reportGlances);
  const { rows, startedBy } = foldTaskCards(
    groupThreadEvents(
      stream.map((item, i) => ({ item, i })),
      kept,
    ),
    reportGlances,
  );
  const reports = placeReportCards(rows, startedBy, reportGlances, new Set());
  const bubble = (id: string) => rows.find(({ item }) => 'id' in item && item.id === id)?.item;

  test('a notice or a silent acknowledgement replaces the standalone row for that build', () => {
    expect([...kept]).toEqual(['r-unanswered', 'r-reworked']);
    expect(rows.map(({ item }) => item.kind)).toEqual([
      'robot',
      'thread-activity',
      'robot',
      'thread-activity',
    ]);
  });

  test('the notice carries the report line only while its build is still the delivered one', () => {
    expect(reports.get(bubble('n-told')!)).toEqual(['told']);
    expect(reports.has(bubble('n-reworked')!)).toBe(false);
  });
});
