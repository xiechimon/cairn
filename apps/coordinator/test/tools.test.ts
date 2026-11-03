import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHIEF_REMOTE_TOOLS } from '@cairn/shared';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { afterEach, describe, expect, it } from 'vitest';
import { openCoordinatorHarness } from '../src/runtime/harness.js';
import { createCoordinatorModels } from '../src/runtime/models.js';
import {
  COORDINATOR_TOOL_OUTPUT_MAX_BYTES,
  coordinatorToolsExtension,
  createStepGate,
} from '../src/runtime/tools.js';
import { runCoordinatorTurn } from '../src/runtime/turn.js';
import { chiefStep, fakeMachineApi } from './fake-machine-api.js';

const ctx = BACKGROUND_CONTEXT;
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function storagePath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'coord-tools-'));
  dirs.push(dir);
  return join(dir, 'coordinator.sqlite');
}

type FauxContext = { messages: { role: string; content: unknown }[] };

function toolThenAnswer(name: string, args: { [key: string]: string }) {
  const seenResults: string[] = [];
  const faux = fauxProvider({ provider: 'stub', models: [{ id: 'm', contextWindow: 200_000 }] });
  faux.setResponses(
    Array(4).fill((c: FauxContext) => {
      const last = c.messages.at(-1);
      if (last?.role === 'toolResult') {
        seenResults.push(JSON.stringify(last.content));
        return fauxAssistantMessage('done');
      }
      return fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: 'toolUse' });
    }),
  );
  return { coordinatorModels: createCoordinatorModels([faux.provider]), seenResults };
}

describe('coordinator tools', () => {
  it('offers every Coordinator tool with its replay rule from the shared definitions', () => {
    const extension = coordinatorToolsExtension(async () => '', createStepGate());
    const tools = extension.tools ?? [];
    expect(tools.map((t) => t.name).sort()).toEqual(CHIEF_REMOTE_TOOLS.map((t) => t.name).sort());
    for (const def of CHIEF_REMOTE_TOOLS) {
      const tool = tools.find((t) => t.name === def.name);
      expect({ name: def.name, replay: tool?.replay }).toEqual({
        name: def.name,
        replay: def.replaySafe === true ? 'safe' : 'unsafe',
      });
    }
    for (const dispatching of ['run_builds', 'create_todo', 'set_secret', 'delete_todos']) {
      expect(tools.find((t) => t.name === dispatching)?.replay).toBe('unsafe');
    }
    for (const reading of ['todos', 'read_history', 'search_history']) {
      expect(tools.find((t) => t.name === reading)?.replay).toBe('safe');
    }
  });

  it('relays a model tool call to the server under the claimed step and feeds back the result', async () => {
    const { coordinatorModels, seenResults } = toolThenAnswer('todos', { projectId: 'p1' });
    const api = fakeMachineApi();
    const gate = createStepGate();
    const harness = await openCoordinatorHarness(storagePath(), coordinatorModels.models, ctx, {
      extensions: [coordinatorToolsExtension(api.relayTool, gate)],
    });
    await runCoordinatorTurn(
      {
        harness,
        models: coordinatorModels,
        api,
        context: ctx,
        heartbeatMs: 1000,
        now: () => 1,
        gate,
      },
      chiefStep('step-tool', 'what is open?'),
    );
    expect(api.tools).toEqual([
      { stepId: 'step-tool', name: 'todos', params: { projectId: 'p1' } },
    ]);
    expect(seenResults[0]).toContain('result of todos');
    expect(api.dones.map((d) => d.body.status)).toEqual(['success']);
    await harness.close(ctx);
  });

  it('turns a relay failure into an error result instead of failing the turn', async () => {
    const { coordinatorModels, seenResults } = toolThenAnswer('todos', {});
    const api = fakeMachineApi();
    api.relayTool = async () => {
      throw new Error('POST /api/machine/tool/step-err -> 400 bad params');
    };
    const gate = createStepGate();
    const harness = await openCoordinatorHarness(storagePath(), coordinatorModels.models, ctx, {
      extensions: [coordinatorToolsExtension(api.relayTool, gate)],
    });
    await runCoordinatorTurn(
      {
        harness,
        models: coordinatorModels,
        api,
        context: ctx,
        heartbeatMs: 1000,
        now: () => 1,
        gate,
      },
      chiefStep('step-err', 'hi'),
    );
    expect(seenResults[0]).toContain('400 bad params');
    expect(api.dones.map((d) => d.body.status)).toEqual(['success']);
    await harness.close(ctx);
  });

  it('caps a huge tool result before it enters the transcript', async () => {
    const { coordinatorModels, seenResults } = toolThenAnswer('conversation', {
      conversationId: 'c',
    });
    const api = fakeMachineApi();
    api.relayTool = async () => 'x'.repeat(COORDINATOR_TOOL_OUTPUT_MAX_BYTES * 10);
    const gate = createStepGate();
    const harness = await openCoordinatorHarness(storagePath(), coordinatorModels.models, ctx, {
      extensions: [coordinatorToolsExtension(api.relayTool, gate)],
    });
    await runCoordinatorTurn(
      {
        harness,
        models: coordinatorModels,
        api,
        context: ctx,
        heartbeatMs: 1000,
        now: () => 1,
        gate,
      },
      chiefStep('step-big', 'read it'),
    );
    expect(seenResults[0]?.length ?? 0).toBeLessThan(COORDINATOR_TOOL_OUTPUT_MAX_BYTES * 2);
    await harness.close(ctx);
  });

  it('holds a resumed tool call until its step is claimed again', async () => {
    const gate = createStepGate();
    let resolved: string | null = null;
    const pending = gate.current().then((id) => {
      resolved = id;
    });
    await Promise.resolve();
    expect(resolved).toBeNull();
    gate.set('step-resumed');
    await pending;
    expect(resolved).toBe('step-resumed');
  });
});
