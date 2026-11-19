import { expect, test } from 'vitest';
import { CHIEF_REMOTE_TOOLS, MEMORY_TOOLS, WORKER_MEMORY_REMOTE_TOOLS } from '../src/index.js';

test('Coordinator and worker memory tools use one document contract', () => {
  for (const name of MEMORY_TOOLS) {
    const worker = WORKER_MEMORY_REMOTE_TOOLS.find((t) => t.name === name);
    const coordinator = CHIEF_REMOTE_TOOLS.find((t) => t.name === name);
    expect({ ...coordinator, description: '' }).toEqual({ ...worker, description: '' });
    expect(worker?.parameters).toMatchObject({
      properties: { scope: { type: 'string' }, file: { type: 'string' } },
    });
  }
  expect(
    WORKER_MEMORY_REMOTE_TOOLS.find((t) => t.name === 'update_memory')?.parameters,
  ).toMatchObject({ required: ['scope', 'file', 'baseVersion'] });
});

test('the Coordinator writes team memory only when asked, under the cap', () => {
  const description = CHIEF_REMOTE_TOOLS.find((t) => t.name === 'update_memory')?.description;
  expect(description).toContain('只在用户说"记住"或纠正你时调用');
  expect(description).toContain('2,000 字');
  expect(description).toContain('先合并或删掉旧条目');
});
