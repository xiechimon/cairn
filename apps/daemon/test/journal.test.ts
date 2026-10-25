import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ClaimedStep } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { StepJournal, TranscriptBuffer } from '../src/journal.js';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'cairn-journal-'));
}

const claimed: ClaimedStep = {
  step: { id: 's1', buildId: 'b1', kind: 'plan', machineId: 'm1', createdAt: 1 },
  conversationId: 'b1',
  session: { action: 'new', sessionId: null },
  todo: { id: 't1', seqNum: 1, title: '探针', spec: '写一行' },
  project: { id: 'p1', name: 'demo', repo: null },
  agent: null,
};

describe('StepJournal', () => {
  test('claim → update → pending → remove lifecycle', () => {
    const dir = tmp();
    const j = new StepJournal(dir);
    j.claim({
      stepId: 's1',
      buildId: 'b1',
      kind: 'plan',
      conversationId: 'b1',
      sessionAction: 'new',
      prompt: '探针\n\n写一行',
      claimed,
    });
    expect(j.pending().map((e) => e.stepId)).toEqual(['s1']);
    expect(j.get('s1')?.state).toBe('claimed');
    expect(j.get('s1')?.claimed?.todo?.title).toBe('探针');

    j.update('s1', { state: 'running', sessionId: 'pi-sess' });
    expect(j.get('s1')?.sessionId).toBe('pi-sess');
    expect(j.pending()).toHaveLength(1);

    j.update('s1', { state: 'done' });
    expect(j.pending()).toHaveLength(0);
    j.remove('s1');
    expect(j.get('s1')).toBeNull();
    expect(existsSync(join(dir, 'step-s1.json'))).toBe(false);
  });

  test('journal persists across instances (the durable surface hosting crash recovery)', () => {
    const dir = tmp();
    const j1 = new StepJournal(dir);
    j1.claim({
      stepId: 's2',
      buildId: 'b2',
      kind: 'build',
      conversationId: 'b2',
      sessionAction: 'continue',
      sessionId: 'sess-x',
      prompt: null,
      claimed,
    });
    j1.update('s2', { state: 'running' });
    const j2 = new StepJournal(dir);
    const entry = j2.get('s2');
    expect(entry?.state).toBe('running');
    expect(entry?.sessionId).toBe('sess-x');
    expect(j2.pending().map((e) => e.stepId)).toEqual(['s2']);
  });
});

describe('TranscriptBuffer', () => {
  test('idempotent upsert by id + createdAt ordering + read-back across instances', () => {
    const dir = tmp();
    const t1 = new TranscriptBuffer(dir, 's1');
    t1.upsert({ id: 'msg-2', role: 'assistant', content: 'b', createdAt: 200 });
    t1.upsert({ id: 'user-s1', role: 'user', content: 'a', createdAt: 100 });
    t1.upsert({ id: 'msg-2', role: 'assistant', content: 'b-final', createdAt: 200 });
    expect(t1.messages().map((m) => m.id)).toEqual(['user-s1', 'msg-2']);
    expect(t1.messages()[1]?.content).toBe('b-final');

    const t2 = new TranscriptBuffer(dir, 's1');
    expect(t2.messages()).toHaveLength(2);
    t2.upsert({ id: 'call-1', role: 'assistant', content: { kind: 'toolcall' }, createdAt: 150 });
    expect(t2.messages().map((m) => m.id)).toEqual(['user-s1', 'call-1', 'msg-2']);
  });
});
