import { test } from 'vitest';
import { scriptedModel } from '../../fakes/scripted-model.js';

test('a caller cannot swallow an unexpected tool failure', () => {
  const model = scriptedModel([
    { name: 'read Project', tool: 'read', arguments: {}, response: 'ok' },
  ]);
  model.callTool('read', {});
  try {
    model.callTool('write', {});
  } catch {}
});
