import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ASK_REQUEST_ID_PATTERN,
  CHIEF_REMOTE_TOOLS,
  CHIEF_REPLY_TOOLS,
  CHIEF_ROUTER_TOOLS,
  COMPUTER_REMOTE_TOOLS,
  REQUEST_SECRET_TOOL_DEF,
  SUGGEST_REPLIES_TOOL_NAME,
} from '@cairn/shared';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type Provider,
} from '@earendil-works/pi-ai';
import { afterEach, describe, expect, it } from 'vitest';
import { openCoordinatorHarness } from '../../src/coordinator/runtime/harness.js';
import type { OcrRunner } from '../../src/coordinator/runtime/image-text.js';
import { createCoordinatorModels } from '../../src/coordinator/runtime/models.js';
import {
  askRequestId,
  COORDINATOR_TOOL_OUTPUT_MAX_BYTES,
  CORE_COORDINATOR_TOOLS,
  coordinatorToolsExtension,
  createStepGate,
} from '../../src/coordinator/runtime/tools.js';
import { runCoordinatorTurn } from '../../src/coordinator/runtime/turn.js';
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

const validPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

type FauxContext = { messages: { role: string; content: unknown }[] };

function toolThenAnswer(
  name: string,
  args: Parameters<typeof fauxToolCall>[1],
  input?: ('text' | 'image')[],
  extraProviders: Provider[] = [],
) {
  const seenResults: string[] = [];
  const seenMessages: FauxContext[] = [];
  const faux = fauxProvider({
    provider: 'stub',
    models: [{ id: 'm', contextWindow: 200_000, ...(input === undefined ? {} : { input }) }],
  });
  faux.setResponses(
    Array(50).fill((c: FauxContext) => {
      seenMessages.push(c);
      const last = c.messages.at(-1);
      if (last?.role === 'toolResult') {
        seenResults.push(JSON.stringify(last.content));
        return fauxAssistantMessage('done');
      }
      return fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: 'toolUse' });
    }),
  );
  return {
    coordinatorModels: createCoordinatorModels([faux.provider, ...extraProviders]),
    seenResults,
    seenMessages,
  };
}

describe('deferred coordinator tools', () => {
  it('offers only the core tools, lists the rest in tool_search, and runs them through call_tool', async () => {
    const offered: string[][] = [];
    const seenResults: string[] = [];
    const faux = fauxProvider({ provider: 'stub', models: [{ id: 'm', contextWindow: 200_000 }] });
    const steps = [
      fauxAssistantMessage([fauxToolCall('tool_search', { query: 'merge_builds' })], {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage(
        [fauxToolCall('call_tool', { name: 'merge_builds', arguments: { buildIds: ['b1'] } })],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('done'),
    ];
    faux.setResponses(
      steps.map((reply) => (c: FauxContext) => {
        const declared = new Set<string>();
        for (const m of c.messages as {
          role: string;
          toolsAdded?: { name: string }[];
          toolsRemoved?: { name: string }[];
        }[]) {
          if (m.role !== 'system') continue;
          for (const t of m.toolsAdded ?? []) declared.add(t.name);
          for (const t of m.toolsRemoved ?? []) declared.delete(t.name);
        }
        offered.push([...declared]);
        const last = c.messages.at(-1);
        if (last?.role === 'toolResult') seenResults.push(JSON.stringify(last.content));
        return reply;
      }),
    );
    const coordinatorModels = createCoordinatorModels([faux.provider]);
    const api = fakeMachineApi();
    const gate = createStepGate();
    const extension = coordinatorToolsExtension(api, gate, { loaded: CORE_COORDINATOR_TOOLS });
    const search = extension.tools?.find((t) => t.name === 'tool_search');
    expect(search?.description).toContain('- merge_builds: ');
    expect(search?.description).toContain('- archive_todos: ');
    const harness = await openCoordinatorHarness(storagePath(), coordinatorModels.models, ctx, {
      extensions: [extension],
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
      chiefStep('step-deferred', 'merge it'),
    );
    expect(offered).toHaveLength(3);
    for (const names of offered) {
      expect(names).toEqual(offered[0]);
      expect(names).toContain('create_todo');
      expect(names).toContain('tool_search');
      expect(names).toContain('call_tool');
      expect(names).toContain('show_diff');
      expect(names).toContain('show_chart');
      expect(names).not.toContain('merge_builds');
    }
    expect(seenResults[0]).toContain('merge_builds');
    expect(seenResults[0]).toContain('buildIds');
    expect(seenResults[0]!.match(/## /g)).toHaveLength(1);
    expect(api.tools).toEqual([
      { stepId: 'step-deferred', name: 'merge_builds', params: { buildIds: ['b1'] } },
    ]);
    expect(seenResults[1]).toContain('result of merge_builds');
    await harness.close(ctx);
  });

  it('offers complete_todos immediately in the core set without requiring tool_search', async () => {
    const offered: string[][] = [];
    const faux = fauxProvider({ provider: 'stub', models: [{ id: 'm', contextWindow: 200_000 }] });
    faux.setResponses([
      (c: FauxContext) => {
        const declared = new Set<string>();
        for (const m of c.messages as {
          role: string;
          toolsAdded?: { name: string }[];
          toolsRemoved?: { name: string }[];
        }[]) {
          if (m.role !== 'system') continue;
          for (const t of m.toolsAdded ?? []) declared.add(t.name);
          for (const t of m.toolsRemoved ?? []) declared.delete(t.name);
        }
        offered.push([...declared]);
        return fauxAssistantMessage([fauxToolCall('complete_todos', { todoIds: ['t1'] })], {
          stopReason: 'toolUse',
        });
      },
      fauxAssistantMessage('done'),
    ]);
    const coordinatorModels = createCoordinatorModels([faux.provider]);
    const api = fakeMachineApi();
    const gate = createStepGate();
    const harness = await openCoordinatorHarness(storagePath(), coordinatorModels.models, ctx, {
      extensions: [coordinatorToolsExtension(api, gate, { loaded: CORE_COORDINATOR_TOOLS })],
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
      chiefStep('step-core-complete', 'finish report'),
    );
    expect(offered[0]).toContain('complete_todos');
    expect(api.tools).toEqual([
      { stepId: 'step-core-complete', name: 'complete_todos', params: { todoIds: ['t1'] } },
    ]);
    await harness.close(ctx);
  });
});

describe('coordinator tools', () => {
  it('offers every Coordinator tool with its replay rule from the shared definitions', () => {
    const extension = coordinatorToolsExtension(fakeMachineApi(), createStepGate());
    const tools = extension.tools ?? [];
    const defs = [
      ...CHIEF_REMOTE_TOOLS,
      ...CHIEF_ROUTER_TOOLS,
      ...CHIEF_REPLY_TOOLS,
      REQUEST_SECRET_TOOL_DEF,
      ...COMPUTER_REMOTE_TOOLS,
    ];
    const actionNames = ['archive_project', 'unarchive_project', 'delete_project'];
    expect(tools.map((t) => t.name).sort()).toEqual(
      [...defs.map((t) => t.name), ...actionNames].sort(),
    );
    for (const name of actionNames) {
      expect(CHIEF_REMOTE_TOOLS.map((t) => t.name)).not.toContain(name);
      expect(tools.find((t) => t.name === name)?.replay).toBe('unsafe');
    }
    for (const def of defs) {
      const tool = tools.find((t) => t.name === def.name);
      expect({ name: def.name, replay: tool?.replay }).toEqual({
        name: def.name,
        replay: def.replaySafe === true || def.name === 'ask_user' ? 'safe' : 'unsafe',
      });
    }
    for (const dispatching of ['open_thread', 'create_todo', 'set_secret', 'delete_todos']) {
      expect(tools.find((t) => t.name === dispatching)?.replay).toBe('unsafe');
    }
    for (const reading of ['todos', 'read_history', 'search_history', 'browser_snapshot']) {
      expect(tools.find((t) => t.name === reading)?.replay).toBe('safe');
    }
    for (const browser of ['browser_navigate', 'browser_act']) {
      expect(tools.find((t) => t.name === browser)?.replay).toBe('unsafe');
    }
  });

  it('keeps suggest_replies loaded so a greeting needs no tool_search', () => {
    const extension = coordinatorToolsExtension(fakeMachineApi(), createStepGate(), {
      loaded: CORE_COORDINATOR_TOOLS,
    });
    const tools = extension.tools ?? [];
    const replies = tools.find((t) => t.name === SUGGEST_REPLIES_TOOL_NAME) as
      | { deferred?: boolean }
      | undefined;
    expect(replies?.deferred).not.toBe(true);
    const search = tools.find((t) => t.name === 'tool_search');
    expect(search?.description).not.toContain(`- ${SUGGEST_REPLIES_TOOL_NAME}: `);
  });

  it('relays a model tool call to the server under the claimed step and feeds back the result', async () => {
    const { coordinatorModels, seenResults } = toolThenAnswer('todos', { projectId: 'p1' });
    const api = fakeMachineApi();
    const gate = createStepGate();
    const harness = await openCoordinatorHarness(storagePath(), coordinatorModels.models, ctx, {
      extensions: [coordinatorToolsExtension(api, gate)],
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

  it('feeds attachment image bytes to the model as image content without text truncation', async () => {
    const data = Buffer.concat([
      validPng,
      Buffer.alloc(COORDINATOR_TOOL_OUTPUT_MAX_BYTES * 2),
    ]).toString('base64');
    const { coordinatorModels, seenResults } = toolThenAnswer('attachment', {
      attachmentId: 'team/image.png',
    });
    const api = fakeMachineApi();
    api.relayTool = async () =>
      JSON.stringify({
        id: 'image',
        fileName: 'image.png',
        mimeType: 'image/png',
        sizeBytes: data.length,
        encoding: 'base64',
        content: data,
      });
    const gate = createStepGate();
    const harness = await openCoordinatorHarness(storagePath(), coordinatorModels.models, ctx, {
      extensions: [coordinatorToolsExtension(api, gate)],
    });
    try {
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
        chiefStep('step-image', 'Describe the attached image'),
      );
      const image = (
        JSON.parse(seenResults[0]!) as { type: string; data?: string; mimeType?: string }[]
      ).find((block) => block.type === 'image');
      expect(image?.mimeType).toBe('image/png');
      expect(image?.data === data).toBe(true);
    } finally {
      await harness.close(ctx);
    }
  });

  it('returns an error and sends nothing to the computer when a text-only model calls computer_act', async () => {
    const { coordinatorModels, seenResults, seenMessages } = toolThenAnswer(
      'computer_act',
      { actions: [{ kind: 'key', key: 'Return' }] },
      ['text'],
    );
    const api = fakeMachineApi();
    const relayed: string[] = [];
    api.relayComputer = async (_stepId, name) => {
      relayed.push(name);
      return { text: 'screen 1600x1000', images: [] };
    };
    const gate = createStepGate();
    const harness = await openCoordinatorHarness(storagePath(), coordinatorModels.models, ctx, {
      extensions: [coordinatorToolsExtension(api, gate, { desktopTools: true })],
    });
    try {
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
        chiefStep('step-text-only', 'Look at the desktop'),
      );
      expect(relayed).toEqual([]);
      const result = seenMessages.at(-1)?.messages.at(-1) as { isError?: boolean } | undefined;
      expect(result?.isError).toBe(true);
      const text = (JSON.parse(seenResults[0]!) as { text?: string }[])
        .map((block) => block.text)
        .join('\n');
      expect(text).toContain('cannot see screenshots');
      expect(text).not.toContain('request_takeover');
    } finally {
      await harness.close(ctx);
    }
  });

  it('offers the desktop tools only when asked and feeds their screenshot to the model as an image', async () => {
    const without = coordinatorToolsExtension(fakeMachineApi(), createStepGate()).tools ?? [];
    expect(without.map((t) => t.name)).not.toContain('computer_observe');
    const { coordinatorModels, seenResults } = toolThenAnswer('computer_observe', {});
    const api = fakeMachineApi();
    const relayed: string[] = [];
    api.relayComputer = async (_stepId, name) => {
      relayed.push(name);
      return {
        text: 'screen 1600x1000, image 1568x980',
        images: [{ data: validPng.toString('base64'), mimeType: 'image/png' }],
      };
    };
    const gate = createStepGate();
    const extension = coordinatorToolsExtension(api, gate, { desktopTools: true });
    expect(extension.tools?.find((t) => t.name === 'computer_observe')?.replay).toBe('safe');
    expect(extension.tools?.find((t) => t.name === 'computer_act')?.replay).toBe('unsafe');
    const harness = await openCoordinatorHarness(storagePath(), coordinatorModels.models, ctx, {
      extensions: [extension],
    });
    try {
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
        chiefStep('step-observe', 'Screenshot your computer'),
      );
      expect(relayed).toEqual(['computer_observe']);
      const blocks = JSON.parse(seenResults[0]!) as {
        type: string;
        text?: string;
        mimeType?: string;
      }[];
      expect(blocks.find((block) => block.type === 'text')?.text).toContain('screen 1600x1000');
      expect(blocks.find((block) => block.type === 'image')?.mimeType).toBe('image/png');
    } finally {
      await harness.close(ctx);
    }
  });

  it("relays the owner's Mac tools through the computer channel and feeds their screenshot to the model", async () => {
    const { coordinatorModels, seenResults } = toolThenAnswer('user_computer_observe', {
      app: 'Finder',
    });
    const api = fakeMachineApi();
    const relayed: string[] = [];
    api.relayComputer = async (_stepId, name) => {
      relayed.push(name);
      return {
        text: 'Finder window, 12 elements',
        images: [{ data: validPng.toString('base64'), mimeType: 'image/png' }],
      };
    };
    const gate = createStepGate();
    const extension = coordinatorToolsExtension(api, gate, { ownComputer: true });
    const harness = await openCoordinatorHarness(storagePath(), coordinatorModels.models, ctx, {
      extensions: [extension],
    });
    try {
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
        chiefStep('step-own-mac', 'Read the Finder window on my Mac'),
      );
      expect(relayed).toEqual(['user_computer_observe']);
      expect(api.tools).toEqual([]);
      const blocks = JSON.parse(seenResults[0]!) as {
        type: string;
        text?: string;
        mimeType?: string;
      }[];
      expect(blocks.find((block) => block.type === 'text')?.text).toContain('Finder window');
      expect(blocks.find((block) => block.type === 'image')?.mimeType).toBe('image/png');
    } finally {
      await harness.close(ctx);
    }
  });

  it.each([
    {
      label: 'oversized PNG',
      mimeType: 'image/png',
      bytes: Buffer.concat([validPng, Buffer.alloc(8 * 1024 * 1024)]),
      readable: true,
    },
    {
      label: 'BMP',
      mimeType: 'image/bmp',
      bytes: Buffer.from(
        '424d3a000000000000003600000028000000010000000100000001001800000000000400000000000000000000000000000000000000000000ff00',
        'hex',
      ),
      readable: true,
    },
    {
      label: 'SVG',
      mimeType: 'image/svg+xml',
      bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      readable: false,
    },
    { label: 'corrupt PNG', mimeType: 'image/png', bytes: Buffer.from('broken'), readable: false },
  ])(
    'validates and bounds $label before persisting model image content',
    async ({ mimeType, bytes, readable }) => {
      const { coordinatorModels, seenResults } = toolThenAnswer('attachment', {
        attachmentId: 'image',
      });
      const api = fakeMachineApi();
      api.relayTool = async () =>
        JSON.stringify({ mimeType, encoding: 'base64', content: bytes.toString('base64') });
      const gate = createStepGate();
      const harness = await openCoordinatorHarness(storagePath(), coordinatorModels.models, ctx, {
        extensions: [coordinatorToolsExtension(api, gate)],
      });
      try {
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
          chiefStep('image-check', 'Describe the image'),
        );
        const output = JSON.parse(seenResults[0]!) as {
          type: string;
          data?: string;
          mimeType?: string;
        }[];
        const image = output.find((block) => block.type === 'image');
        expect(Boolean(image)).toBe(readable);
        if (readable) {
          expect(image?.mimeType).toBe('image/png');
          expect((image?.data?.length ?? Infinity) <= 4.5 * 1024 * 1024).toBe(true);
        } else {
          expect(seenResults[0]).toContain('cannot decode');
        }
      } finally {
        await harness.close(ctx);
      }
    },
  );

  it.each([
    { label: 'byte budget', count: 2, padding: 2 * 1024 * 1024, expected: 1 },
    { label: 'image count', count: 21, padding: 0, expected: 20 },
  ])(
    'bounds accumulated image $label on every provider request',
    async ({ count, padding, expected }) => {
      const { coordinatorModels, seenMessages } = toolThenAnswer('attachment', {
        attachmentId: 'image',
      });
      const api = fakeMachineApi();
      const data = Buffer.concat([validPng, Buffer.alloc(padding)]).toString('base64');
      api.relayTool = async () =>
        JSON.stringify({ mimeType: 'image/png', encoding: 'base64', content: data });
      const gate = createStepGate();
      const harness = await openCoordinatorHarness(storagePath(), coordinatorModels.models, ctx, {
        extensions: [coordinatorToolsExtension(api, gate)],
      });
      try {
        for (let i = 0; i < count; i++) {
          await runCoordinatorTurn(
            {
              harness,
              models: coordinatorModels,
              api,
              context: ctx,
              heartbeatMs: 1000,
              now: () => i + 1,
              gate,
            },
            chiefStep(`image-${i}`, 'Describe the next image'),
          );
        }
        const blocks = seenMessages
          .at(-1)!
          .messages.flatMap((message) =>
            Array.isArray(message.content) ? (message.content as { type: string }[]) : [],
          );
        expect(blocks.filter((block) => block.type === 'image')).toHaveLength(expected);
      } finally {
        await harness.close(ctx);
      }
    },
  );

  it('turns a relay failure into an error result instead of failing the turn', async () => {
    const { coordinatorModels, seenResults } = toolThenAnswer('todos', {});
    const api = fakeMachineApi();
    api.relayTool = async () => {
      throw new Error('POST /api/machine/tool/step-err -> 400 bad params');
    };
    const gate = createStepGate();
    const harness = await openCoordinatorHarness(storagePath(), coordinatorModels.models, ctx, {
      extensions: [coordinatorToolsExtension(api, gate)],
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
      extensions: [coordinatorToolsExtension(api, gate)],
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

  it("ask_user blocks on the answer channel and returns the user's answer as the tool result", async () => {
    const questions = [
      { header: 'Merge', question: 'Merge #12 now?', options: [{ label: 'Yes' }] },
    ];
    const { coordinatorModels, seenResults } = toolThenAnswer('ask_user', { questions });
    const api = fakeMachineApi();
    api.askUser = async (stepId, body) => {
      api.asks.push({ stepId, body });
      await new Promise((r) => setTimeout(r, 200));
      return {
        status: 'answered',
        requestId: body.requestId,
        answers: [{ header: 'Merge', choices: ['Yes'] }],
        reason: null,
      };
    };
    const gate = createStepGate();
    const harness = await openCoordinatorHarness(storagePath(), coordinatorModels.models, ctx, {
      extensions: [coordinatorToolsExtension(api, gate)],
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
      chiefStep('step-ask', 'merge it?'),
    );
    expect(api.tools).toEqual([]);
    expect(api.asks).toHaveLength(1);
    expect(api.asks[0]?.stepId).toBe('step-ask');
    expect(api.asks[0]?.body.questions).toEqual(questions);
    expect(api.asks[0]?.body.requestId).toMatch(ASK_REQUEST_ID_PATTERN);
    expect(seenResults[0]).toContain('answered');
    expect(seenResults[0]).toContain('Yes');
    expect(api.dones.map((d) => d.body.status)).toEqual(['success']);
    await harness.close(ctx);
  });

  it('ask_user that cannot reach the answer channel comes back cancelled instead of failing the turn', async () => {
    const { coordinatorModels, seenResults } = toolThenAnswer('ask_user', {
      questions: [{ header: 'H', question: 'Q?', options: [] }],
    });
    const api = fakeMachineApi();
    api.askUser = async () => {
      throw new Error('POST /api/machine/ask/step-ask2 -> 409 not claimed');
    };
    const gate = createStepGate();
    const harness = await openCoordinatorHarness(storagePath(), coordinatorModels.models, ctx, {
      extensions: [coordinatorToolsExtension(api, gate)],
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
      chiefStep('step-ask2', 'hi'),
    );
    expect(seenResults[0]).toContain('cancelled');
    expect(seenResults[0]).toContain('409 not claimed');
    expect(api.dones.map((d) => d.body.status)).toEqual(['success']);
    await harness.close(ctx);
  });

  it('a replayed ask_user call asks with the same request id, so it rejoins the same card', () => {
    const id = askRequestId('step-1', 'toolu_01AbC');
    expect(id).toMatch(ASK_REQUEST_ID_PATTERN);
    expect(askRequestId('step-1', 'toolu_01AbC')).toBe(id);
    expect(askRequestId('step-1', 'toolu_02XyZ')).not.toBe(id);
    expect(askRequestId('step-2', 'toolu_01AbC')).not.toBe(id);
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

  describe('on a model without image input', () => {
    const pngRelay = () =>
      JSON.stringify({
        id: 'att-1',
        fileName: 'screen.png',
        mimeType: 'image/png',
        sizeBytes: validPng.length,
        encoding: 'base64',
        content: validPng.toString('base64'),
      });

    async function runAttachment(options: {
      providers?: Provider[];
      ocrRunner?: OcrRunner;
    }): Promise<{ seenResults: string[]; rows: { role: string; content: unknown }[] }> {
      const { coordinatorModels, seenResults } = toolThenAnswer(
        'attachment',
        { attachmentId: 'team/screen.png' },
        ['text'],
        options.providers ?? [],
      );
      const api = fakeMachineApi();
      api.relayTool = async () => pngRelay();
      const gate = createStepGate();
      const harness = await openCoordinatorHarness(storagePath(), coordinatorModels.models, ctx, {
        extensions: [
          coordinatorToolsExtension(api, gate, {
            ocrRunner: options.ocrRunner,
            imageTextCache: new Map(),
          }),
        ],
      });
      try {
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
          chiefStep('step-blind', 'What does the screenshot say?'),
        );
      } finally {
        await harness.close(ctx);
      }
      return { seenResults, rows: api.rows.map((r) => r.row) };
    }

    function resultText(seenResults: string[]): string {
      const blocks = JSON.parse(seenResults[0]!) as { type: string; text?: string }[];
      expect(blocks.some((block) => block.type === 'image')).toBe(false);
      return blocks.map((block) => block.text ?? '').join('\n');
    }

    it('asks a configured vision model to describe the image and returns that text', async () => {
      const vis = fauxProvider({
        provider: 'vis',
        models: [{ id: 'vm', contextWindow: 200_000, input: ['text', 'image'] }],
      });
      const requests: FauxContext[] = [];
      vis.setResponses([
        (c: FauxContext) => {
          requests.push(c);
          return fauxAssistantMessage('a dark panel with three toggles');
        },
      ]);
      const { seenResults } = await runAttachment({
        providers: [vis.provider],
        ocrRunner: async () => {
          throw new Error('OCR must not run when a vision caption succeeds');
        },
      });
      const text = resultText(seenResults);
      expect(text).toContain('a dark panel with three toggles');
      expect(text).toContain('vis/vm');
      expect(JSON.stringify(requests[0]?.messages.at(-1)?.content)).toContain('"type":"image"');
    });

    it('runs OCR and marks the transcript as OCR when no vision model is configured', async () => {
      let ocrArg: { fileName?: string; mimeType?: string } | undefined;
      const { seenResults } = await runAttachment({
        ocrRunner: async (image) => {
          ocrArg = image;
          return 'OCR-RESULT three tasks';
        },
      });
      const text = resultText(seenResults);
      expect(ocrArg?.fileName).toBe('screen.png');
      expect(ocrArg?.mimeType).toBe('image/png');
      expect(text).toContain('OCR-RESULT three tasks');
      expect(text).toContain('OCR');
    });

    it('uses OCR when the configured vision model fails', async () => {
      const vis = fauxProvider({
        provider: 'vis',
        models: [{ id: 'vm', contextWindow: 200_000, input: ['text', 'image'] }],
      });
      vis.setResponses([
        fauxAssistantMessage('upstream down', { stopReason: 'error', errorMessage: 'down' }),
      ]);
      const { seenResults } = await runAttachment({
        providers: [vis.provider],
        ocrRunner: async () => 'OCR-RESULT after vision failure',
      });
      expect(resultText(seenResults)).toContain('OCR-RESULT after vision failure');
    });

    it('names the file and points at ask_user when neither vision nor OCR can read it', async () => {
      const { seenResults } = await runAttachment({ ocrRunner: async () => undefined });
      const text = resultText(seenResults);
      expect(text).toContain('screen.png');
      expect(text).toContain('cannot see images');
      expect(text).toContain('ask_user');
    });

    it('writes a transcript marker naming the vision model that read the image', async () => {
      const vis = fauxProvider({
        provider: 'vis',
        models: [{ id: 'vm', contextWindow: 200_000, input: ['text', 'image'] }],
      });
      vis.setResponses([fauxAssistantMessage('a dark panel')]);
      const { rows } = await runAttachment({ providers: [vis.provider] });
      const marker = rows.find(
        (row) => row.role === 'system' && String(row.content).includes('screen.png'),
      );
      expect(marker).toBeDefined();
      expect(String(marker?.content)).toContain('vis/vm');
      expect(String(marker?.content)).toContain('转录');
    });

    it('writes a transcript marker naming OCR when tesseract reads the image', async () => {
      const { rows } = await runAttachment({ ocrRunner: async () => 'OCR-RESULT' });
      const marker = rows.find(
        (row) => row.role === 'system' && String(row.content).includes('screen.png'),
      );
      expect(marker).toBeDefined();
      expect(String(marker?.content)).toContain('OCR');
      expect(String(marker?.content)).toContain('tesseract');
    });

    it('writes a transcript marker when nothing could read the image', async () => {
      const { rows } = await runAttachment({ ocrRunner: async () => undefined });
      const marker = rows.find(
        (row) => row.role === 'system' && String(row.content).includes('screen.png'),
      );
      expect(marker).toBeDefined();
      expect(String(marker?.content)).toContain('未能读取');
    });
  });
});
