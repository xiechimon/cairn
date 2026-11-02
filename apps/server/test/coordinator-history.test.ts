import { eq, sql } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { chiefMessage, chiefSummary } from '../src/db/schema.js';
import {
  assembleCoordinatorHistory,
  estimateTokens,
  OUTPUT_RESERVE_TOKENS,
} from '../src/services/coordinator-history.js';
import { H, registerChiefHarness } from './chief-harness.js';

registerChiefHarness();

const BASE = 1_700_000_000_000;
let n = 0;
function add(role: 'user' | 'assistant' | 'system', content: unknown, id = `r${n}`): string {
  H.s.db
    .insert(chiefMessage)
    .values({ id, threadId: H.threadId, role, content, createdAt: BASE + n })
    .run();
  n += 1;
  return id;
}

function assemble(contextWindow = 200_000, fixedText = '') {
  return assembleCoordinatorHistory(H.s.db, {
    threadId: H.threadId,
    turnCreatedAt: BASE + 1_000_000,
    contextWindow,
    fixedText,
  });
}

describe('assembleCoordinatorHistory (D70 C3)', () => {
  test('roles alternate, tool calls become short notes, tool results and system rows are pruned', () => {
    n = 0;
    add('user', 'hello');
    add('assistant', {
      kind: 'toolcall',
      call: { name: 'todos', arguments: { q: 'x'.repeat(500) } },
    });
    add('user', { kind: 'toolresult', result: 'y'.repeat(5000) });
    add('assistant', 'there are 3 todos');
    add('system', 'internal');
    add('user', 'next');
    add('assistant', 'ok');
    const h = assemble();
    expect(h.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(h.messages[1]?.text).toContain('[called todos ');
    expect(h.messages[1]?.text.length).toBeLessThan(260);
    expect(JSON.stringify(h.messages)).not.toContain('yyyy');
    expect(JSON.stringify(h.messages)).not.toContain('internal');
  });

  test('trailing user messages are handed back as unanswered, not left dangling', () => {
    n = 0;
    add('user', 'q1');
    add('assistant', 'a1');
    add('user', 'q2 got no reply');
    add('user', 'q3 now');
    const h = assemble();
    expect(h.messages.at(-1)?.role).toBe('assistant');
    expect(h.unanswered).toEqual(['q2 got no reply\n\nq3 now']);
  });

  test('a daemon prompt row that repeats a posted message is not counted twice; a wake prompt row is kept', () => {
    n = 0;
    add('user', 'posted question');
    add('user', 'posted question', 'user-step1');
    add('assistant', 'answer');
    add('user', '[wake:gate] provenance=watch:t1\ncheck #12', 'user-step2');
    add('assistant', 'checked');
    const h = assemble();
    expect(h.messages[0]?.text).toBe('posted question');
    expect(h.messages[2]?.text).toContain('[event] provenance=watch:t1');
  });

  test('messages a summary covers are left out and the summary section names its cursor', () => {
    n = 0;
    add('user', 'old q');
    const covered = add('assistant', 'old a');
    add('user', 'new q');
    add('assistant', 'new a');
    const row = H.s.db
      .select({ rowid: sql<number>`rowid`, createdAt: chiefMessage.createdAt })
      .from(chiefMessage)
      .where(eq(chiefMessage.id, covered))
      .get()!;
    H.s.db
      .insert(chiefSummary)
      .values({
        threadId: H.threadId,
        summary: 'SUMMARY',
        coveredThroughId: covered,
        coveredAt: row.createdAt,
        coveredRowid: row.rowid,
        compactedMessages: 2,
        generation: 1,
        updatedAt: 1,
      })
      .run();
    const h = assemble();
    expect(h.messages.map((m) => m.text)).toEqual(['new q', 'new a']);
    expect(h.summarySection).toContain(
      '<compacted_thread_summary>\nSUMMARY\n</compacted_thread_summary>',
    );
    expect(h.summarySection).toContain(covered);
  });

  test('over the token budget the oldest exchanges drop first and the history still starts with a user', () => {
    n = 0;
    for (let i = 0; i < 10; i++) {
      add('user', `q${i} ${'w'.repeat(3000)}`);
      add('assistant', `a${i} ${'v'.repeat(3000)}`);
    }
    const perPair =
      estimateTokens(`q0 ${'w'.repeat(3000)}`) + estimateTokens(`a0 ${'v'.repeat(3000)}`);
    const h = assemble(OUTPUT_RESERVE_TOKENS + perPair * 3 + 10);
    expect(h.messages.length).toBe(6);
    expect(h.messages[0]?.role).toBe('user');
    expect(h.messages[0]?.text.startsWith('q7')).toBe(true);
    expect(h.droppedMessages).toBe(14);
  });

  test('without a summary only the newest 100 rows are read, so enabling the flag on a long thread stays bounded', () => {
    n = 0;
    for (let i = 0; i < 150; i++) add(i % 2 === 0 ? 'user' : 'assistant', `m${i}`);
    const h = assemble();
    expect(h.messages[0]?.text).toBe('m50');
    expect(h.messages.length).toBe(100);
  });

  test('a huge message is cut with a pointer to read_history for the rest', () => {
    n = 0;
    const id = add('user', 'h'.repeat(3_890_000));
    add('assistant', 'ok');
    const first = assemble().messages[0]?.text ?? '';
    expect(first.length).toBeLessThan(8_200);
    expect(first).toContain(`read_history ids ["${id}"] offset 8000`);
  });

  test('messages after the turn was queued are not part of its history', () => {
    n = 0;
    add('user', 'before');
    add('assistant', 'reply');
    H.s.db
      .insert(chiefMessage)
      .values({
        id: 'late',
        threadId: H.threadId,
        role: 'user',
        content: 'later',
        createdAt: BASE + 2_000_000,
      })
      .run();
    expect(JSON.stringify(assemble().messages)).not.toContain('later');
  });
});
