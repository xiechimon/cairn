import { expect, test } from 'vitest';
import { CHIEF_REMOTE_TOOLS, MEMORY_TOOLS, WORKER_MEMORY_REMOTE_TOOLS } from '../src/index.js';

test('Coordinator and worker memory tools use one document contract', () => {
  for (const name of MEMORY_TOOLS) {
    const worker = WORKER_MEMORY_REMOTE_TOOLS.find((t) => t.name === name);
    expect(CHIEF_REMOTE_TOOLS.find((t) => t.name === name)).toEqual(worker);
    expect(worker?.parameters).toMatchObject({
      properties: { scope: { type: 'string' }, file: { type: 'string' } },
    });
  }
  expect(
    WORKER_MEMORY_REMOTE_TOOLS.find((t) => t.name === 'update_memory')?.parameters,
  ).toMatchObject({ required: ['scope', 'file', 'baseVersion'] });
});
