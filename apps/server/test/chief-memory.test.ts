import { eq } from 'drizzle-orm';
import { describe, expect, onTestFinished, test } from 'vitest';
import { routingRule } from '../src/db/schema.js';
import { buildChiefSystemPrompt } from '../src/services/chief.js';
import { setCoordinatorInServer } from '../src/services/coordinator-context.js';
import { createProvider } from '../src/services/providers.js';
import { coordinatorMemoryOwner } from '../src/services/routing-rules.js';
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

  test('on the default coordinator route the memory is saved under the chief and read back next turn', async () => {
    H.s.db.delete(routingRule).where(eq(routingRule.use, 'coordinator')).run();
    setCoordinatorInServer(true);
    onTestFinished(() => setCoordinatorInServer(false));
    expect(coordinatorMemoryOwner(H.s.db, H.teamId)).toBeUndefined();
    createProvider(
      { db: H.s.db, box: H.s.secretBox },
      {
        teamId: H.teamId,
        body: {
          providerId: 'vani',
          label: 'Vani',
          baseUrl: 'https://vani.example.com/v1',
          api: 'openai-completions',
          apiKey: 'vani-key',
          models: [{ id: 'glm-5.3', name: 'glm' }],
        },
        createdBy: H.userId,
      },
    );
    const owner = coordinatorMemoryOwner(H.s.db, H.teamId) ?? null;
    const mem = (await relay(
      'save_memory',
      { scope: 'team', file: 'prefs', content: 'deploys go out on Fridays only' },
      { chiefAgentId: owner },
    )) as { agentId: string };
    expect(mem.agentId).toBe(H.chiefId);
    const next = buildChiefSystemPrompt(
      { db: H.s.db, hub: H.s.hub, user: H.s.user, skillsDir: H.s.skillsDir },
      H.teamId,
      H.threadId,
    );
    expect(next.text).toContain('记忆文件：1 个');
  });
});
