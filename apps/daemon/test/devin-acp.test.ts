import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SessionUpdate } from '@agentclientprotocol/sdk';
import type { MachineCapabilities, SessionOpts, StepEvent } from '@cairn/shared';
import { describe, expect, test, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { createAcpBackend } from '../src/backend/acp.js';
import { createDevinUpdateNormalizer } from '../src/backend/devin-acp.js';
import type { DevinManaged } from '../src/backend/devin-managed.js';
import { clearCredentials, pushCredential } from '../src/credentials.js';
import { saveDevinModels } from '../src/state.js';
import { prepareStepEnv } from '../src/step-env.js';
import { agentStepRefusal, devinSubscriptionMissingMessage } from '../src/step-preflight.js';
import { boot, CLAIMED, FakeMachineApi, waitFor } from './machine-loop-harness.js';

const fixture = fileURLToPath(new URL('./fixtures/acp-agent.mjs', import.meta.url));
const opts: SessionOpts = {
  cwd: process.cwd(),
  provider: { kind: 'api_key', providerId: 'devin' },
  modelId: 'stub-model',
  prompt: 'Hello',
};

function devinBackend(scenario = 'devin') {
  return createAcpBackend({
    harness: 'devin',
    command: process.execPath,
    args: [fixture, scenario],
    steering: 'mid-turn',
    sessionResume: true,
    allowHostMcp: true,
    usageEvents: true,
    createUpdateNormalizer: createDevinUpdateNormalizer,
    initializeTimeoutMs: 3_000,
    cancelTimeoutMs: 100,
  });
}

async function collect(events: AsyncIterable<StepEvent>): Promise<StepEvent[]> {
  const result: StepEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}

describe('devin update normalizer', () => {
  const toolCall = (extra: Record<string, unknown>) =>
    ({ sessionUpdate: 'tool_call', toolCallId: 'tc-1', ...extra }) as unknown as SessionUpdate;

  test('routes child tool calls under the subagent spawn call', () => {
    const normalize = createDevinUpdateNormalizer();
    const started = normalize(
      toolCall({
        title: 'Tool',
        _meta: {
          'cognition.ai/subagent_started': { title: 'Research', agentId: 'agent-7' },
          'cognition.ai/subagent_context': { parentAgentId: 'root' },
        },
      }),
    );
    expect(started.update).toMatchObject({ title: 'Subagent: Research' });
    expect(started.parent).toBeUndefined();
    const child = normalize(
      toolCall({
        toolCallId: 'child-1',
        title: 'Tool',
        _meta: {
          'cognition.ai/subagent_context': { parentAgentId: 'agent-7' },
          'cognition.ai/inferenceToolName': 'Bash',
        },
      }),
    );
    expect(child.parent).toBe('tc-1');
    expect(child.update).toMatchObject({ title: 'Bash' });
  });

  test('drops child message and thought chunks', () => {
    const normalize = createDevinUpdateNormalizer();
    const child = {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'nested' },
      _meta: { 'cognition.ai/subagent_context': { parentAgentId: 'agent-7' } },
    } as unknown as SessionUpdate;
    expect(normalize(child).update).toBeNull();
    const root = {
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: 'root' },
      _meta: { 'cognition.ai/subagent_context': { parentAgentId: 'root' } },
    } as unknown as SessionUpdate;
    expect(normalize(root).update).not.toBeNull();
  });

  test('marks subagent completion with summary and failure status', () => {
    const normalize = createDevinUpdateNormalizer();
    const done = normalize(
      toolCall({
        toolCallId: 'sub-1',
        sessionUpdate: 'tool_call_update',
        _meta: {
          'cognition.ai/subagent_completed': { success: false, summary: 'gave up' },
        },
      }),
    );
    expect(done.update).toMatchObject({
      status: 'failed',
      content: [{ type: 'content', content: { type: 'text', text: 'gave up' } }],
    });
  });
});

describe('devin ACP adapter over scripted stdio', () => {
  test('lands bypass mode, nested tool calls and usage rows', async () => {
    const session = await devinBackend('devin').createSession(opts);
    const events = await collect(session.events);
    const calls = events.filter((e) => e.type === 'toolcall_end').map((e) => e.call);
    expect(calls).toContainEqual(
      expect.objectContaining({ id: 'sub-1', name: 'Subagent: Research' }),
    );
    expect(calls).toContainEqual(
      expect.objectContaining({ id: 'child-1', name: 'Bash', parent: 'sub-1', result: 'files' }),
    );
    expect(calls).toContainEqual(
      expect.objectContaining({
        id: 'sub-1',
        name: 'Subagent: Research',
        result: [{ type: 'content', content: { type: 'text', text: 'done research' } }],
      }),
    );
    expect(events).toContainEqual({
      type: 'usage',
      usage: [
        {
          model: 'stub-model',
          input: 40,
          output: 10,
          cacheRead: 3,
          cacheWrite: 2,
          contextWindow: 1000,
        },
      ],
    });
    expect(events.findIndex((e) => e.type === 'usage')).toBeLessThan(
      events.findIndex((e) => e.type === 'done'),
    );
    expect(events).toContainEqual({
      type: 'done',
      usage: [
        {
          model: 'stub-model',
          input: 40,
          output: 10,
          cacheRead: 3,
          cacheWrite: 2,
          contextWindow: 1000,
        },
      ],
    });
  });

  test('mid-turn steer resolves the interrupted turn and keeps the steered turn', async () => {
    const session = await devinBackend('devin-steer').createSession(opts);
    const iterator = session.events[Symbol.asyncIterator]();
    await iterator.next();
    await session.steer('steer-now');
    const events = await collect({ [Symbol.asyncIterator]: () => iterator });
    expect(events).toContainEqual({
      type: 'message_end',
      message: { role: 'assistant', content: 'counting' },
    });
    expect(events).toContainEqual({
      type: 'message_end',
      message: { role: 'assistant', content: 'steered' },
    });
    expect(events).toContainEqual(expect.objectContaining({ type: 'done' }));
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  test('advertises steering and session resume', () => {
    const backend = devinBackend();
    expect(backend.capabilities.steering).toBe(true);
    expect(backend.capabilities.sessionResume).toBe(true);
  });
});

describe('devin credential delivery', () => {
  test('missing devin token refuses with a subscription hint', () => {
    const refusal = agentStepRefusal({
      stepKind: 'build',
      agentTools: undefined,
      runtimeId: 'devin',
      hasSubscriptionToken: false,
      hasDevinToken: false,
    });
    expect(refusal).toBe(devinSubscriptionMissingMessage());
    expect(
      agentStepRefusal({
        stepKind: 'build',
        agentTools: undefined,
        runtimeId: 'devin',
        hasSubscriptionToken: false,
        hasDevinToken: true,
      }),
    ).toBeNull();
  });

  test('devin accepts every step kind once its token is present', () => {
    for (const stepKind of ['build', 'session', 'plan', 'merge', 'chief', 'review', 'verify']) {
      expect(
        agentStepRefusal({
          stepKind,
          agentTools: undefined,
          runtimeId: 'devin',
          hasSubscriptionToken: false,
          hasDevinToken: true,
        }),
      ).toBeNull();
    }
  });

  test('devinToken lands in WINDSURF_API_KEY and HOME redirect, then clears', () => {
    const creds = pushCredential(
      {
        provider: null,
        devinToken: 'wsk-test',
        secrets: {},
        git: null,
      } as never,
      null,
    );
    expect(creds.devinToken).toBe('wsk-test');
    const stepEnv = prepareStepEnv(
      {
        inherited: { WINDSURF_API_KEY: 'stale' },
        git: null,
        appCredential: null,
        readonlyGit: false,
        runtimeId: 'devin',
        agentConfig: { own: false, cairnHome: '/cairn-home' },
        claudeSubscriptionToken: undefined,
        devinToken: creds.devinToken,
        devinHome: '/managed/devin/home',
      },
      [],
    );
    expect('error' in stepEnv).toBe(false);
    if ('error' in stepEnv) return;
    expect(stepEnv.env.WINDSURF_API_KEY).toBe('wsk-test');
    expect(stepEnv.env.HOME).toBe('/managed/devin/home');
    clearCredentials(creds);
    expect(creds.devinToken).toBeUndefined();
  });
});

describe('devin advertised model catalog', () => {
  const advertised = [
    { id: 'stub-model', name: 'Stub Model', thinkingLevels: [] },
    { id: 'swe-2-high', name: 'SWE-2' },
    { id: 'swe-2-flash-medium', name: 'SWE-2 Flash' },
    { id: 'adaptive', name: 'adaptive' },
  ];

  function devinInstall(root: string) {
    const home = join(root, 'devin-home');
    mkdirSync(home, { recursive: true });
    return { version: '1.0.0', binPath: process.execPath, args: [fixture, 'devin'], home };
  }

  function fakeDevinManaged(root: string): DevinManaged {
    const install = devinInstall(root);
    return { current: () => install, ensure: async () => install };
  }

  function lastCapabilities(api: FakeMachineApi): MachineCapabilities | undefined {
    const body = api.presenceBodies.at(-1) as { capabilities?: unknown } | undefined;
    return body?.capabilities as MachineCapabilities | undefined;
  }

  test('a session/new model option reaches onDevinModels flattened, deduped and named', async () => {
    const onDevinModels = vi.fn();
    const session = await createAcpBackend({
      harness: 'devin',
      command: process.execPath,
      args: [fixture, 'devin'],
      onDevinModels,
    }).createSession(opts);
    await collect(session.events);
    expect(onDevinModels).toHaveBeenCalledTimes(1);
    expect(onDevinModels).toHaveBeenCalledWith(advertised);
  });

  test('a resumed session refreshes the catalog too', async () => {
    const onDevinModels = vi.fn();
    const session = await createAcpBackend({
      harness: 'devin',
      command: process.execPath,
      args: [fixture, 'devin'],
      onDevinModels,
    }).continueSession('acp-session-2290', opts);
    await collect(session.events);
    expect(onDevinModels).toHaveBeenCalledWith(advertised);
  });

  test('a non-devin adapter never reports a catalog', async () => {
    const onDevinModels = vi.fn();
    const session = await createAcpBackend({
      harness: 'antigravity',
      command: process.execPath,
      args: [fixture, 'complete'],
      onDevinModels,
    }).createSession(opts);
    await collect(session.events);
    expect(onDevinModels).not.toHaveBeenCalled();
  });

  test('a devin step lands the catalog in capabilities.devin.models and in the state file', async () => {
    const api = new FakeMachineApi();
    api.devinToken = 'wsk-test';
    const devinRoot = makeTestTempDir('devin-root-');
    try {
      const { handle, paths } = await boot({
        api,
        presenceIntervalMs: 50,
        devinManaged: fakeDevinManaged(devinRoot),
      });
      try {
        await waitFor(() => api.parked !== null);
        api.parked?.({
          ...CLAIMED,
          step: { ...CLAIMED.step, kind: 'build' },
          instruction: 'Hello',
          agent: { ...CLAIMED.agent!, provider: 'devin' },
        });
        await waitFor(() => api.doneBodies.length === 1);
        expect(api.doneBodies[0]?.body.status).toBe('success');
        await waitFor(() => lastCapabilities(api)?.devin?.models !== undefined);
        expect(lastCapabilities(api)?.devin).toEqual({
          installed: true,
          version: '1.0.0',
          models: advertised,
        });
        expect(JSON.parse(readFileSync(paths.devinModelsJson, 'utf8'))).toEqual({
          models: advertised,
        });
      } finally {
        await handle.stop();
        await handle.done;
      }
    } finally {
      releaseTestTempDir(devinRoot);
    }
  });

  test('a catalog persisted by an earlier run reports before any devin step ran', async () => {
    const api = new FakeMachineApi();
    const devinRoot = makeTestTempDir('devin-root-');
    try {
      const { handle } = await boot({
        api,
        presenceIntervalMs: 50,
        devinManaged: fakeDevinManaged(devinRoot),
        seedJournal: (paths) => saveDevinModels(paths, advertised),
      });
      try {
        await waitFor(() => lastCapabilities(api)?.devin?.models !== undefined);
        expect(lastCapabilities(api)?.devin?.models).toEqual(advertised);
      } finally {
        await handle.stop();
        await handle.done;
      }
    } finally {
      releaseTestTempDir(devinRoot);
    }
  });

  test('an uninstalled devin never carries a stale catalog', async () => {
    const api = new FakeMachineApi();
    const { handle } = await boot({
      api,
      presenceIntervalMs: 50,
      seedJournal: (paths) => saveDevinModels(paths, advertised),
    });
    try {
      await waitFor(() => api.presenceBodies.length > 0);
      expect(lastCapabilities(api)?.devin).toEqual({ installed: false });
    } finally {
      await handle.stop();
      await handle.done;
    }
  });
});
