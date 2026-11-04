import { test } from 'vitest';
import { scriptedModel } from '../../fakes/scripted-model.js';

test('unfinished script', () => {
  scriptedModel([{ name: 'read Project', tool: 'read', arguments: {}, response: 'ok' }]);
});
