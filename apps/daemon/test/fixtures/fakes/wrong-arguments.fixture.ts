import { test } from 'vitest';
import { scriptedModel } from '../../fakes/scripted-model.js';

test('mismatched arguments name the expected step', () => {
  const model = scriptedModel([
    { name: 'read Project', tool: 'read', arguments: { path: 'a' }, response: 'ok' },
  ]);
  model.callTool('read', { path: 'b' });
});
