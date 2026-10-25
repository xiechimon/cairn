import { describe, expect, test } from 'vitest';
import { agentMemory } from '../src/db/schema.js';
import { HttpError } from '../src/lib/errors.js';
import { newRecordId, nowMs } from '../src/lib/ids.js';
import { AGENT_ID, H, registerChiefHarness, relay } from './chief-harness.js';

registerChiefHarness();

describe('save_memory write path (r5 section 6)', () => {
  test('entries carry three-level provenance (sourceBuildId = chief conv id)', async () => {
    const mem = (await relay('save_memory', {
      title: 't',
      content: 'c',
      projectId: H.projectId,
    })) as {
      agentId: string;
      sourceBuildId: string | null;
      projectId: string | null;
    };
    expect(mem.agentId).toBe(AGENT_ID);
    expect(mem.sourceBuildId).toBe(H.threadId);
    expect(mem.projectId).toBe(H.projectId);
  });

  test('quota 100 entries/Agent (over -> 409)', async () => {
    for (let i = 0; i < 100; i++) {
      H.s.db
        .insert(agentMemory)
        .values({
          id: newRecordId(),
          agentId: AGENT_ID,
          teamId: H.teamId,
          title: `m${i}`,
          content: 'c',
          projectId: null,
          sourceTodoId: null,
          sourceBuildId: null,
          createdAt: nowMs(),
          updatedAt: nowMs(),
        })
        .run();
    }
    let threw = false;
    try {
      await relay('save_memory', { title: 'overflow', content: 'c' });
    } catch (err) {
      threw = err instanceof HttpError && err.status === 409;
    }
    expect(threw).toBe(true);
  });

  test('memories read back + delete_memory', async () => {
    const mem = (await relay('save_memory', { title: 'x', content: 'y' })) as { id: string };
    const list = (await relay('memories', {})) as { id: string }[];
    expect(list.some((m) => m.id === mem.id)).toBe(true);
    await relay('delete_memory', { memoryId: mem.id });
    const after = (await relay('memories', {})) as { id: string }[];
    expect(after.some((m) => m.id === mem.id)).toBe(false);
  });
});
