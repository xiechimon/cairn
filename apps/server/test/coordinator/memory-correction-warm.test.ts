import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { expect, test } from 'vitest';
import { memoryCorrection } from '../../src/db/schema.js';
import { executeMemoryDocumentTool } from '../../src/services/memory-documents.js';
import { req } from '../helpers.js';
import { boot, type World, world } from './runner-world.js';

const RULE = '- Reply with the conclusion first.';

function teamIndex(w: World) {
  const owner = { agentId: 'rule-coordinator', teamId: w.teamId, projectId: null };
  const read = () =>
    executeMemoryDocumentTool(w.s.db, owner, 'memories', {
      scope: 'team',
      file: 'MEMORY.md',
    }) as { baseVersion: string };
  return {
    read,
    save: (content: string) =>
      executeMemoryDocumentTool(w.s.db, owner, 'update_memory', {
        scope: 'team',
        file: 'MEMORY.md',
        baseVersion: read().baseVersion,
        content,
      }),
  };
}

test('a rule saved while the prompt is reused is not in the attached index', async () => {
  const w = await world('hello');
  const index = teamIndex(w);
  const systems: string[] = [];
  let report = false;
  const faux = fauxProvider({
    provider: 'stub',
    models: [{ id: 'm', contextWindow: 200_000 }],
    tokensPerSecond: 1e9,
  });
  faux.setResponses(
    Array(12).fill((c: { systemPrompt?: string; messages: { role: string }[] }) => {
      systems.push(JSON.stringify(c));
      if (!report || c.messages.at(-1)?.role === 'toolResult') return fauxAssistantMessage('ok');
      report = false;
      return fauxAssistantMessage(
        [
          fauxToolCall('call_tool', {
            name: 'update_memory',
            arguments: {
              scope: 'team',
              file: 'MEMORY.md',
              baseVersion: index.read().baseVersion,
              correction: true,
              repeats: RULE,
            },
          }),
        ],
        { stopReason: 'toolUse' },
      );
    }),
  );
  const coordinator = boot(w, faux);
  const say = async (content: string) => {
    const sent = await req(w.s.app, 'POST', `/api/conversations/${w.threadId}/messages`, {
      content,
    });
    expect(sent.status).toBeLessThan(300);
    coordinator.wake(w.threadId);
    await coordinator.idle();
  };

  coordinator.wake(w.threadId);
  await coordinator.idle();
  index.save(RULE);
  await say('How is the release going?');
  expect(systems.at(-1)).not.toContain('Reply with the conclusion first');
  report = true;
  await say('Again: conclusion first.');

  expect(w.s.db.select().from(memoryCorrection).all()).toMatchObject([
    { inTurnIndex: false, pointedRule: RULE },
  ]);
});

test('a rule this chat saved is not in the index of a turn that reuses the older prompt', async () => {
  const w = await world('Stop opening with background.');
  const index = teamIndex(w);
  let write: Record<string, unknown> | null = null;
  const faux = fauxProvider({
    provider: 'stub',
    models: [{ id: 'm', contextWindow: 200_000 }],
    tokensPerSecond: 1e9,
  });
  faux.setResponses(
    Array(12).fill(() => {
      if (write === null) return fauxAssistantMessage('ok');
      const args = { scope: 'team', file: 'MEMORY.md', baseVersion: index.read().baseVersion };
      const call = fauxToolCall('call_tool', {
        name: 'update_memory',
        arguments: { ...args, correction: true, ...write },
      });
      write = null;
      return fauxAssistantMessage([call], { stopReason: 'toolUse' });
    }),
  );
  const coordinator = boot(w, faux);
  write = { content: RULE };
  coordinator.wake(w.threadId);
  await coordinator.idle();

  write = { repeats: RULE };
  const sent = await req(w.s.app, 'POST', `/api/conversations/${w.threadId}/messages`, {
    content: 'I just told you: conclusion first.',
  });
  expect(sent.status).toBeLessThan(300);
  coordinator.wake(w.threadId);
  await coordinator.idle();

  expect(w.s.db.select().from(memoryCorrection).all()).toMatchObject([
    { pointedRule: null, inTurnIndex: null },
    { pointedRule: RULE, inTurnIndex: false },
  ]);
});
