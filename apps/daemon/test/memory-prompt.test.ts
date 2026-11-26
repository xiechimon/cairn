import { MEMORY_VERIFY_NOTE } from '@cairn/shared';
import { expect, test } from 'vitest';
import { composeWorkerSystemPrompt } from '../src/step-prompt.js';

test('injected worker memory tells the agent to verify it against the repository', () => {
  const prompt = composeWorkerSystemPrompt(null, [{ title: 'MEMORY.md', content: '- fact' }]);
  expect(prompt).toContain(`## 记忆\n${MEMORY_VERIFY_NOTE}\n- MEMORY.md：- fact`);
});
