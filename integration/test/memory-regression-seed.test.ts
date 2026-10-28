import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { user as userTable } from '../../apps/server/src/db/schema.js';
import { composeChiefSystemPrompt } from '../../apps/server/src/services/chief.js';
import { listMemoryEntries } from '../../apps/server/src/services/memory.js';
import {
  bootStack,
  type RosterAgent,
  type SeededWorld,
  type Stack,
  seedWorld,
} from '../eval/chief-dispatch/stack.mts';
import { type MemoryCase, memoryIdFor } from '../eval/memory-regression/grade.mts';
import { readMemoryRows, seedMemories } from '../eval/memory-regression/seed.mts';

const flow = JSON.parse(
  readFileSync(
    join(import.meta.dirname, '../../.claude/hillclimb/memory-regression/cases.json'),
    'utf8',
  ),
) as { roster: RosterAgent[]; cases: MemoryCase[] };
const caseOf = (id: string): MemoryCase => {
  const found = flow.cases.find((c) => c.id === id);
  if (found === undefined) throw new Error(`没有用例 ${id}`);
  return found;
};

let stack: Stack;
let world: SeededWorld;

function chiefPrompt(): string {
  const user = stack.server.db.select().from(userTable).all()[0];
  if (user === undefined) throw new Error('seed 用户缺失');
  return composeChiefSystemPrompt(
    { db: stack.server.db, hub: {} as never, user, skillsDir: stack.skillsDir },
    stack.server.teamId,
  );
}

beforeAll(async () => {
  stack = await bootStack();
  world = await seedWorld(stack, {
    relayBaseUrl: 'http://127.0.0.1:9/v1',
    relayKey: 'unused',
    roster: flow.roster,
    chiefModelId: 'glm-5.3',
  });
}, 120_000);

afterAll(async () => {
  await stack?.close();
});

describe('memory seed library', () => {
  test('conflict class (old entry invalidated): prompt carries only the new entry, the old one stays in the library', async () => {
    const c = caseOf('c01');
    await seedMemories(stack.server, world, c);
    const prompt = chiefPrompt();
    expect(prompt).toContain('rel-x.y');
    expect(prompt).not.toContain('release/x.y');
    const rows = readMemoryRows(stack.server, world.chiefAgentId);
    expect(rows.find((r) => r.id === memoryIdFor('c01', 'old'))?.supersededBy).toBe(
      memoryIdFor('c01', 'new'),
    );
  });

  test('conflict class (old entry merely earlier): both entries in the prompt, the new one created later', async () => {
    const c = caseOf('c05');
    await seedMemories(stack.server, world, c);
    const prompt = chiefPrompt();
    expect(prompt).toContain('60%');
    expect(prompt).toContain('80%');
    const created = new Map(
      listMemoryEntries(stack.server.db, {
        agentId: world.chiefAgentId,
        teamId: stack.server.teamId,
      }).map((row) => [row.id, row.createdAt]),
    );
    expect(created.get(memoryIdFor('c05', 'new'))).toBeGreaterThan(
      created.get(memoryIdFor('c05', 'old')) ?? Infinity,
    );
  });

  test('cross-project class: the other project memory sits under another real project, this one under eval-project', async () => {
    const c = caseOf('l03');
    await seedMemories(stack.server, world, c);
    const rows = listMemoryEntries(stack.server.db, {
      agentId: world.chiefAgentId,
      teamId: stack.server.teamId,
    });
    const foreign = rows.find((r) => r.id === memoryIdFor('l03', 'foreign'));
    const own = rows.find((r) => r.id === memoryIdFor('l03', 'own'));
    expect(foreign?.projectId).not.toBeNull();
    expect(foreign?.projectId).not.toBe(world.projectId);
    expect(own?.projectId).toBe(world.projectId);
  });

  test('stale class: the seeded stale entry and the unrelated entry are both active rows', async () => {
    const c = caseOf('s01');
    await seedMemories(stack.server, world, c);
    const rows = readMemoryRows(stack.server, world.chiefAgentId);
    for (const key of ['stale', 'keep']) {
      expect(rows.find((r) => r.id === memoryIdFor('s01', key))?.invalidAt).toBeNull();
    }
  });

  test('adjacent class: both memories are stored on eval-project', async () => {
    const c = flow.cases.find((item) => item.expect.kind === 'adjacent');
    if (c === undefined) throw new Error('no adjacent case');
    await seedMemories(stack.server, world, c);
    const rows = listMemoryEntries(stack.server.db, {
      agentId: world.chiefAgentId,
      teamId: stack.server.teamId,
    });
    for (const memory of c.memories) {
      expect(rows.find((r) => r.id === memoryIdFor(c.id, memory.key))?.projectId).toBe(
        world.projectId,
      );
    }
  });

  test('irrelevant class: the memory is stored on eval-project', async () => {
    const c = flow.cases.find((item) => item.expect.kind === 'irrelevant');
    if (c === undefined) throw new Error('no irrelevant case');
    await seedMemories(stack.server, world, c);
    const rows = listMemoryEntries(stack.server.db, {
      agentId: world.chiefAgentId,
      teamId: stack.server.teamId,
    });
    const memory = c.memories[0];
    if (memory === undefined) throw new Error(`${c.id} has no memory`);
    expect(rows.find((r) => r.id === memoryIdFor(c.id, memory.key))?.projectId).toBe(
      world.projectId,
    );
  });
});
