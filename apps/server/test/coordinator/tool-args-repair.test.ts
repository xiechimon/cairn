import { join } from 'node:path';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { fauxAssistantMessage, fauxProvider, type ToolCall } from '@earendil-works/pi-ai';
import { createModels } from '@earendil-works/pi-ai/models';
import { afterEach, describe, expect, it } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../../scripts/test-tmpdir.mjs';
import { openCoordinatorHarness } from '../../src/coordinator/runtime/harness.js';
import {
  argumentsErrorText,
  INVALID_ARGUMENT_STREAK_CAP,
  repairToolCallArguments,
} from '../../src/coordinator/runtime/tool-args-repair.js';
import {
  coordinatorToolsExtension,
  createStepGate,
  type ToolChannel,
} from '../../src/coordinator/runtime/tools.js';

const INCIDENT_RAW = `{"projectId": "kPe5w6Ulzc2viKul7cIWH", "title": "输入框有序列表退格需整块删掉标记", "research": 先读 t3-code 的输入框实现，看它怎么让有序列表标记（1. / 2.）成为一个整体、在标记后按退格能整块删掉，再定 Cairn 输入框的方案。, "difficulty": "standard"}`;

const INCIDENT_ERROR = `Unexpected token '先', ..."esearch": 先读 t3-code"... is not valid JSON\n\nReceived arguments:\n${INCIDENT_RAW}`;

function badCall(name: string, argumentsError: string, id = 'call-1'): ToolCall {
  return { type: 'toolCall', id, name, arguments: {}, argumentsError };
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) releaseTestTempDir(d);
});

describe('repairToolCallArguments', () => {
  it('repairs an unquoted string value containing slashes and CJK', () => {
    const repaired = repairToolCallArguments(INCIDENT_RAW);
    expect(repaired).toEqual({
      projectId: 'kPe5w6Ulzc2viKul7cIWH',
      title: '输入框有序列表退格需整块删掉标记',
      research:
        '先读 t3-code 的输入框实现，看它怎么让有序列表标记（1. / 2.）成为一个整体、在标记后按退格能整块删掉，再定 Cairn 输入框的方案。',
      difficulty: 'standard',
    });
  });

  it('repairs single-quoted strings', () => {
    expect(repairToolCallArguments("{'a': 'x', 'b': 1}")).toEqual({ a: 'x', b: 1 });
  });

  it('repairs a trailing comma', () => {
    expect(repairToolCallArguments('{"a": "x", "b": 1,}')).toEqual({ a: 'x', b: 1 });
  });

  it('repairs Python-style literals', () => {
    expect(repairToolCallArguments('{"a": True, "b": None}')).toEqual({ a: true, b: null });
  });

  it('refuses a value that is not a JSON object', () => {
    expect(repairToolCallArguments('[1, 2]')).toBeUndefined();
    expect(repairToolCallArguments('"x"')).toBeUndefined();
  });

  it('refuses text it cannot repair', () => {
    expect(repairToolCallArguments('totally not json')).toBeUndefined();
    expect(repairToolCallArguments('{')).toEqual({});
  });
});

describe('argumentsErrorText', () => {
  it('extracts the raw arguments after the marker', () => {
    expect(argumentsErrorText(INCIDENT_ERROR)).toBe(INCIDENT_RAW);
  });

  it('returns undefined without the marker', () => {
    expect(argumentsErrorText('some other error')).toBeUndefined();
  });
});

async function runTurn(
  responses: Parameters<ReturnType<typeof fauxProvider>['setResponses']>[0],
  channel: ToolChannel,
) {
  const dir = makeTestTempDir('coord-repair-');
  dirs.push(dir);
  const ctx = BACKGROUND_CONTEXT;
  const faux = fauxProvider({ provider: 'stub', models: [{ id: 'm', contextWindow: 200_000 }] });
  faux.setResponses(responses);
  const models = createModels();
  models.setProvider(faux.provider);
  const gate = createStepGate();
  gate.set('step-1');
  const harness = await openCoordinatorHarness(join(dir, 'coordinator.sqlite'), models, ctx, {
    extensions: [coordinatorToolsExtension(channel, gate)],
  });
  const root = await harness.root(ctx, { agent: { model: { provider: 'stub', modelId: 'm' } } });
  const submission = await root.submit({ type: 'input', content: 'hi', requestId: 'step-1' }, ctx);
  const settled = await submission.wait(ctx);
  await harness.close(ctx);
  return { settled, faux };
}

describe('tool arguments repair in a Coordinator turn', () => {
  it('a malformed tool call is repaired before validation and the tool runs once', async () => {
    const calls: Record<string, unknown>[] = [];
    const channel = {
      relayTool: async (_step: string, _name: string, params: Record<string, unknown>) => {
        calls.push(params);
        return '{"ok":true}';
      },
      relayComputer: async () => {
        throw new Error('no computer');
      },
      askUser: async () => {
        throw new Error('no ask');
      },
      transcriptRow: async () => {
        throw new Error('no transcript');
      },
    } as ToolChannel;
    const { settled } = await runTurn(
      [
        fauxAssistantMessage([badCall('todos', INCIDENT_ERROR)], { stopReason: 'toolUse' }),
        fauxAssistantMessage('done'),
      ],
      channel,
    );
    expect(settled.status).toBe('done');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      projectId: 'kPe5w6Ulzc2viKul7cIWH',
      title: '输入框有序列表退格需整块删掉标记',
      research:
        '先读 t3-code 的输入框实现，看它怎么让有序列表标记（1. / 2.）成为一个整体、在标记后按退格能整块删掉，再定 Cairn 输入框的方案。',
      difficulty: 'standard',
    });
  });

  it('an unrepairable call keeps the invalid-arguments feedback loop', async () => {
    const calls: Record<string, unknown>[] = [];
    const channel = {
      relayTool: async (_step: string, _name: string, params: Record<string, unknown>) => {
        calls.push(params);
        return '{"ok":true}';
      },
      relayComputer: async () => {
        throw new Error('no computer');
      },
      askUser: async () => {
        throw new Error('no ask');
      },
      transcriptRow: async () => {
        throw new Error('no transcript');
      },
    } as ToolChannel;
    let secondContext = '';
    const { settled } = await runTurn(
      [
        fauxAssistantMessage(
          [badCall('todos', 'broken\n\nReceived arguments:\n{"a": {{{unrepairable')],
          { stopReason: 'toolUse' },
        ),
        (context) => {
          secondContext = JSON.stringify(context.messages);
          return fauxAssistantMessage('done');
        },
      ],
      channel,
    );
    expect(settled.status).toBe('done');
    expect(calls).toHaveLength(0);
    expect(secondContext).toContain('Invalid arguments');
  });

  it(`stops paying rounds after ${INVALID_ARGUMENT_STREAK_CAP} consecutive malformed calls`, async () => {
    const calls: Record<string, unknown>[] = [];
    const channel = {
      relayTool: async (_step: string, _name: string, params: Record<string, unknown>) => {
        calls.push(params);
        return '{"ok":true}';
      },
      relayComputer: async () => {
        throw new Error('no computer');
      },
      askUser: async () => {
        throw new Error('no ask');
      },
      transcriptRow: async () => {
        throw new Error('no transcript');
      },
    } as ToolChannel;
    const bad = () =>
      fauxAssistantMessage(
        [
          badCall(
            'todos',
            'broken\n\nReceived arguments:\n{"a": {{{unrepairable',
            `call-${Math.random()}`,
          ),
        ],
        { stopReason: 'toolUse' },
      );
    const { settled, faux } = await runTurn([bad(), bad(), bad(), bad()], channel);
    expect(calls).toHaveLength(0);
    expect(faux.state.callCount).toBe(INVALID_ARGUMENT_STREAK_CAP);
    expect(settled.status).not.toBe('done');
  });
});
