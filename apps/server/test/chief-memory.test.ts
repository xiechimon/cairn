import { describe, expect, test } from 'vitest';
import { AGENT_ID, H, registerChiefHarness, relay } from './chief-harness.js';

registerChiefHarness();

describe('save_memory write path (r5 section 6)', () => {
  test('entries carry three-level provenance (sourceBuildId = chief conv id)', async () => {
    const mem = (await relay('save_memory', {
      file: 't',
      content: 'c',
      scope: H.projectId,
    })) as {
      agentId: string;
      sourceBuildId: string | null;
      projectId: string | null;
    };
    expect(mem.agentId).toBe(AGENT_ID);
    expect(mem.sourceBuildId).toBe(H.threadId);
    expect(mem.projectId).toBe(H.projectId);
  });

  test('files have no entry cap or duplicate-content gate', async () => {
    for (let i = 0; i < 105; i++)
      await relay('save_memory', { scope: 'team', file: `file-${i}`, content: 'same content' });
    let count = 0;
    let offset: number | null = 0;
    while (offset !== null) {
      const page = (await relay('memories', { scope: 'team', offset })) as {
        documents: unknown[];
        nextOffset: number | null;
      };
      count += page.documents.length;
      offset = page.nextOffset;
    }
    expect(count).toBe(106);
  });
});
