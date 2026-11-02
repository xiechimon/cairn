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
function add(
  role: 'user' | 'assistant' | 'system',
  content: unknown,
  id = role === 'user' ? `user-step${n}` : `r${n}`,
): string {
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
    claimedAt: BASE + 1_500_000,
    turnPrompt: '',
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
    expect(h.unanswered).toEqual(['q2 got no reply', 'q3 now']);
  });

  test('the prompt the model saw wins over the raw posted copy, even when it carries extra notes; a wake prompt row is kept', () => {
    n = 0;
    add('user', 'posted question', 'posted-1');
    add('user', 'posted question\n\n[project: demo]', 'user-step1');
    add('assistant', 'answer');
    add('user', '[wake:gate] provenance=watch:t1\ncheck #12', 'user-step2');
    add('assistant', 'checked');
    const h = assemble();
    expect(h.messages[0]?.text).toBe('posted question\n\n[project: demo]');
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
    expect(h.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(h.messages[0]?.text.startsWith(h.summarySection ?? 'missing')).toBe(true);
    expect(h.messages[0]?.text.endsWith('new q')).toBe(true);
    expect(JSON.stringify(h.messages)).not.toContain('old q');
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

  test('a turn queued behind a running one sees that reply, and its own posted message stays out of history', () => {
    n = 0;
    add('user', 'qA', 'posted-a');
    add('user', 'qA', 'user-stepA');
    add('user', 'qB', 'posted-b');
    add('assistant', 'aA');
    const h = assembleCoordinatorHistory(H.s.db, {
      threadId: H.threadId,
      turnCreatedAt: BASE + 2,
      claimedAt: BASE + 10,
      turnPrompt: '',
      contextWindow: 200_000,
      fixedText: '',
    });
    expect(h.messages.map((m) => `${m.role}:${m.text}`)).toEqual(['user:qA', 'assistant:aA']);
    expect(h.unanswered).toEqual(['qB']);
    const own = assembleCoordinatorHistory(H.s.db, {
      threadId: H.threadId,
      turnCreatedAt: BASE + 2,
      claimedAt: BASE + 10,
      turnPrompt: 'qB',
      contextWindow: 200_000,
      fixedText: '',
    });
    expect(own.unanswered).toEqual([]);
  });

  test('a long unanswered message is capped and counted against the budget', () => {
    n = 0;
    add('user', 'q1');
    add('assistant', 'a1');
    add('user', 'u'.repeat(50_000), 'posted-long');
    const h = assembleCoordinatorHistory(H.s.db, {
      threadId: H.threadId,
      turnCreatedAt: BASE + 5,
      claimedAt: BASE + 10,
      turnPrompt: 'something else',
      contextWindow: 200_000,
      fixedText: '',
    });
    expect(h.unanswered[0]?.length).toBeLessThan(8_200);
    expect(h.unanswered[0]).toContain('read_history ids ["posted-long"]');
    expect(h.estimatedTokens).toBeGreaterThan(2_000);
  });

  test('a message posted after this turn was queued is left to its own turn', () => {
    n = 0;
    add('user', 'q1');
    add('assistant', 'a1');
    add('user', 'later question', 'posted-later');
    const h = assembleCoordinatorHistory(H.s.db, {
      threadId: H.threadId,
      turnCreatedAt: BASE + 1,
      claimedAt: BASE + 10,
      turnPrompt: '',
      contextWindow: 200_000,
      fixedText: '',
    });
    expect(JSON.stringify(h)).not.toContain('later question');
  });
});
