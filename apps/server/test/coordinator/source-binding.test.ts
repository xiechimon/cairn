import { toolCallRecordSchema } from '@cairn/shared';
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { expect, test } from 'vitest';
import { chiefMessage, step, todo } from '../../src/db/schema.js';
import { postProject } from '../helpers.js';
import { seedOwnerMessage } from '../owner-message.js';
import { boot, world } from './runner-world.js';

test('running Coordinator replays the batch sequence without creating a combined task', async () => {
  const w = await world('Please dispatch the caret alignment fix.');
  const projectId = await postProject(w.s.app, 'source-binding');
  const preview = seedOwnerMessage(
    w.s.db,
    w.threadId,
    'Research Markdown preview implementations, then propose a plan.',
  );
  const pending = w.s.db.select().from(step).get()!;
  const caret = pending.ownerMessageIds![0]!;
  w.s.db
    .update(step)
    .set({ ownerMessageIds: [caret, preview] })
    .run();
  const faux = fauxProvider({
    provider: 'stub',
    models: [{ id: 'm', contextWindow: 200_000 }],
    tokensPerSecond: 1e9,
  });
  const requests: Parameters<typeof fauxToolCall>[1][] = [
    { projectId, output: 'info' },
    { projectId, messageIds: [preview], output: 'info' },
    { projectId, messageIds: [caret] },
    { projectId, messageIds: [preview] },
    { projectId, messageIds: [caret], quotes: ['caret alignment fix.'] },
  ];
  faux.setResponses([
    ...requests.map((params) =>
      fauxAssistantMessage([fauxToolCall('create_todo', params)], { stopReason: 'toolUse' }),
    ),
    fauxAssistantMessage('Done.'),
  ]);
  const coordinator = boot(w, faux);
  coordinator.wake(w.threadId);
  await coordinator.idle();
  const rows = w.s.db.select().from(todo).all();
  expect(rows.map((row) => row.spec)).toEqual([
    'Research Markdown preview implementations, then propose a plan.',
    'Please dispatch the caret alignment fix.',
    '> caret alignment fix.',
  ]);
  expect(rows.map((row) => row.phase)).toEqual(['queued', 'queued', 'queued']);
  const transcript = w.s.db.select().from(chiefMessage).all();
  const calls = transcript
    .map((row) => row.content)
    .flatMap((content) => {
      if (typeof content !== 'object' || content === null || !('call' in content)) return [];
      const parsed = toolCallRecordSchema.safeParse(content.call);
      return parsed.success ? [parsed.data] : [];
    });
  expect(calls).toHaveLength(4);
  expect(calls.map((content) => content.isError)).toEqual([false, false, true, false]);
  console.log(
    'Coordinator source replay:',
    JSON.stringify({
      dispatched: calls.map((content) => ({
        arguments: content.arguments,
        isError: content.isError,
      })),
      tasks: rows.map((row) => ({ spec: row.spec, phase: row.phase })),
    }),
  );
}, 30_000);
