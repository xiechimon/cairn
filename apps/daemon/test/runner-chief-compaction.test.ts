import { join } from 'node:path';
import type {
  AgentBackend,
  ClaimedStep,
  MachineDoneBody,
  MachineStreamEvent,
  SessionCompaction,
  SessionOpts,
  ToolCallRecord,
  TranscriptUpload,
} from '@cairn/shared';
import { afterEach, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import { StepJournal } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import type { MachineApi } from '../src/machine-client.js';
import { runStep } from '../src/runner.js';
import { statePaths } from '../src/state.js';
import { StepStops } from '../src/step-stops.js';

const noop = () => {};
const logger: DaemonLogger = {
  raw: noop,
  prefixed: noop,
  supervisor: noop,
  machine: noop,
  step: noop,
  workspace: noop,
  recover: noop,
  wake: noop,
  mcp: noop,
  skills: noop,
  gate: noop,
  trust: noop,
};

class FakeClient implements MachineApi {
  doneBodies: MachineDoneBody[] = [];
  uploaded: unknown[] = [];
  activities = 0;
  async enroll(): Promise<never> {
    throw new Error('unused');
  }
  async me(): Promise<never> {
    throw new Error('unused');
  }
  async presence() {}
  async recover() {
    return { steps: [] };
  }
  async claim() {
    return null;
  }
  async heartbeat() {}
  async tool(_stepId: string, _call: ToolCallRecord) {}
  async transcriptDelta() {}
  async relayTool() {
    return '{}';
  }
  async token() {
    return {
      provider: {
        kind: 'http' as const,
        providerId: 'gw',
        baseUrl: 'http://127.0.0.1:9/v1',
        api: 'openai-completions' as const,
        models: [{ id: 'stub-model', name: 'stub-model' }],
      },
      secrets: {},
      git: null,
    };
  }
  async skillsManifest() {
    return { selection: 'whitelist' as const, skills: [] };
  }
  async skillFile(): Promise<Buffer> {
    throw new Error('unused');
  }
  async uploadUrls(_stepId: string, files: { name: string }[]) {
    return {
      uploads: files.map((f) => ({
        name: f.name,
        url: `u/${f.name}`,
        method: 'PUT' as const,
        headers: {},
      })),
    };
  }
  async putUpload(_url: string, _headers: Record<string, string>, body: TranscriptUpload | string) {
    this.uploaded.push(body);
  }
  async done(_stepId: string, body: MachineDoneBody) {
    this.doneBodies.push(body);
  }
  async activity() {
    this.activities += 1;
  }
  async steer() {
    return null;
  }
  async stop() {
    return null;
  }
  async syncResult() {}
  async attachment(): Promise<never> {
    throw new Error('unused');
  }
  async shellPrecheck(): Promise<never> {
    throw new Error('unused');
  }
  async shellResult(): Promise<void> {}
  async stream(_signal: AbortSignal, _onEvent: (ev: MachineStreamEvent) => void) {}
}

function claimed(): ClaimedStep {
  return {
    step: { id: 'compact-1', buildId: 'chief-t1', kind: 'chief', machineId: null, createdAt: 1 },
    conversationId: 'chief-t1',
    session: { action: 'continue', sessionId: 'pi-sess-1' },
    agent: {
      id: 'a1',
      displayName: 'Coordinator',
      description: null,
      provider: 'gw',
      modelId: 'stub-model',
      thinkingLevel: null,
    },
    chief: {
      threadId: 'chief-t1',
      systemPrompt: '',
      trigger: 'user',
      compaction: { thresholdTokens: 64_000, keepRecentTokens: 16_384 },
      compactOnly: true,
    },
    remoteTools: [],
    remoteToolsOnly: true,
  };
}

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) releaseTestTempDir(home);
});

async function run(
  compactSession: (
    id: string,
    opts: SessionOpts,
    signal: AbortSignal,
  ) => Promise<SessionCompaction>,
  during?: (stops: StepStops) => void,
) {
  const home = makeTestTempDir('runner-compact-');
  homes.push(home);
  const client = new FakeClient();
  const stops = new StepStops();
  const calls: { id: string; opts: SessionOpts }[] = [];
  const backend: AgentBackend = {
    capabilities: PI_CAPABILITIES,
    createSession: async () => {
      throw new Error('a compaction step must not open a turn');
    },
    continueSession: async () => {
      throw new Error('a compaction step must not open a turn');
    },
    compactSession: (id, opts, signal) => {
      calls.push({ id, opts });
      queueMicrotask(() => during?.(stops));
      return compactSession(id, opts, signal);
    },
  };
  const paths = statePaths(home, join(home, 'workspaces'));
  await runStep(
    {
      client,
      journal: new StepJournal(paths.outboxDir),
      backendFor: () => backend,
      logger,
      paths,
      workspacesDir: join(home, 'workspaces'),
      mcpConfigPath: join(home, 'claude.json'),
      heartbeatIntervalMs: 60_000,
      stops,
    },
    claimed(),
  );
  return { client, calls };
}

describe('a compaction-only chief step compacts the session and opens no turn', () => {
  test('it reports the compaction with its usage and uploads no transcript', async () => {
    const { client, calls } = await run(async () => ({
      compacted: true,
      tokensBefore: 50_000,
      tokensAfter: 18_000,
      summaryTokens: 1200,
      usage: [{ model: 'gw/stub-model', input: 40_000, output: 900, cacheRead: 0, cacheWrite: 0 }],
    }));
    expect(calls).toMatchObject([
      {
        id: 'pi-sess-1',
        opts: {
          modelId: 'stub-model',
          compaction: { thresholdTokens: 64_000, keepRecentTokens: 16_384 },
        },
      },
    ]);
    expect(calls[0]?.opts.prompt).toBeUndefined();
    expect(client.doneBodies).toEqual([
      {
        status: 'success',
        sessionId: 'pi-sess-1',
        usage: [
          { model: 'gw/stub-model', input: 40_000, output: 900, cacheRead: 0, cacheWrite: 0 },
        ],
        compaction: {
          compacted: true,
          tokensBefore: 50_000,
          tokensAfter: 18_000,
          summaryTokens: 1200,
        },
      },
    ]);
    expect(client.uploaded).toEqual([{ stepId: 'compact-1', messages: [] }]);
    expect(client.activities).toBe(0);
  });

  test('a stop aborts the summary and reports stopped', async () => {
    const { client } = await run(
      (_id, _opts, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('Compaction cancelled')));
        }),
      (stops) => {
        void stops.get('compact-1')?.deliver({ discard: false });
      },
    );
    expect(client.doneBodies).toEqual([{ status: 'stopped' }]);
  });

  test('a provider failure reports failed with the reason', async () => {
    const { client } = await run(async () => {
      throw new Error('Compaction failed: 529 overloaded');
    });
    expect(client.doneBodies).toEqual([
      { status: 'failed', errorMessage: 'Compaction failed: 529 overloaded' },
    ]);
  });
});
