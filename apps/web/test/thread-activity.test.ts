import { describe, expect, test } from 'vitest';
import { mapChiefStream, type MessageRow } from '../src/api/mappers.js';
import { foldTaskCards, placeReportCards, todoGlanceOf } from '../src/chief/chief-task-refs.js';
import { groupThreadEvents } from '../src/chief/thread-activity.js';
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
