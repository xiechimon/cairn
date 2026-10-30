import type { SessionOpts, StepEvent } from '@cairn/shared';
import { expect, test, vi } from 'vitest';
import { scriptedModel } from './fakes/scripted-model.js';

const opts: SessionOpts = {
  provider: { kind: 'http', providerId: 'script' },
  modelId: 'script',
  cwd: '/sandbox',
};

test('rejects an unconsumed step by name', () => {
  const model = scriptedModel([
    { name: 'read Project', tool: 'read', arguments: {}, response: 'ok' },
  ]);
  expect(() => model.assertConsumed()).toThrow('read Project');
  model.callTool('read', {});
});

test('consumes exact arguments and the response from an isolated script', () => {
  const script = [{ name: 'read Project', tool: 'read', arguments: { path: 'a' }, response: 'ok' }];
  const model = scriptedModel(script);
  script[0]!.arguments.path = 'changed';
  expect(model.callTool('read', { path: 'a' })).toBe('ok');
  model.assertConsumed();
});

test('drives the backend seam and verifies real tool responses', async () => {
  const execute = vi.fn(async () => 'Project contents');
  const model = scriptedModel([
    { name: 'read Project', tool: 'read', arguments: { path: 'a' }, response: 'Project contents' },
  ]);
  const session = await model.backend.createSession({ ...opts, executeRemoteTool: execute });
  const events: StepEvent[] = [];
  for await (const event of session.events) events.push(event);
  expect(execute).toHaveBeenCalledWith('read', { path: 'a' });
  expect(events).toMatchObject([
    { type: 'toolcall_end', call: { name: 'read', result: 'Project contents' } },
    { type: 'done' },
  ]);
  model.assertConsumed();
});

test('a mismatched tool response fails the backend run', async () => {
  const model = scriptedModel([
    { name: 'read Project', tool: 'read', arguments: {}, response: 'expected' },
  ]);
  const session = await model.backend.createSession({
    ...opts,
    executeRemoteTool: async () => 'wrong',
  });
  await expect(async () => {
    for await (const _event of session.events) {
    }
  }).rejects.toThrow(/read Project.*response/);
  model.callTool('read', {});
});
