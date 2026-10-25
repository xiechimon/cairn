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

describe('记忆种库', () => {
  test('冲突类（旧条被标失效）：提示词只带新条，旧条仍留在库里', async () => {
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

  test('冲突类（旧条只是较早）：两条都进提示词，新条创建得更晚', async () => {
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

  test('跨项目类：别的项目的记忆挂在另一个真实项目名下，本项目的挂在 eval-project 名下', async () => {
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

  test('过期类：种进库的过期条与无关条都是有效条目', async () => {
    const c = caseOf('s01');
    await seedMemories(stack.server, world, c);
    const rows = readMemoryRows(stack.server, world.chiefAgentId);
    for (const key of ['stale', 'keep']) {
      expect(rows.find((r) => r.id === memoryIdFor('s01', key))?.invalidAt).toBeNull();
    }
  });
});
