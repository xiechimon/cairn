import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxProvider,
} from '@earendil-works/pi-ai';
import { desc, eq, SQL, sql } from 'drizzle-orm';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  compactionFailureCounts,
  resetCompactionFailureCounts,
} from '../../src/coordinator/runtime/failure-report.js';
import { SUGGEST_REPLIES_ASK } from '../../src/coordinator/runtime/suggest-replies.js';
import {
  agentMemory,
  chiefMessage,
  chiefThread,
  coordinatorInput,
  project,
  provider,
  step,
} from '../../src/db/schema.js';
import { buildChiefSystemPrompt } from '../../src/services/chief.js';
import { ensureMemoryIndex, listMemoryEntries } from '../../src/services/memory.js';
import { appendMemoryIndex, memoryDocumentVersion } from '../../src/services/memory-documents.js';
import { projectTurnContext } from '../../src/services/project-instructions.js';
import { coordinatorProfile } from '../../src/services/routing-rules.js';
import { req } from '../helpers.js';
import { boot, type World, world } from './runner-world.js';

const MINUTE = 60_000;
const factJson = (title: string, content: string, projectId: string | null = null) =>
  JSON.stringify({ memories: [{ title, content, projectId }], used: [] });

function isFlushPrompt(content: unknown): boolean {
  return JSON.stringify(content ?? '').includes('pick the durable facts');
}

function memoryRows(w: World) {
  return listMemoryEntries(w.s.db, {
    teamId: w.teamId,
    agentId: coordinatorProfile(w.s.db, w.teamId)!.id,
  });
}

function backdateMessages(w: World, ageMs: number) {
  const old = Date.now() - ageMs;
  w.s.db
    .update(chiefMessage)
    .set({ createdAt: old })
    .where(eq(chiefMessage.threadId, w.threadId))
    .run();
}

function watermark(w: World): number | null {
  return (
    w.s.db.select().from(chiefThread).where(eq(chiefThread.id, w.threadId)).get()
      ?.memoryFlushedAt ?? null
  );
}

function countingFaux(onFlush: (call: number) => ReturnType<typeof fauxAssistantMessage>) {
  const faux = fauxProvider({
    provider: 'stub',
    models: [{ id: 'm', contextWindow: 200_000 }],
    tokensPerSecond: 1e9,
  });
  let flushCalls = 0;
  faux.setResponses(
    Array(24).fill((c: { messages: { content: unknown }[] }) => {
      const last = c.messages.at(-1)?.content;
      if (isFlushPrompt(last)) {
        flushCalls += 1;
        return onFlush(flushCalls);
      }
      return fauxAssistantMessage('noted');
    }),
  );
  return { faux, calls: () => flushCalls };
}

function gatedFaux(opts: {
  onFlushStart?: (call: number, prompt: string) => void;
  onFlushEnd?: (call: number) => void;
  gate: Promise<void>;
  reply: (call: number) => string;
}) {
  const base = fauxProvider({
    provider: 'stub',
    models: [{ id: 'm', contextWindow: 200_000 }],
    tokensPerSecond: 1e9,
  });
  base.setResponses(Array(40).fill(fauxAssistantMessage('noted')));
  let flushCalls = 0;
  const provider: typeof base.provider = {
    ...base.provider,
    streamSimple(model, context, options) {
      if (context.messages[0]?.content === SUGGEST_REPLIES_ASK) {
        const stream = createAssistantMessageEventStream();
        const message = {
          ...fauxAssistantMessage('{"replies":[]}'),
          api: model.api,
          provider: model.provider,
          model: model.id,
        };
        stream.push({ type: 'done', reason: 'stop', message });
        stream.end(message);
        return stream;
      }
      const last = context.messages.at(-1)?.content;
      if (!isFlushPrompt(last)) return base.provider.streamSimple(model, context, options);
      flushCalls += 1;
      const call = flushCalls;
      opts.onFlushStart?.(call, String(last));
      const stream = createAssistantMessageEventStream();
      void opts.gate.then(() => {
        opts.onFlushEnd?.(call);
        const message = {
          ...fauxAssistantMessage(opts.reply(call)),
          api: model.api,
          provider: model.provider,
          model: model.id,
        };
        stream.push({ type: 'done', reason: 'stop', message });
        stream.end(message);
      });
      return stream;
    },
  };
  return { provider, calls: () => flushCalls };
}

async function until(check: () => boolean, ms = 8_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline && !check()) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  expect(check()).toBe(true);
}

beforeEach(() => resetCompactionFailureCounts());

describe('idle memory extraction', () => {
  it('extracts facts from an idle conversation through the existing flush', async () => {
    const w = await world('Remember: ian wants squash merges only.');
    const prompts: string[] = [];
    const { faux, calls } = countingFaux(() => {
      prompts.push('flush');
      return fauxAssistantMessage(factJson('Merge rule', 'ian wants squash merges only.'));
    });
    const coordinator = boot(w, faux, { idleMemoryFlushMs: 10 * MINUTE });
    coordinator.wake(w.threadId);
    await coordinator.idle();
    expect(w.s.db.select().from(step).where(eq(step.id, w.stepId)).get()?.status).toBe('done');
    expect(calls()).toBe(0);
    backdateMessages(w, 11 * MINUTE);
    coordinator.tick();
    await coordinator.idle();
    expect(calls()).toBe(1);
    expect(memoryRows(w).map((r) => r.content)).toEqual([
      '- Merge rule：ian wants squash merges only.',
    ]);
    expect(watermark(w)).toBeGreaterThan(0);
    const messages = w.s.db
      .select()
      .from(chiefMessage)
      .where(eq(chiefMessage.threadId, w.threadId))
      .all();
    expect(messages.length).toBeGreaterThanOrEqual(2);
    const prompt = buildChiefSystemPrompt(
      { db: w.s.db, hub: w.s.hub, user: w.s.user, skillsDir: w.s.skillsDir },
      w.teamId,
    ).text;
    expect(prompt).toContain('Merge rule');
    expect(prompt).toContain('squash merges only');
  }, 20_000);

  it('writes a project channel fact into that project memory', async () => {
    const w = await world('hello');
    const pid = 'channel-p';
    w.s.db.insert(project).values({ id: pid, teamId: w.teamId, name: pid }).run();
    const chiefRow = w.s.db.select().from(chiefThread).where(eq(chiefThread.id, w.threadId)).get()!;
    const old = Date.now() - 11 * MINUTE;
    const tid = 'chief-channel-p';
    w.s.db
      .insert(chiefThread)
      .values({
        id: tid,
        chiefId: chiefRow.chiefId,
        userId: w.s.user.id,
        teamId: w.teamId,
        projectId: pid,
        title: 'channel p',
        createdAt: old,
        updatedAt: old,
        sessionId: 'sess-p',
        sessionOpenedAt: old,
      })
      .run();
    w.s.db
      .insert(chiefMessage)
      .values({
        id: 'channel-msg',
        threadId: tid,
        role: 'user',
        content: [{ type: 'text', text: 'This project ships on Thursday.' }],
        projectId: pid,
        createdAt: old,
      })
      .run();
    const prompts: string[] = [];
    const { provider, calls } = gatedFaux({
      gate: Promise.resolve(),
      reply: () => factJson('Ship day', 'this project ships on Thursday', pid),
      onFlushStart: (_call, prompt) => prompts.push(prompt),
    });
    const coordinator = boot(w, { provider }, { idleMemoryFlushMs: 10 * MINUTE });
    coordinator.tick();
    await coordinator.idle();
    expect(calls()).toBe(1);
    expect(prompts[0]).toContain(`Conversation project: ${pid}`);
    expect(compactionFailureCounts()['idle-memory-flush']).toBeUndefined();
    const response = await req(w.s.app, 'GET', `/api/teams/${w.teamId}/memories`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          projectId: pid,
          content: '- Ship day：this project ships on Thursday',
        }),
      ]),
    );
    const scope = { teamId: w.teamId, agentId: coordinatorProfile(w.s.db, w.teamId)!.id };
    expect(projectTurnContext(w.s.db, { ...scope, projectId: pid, threadId: tid })).toContain(
      'this project ships on Thursday',
    );
    const deps = { db: w.s.db, hub: w.s.hub, user: w.s.user, skillsDir: w.s.skillsDir };
    expect(buildChiefSystemPrompt(deps, w.teamId, w.threadId).text).not.toContain(
      'this project ships on Thursday',
    );
  }, 20_000);

  it('does not extract before the idle threshold or while a turn is pending', async () => {
    const w = await world('hello');
    const { faux, calls } = countingFaux(() => fauxAssistantMessage(factJson('No', 'appear')));
    const coordinator = boot(w, faux, { idleMemoryFlushMs: 10 * MINUTE });
    backdateMessages(w, 11 * MINUTE);
    coordinator.tick();
    await coordinator.idle();
    expect(calls()).toBe(0);
    expect(memoryRows(w)).toEqual([]);
    expect(watermark(w)).toBeNull();
    coordinator.wake(w.threadId);
    await coordinator.idle();
    backdateMessages(w, 5 * MINUTE);
    coordinator.tick();
    await coordinator.idle();
    expect(calls()).toBe(0);
    expect(memoryRows(w)).toEqual([]);
    backdateMessages(w, 11 * MINUTE);
    for (const status of ['claimed', 'waiting_quota', 'pending'] as const) {
      w.s.db
        .insert(step)
        .values({
          id: `held-${status}`,
          buildId: w.threadId,
          kind: 'chief',
          machineId: 'mach',
          status,
          prompt: 'held',
          createdAt: Date.now(),
        })
        .run();
      coordinator.tick();
      await coordinator.idle();
      expect(calls()).toBe(0);
      w.s.db
        .delete(step)
        .where(eq(step.id, `held-${status}`))
        .run();
    }
    w.s.db
      .insert(coordinatorInput)
      .values({
        id: 'pending-input',
        threadId: w.threadId,
        stepId: w.stepId,
        kind: 'steer',
        ownerMessageIds: [],
        content: 'waiting for the turn to start',
        createdAt: Date.now(),
      })
      .run();
    coordinator.tick();
    await coordinator.idle();
    expect(calls()).toBe(0);
    w.s.db.delete(coordinatorInput).where(eq(coordinatorInput.id, 'pending-input')).run();
  }, 30_000);

  it.each(['team', 'project'] as const)(
    'discards a flush whose %s memory was edited while it ran',
    async (scope) => {
      const w = await world('Remember: deploy only on Fridays.');
      const projectId = scope === 'team' ? null : 'edit-project';
      if (projectId !== null) {
        w.s.db
          .insert(project)
          .values({ id: projectId, teamId: w.teamId, name: 'Edit project' })
          .run();
      }
      let releaseFlush!: () => void;
      const gate = new Promise<void>((resolve) => {
        releaseFlush = resolve;
      });
      const { provider, calls } = gatedFaux({
        gate,
        reply: () => factJson('Deploy day', 'deploy fact: Fridays only', projectId),
      });
      const coordinator = boot(w, { provider }, { idleMemoryFlushMs: 10 * MINUTE });
      coordinator.wake(w.threadId);
      await coordinator.idle();
      const existing = memoryRows(w)[0];
      expect(existing).toBeUndefined();
      backdateMessages(w, 11 * MINUTE);
      coordinator.tick();
      await until(() => calls() === 1);
      const agentId = coordinatorProfile(w.s.db, w.teamId)!.id;
      const owner = { agentId, teamId: w.teamId, projectId };
      const seeded = ensureMemoryIndex(w.s.db, owner);
      appendMemoryIndex(w.s.db, owner, 'Manual rule', 'the user wrote this while the flush ran');
      expect(memoryDocumentVersion(ensureMemoryIndex(w.s.db, owner))).not.toBe(
        memoryDocumentVersion(seeded),
      );
      releaseFlush();
      await coordinator.idle();
      expect(memoryRows(w).map((r) => r.content)).toEqual([
        '- Manual rule：the user wrote this while the flush ran',
      ]);
      expect(watermark(w)).toBeNull();
    },
    30_000,
  );

  it('extracts nothing while only unshapeable rows are new, then picks up the next real message', async () => {
    const w = await world('hello');
    const { faux, calls } = countingFaux(() => fauxAssistantMessage(factJson('No', 'appear')));
    const coordinator = boot(w, faux, { idleMemoryFlushMs: 10 * MINUTE });
    coordinator.wake(w.threadId);
    await coordinator.idle();
    const base = Date.now() - 11 * MINUTE;
    w.s.db.delete(chiefMessage).where(eq(chiefMessage.threadId, w.threadId)).run();
    w.s.db
      .insert(chiefMessage)
      .values({
        id: 'thinking-only',
        threadId: w.threadId,
        role: 'assistant',
        content: [{ type: 'thinking', thinking: 'internal' }],
        createdAt: base,
      })
      .run();
    coordinator.tick();
    await coordinator.idle();
    expect(calls()).toBe(0);
    expect(watermark(w)).toBeNull();
    const sent = await req(w.s.app, 'POST', `/api/conversations/${w.threadId}/messages`, {
      content: 'Remember: only Shorthands are welcome.',
    });
    expect(sent.status).toBe(201);
    coordinator.wake(w.threadId);
    await coordinator.idle();
    backdateMessages(w, 11 * MINUTE);
    coordinator.tick();
    await coordinator.idle();
    expect(calls()).toBe(1);
  }, 30_000);

  it('advances the cursor when the model returns no usable memories', async () => {
    const w = await world('Remember: nothing here.');
    const { faux, calls } = countingFaux(() => fauxAssistantMessage('{"memories":[],"used":[]}'));
    const coordinator = boot(w, faux, { idleMemoryFlushMs: 10 * MINUTE });
    coordinator.wake(w.threadId);
    await coordinator.idle();
    backdateMessages(w, 11 * MINUTE);
    coordinator.tick();
    await coordinator.idle();
    expect(calls()).toBe(1);
    expect(memoryRows(w)).toEqual([]);
    expect(watermark(w)).toBeGreaterThan(0);
    expect(compactionFailureCounts()['idle-memory-flush']).toBeUndefined();
    coordinator.tick();
    await coordinator.idle();
    expect(calls()).toBe(1);
  }, 20_000);

  it('skips a second sweep with no new messages and extracts a later message', async () => {
    const w = await world('Remember: deploy only on Fridays.');
    const { faux, calls } = countingFaux((call) =>
      fauxAssistantMessage(factJson(`Fact ${call}`, `deploy fact ${call}`)),
    );
    const coordinator = boot(w, faux, { idleMemoryFlushMs: 10 * MINUTE });
    coordinator.wake(w.threadId);
    await coordinator.idle();
    backdateMessages(w, 11 * MINUTE);
    coordinator.tick();
    await coordinator.idle();
    expect(calls()).toBe(1);
    const firstWatermark = watermark(w);
    const queries = vi.spyOn(w.s.db, 'get');
    try {
      coordinator.tick();
      const dialect = new SQLiteSyncDialect();
      const cursor = queries.mock.calls
        .map(([query]) => query)
        .find(
          (query): query is SQL =>
            query instanceof SQL && dialect.sqlToQuery(query).sql.includes('rowid >'),
        );
      expect(cursor).toBeDefined();
      expect(w.s.db.all(sql`EXPLAIN QUERY PLAN ${cursor}`)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ detail: expect.stringContaining('threadId=? AND rowid>?') }),
        ]),
      );
    } finally {
      queries.mockRestore();
    }
    await coordinator.idle();
    expect(calls()).toBe(1);
    expect(watermark(w)).toBe(firstWatermark);
    const sent = await req(w.s.app, 'POST', `/api/conversations/${w.threadId}/messages`, {
      content: 'Also: standup is at 9:30.',
    });
    expect(sent.status).toBe(201);
    coordinator.wake(w.threadId);
    await coordinator.idle();
    backdateMessages(w, 11 * MINUTE);
    coordinator.tick();
    await coordinator.idle();
    expect(calls()).toBe(2);
    expect(watermark(w)!).toBeGreaterThan(firstWatermark!);
    expect(
      memoryRows(w)
        .map((r) => r.content)
        .join('\n'),
    ).toContain('- Fact 2：deploy fact 2');
  }, 30_000);

  it('drops a flush whose conversation moved on and re-extracts the newer state', async () => {
    const w = await world('Remember: deploy only on Fridays.');
    let releaseFlush!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFlush = resolve;
    });
    const { provider, calls } = gatedFaux({
      gate,
      reply: (call) =>
        call === 1
          ? factJson('Deploy day', 'deploy fact: Fridays only')
          : factJson('Deploy day', 'deploy fact: Thursday now'),
    });
    const coordinator = boot(w, { provider }, { idleMemoryFlushMs: 10 * MINUTE });
    coordinator.wake(w.threadId);
    await coordinator.idle();
    backdateMessages(w, 11 * MINUTE);
    coordinator.tick();
    await until(() => calls() === 1);
    const sent = await req(w.s.app, 'POST', `/api/conversations/${w.threadId}/messages`, {
      content: 'Correction: deploy on Thursdays, not Fridays.',
    });
    expect(sent.status).toBe(201);
    coordinator.wake(w.threadId);
    await until(
      () =>
        !w.s.db
          .select()
          .from(step)
          .where(eq(step.buildId, w.threadId))
          .all()
          .some((r) => r.status === 'pending' || r.status === 'claimed'),
    );
    releaseFlush();
    await coordinator.idle();
    expect(memoryRows(w)).toEqual([]);
    expect(watermark(w)).toBeNull();
    backdateMessages(w, 11 * MINUTE);
    coordinator.tick();
    await coordinator.idle();
    expect(calls()).toBe(2);
    expect(
      memoryRows(w)
        .map((r) => r.content)
        .join('\n'),
    ).toContain('- Deploy day：deploy fact: Thursday now');
    expect(
      memoryRows(w)
        .map((r) => r.content)
        .join('\n'),
    ).not.toContain('Fridays only');
    expect(watermark(w)).toBe(
      w.s.db
        .select()
        .from(chiefMessage)
        .where(eq(chiefMessage.threadId, w.threadId))
        .orderBy(desc(chiefMessage.createdAt))
        .get()!.createdAt,
    );
  }, 30_000);

  it('extracts a message written at the same millisecond as the watermark', async () => {
    const w = await world('Remember: squash merges only.');
    const { faux, calls } = countingFaux((call) =>
      fauxAssistantMessage(factJson(`Fact ${call}`, `same-ms fact ${call}`)),
    );
    const coordinator = boot(w, faux, { idleMemoryFlushMs: 10 * MINUTE });
    coordinator.wake(w.threadId);
    await coordinator.idle();
    backdateMessages(w, 11 * MINUTE);
    coordinator.tick();
    await coordinator.idle();
    expect(calls()).toBe(1);
    const mark = watermark(w)!;
    expect(mark).toBeGreaterThan(0);
    w.s.db
      .insert(chiefMessage)
      .values({
        id: 'same-ms-late',
        threadId: w.threadId,
        role: 'user',
        content: [{ type: 'text', text: 'Late note at the same timestamp.' }],
        createdAt: mark,
      })
      .run();
    coordinator.tick();
    await coordinator.idle();
    expect(calls()).toBe(2);
    expect(
      memoryRows(w)
        .map((r) => r.content)
        .join('\n'),
    ).toContain('- Fact 2：same-ms fact 2');
  }, 30_000);

  it('walks the newest window first and never re-offers a truncated backlog', async () => {
    const w = await world('first');
    const prompts: string[] = [];
    const { provider, calls } = gatedFaux({
      gate: Promise.resolve(),
      reply: () => factJson('Cap', 'cap fact'),
      onFlushStart: (_call, prompt) => {
        prompts.push(prompt);
      },
    });
    const coordinator = boot(w, { provider }, { idleMemoryFlushMs: 10 * MINUTE });
    coordinator.wake(w.threadId);
    await coordinator.idle();
    const base = Date.now() - 11 * MINUTE;
    for (const row of w.s.db
      .select()
      .from(chiefMessage)
      .where(eq(chiefMessage.threadId, w.threadId))
      .all()) {
      w.s.db.update(chiefMessage).set({ createdAt: base }).where(eq(chiefMessage.id, row.id)).run();
    }
    for (let i = 0; i < 401; i += 1) {
      w.s.db
        .insert(chiefMessage)
        .values({
          id: `cap-${i}`,
          threadId: w.threadId,
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: [{ type: 'text', text: `cap line ${i}` }],
          createdAt: base + i,
        })
        .run();
    }
    coordinator.tick();
    await coordinator.idle();
    expect(calls()).toBe(1);
    expect(prompts[0]).toContain('用户：cap line 400');
    expect(prompts[0]).not.toContain('cap line 0');
    const newest = w.s.db
      .select()
      .from(chiefMessage)
      .where(eq(chiefMessage.threadId, w.threadId))
      .orderBy(desc(chiefMessage.createdAt))
      .get()!;
    expect(watermark(w)).toBe(newest.createdAt);
    coordinator.tick();
    await coordinator.idle();
    expect(calls()).toBe(1);
  }, 30_000);

  it('gives up on a hung extraction at the deadline and retries later', async () => {
    const w = await world('Remember: squash merges only.');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { provider, calls } = gatedFaux({
      gate,
      reply: () => factJson('Merge rule', 'ian wants squash merges only.'),
    });
    const coordinator = boot(
      w,
      { provider },
      {
        idleMemoryFlushMs: 10 * MINUTE,
        idleMemoryRetryMs: 50,
        idleMemoryTimeoutMs: 120,
      },
    );
    coordinator.wake(w.threadId);
    await coordinator.idle();
    backdateMessages(w, 11 * MINUTE);
    coordinator.tick();
    await until(() => calls() === 1);
    await until(() => compactionFailureCounts()['idle-memory-flush'] === 1, 4_000);
    expect(watermark(w)).toBeNull();
    coordinator.tick();
    await coordinator.idle();
    expect(calls()).toBe(1);
    release();
    await new Promise((resolve) => setTimeout(resolve, 80));
    coordinator.tick();
    await coordinator.idle();
    expect(
      memoryRows(w)
        .map((r) => r.content)
        .join('\n'),
    ).toContain('- Merge rule：ian wants squash merges only.');
    expect(watermark(w)).toBeGreaterThan(0);
  }, 30_000);

  it('runs at most two idle flushes concurrently, oldest first', async () => {
    const w = await world('hello');
    const chiefRow = w.s.db.select().from(chiefThread).where(eq(chiefThread.id, w.threadId)).get()!;
    const old = Date.now() - 20 * MINUTE;
    const started: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const tid = `chief-concurrent-${i}`;
      const pid = `concurrent-p-${i}`;
      w.s.db.insert(project).values({ id: pid, teamId: w.teamId, name: pid }).run();
      w.s.db
        .insert(chiefThread)
        .values({
          id: tid,
          chiefId: chiefRow.chiefId,
          userId: w.s.user.id,
          teamId: w.teamId,
          projectId: pid,
          title: `concurrent ${i}`,
          createdAt: old,
          updatedAt: old,
          sessionId: `sess-${i}`,
          sessionOpenedAt: old,
        })
        .run();
      w.s.db
        .insert(chiefMessage)
        .values({
          id: `concurrent-msg-${i}`,
          threadId: tid,
          role: 'user',
          content: [{ type: 'text', text: `remember fact ${i}` }],
          createdAt: old + i * MINUTE,
        })
        .run();
    }
    let inFlight = 0;
    let maxInFlight = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { provider, calls } = gatedFaux({
      gate,
      reply: (call) => factJson(`Fact ${call}`, 'concurrent fact'),
      onFlushStart: (_call, prompt) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        for (const i of [0, 1, 2, 3]) {
          if (prompt.includes(`remember fact ${i}`)) started.push(`fact ${i}`);
        }
      },
      onFlushEnd: () => {
        inFlight -= 1;
      },
    });
    const coordinator = boot(w, { provider }, { idleMemoryFlushMs: 10 * MINUTE });
    coordinator.tick();
    await until(() => calls() === 2);
    expect(maxInFlight).toBe(2);
    expect(started).toEqual(['fact 0', 'fact 1']);
    release();
    await coordinator.idle();
    expect(inFlight).toBe(0);
    coordinator.tick();
    await coordinator.idle();
    expect(calls()).toBe(4);
    expect(maxInFlight).toBe(2);
  }, 30_000);

  it('reports a failed flush, keeps the watermark, backs off, and retries later', async () => {
    const w = await world('Remember: ian wants squash merges only.');
    const { faux, calls } = countingFaux((call) =>
      call === 1
        ? fauxAssistantMessage([], { stopReason: 'error', errorMessage: 'quota exhausted' })
        : fauxAssistantMessage(factJson('Merge rule', 'ian wants squash merges only.')),
    );
    const coordinator = boot(w, faux, { idleMemoryFlushMs: 10 * MINUTE, idleMemoryRetryMs: 50 });
    coordinator.wake(w.threadId);
    await coordinator.idle();
    backdateMessages(w, 11 * MINUTE);
    coordinator.tick();
    await coordinator.idle();
    expect(calls()).toBe(1);
    expect(memoryRows(w)).toEqual([]);
    expect(watermark(w)).toBeNull();
    expect(compactionFailureCounts()['idle-memory-flush']).toBe(1);
    coordinator.tick();
    await coordinator.idle();
    expect(calls()).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 80));
    coordinator.tick();
    await coordinator.idle();
    expect(calls()).toBe(2);
    expect(
      memoryRows(w)
        .map((r) => r.content)
        .join('\n'),
    ).toContain('- Merge rule：ian wants squash merges only.');
    expect(watermark(w)).toBeGreaterThan(0);
  }, 30_000);

  it('does not let older unshapeable conversations take the provider slots', async () => {
    const w = await world('Fixture uses amber labels.');
    const { faux, calls } = countingFaux(() =>
      fauxAssistantMessage(factJson('Label', 'Use amber.')),
    );
    const coordinator = boot(w, faux, { idleMemoryFlushMs: 10 * MINUTE });
    coordinator.wake(w.threadId);
    await coordinator.idle();
    backdateMessages(w, 11 * MINUTE);
    const thread = w.s.db.select().from(chiefThread).where(eq(chiefThread.id, w.threadId)).get()!;
    const older = Date.now() - 30 * MINUTE;
    for (let index = 0; index < 2; index++) {
      const id = `empty-${index}`;
      w.s.db.insert(project).values({ id, teamId: w.teamId, name: id }).run();
      w.s.db
        .insert(chiefThread)
        .values({ ...thread, id, projectId: id, sessionId: id })
        .run();
      w.s.db
        .insert(chiefMessage)
        .values({
          id,
          threadId: id,
          role: 'assistant',
          content: { kind: 'question' },
          createdAt: older,
        })
        .run();
    }
    coordinator.tick();
    await coordinator.idle();
    expect(calls()).toBe(1);
    expect(watermark(w)).toBeGreaterThan(0);
  }, 20_000);

  it('leaves legacy project memory byte-identical when the summary provider fails', async () => {
    const w = await world('Fixture uses amber labels.');
    const { faux, calls } = countingFaux(() =>
      fauxAssistantMessage([], { stopReason: 'error', errorMessage: 'unavailable' }),
    );
    const coordinator = boot(w, faux, { idleMemoryFlushMs: 10 * MINUTE });
    coordinator.wake(w.threadId);
    await coordinator.idle();
    const pid = 'legacy-memory-project';
    w.s.db.insert(project).values({ id: pid, teamId: w.teamId, name: pid }).run();
    w.s.db
      .insert(agentMemory)
      .values({
        id: pid,
        teamId: w.teamId,
        projectId: pid,
        agentId: coordinatorProfile(w.s.db, w.teamId)!.id,
        title: 'Old fact',
        content: 'Use amber.',
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    const rows = () =>
      w.s.db.select().from(agentMemory).where(eq(agentMemory.projectId, pid)).all();
    const before = rows();
    backdateMessages(w, 11 * MINUTE);
    coordinator.tick();
    await coordinator.idle();
    expect(calls()).toBe(1);
    expect(rows()).toEqual(before);
  }, 20_000);

  it('does not leave memory writes behind if saving the cursor fails', async () => {
    const w = await world('The runbook uses test fixtures only.');
    const owner = {
      agentId: coordinatorProfile(w.s.db, w.teamId)!.id,
      teamId: w.teamId,
      projectId: null,
    };
    appendMemoryIndex(w.s.db, owner, 'Old rule', 'Deploy on Fridays.');
    for (let i = 0; i < 30; i += 1) {
      appendMemoryIndex(w.s.db, owner, `Retained ${i}`, `Fixture rule ${i}`);
    }
    const original = memoryRows(w).map((r) => r.content);
    const { faux, calls } = countingFaux(() =>
      fauxAssistantMessage(
        JSON.stringify({
          memories: [
            { title: 'Fixtures', content: 'The runbook uses test fixtures only.', replaces: [1] },
          ],
        }),
      ),
    );
    const coordinator = boot(w, faux, { idleMemoryFlushMs: 10 * MINUTE, idleMemoryRetryMs: 5 });
    coordinator.wake(w.threadId);
    await coordinator.idle();
    backdateMessages(w, 11 * MINUTE);
    w.s.db.run(sql`CREATE TRIGGER reject_idle_cursor BEFORE UPDATE OF memoryFlushedAt ON chief_thread
      BEGIN SELECT RAISE(ABORT, 'injected cursor write failure'); END`);
    coordinator.tick();
    await coordinator.idle();
    expect(calls()).toBe(1);
    expect(compactionFailureCounts()['idle-memory-flush']).toBe(1);
    expect(watermark(w)).toBeNull();
    expect(memoryRows(w).map((r) => r.content)).toEqual(original);
    w.s.db.run(sql`DROP TRIGGER reject_idle_cursor`);
    await new Promise((resolve) => setTimeout(resolve, 25));
    coordinator.tick();
    await coordinator.idle();
    expect(calls()).toBe(2);
    expect(watermark(w)).toBeGreaterThan(0);
    const committed = memoryRows(w)
      .map((r) => r.content)
      .join('\n');
    expect(committed).not.toContain('Old rule');
    expect(committed).toContain('The runbook uses test fixtures only.');
    expect(committed).toContain('Fixture rule 1');
  }, 20_000);

  it('aborts a pending extraction on close without applying a late result', async () => {
    const w = await world('The runbook uses test fixtures only.');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { provider, calls } = gatedFaux({ gate, reply: () => factJson('Fixtures', 'test only') });
    const coordinator = boot(
      w,
      { provider },
      { idleMemoryFlushMs: 10 * MINUTE, idleMemoryTimeoutMs: 60_000 },
    );
    coordinator.wake(w.threadId);
    await coordinator.idle();
    backdateMessages(w, 11 * MINUTE);
    coordinator.tick();
    await until(() => calls() === 1);
    try {
      await coordinator.close();
    } finally {
      release();
    }
    expect(memoryRows(w)).toEqual([]);
    expect(watermark(w)).toBeNull();
    expect(compactionFailureCounts()['idle-memory-flush']).toBeUndefined();
  }, 10_000);

  it('skips archived threads and threads without a keyed provider', async () => {
    const w = await world('hello');
    const { faux, calls } = countingFaux(() => fauxAssistantMessage(factJson('No', 'appear')));
    const coordinator = boot(w, faux, { idleMemoryFlushMs: 10 * MINUTE });
    coordinator.wake(w.threadId);
    await coordinator.idle();
    backdateMessages(w, 11 * MINUTE);
    w.s.db
      .update(chiefThread)
      .set({ archivedAt: Date.now() })
      .where(eq(chiefThread.id, w.threadId))
      .run();
    coordinator.tick();
    await coordinator.idle();
    expect(calls()).toBe(0);
    expect(watermark(w)).toBeNull();
    w.s.db
      .update(chiefThread)
      .set({ archivedAt: null })
      .where(eq(chiefThread.id, w.threadId))
      .run();
    w.s.db.delete(provider).where(eq(provider.teamId, w.teamId)).run();
    coordinator.tick();
    await coordinator.idle();
    expect(calls()).toBe(0);
    expect(watermark(w)).toBeNull();
  }, 20_000);
});
