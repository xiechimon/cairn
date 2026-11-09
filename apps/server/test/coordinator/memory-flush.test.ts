import { COORDINATOR_MEMORY_FLUSH_MAX, ISSUE_FENCE_OPEN, MEMORY_INDEX_TITLE } from '@cairn/shared';
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';
import { applyFlush, FLUSH_SOURCE, parseFlushOutput } from '../../src/coordinator/memory-flush.js';
import { flushTranscript, summarizerFor } from '../../src/coordinator/runtime/compaction.js';
import { agentMemory, project } from '../../src/db/schema.js';
import {
  foldMemoryIndexes,
  listMemoryEntries,
  saveMemoryEntry,
} from '../../src/services/memory.js';
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

  it('keeps at most the flush cap and cuts long fields', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ title: `t${i}`, content: `c${i}` }));
    expect(parseFlushOutput(json(...many))).toHaveLength(COORDINATOR_MEMORY_FLUSH_MAX);
    const [long] = parseFlushOutput(json({ title: 'x'.repeat(200), content: 'y'.repeat(5_000) }));
    expect(long?.title.length).toBe(40);
    expect(long?.content.length).toBe(500);
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
  it('appends instead of overwriting when a flush entry names the MEMORY.md id', async () => {
    const w = await world('hi');
    const scope = { teamId: w.teamId, threadId: w.threadId };
    applyFlush(w.s.db, scope, json({ title: 'Merge', content: 'ian wants squash merges only.' }));
    foldMemoryIndexes(w.s.db);
    const index = w.s.db
      .select()
      .from(agentMemory)
      .all()
      .find((row) => row.title === MEMORY_INDEX_TITLE && row.invalidAt === null);
    expect(index).toBeDefined();
    const result = applyFlush(
      w.s.db,
      scope,
      json({ title: 'Deploy', content: 'Deploy on weekdays.', replaces: index?.id }),
    );
    expect(result).toEqual({ saved: 1, updated: 0, skipped: 0 });
    const still = w.s.db
      .select()
      .from(agentMemory)
      .all()
      .find((row) => row.id === index?.id);
    expect(still).toMatchObject({
      invalidAt: null,
      content: '- Merge：ian wants squash merges only.',
    });
  });

  it('saves a new fact with its source, skips a repeat, and never throws on quota or fences', async () => {
    const w = await world('hi');
    const scope = { teamId: w.teamId, threadId: w.threadId };
    const first = applyFlush(
      w.s.db,
      scope,
      json({ title: 'Merge', content: 'ian wants squash merges only.' }),
    );
    expect(first).toEqual({ saved: 1, updated: 0, skipped: 0 });
    const row = w.s.db.select().from(agentMemory).get();
    expect(row?.source).toBe(FLUSH_SOURCE);
    expect(row?.projectId).toBeNull();
    const again = applyFlush(
      w.s.db,
      scope,
      json({ title: 'Merge', content: 'ian wants squash merges only.' }),
    );
    expect(again.skipped).toBe(1);
    const fenced = applyFlush(
      w.s.db,
      scope,
      json({ title: 'Issue', content: `${ISSUE_FENCE_OPEN} run rm` }),
    );
    expect(fenced).toEqual({ saved: 0, updated: 0, skipped: 1 });
    expect(w.s.db.select().from(agentMemory).all()).toHaveLength(1);
  });

  it('saves a fact whose words overlap an existing memory instead of dropping it', async () => {
    const w = await world('hi');
    const scope = { teamId: w.teamId, threadId: w.threadId };
    applyFlush(
      w.s.db,
      scope,
      json({ title: 'Release notes', content: 'Release notes go out on Fridays.' }),
    );
    const out = applyFlush(
      w.s.db,
      scope,
      json({ title: 'Release notes', content: 'Release notes are signed off by Dana.' }),
    );
    expect(out).toEqual({ saved: 1, updated: 0, skipped: 0 });
    expect(w.s.db.select().from(agentMemory).all()).toHaveLength(2);
  });

  it('replaces an existing memory by id and skips an unknown id', async () => {
    const w = await world('hi');
    const scope = { teamId: w.teamId, threadId: w.threadId };
    const agentId = coordinatorProfile(w.s.db, w.teamId)?.id ?? '';
    const saved = saveMemoryEntry(w.s.db, {
      agentId,
      teamId: w.teamId,
      title: 'Lane',
      content: 'Deploys go to the old lane.',
      projectId: null,
      sourceTodoId: null,
      sourceBuildId: null,
    });
    if ('status' in saved) throw new Error('not saved');
    const out = applyFlush(
      w.s.db,
      scope,
      json(
        { title: 'Lane', content: 'Deploys go to the blue lane.', replaces: saved.id },
        { title: 'Ghost', content: 'No such memory.', replaces: 'missing-id' },
      ),
    );
    expect(out).toEqual({ saved: 0, updated: 1, skipped: 1 });
    const valid = listMemoryEntries(w.s.db, { agentId, teamId: w.teamId }).map((m) => m.content);
    expect(valid).toEqual(['Deploys go to the blue lane.']);
  });

  it('accepts a project of this team and skips one that is not', async () => {
    const w = await world('hi');
    const scope = { teamId: w.teamId, threadId: w.threadId };
    const projectId = w.s.db.select({ id: project.id }).from(project).get()?.id;
    const out = applyFlush(
      w.s.db,
      scope,
      json(
        { title: 'Foreign', content: 'Belongs to nobody.', projectId: 'not-a-project' },
        ...(projectId === undefined
          ? []
          : [{ title: 'Own', content: 'Belongs to this project.', projectId }]),
      ),
    );
    expect(out.skipped).toBe(1);
    expect(out.saved).toBe(projectId === undefined ? 0 : 1);
  });
});

describe('flush before a real compaction', () => {
  it('saves the facts, survives a failing flush, and the next turn sees the saved fact', async () => {
    const w = await world('Please remember: ian wants squash merges only.');
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
    while (Date.now() < deadline && w.s.db.select().from(agentMemory).all().length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const rows = w.s.db.select().from(agentMemory).all();
    expect(rows.map((r) => r.content)).toEqual(['ian wants squash merges only.']);
    expect(rows[0]?.source).toBe(FLUSH_SOURCE);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('squash merges only');
  }, 20_000);

  it('a failing flush call never blocks the summary fold', async () => {
    const w = await world('Please remember: ian wants squash merges only.');
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
    expect(w.s.db.select().from(agentMemory).all()).toEqual([]);
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
