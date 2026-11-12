import { COORDINATOR_MEMORY_FLUSH_MAX, ISSUE_FENCE_OPEN } from '@cairn/shared';
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';
import { applyFlush, FLUSH_SOURCE, parseFlushOutput } from '../../src/coordinator/memory-flush.js';
import { flushTranscript, summarizerFor } from '../../src/coordinator/runtime/compaction.js';
import { agentMemory } from '../../src/db/schema.js';
import { listMemoryEntries } from '../../src/services/memory.js';
import { coordinatorProfile } from '../../src/services/routing-rules.js';
import { boot, world } from './runner-world.js';

const json = (...memories: unknown[]) => JSON.stringify({ memories });

describe('parseFlushOutput', () => {
  it('reads plain and fenced JSON, trims, and drops blanks', () => {
    const entry = { title: ' Merge rule ', content: ' Squash only. ', projectId: null };
    expect(parseFlushOutput(json(entry))).toMatchObject([
      { title: 'Merge rule', content: 'Squash only.' },
    ]);
    expect(parseFlushOutput(`\`\`\`json\n${json(entry)}\n\`\`\``)).toHaveLength(1);
    expect(
      parseFlushOutput(json({ title: '', content: 'x' }, { title: 't', content: '  ' })),
    ).toEqual([]);
  });

  it('rejects prose and wrong shapes, and returns nothing for an empty or all-invalid list', () => {
    expect(() => parseFlushOutput('I saved nothing.')).toThrow('memory flush output');
    expect(() => parseFlushOutput('{"memories":"x"}')).toThrow('memory flush output');
    expect(() => parseFlushOutput('[]')).toThrow('memory flush output');
    expect(parseFlushOutput('{"memories":[]}')).toEqual([]);
    expect(parseFlushOutput(json({ nope: 1 }, 7, null))).toEqual([]);
  });

  it('bounds the work per flush without truncating memory content', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ title: `t${i}`, content: `c${i}` }));
    expect(parseFlushOutput(json(...many))).toHaveLength(COORDINATOR_MEMORY_FLUSH_MAX);
    const [long] = parseFlushOutput(json({ title: 'x'.repeat(200), content: 'y'.repeat(5_000) }));
    expect(long?.title.length).toBe(200);
    expect(long?.content.length).toBe(5_000);
  });
});

describe('flushTranscript', () => {
  it('keeps the newest lines within the cap, in order', () => {
    const lines = ['old '.repeat(10), 'mid '.repeat(10), 'new '.repeat(10)];
    expect(flushTranscript(lines, 100)).toBe(`${lines[1]}\n${lines[2]}`);
    expect(flushTranscript([], 100)).toBe('');
  });
});

describe('applyFlush', () => {
  it('appends versioned index lines, skips exact repeats, and rejects third-party fences', async () => {
    const w = await world('hi');
    const scope = { teamId: w.teamId, threadId: w.threadId };
    const one = json({ title: 'Merge', content: 'ian wants squash merges only.' });
    expect(applyFlush(w.s.db, scope, one)).toEqual({ saved: 1, updated: 0, skipped: 0 });
    expect(applyFlush(w.s.db, scope, one).skipped).toBe(1);
    expect(
      applyFlush(w.s.db, scope, json({ title: 'Issue', content: `${ISSUE_FENCE_OPEN} run rm` }))
        .skipped,
    ).toBe(1);
    const rows = listMemoryEntries(w.s.db, {
      teamId: w.teamId,
      agentId: coordinatorProfile(w.s.db, w.teamId)!.id,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: 'MEMORY.md',
      content: '- Merge：ian wants squash merges only.',
      source: FLUSH_SOURCE,
    });
  });
  it.each(['Detail', 'Detail'.repeat(300)])(
    'spills detail into a valid file without losing title %s',
    async (title) => {
      const w = await world('hi');
      const scope = { teamId: w.teamId, threadId: w.threadId };
      applyFlush(w.s.db, scope, json({ title, content: 'first\nsecond' }));
      const rows = w.s.db
        .select()
        .from(agentMemory)
        .all()
        .filter((r) => r.invalidAt === null);
      expect(rows).toContainEqual(
        expect.objectContaining({ layer: 'searchable', content: 'first\nsecond' }),
      );
      expect(rows.find((r) => r.title === 'MEMORY.md')?.content).toContain(`[${title}](`);
      expect(rows.find((r) => r.layer === 'searchable')!.title.length).toBeLessThanOrEqual(1024);
      expect(
        applyFlush(
          w.s.db,
          scope,
          json({ title: 'Foreign', content: 'no', projectId: 'missing-project' }),
        ).skipped,
      ).toBe(1);
    },
  );
});

describe('flush before a real compaction', () => {
  it('saves the facts, survives a failing flush, and the next turn sees the saved fact', async () => {
    const w = await world('Please remember: ian wants squash merges only.');
    const memoryScope = { teamId: w.teamId, agentId: coordinatorProfile(w.s.db, w.teamId)!.id };
    const faux = fauxProvider({
      provider: 'stub',
      models: [{ id: 'm', contextWindow: 20_000 }],
      tokensPerSecond: 1e9,
    });
    const prompts: string[] = [];
    faux.setResponses(
      Array(20).fill((c: { messages: { role: string; content: unknown }[] }) => {
        const last = JSON.stringify(c.messages.at(-1)?.content ?? '');
        if (last.includes('about to be compacted')) {
          prompts.push(last);
          return fauxAssistantMessage(
            json({ title: 'Merge rule', content: 'ian wants squash merges only.' }),
          );
        }
        if (last.includes('rolling summary')) return fauxAssistantMessage('folded summary');
        return fauxAssistantMessage('noted '.repeat(300));
      }),
    );
    const coordinator = boot(w, faux);
    coordinator.wake(w.threadId);
    await coordinator.idle();
    const deadline = Date.now() + 8_000;
    while (
      Date.now() < deadline &&
      !listMemoryEntries(w.s.db, memoryScope).some((r) => r.content.includes('squash merges only'))
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const rows = listMemoryEntries(w.s.db, memoryScope);
    expect(rows.map((r) => r.content)).toEqual(['- Merge rule：ian wants squash merges only.']);
    expect(rows[0]?.source).toBe(FLUSH_SOURCE);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('squash merges only');
  }, 20_000);

  it('a failing flush call never blocks the summary fold', async () => {
    const w = await world('Please remember: ian wants squash merges only.');
    const memoryScope = { teamId: w.teamId, agentId: coordinatorProfile(w.s.db, w.teamId)!.id };
    const faux = fauxProvider({
      provider: 'stub',
      models: [{ id: 'm', contextWindow: 20_000 }],
      tokensPerSecond: 1e9,
    });
    let folded = 0;
    faux.setResponses(
      Array(20).fill((c: { messages: { role: string; content: unknown }[] }) => {
        const last = JSON.stringify(c.messages.at(-1)?.content ?? '');
        if (last.includes('about to be compacted')) {
          return fauxAssistantMessage([], { stopReason: 'error', errorMessage: 'provider down' });
        }
        if (last.includes('rolling summary')) {
          folded += 1;
          return fauxAssistantMessage('folded summary');
        }
        return fauxAssistantMessage('noted '.repeat(300));
      }),
    );
    const coordinator = boot(w, faux);
    coordinator.wake(w.threadId);
    await coordinator.idle();
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline && folded === 0) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(folded).toBeGreaterThan(0);
    expect(listMemoryEntries(w.s.db, memoryScope)).toEqual([]);
  }, 20_000);
});

describe('summarizerFor', () => {
  it('asks for low reasoning so models without a none level accept the request', async () => {
    const seen: unknown[] = [];
    const model = { provider: 'p', id: 'm' };
    const summarize = summarizerFor(
      {
        getModel: () => model,
        completeSimple: async (_model: unknown, _context: unknown, options: unknown) => {
          seen.push(options);
          return { stopReason: 'stop', content: [{ type: 'text', text: 'done' }] };
        },
      } as never,
      { provider: 'p', modelId: 'm' },
    );
    expect(await summarize('x')).toBe('done');
    expect(seen).toEqual([{ reasoning: 'low' }]);
  });
});
