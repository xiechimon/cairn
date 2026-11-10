import { DONE_ROW } from '@cairn/shared';
import { expect, test } from 'vitest';
import { type MessageRow, mapTranscript } from '../src/api/mappers.js';
import type { TranscriptItem } from '../src/fixtures/records.js';
import { NOW, todo } from './helpers.js';

function doneMessage(): MessageRow {
  return { id: 'msg-done', role: 'system', content: DONE_ROW, createdAt: NOW - 1_000 };
}

function notesFor(verified: boolean | undefined): string[] {
  const base = todo(12, 'done');
  const items: TranscriptItem[] = mapTranscript({
    messages: [doneMessage()],
    steps: [],
    plans: [],
    build: null,
    todo: verified === undefined ? base : { ...base, verified },
    machineName: null,
    userName: 'Xmon Dai',
    liveText: '',
  });
  return items
    .filter((item): item is Extract<TranscriptItem, { kind: 'note' }> => item.kind === 'note')
    .map((item) => item.text);
}

test('F1: the done row reads the finished word and ignores a stored verify bit', () => {
  expect(notesFor(undefined)).toEqual(['已完成']);
  expect(notesFor(false)).toEqual(['已完成']);
  expect(notesFor(true)).toEqual(['已完成']);
});

test('F3: the stored row text is unchanged so the trajectory outcome keeps matching it', () => {
  expect(DONE_ROW).toBe('🎉 任务已完成');
});
