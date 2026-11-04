import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  agentMemory,
  agent as agentTable,
  chief as chiefTable,
  routingRule,
  todo as todoTable,
} from '../src/db/schema.js';
import { newRecordId } from '../src/lib/ids.js';
import { injectMemories } from '../src/services/memory.js';
import {
  adoptAgentMemories,
  memoryOwnerOf,
  setRoutingRulesEnabled,
} from '../src/services/routing-rules.js';
import { bootServer, postProject, type TestServer } from './helpers.js';

const servers: TestServer[] = [];
afterAll(() => {
  for (const s of servers) s.dispose();
});
beforeEach(() => setRoutingRulesEnabled(true));
afterEach(() => setRoutingRulesEnabled(false));

interface World {
  s: TestServer;
  teamId: string;
  projectId: string;
  ruleId: string;
}

let seq = 40_000;

async function world(): Promise<World> {
  const s = bootServer({});
  servers.push(s);
  const teamId = s.team.id;
  const projectId = await postProject(s.app, 'memory-proj');
  for (const id of ['planner', 'builder', 'verifier', 'reviewer', 'chief-agent']) {
    s.db
      .insert(agentTable)
      .values({ id, teamId, displayName: id, provider: 'stub-gw', modelId: 'stub-model' })
      .run();
  }
  s.db.update(chiefTable).set({ agentId: 'chief-agent' }).run();
  if (s.db.select().from(chiefTable).get() === undefined) {
    s.db
      .insert(chiefTable)
      .values({ id: 'chief-1', userId: s.user.id, teamId, agentId: 'chief-agent', createdAt: 1 })
      .run();
  }
  const ruleId = newRecordId();
  s.db
    .insert(routingRule)
    .values({
      id: ruleId,
      teamId,
      use: 'session',
      provider: 'stub-gw',
      modelId: 'stub-model',
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
  seq += 1;
  s.db
    .insert(todoTable)
    .values({
      id: `todo-mem-${seq}`,
      teamId,
      projectId,
      seqNum: seq,
      title: 'memory probe',
      spec: '',
      phase: 'done',
      phaseAt: 1,
      assignment: {
        plan: { agentId: 'planner' },
        build: { agentId: 'builder' },
        verify: { agentId: 'verifier' },
      },
    })
    .run();
  return { s, teamId, projectId, ruleId };
}

function remember(
  w: World,
  agentId: string,
  content: string,
  opts: { projectId?: string | null; invalid?: boolean } = {},
): void {
  w.s.db
    .insert(agentMemory)
    .values({
      id: newRecordId(),
      agentId,
      teamId: w.teamId,
      title: content.slice(0, 20),
      content,
      projectId: opts.projectId ?? null,
      invalidAt: opts.invalid ? 5 : null,
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
}

function ruleMemories(w: World) {
  return w.s.db
    .select()
    .from(agentMemory)
    .where(eq(agentMemory.agentId, w.ruleId))
    .all()
    .map((row) => row.content)
    .sort();
}

describe('D71 memory owned by the session rule', () => {
  test('adoption copies the valid memories of plan, build and verify agents, deduping identical content', async () => {
    const w = await world();
    remember(w, 'planner', 'split migrations from code');
    remember(w, 'builder', 'run pnpm lint before push');
    remember(w, 'verifier', 'run pnpm lint before push');
    remember(w, 'builder', 'old rule', { invalid: true });
    remember(w, 'reviewer', 'check the threat model');
    remember(w, 'chief-agent', 'ian prefers Chinese');
    adoptAgentMemories(w.s.db);
    expect(ruleMemories(w)).toEqual(['run pnpm lint before push', 'split migrations from code']);
  });

  test('adoption is idempotent and a second run never drops a memory', async () => {
    const w = await world();
    remember(w, 'builder', 'run pnpm lint before push');
    remember(w, 'planner', 'split migrations from code');
    adoptAgentMemories(w.s.db);
    const first = ruleMemories(w);
    adoptAgentMemories(w.s.db);
    adoptAgentMemories(w.s.db);
    expect(ruleMemories(w)).toEqual(first);
    expect(
      w.s.db.select().from(agentMemory).where(eq(agentMemory.agentId, 'builder')).all(),
    ).toHaveLength(1);
  });

  test('a rule memory a worker deleted is not brought back by the next adoption run', async () => {
    const w = await world();
    remember(w, 'builder', 'run pnpm lint before push');
    adoptAgentMemories(w.s.db);
    w.s.db.delete(agentMemory).where(eq(agentMemory.agentId, w.ruleId)).run();
    adoptAgentMemories(w.s.db);
    expect(ruleMemories(w)).toEqual([]);
  });

  test('an agent first assigned after the last run is adopted on the next run', async () => {
    const w = await world();
    adoptAgentMemories(w.s.db);
    w.s.db
      .insert(agentTable)
      .values({ id: 'late', teamId: w.teamId, displayName: 'late', provider: 'p', modelId: 'm' })
      .run();
    remember(w, 'late', 'late lesson');
    w.s.db
      .update(todoTable)
      .set({ assignment: { plan: null, build: { agentId: 'late' } } })
      .run();
    adoptAgentMemories(w.s.db);
    expect(ruleMemories(w)).toEqual(['late lesson']);
  });

  test('rules on: an adopted agent reads and writes memory through the rule; the chief and reviewer keep their own', async () => {
    const w = await world();
    remember(w, 'builder', 'run pnpm lint before push');
    adoptAgentMemories(w.s.db);
    expect(memoryOwnerOf(w.s.db, w.teamId, 'builder', 'build')).toBe(w.ruleId);
    expect(memoryOwnerOf(w.s.db, w.teamId, 'chief-agent', 'build')).toBe('chief-agent');
    expect(memoryOwnerOf(w.s.db, w.teamId, 'reviewer', 'build')).toBe('reviewer');
    expect(memoryOwnerOf(w.s.db, w.teamId, 'builder', 'review')).toBe('builder');
    expect(
      injectMemories(w.s.db, { agentId: memoryOwnerOf(w.s.db, w.teamId, 'planner', 'plan') }).map(
        (m) => m.content,
      ),
    ).toEqual(['run pnpm lint before push']);
  });

  test('rules off: every agent owns its own memory', async () => {
    const w = await world();
    adoptAgentMemories(w.s.db);
    setRoutingRulesEnabled(false);
    expect(memoryOwnerOf(w.s.db, w.teamId, 'builder', 'build')).toBe('builder');
  });
});
