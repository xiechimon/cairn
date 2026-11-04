import { describe, expect, test } from 'vitest';
import { formatTurnDuration } from '../src/components/chat/turn-fold.js';
import type { ChiefStreamItem, TranscriptItem } from '../src/fixtures/records.js';
import { EN } from '../src/i18n/en.js';
import { type TFunc, translate } from '../src/i18n/translate.js';
import {
  type ChiefRow,
  chiefTurns,
  groupTurns,
  isTurnOpen,
  latestOpenTurnId,
  PURPOSE_MAX_LENGTH,
  purposeOf,
  transcriptTurns,
} from '../src/lib/turn-fold.js';

const en: TFunc = (source, vars) => translate('en', EN, source, vars);

const user = (id: string, text: string, createdAt?: number): TranscriptItem => ({
  kind: 'user',
  id,
  text,
  ...(createdAt === undefined ? {} : { createdAt }),
});
const robot = (id: string, createdAt?: number): TranscriptItem => ({
  kind: 'robot',
  id,
  markdown: 'done',
  ...(createdAt === undefined ? {} : { createdAt }),
});
const work: TranscriptItem = { kind: 'work', id: 'w', steps: [] };
const streaming: TranscriptItem = { kind: 'streaming', label: '执行中...' };

describe('purposeOf', () => {
  test('takes the first non-empty line and collapses whitespace', () => {
    expect(purposeOf('\n\n  Fix   the flaky\tlogin test \nsecond line')).toBe(
      'Fix the flaky login test',
    );
  });

  test('truncates long lines with an ellipsis within the limit', () => {
    const purpose = purposeOf('x'.repeat(200));
    expect(purpose.length).toBe(PURPOSE_MAX_LENGTH);
    expect(purpose.endsWith('…')).toBe(true);
  });

  test('is empty for blank text', () => {
    expect(purposeOf(' \n ')).toBe('');
  });
});

describe('formatTurnDuration', () => {
  test.each([
    [1, '1 second'],
    [59, '59 seconds'],
    [60, '1 minute'],
    [240, '4 minutes'],
    [3599, '59 minutes'],
    [3600, '1 hour'],
    [7300, '2 hours'],
  ])('%i seconds reads %s', (seconds, text) => {
    expect(formatTurnDuration(seconds, en)).toBe(text);
  });
});

describe('thread turns', () => {
  test('a finished turn folds from its user message to its last row', () => {
    const items = [user('u1', 'Fix it\nplease', 1000), work, robot('r1', 241_000)];
    const [segment] = groupTurns(items, transcriptTurns);
    expect(segment).toMatchObject({
      kind: 'turn',
      turn: { id: 'u1', purpose: 'Fix it', status: 'done', seconds: 240 },
    });
    expect(segment?.kind === 'turn' && segment.turn.rows.map((row) => row.index)).toEqual([0, 1, 2]);
  });

  test('each user message starts its own turn', () => {
    const segments = groupTurns(
      [user('u1', 'one'), robot('r1'), user('u2', 'two'), robot('r2')],
      transcriptTurns,
    );
    expect(segments.map((segment) => segment.kind)).toEqual(['turn', 'turn']);
  });

  test('a turn with a streaming row stays loose and open', () => {
    const segments = groupTurns([user('u1', 'go', 1000), work, robot('r1'), streaming], transcriptTurns);
    expect(segments.map((segment) => segment.kind)).toEqual(['row', 'row', 'row', 'row']);
  });

  test('a fail row marks the turn failed', () => {
    const [segment] = groupTurns(
      [user('u1', 'bump', 0), { kind: 'fail', title: 'x', body: 'y' }, robot('r', 120_000)],
      transcriptTurns,
    );
    expect(segment).toMatchObject({ kind: 'turn', turn: { status: 'failed', seconds: 120 } });
  });

  test('a turn without a terminal row is not folded', () => {
    const segments = groupTurns([user('u1', 'go'), work], transcriptTurns);
    expect(segments.map((segment) => segment.kind)).toEqual(['row', 'row']);
  });

  test('rows before the first user message and run markers stay loose', () => {
    const segments = groupTurns(
      [{ kind: 'run' }, user('u1', 'go'), robot('r1'), { kind: 'scheduled' }, work],
      transcriptTurns,
    );
    expect(segments.map((segment) => segment.kind)).toEqual(['row', 'turn', 'row', 'row']);
  });

  test('a single timestamp yields no duration', () => {
    const [segment] = groupTurns([user('u1', 'go', 5000), robot('r1')], transcriptTurns);
    expect(segment).toMatchObject({ kind: 'turn', turn: { seconds: null } });
  });

  test('a blank user message is not folded', () => {
    const segments = groupTurns([user('u1', ' '), robot('r1')], transcriptTurns);
    expect(segments.map((segment) => segment.kind)).toEqual(['row', 'row']);
  });
});

const rows = (items: ChiefStreamItem[]): ChiefRow[] => items.map((item, i) => ({ item, i }));
const chiefUser = (id: string, createdAt?: number): ChiefStreamItem => ({
  kind: 'user',
  id,
  text: `ask ${id}`,
  ...(createdAt === undefined ? {} : { createdAt }),
});
const chiefRobot = (id: string, createdAt?: number): ChiefStreamItem => ({
  kind: 'robot',
  id,
  markdown: 'ok',
  seconds: '',
  ...(createdAt === undefined ? {} : { createdAt }),
});

describe('Coordinator turns', () => {
  test('a user message with its reply folds with a duration', () => {
    const [segment] = groupTurns(rows([chiefUser('a', 0), chiefRobot('b', 90_000)]), chiefTurns);
    expect(segment).toMatchObject({
      kind: 'turn',
      turn: { id: 'a', purpose: 'ask a', status: 'done', seconds: 90 },
    });
  });

  test('a typing reply, a streaming row and a pending question keep the turn loose', () => {
    const live: ChiefStreamItem[][] = [
      [chiefUser('a'), { ...(chiefRobot('b') as ChiefStreamItem & { kind: 'robot' }), typing: true }],
      [chiefUser('a'), { kind: 'streaming', label: 'x' }],
      [
        chiefUser('a'),
        {
          kind: 'question',
          requestId: 'q',
          status: 'pending',
          questions: [],
          answers: null,
        },
      ],
    ];
    for (const items of live) {
      const segments = groupTurns(rows(items), chiefTurns);
      expect(segments.every((segment) => segment.kind === 'row')).toBe(true);
    }
  });

  test('an error row marks the turn failed', () => {
    const [segment] = groupTurns(rows([chiefUser('a', 0), { kind: 'error', text: 'x', createdAt: 30_000 }]), chiefTurns);
    expect(segment).toMatchObject({ kind: 'turn', turn: { status: 'failed', seconds: 30 } });
  });

  test('thread reports between turns stay outside every fold', () => {
    const segments = groupTurns(
      rows([
        chiefUser('a'),
        chiefRobot('b'),
        {
          kind: 'thread-message',
          id: 'm',
          todoId: 't',
          seqNum: 1,
          excerpt: 'hi',
        } as ChiefStreamItem,
        chiefUser('c'),
        chiefRobot('d'),
      ]),
      chiefTurns,
    );
    expect(segments.map((segment) => segment.kind)).toEqual(['turn', 'row', 'turn']);
  });

  test('rows keep their stream index for the row renderer', () => {
    const [segment] = groupTurns(rows([chiefUser('a'), chiefRobot('b')]), chiefTurns);
    expect(segment?.kind === 'turn' && segment.turn.rows.map((row) => row.item.i)).toEqual([0, 1]);
  });
});

describe('default-open turn', () => {
  const finished = (id: string): TranscriptItem[] => [user(id, `ask ${id}`), robot(`r-${id}`)];
  const segmentsOf = (items: TranscriptItem[]) => groupTurns(items, transcriptTurns);

  test('the last finished turn is the default-open one and earlier turns fold', () => {
    const segments = segmentsOf([...finished('a'), ...finished('b')]);
    expect(latestOpenTurnId(segments, transcriptTurns)).toBe('b');
  });

  test('a trailing marker row does not fold the last turn', () => {
    const segments = segmentsOf([
      ...finished('a'),
      { kind: 'run' },
    ]);
    expect(latestOpenTurnId(segments, transcriptTurns)).toBe('a');
  });

  test('a following user row folds the previous turn', () => {
    const segments = segmentsOf([...finished('a'), user('b', 'next'), streaming]);
    expect(latestOpenTurnId(segments, transcriptTurns)).toBeNull();
  });

  test('no turn segments means no default-open turn', () => {
    expect(latestOpenTurnId(segmentsOf([work]), transcriptTurns)).toBeNull();
  });

  test('a manual toggle flips relative to the default', () => {
    expect(isTurnOpen('b', 'b', new Set())).toBe(true);
    expect(isTurnOpen('b', 'b', new Set(['b']))).toBe(false);
    expect(isTurnOpen('a', 'b', new Set())).toBe(false);
    expect(isTurnOpen('a', 'b', new Set(['a']))).toBe(true);
  });
});
