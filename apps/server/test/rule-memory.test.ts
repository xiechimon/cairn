import { afterAll, describe, expect, test } from 'vitest';
import { agentMemory } from '../src/db/schema.js';
import { newRecordId } from '../src/lib/ids.js';
import { injectMemories } from '../src/services/memory.js';
import { memoryOwnerOf } from '../src/services/routing-rules.js';
import { bootServer, seedRoute, type TestServer } from './helpers.js';

const servers: TestServer[] = [];
afterAll(() => {
  for (const s of servers) s.dispose();
});

function world(): TestServer {
  const s = bootServer({});
  servers.push(s);
  return s;
}

describe('D71 memory owned by the session rule', () => {
  test('plan, build and session steps read and write memory through the session rule', () => {
    const s = world();
    const ruleId = seedRoute(s, 'session', { provider: 'stub-gw', modelId: 'stub-model' });
    for (const kind of ['plan', 'build', 'session', 'merge'] as const) {
      expect(memoryOwnerOf(s.db, s.team.id, kind)).toBe(ruleId);
    }
    expect(memoryOwnerOf(s.db, s.team.id, 'verify')).toBe(`${ruleId}:verify`);
  });

  test('a review step owns its own memory through the review rule', () => {
    const s = world();
    const sessionId = seedRoute(s, 'session', { provider: 'stub-gw', modelId: 'stub-model' });
    expect(memoryOwnerOf(s.db, s.team.id, 'review')).toBe(sessionId);
    const reviewId = seedRoute(s, 'review', { provider: 'stub-gw', modelId: 'stub-model' });
    expect(memoryOwnerOf(s.db, s.team.id, 'review')).toBe(reviewId);
    expect(memoryOwnerOf(s.db, s.team.id, 'build')).toBe(sessionId);
  });

  test('without any rule the team id owns the memory', () => {
    const s = world();
    expect(memoryOwnerOf(s.db, s.team.id, 'build')).toBe(s.team.id);
  });

  test('injection through the rule owner returns what the rule remembered', () => {
    const s = world();
    const ruleId = seedRoute(s, 'session', { provider: 'stub-gw', modelId: 'stub-model' });
    for (const [agentId, content] of [
      [ruleId, 'run pnpm lint before push'],
      ['someone-else', 'unrelated lesson'],
    ] as const) {
      s.db
        .insert(agentMemory)
        .values({
          id: newRecordId(),
          agentId,
          teamId: s.team.id,
          title: content.slice(0, 20),
          content,
          projectId: null,
          createdAt: 1,
          updatedAt: 1,
        })
        .run();
    }
    expect(
      injectMemories(s.db, { agentId: memoryOwnerOf(s.db, s.team.id, 'plan') }).map(
        (m) => m.content,
      ),
    ).toEqual(['run pnpm lint before push']);
  });
});
