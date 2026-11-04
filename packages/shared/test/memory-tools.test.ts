import { expect, test } from 'vitest';
import { CHIEF_REMOTE_TOOLS, MEMORY_TOOLS, WORKER_MEMORY_REMOTE_TOOLS } from '../src/index.js';

test('memory tools: publish-update entry, plus candidates, forced-write, and history semantics', () => {
  expect(MEMORY_TOOLS).toContain('update_memory');
  for (const tools of [CHIEF_REMOTE_TOOLS, WORKER_MEMORY_REMOTE_TOOLS]) {
    const save = tools.find((t) => t.name === 'save_memory');
    expect(save?.description).toContain('update_memory');
    expect(save?.description).toContain('409');
    expect(save?.parameters).toMatchObject({ properties: { force: { type: 'boolean' } } });
    const update = tools.find((t) => t.name === 'update_memory');
    expect(update?.parameters).toMatchObject({ required: ['memoryId', 'content'] });
    expect(update?.description).toContain('history');
    expect(tools.find((t) => t.name === 'memories')?.description).toContain('history');
    expect(tools.find((t) => t.name === 'memories')?.parameters).toMatchObject({
      properties: { includeInvalid: { type: 'boolean' } },
    });
    expect(update?.description).toContain('superseded');
  }
});
