import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AgentBackend,
  AgentSessionHandle,
  ClaimedStep,
  MachineDoneBody,
  MachineStreamEvent,
  SessionOpts,
  StepEvent,
  ToolCallRecord,
  TranscriptUpload,
} from '@cairn/shared';
import {
  formatAttachmentToken,
  type MachineAttachmentResponse,
  type ProviderConfig,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import { StepJournal } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import type { MachineApi } from '../src/machine-client.js';
import { runStep } from '../src/runner.js';
import { statePaths } from '../src/state.js';

const PNG_BYTES = Buffer.from('89504e470d0a1a0a', 'hex');
const DONE_EVENT: StepEvent = { type: 'done', usage: [] };
const NO_VISION_400 = {
  type: 'error',
  error: { message: '400: GLM-5.3-BF16-W4A8 is not a multimodal model', retryable: true },
} as const satisfies StepEvent;

const TASK = {
  id: 't1',
  seqNum: 3,
  title: '带图任务',
  spec: '根据截图修改样式。',
};

function imageStep(spec: string): ClaimedStep {
  return {
    step: { id: 's1', buildId: 'conv-1', kind: 'build', machineId: 'm1', createdAt: 1 },
    conversationId: 'conv-1',
    session: { action: 'new', sessionId: null },
    todo: { ...TASK, spec },
    project: { id: 'p1', name: 'demo', repo: null },
    agent: {
      id: 'a1',
      displayName: 'stub-builder',
      description: null,
      provider: null,
      modelId: 'stub-model',
      thinkingLevel: null,
    },
  };
}

function captureLogger(): { logger: DaemonLogger; lines: string[] } {
  const lines: string[] = [];
  const push = (prefix: string | undefined, msg: string) =>
    lines.push(prefix ? `[${prefix}] ${msg}` : msg);
  const logger: DaemonLogger = {
    raw: (msg) => push(undefined, msg),
    prefixed: (prefix, msg) => push(prefix, msg),
    supervisor: (msg) => push('supervisor', msg),
    machine: (msg) => push('machine', msg),
    step: (msg) => push('step', msg),
    workspace: (msg) => push('workspace', msg),
    recover: (msg) => push('recover', msg),
    wake: (msg) => push('wake', msg),
    skills: (msg) => push('skills', msg),
    gate: (msg) => push('gate', msg),
    trust: (msg) => push('trust', msg),
    mcp: (msg) => push('mcp', msg),
  };
  return { logger, lines };
}

class FakeClient implements MachineApi {
  doneBodies: { stepId: string; body: MachineDoneBody }[] = [];
  uploads: TranscriptUpload[] = [];
  attachmentCalls: string[] = [];
  attachments: Record<string, MachineAttachmentResponse> = {
    img1: {
      fileName: 'shot.png',
      mimeType: 'image/png',
      sizeBytes: PNG_BYTES.byteLength,
      contentBase64: PNG_BYTES.toString('base64'),
    },
  };

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
        providerId: 'stub-gw',
        baseUrl: 'http://127.0.0.1:9/v1',
        api: 'openai-completions' as const,
        authHeader: true,
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
    throw new Error('unexpected skillFile call');
  }
  async uploadUrls(_stepId: string, files: { name: string }[]) {
    return {
      uploads: files.map((f, i) => ({
        name: f.name,
        url: `http://server/up/${i}`,
        method: 'PUT' as const,
        headers: {},
      })),
    };
  }
  async putUpload(_url: string, _headers: Record<string, string>, body: TranscriptUpload) {
    this.uploads.push(body);
  }
  async done(stepId: string, body: MachineDoneBody) {
    this.doneBodies.push({ stepId, body });
  }
  async steer() {
    return null;
  }
  async stop() {
    return null;
  }
  async syncResult(_syncId: string, _body: { status: string; errorMessage?: string }) {}
  async attachment(_stepId: string, attachmentId: string) {
    this.attachmentCalls.push(attachmentId);
    const hit = this.attachments[attachmentId];
    if (hit === undefined) throw new Error(`unused attachment ${attachmentId}`);
    return hit;
  }
  async shellPrecheck(): Promise<never> {
    throw new Error('unused');
  }
  async shellResult(): Promise<void> {}
  async stream(_signal: AbortSignal, _onEvent: (ev: MachineStreamEvent) => void) {}
}

interface HandleRecord {
  stopped: number;
}

function handleOf(
  events: StepEvent[],
  record: HandleRecord,
  streamFailure?: string,
): AgentSessionHandle {
  return {
    sessionId: 'sess-1',
    events: (async function* gen() {
      for (const ev of events) yield ev;
      if (streamFailure !== undefined) throw new Error(streamFailure);
    })(),
    async steer() {},
    async stop() {
      record.stopped += 1;
    },
    usage: () => [],
  };
}

interface BackendScript {
  eventsByCall: StepEvent[][];
  modelSupportsImages?: (provider: ProviderConfig, modelId: string) => Promise<boolean | null>;
  rememberNoVisionCalls: { providerId: string; modelId: string }[];
  failOpen?: string;
  streamFailure?: string;
}

function scriptingBackend(script: BackendScript): {
  backend: AgentBackend;
  created: { opts: SessionOpts }[];
  handles: AgentSessionHandle[];
  stopRecords: HandleRecord[];
  actions: string[];
} {
  const created: { opts: SessionOpts }[] = [];
  const handles: AgentSessionHandle[] = [];
  const stopRecords: HandleRecord[] = [];
  const actions: string[] = [];
  let call = 0;
  const backend: AgentBackend = {
    capabilities: PI_CAPABILITIES,
    async createSession(opts) {
      actions.push('create');
      created.push({ opts: { ...opts } });
      if (script.failOpen !== undefined && call++ === 0) throw new Error(script.failOpen);
      const record: HandleRecord = { stopped: 0 };
      stopRecords.push(record);
      const events = script.eventsByCall[Math.min(call, script.eventsByCall.length - 1)] ?? [
        DONE_EVENT,
      ];
      call += 1;
      const h = handleOf(events, record, call === 1 ? script.streamFailure : undefined);
      handles.push(h);
      return h;
    },
    async continueSession(_id, opts) {
      actions.push('continue');
      created.push({ opts: { ...opts } });
      const record: HandleRecord = { stopped: 0 };
      stopRecords.push(record);
      const events = script.eventsByCall[Math.min(call, script.eventsByCall.length - 1)] ?? [
        DONE_EVENT,
      ];
      call += 1;
      const h = handleOf(events, record, call === 1 ? script.streamFailure : undefined);
      handles.push(h);
      return h;
    },
    ...(script.modelSupportsImages !== undefined
      ? {
          modelSupportsImages: script.modelSupportsImages,
          rememberNoVision: (provider: ProviderConfig, modelId: string) => {
            script.rememberNoVisionCalls.push({ providerId: provider.providerId, modelId });
          },
        }
      : {}),
  };
  return { backend, created, handles, stopRecords, actions };
}

async function runImageStep(
  claimed: ClaimedStep,
  backend: AgentBackend,
): Promise<{
  client: FakeClient;
  lines: string[];
}> {
  const home = mkdtempSync(join(tmpdir(), 'cairn-runner-image-'));
  const paths = statePaths(home, join(home, 'workspaces'));
  const { logger, lines } = captureLogger();
  const client = new FakeClient();
  const journal = new StepJournal(paths.outboxDir);
  await runStep(
    {
      client,
      journal,
      backendFor: () => backend,
      logger,
      paths,
      workspacesDir: join(home, 'workspaces'),
      mcpConfigPath: join(home, 'claude.json'),
      heartbeatIntervalMs: 60_000,
    },
    claimed,
  );
  return { client, lines };
}

const SPEC_TOKEN = formatAttachmentToken('shot.png', 't1/img1.png');

function systemRows(client: FakeClient): string[] {
  return client.uploads
    .flatMap((upload) => upload.messages)
    .filter((message) => message.role === 'system')
    .map((message) => String(message.content));
}

describe('runner probe-driven degrade (#1671 slice 1)', () => {
  test('declared no-vision model: no images delivered, annotated prompt, step succeeds', async () => {
    const claimed = imageStep(`${TASK.spec}\n\n${SPEC_TOKEN}`);
    const { backend, created } = scriptingBackend({
      eventsByCall: [[DONE_EVENT]],
      modelSupportsImages: async () => false,
      rememberNoVisionCalls: [],
    });
    const { client, lines } = await runImageStep(claimed, backend);

    expect(client.attachmentCalls).toHaveLength(0);
    expect(created[0]?.opts.promptImages).toBeUndefined();
    expect(created[0]?.opts.prompt).toContain(SPEC_TOKEN);
    expect(created[0]?.opts.prompt).toContain('[图片附件 t1/img1.png 未被模型读取 — 该图片未下载]');
    expect(client.doneBodies[0]?.body.status).toBe('success');
    expect(systemRows(client).some((c) => c.includes('图片未被模型读取'))).toBe(true);
    expect(lines.join('\n')).toContain('image attachment skipped');
  });

  test('undeclared model (probe null): images still delivered (regression red line)', async () => {
    const claimed = imageStep(`${TASK.spec}\n\n${SPEC_TOKEN}`);
    const { backend, created } = scriptingBackend({
      eventsByCall: [[DONE_EVENT]],
      modelSupportsImages: async () => null,
      rememberNoVisionCalls: [],
    });
    const { client } = await runImageStep(claimed, backend);

    expect(client.attachmentCalls).toEqual(['img1']);
    expect(created[0]?.opts.promptImages).toEqual([
      { data: PNG_BYTES.toString('base64'), mimeType: 'image/png' },
    ]);
    expect(client.doneBodies[0]?.body.status).toBe('success');
  });

  test('backend without the probe method: today behavior (images delivered, no crash)', async () => {
    const claimed = imageStep(`${TASK.spec}\n\n${SPEC_TOKEN}`);
    const { backend, created } = scriptingBackend({
      eventsByCall: [[DONE_EVENT]],
      rememberNoVisionCalls: [],
    });
    const { client } = await runImageStep(claimed, backend);

    expect(client.attachmentCalls).toEqual(['img1']);
    expect(created[0]?.opts.promptImages).toHaveLength(1);
    expect(client.doneBodies[0]?.body.status).toBe('success');
  });

  test('probe throws → treated as unknown, images delivered, step succeeds', async () => {
    const claimed = imageStep(`${TASK.spec}\n\n${SPEC_TOKEN}`);
    const { backend, created } = scriptingBackend({
      eventsByCall: [[DONE_EVENT]],
      modelSupportsImages: async () => {
        throw new Error('runtime boom');
      },
      rememberNoVisionCalls: [],
    });
    const { client, lines } = await runImageStep(claimed, backend);

    expect(created[0]?.opts.promptImages).toHaveLength(1);
    expect(client.doneBodies[0]?.body.status).toBe('success');
    expect(lines.join('\n')).toContain('image support probe failed');
  });

  test('text-only spec probes capability for later image steering', async () => {
    const claimed = imageStep(TASK.spec);
    let probed = 0;
    const { backend } = scriptingBackend({
      eventsByCall: [[DONE_EVENT]],
      modelSupportsImages: async () => {
        probed += 1;
        return false;
      },
      rememberNoVisionCalls: [],
    });
    await runImageStep(claimed, backend);
    expect(probed).toBe(1);
  });

  test('no-model step fails before any attachment download', async () => {
    const claimed = imageStep(`${TASK.spec}\n\n${SPEC_TOKEN}`);
    (claimed as { agent: ClaimedStep['agent'] }).agent = {
      id: 'a1',
      displayName: 'stub-builder',
      description: null,
      provider: null,
      modelId: '',
      thinkingLevel: null,
    };
    const { backend } = scriptingBackend({
      eventsByCall: [[DONE_EVENT]],
      rememberNoVisionCalls: [],
    });
    const { client } = await runImageStep(claimed, backend);
    expect(client.attachmentCalls).toHaveLength(0);
    expect(client.doneBodies[0]?.body.status).toBe('failed');
  });
});

describe('runner 400-signal one-time degrade retry (#1671 slice 2)', () => {
  test('session creation rejects image input: retry without images instead of failing the step', async () => {
    const claimed = imageStep(`${TASK.spec}\n\n${SPEC_TOKEN}`);
    const { backend, created } = scriptingBackend({
      eventsByCall: [[DONE_EVENT]],
      modelSupportsImages: async () => null,
      rememberNoVisionCalls: [],
      failOpen: NO_VISION_400.error.message,
    });
    const { client } = await runImageStep(claimed, backend);
    expect(created).toHaveLength(2);
    expect(created[1]?.opts.promptImages).toBeUndefined();
    expect(client.doneBodies[0]?.body.status).toBe('success');
    expect(systemRows(client).join('\n')).toContain('图片未被模型读取');
  });

  test('a network retry can still degrade a later image rejection once', async () => {
    const claimed = imageStep(`${TASK.spec}\n\n${SPEC_TOKEN}`);
    const { backend, created, actions } = scriptingBackend({
      eventsByCall: [
        [{ type: 'error', error: { message: 'ECONNRESET', retryable: true } }],
        [NO_VISION_400],
        [DONE_EVENT],
      ],
      modelSupportsImages: async () => null,
      rememberNoVisionCalls: [],
    });
    const { client } = await runImageStep(claimed, backend);
    expect(created).toHaveLength(3);
    expect(actions).toEqual(['create', 'continue', 'create']);
    expect(created[2]?.opts.promptImages).toBeUndefined();
    expect(client.doneBodies[0]?.body.status).toBe('success');
  });

  test('a thrown image rejection from the event iterator retries without images', async () => {
    const claimed = imageStep(`${TASK.spec}\n\n${SPEC_TOKEN}`);
    const { backend, created } = scriptingBackend({
      eventsByCall: [[], [DONE_EVENT]],
      streamFailure: NO_VISION_400.error.message,
      modelSupportsImages: async () => null,
      rememberNoVisionCalls: [],
    });
    const { client } = await runImageStep(claimed, backend);
    expect(created).toHaveLength(2);
    expect(created[1]?.opts.promptImages).toBeUndefined();
    expect(client.doneBodies[0]?.body.status).toBe('success');
  });

  test('undeclared model 400s on images → learn, retry without images, step succeeds', async () => {
    const claimed = imageStep(`${TASK.spec}\n\n${SPEC_TOKEN}`);
    const script: BackendScript = {
      eventsByCall: [[NO_VISION_400, DONE_EVENT], [DONE_EVENT]],
      modelSupportsImages: async () => null,
      rememberNoVisionCalls: [],
    };
    const { backend, created, stopRecords } = scriptingBackend(script);
    const { client, lines } = await runImageStep(claimed, backend);

    expect(created).toHaveLength(2);
    expect(created[0]?.opts.promptImages).toHaveLength(1);
    expect(created[1]?.opts.promptImages).toBeUndefined();
    expect(created[1]?.opts.prompt).toContain(SPEC_TOKEN);
    expect(created[1]?.opts.prompt).toContain('[图片附件 t1/img1.png 未被模型读取 — 该图片未下载]');
    expect(script.rememberNoVisionCalls).toEqual([
      { providerId: 'stub-gw', modelId: 'stub-model' },
    ]);
    expect(client.doneBodies[0]?.body.status).toBe('success');
    expect(systemRows(client).some((c) => c.includes('图片未被模型读取'))).toBe(true);
    expect(stopRecords[0]?.stopped).toBeGreaterThan(0);
    expect(lines.join('\n')).toContain('not a multimodal model');
  });

  test('learned cache short-circuits the next step: single session, zero 400s', async () => {
    const learned = new Set<string>();
    const claimed = imageStep(`${TASK.spec}\n\n${SPEC_TOKEN}`);
    const script: BackendScript = {
      eventsByCall: [[DONE_EVENT]],
      modelSupportsImages: async (provider, modelId) =>
        learned.has(`${provider.providerId}/${modelId}`) ? false : null,
      rememberNoVisionCalls: [],
    };
    const { backend } = scriptingBackend(script);
    const first = await runImageStep(claimed, backend);
    expect(first.client.attachmentCalls).toEqual(['img1']);

    learned.add('stub-gw/stub-model');
    const secondClient = new FakeClient();
    const home = mkdtempSync(join(tmpdir(), 'cairn-runner-image-'));
    const paths = statePaths(home, join(home, 'workspaces'));
    const { logger } = captureLogger();
    const journal = new StepJournal(paths.outboxDir);
    const claimed2 = imageStep(`${TASK.spec}\n\n${SPEC_TOKEN}`);
    claimed2.step.id = 's2';
    await runStep(
      {
        client: secondClient,
        journal,
        backendFor: () => backend,
        logger,
        paths,
        workspacesDir: join(home, 'workspaces'),
        mcpConfigPath: join(home, 'claude.json'),
        heartbeatIntervalMs: 60_000,
      },
      claimed2,
    );
    expect(secondClient.attachmentCalls).toHaveLength(0);
    expect(script.rememberNoVisionCalls).toHaveLength(0);
  });

  test('one-shot guard: second no-vision 400 after degrade → no third session, step fails', async () => {
    const claimed = imageStep(`${TASK.spec}\n\n${SPEC_TOKEN}`);
    const script: BackendScript = {
      eventsByCall: [
        [NO_VISION_400, DONE_EVENT],
        [NO_VISION_400, DONE_EVENT],
      ],
      modelSupportsImages: async () => null,
      rememberNoVisionCalls: [],
    };
    const { backend, created } = scriptingBackend(script);
    const { client } = await runImageStep(claimed, backend);

    expect(created).toHaveLength(2);
    expect(client.doneBodies[0]?.body.status).toBe('failed');
    expect(client.doneBodies[0]?.body.errorMessage).toContain('not a multimodal model');
  });

  test('progress before the 400 → no image degrade retry (progress is not thrown away)', async () => {
    const claimed = imageStep(`${TASK.spec}\n\n${SPEC_TOKEN}`);
    const script: BackendScript = {
      eventsByCall: [[{ type: 'text_delta', text: '先分析一下' }, NO_VISION_400, DONE_EVENT]],
      modelSupportsImages: async () => null,
      rememberNoVisionCalls: [],
    };
    const { backend, created } = scriptingBackend(script);
    await runImageStep(claimed, backend);
    expect(created).toHaveLength(1);
  });

  test('non-vision 400 on an image step → no degrade retry (signal must match)', async () => {
    const claimed = imageStep(`${TASK.spec}\n\n${SPEC_TOKEN}`);
    const script: BackendScript = {
      eventsByCall: [
        [
          {
            type: 'error',
            error: { message: '400: image too large', retryable: true },
          },
          DONE_EVENT,
        ],
      ],
      modelSupportsImages: async () => null,
      rememberNoVisionCalls: [],
    };
    const { backend, created } = scriptingBackend(script);
    await runImageStep(claimed, backend);
    expect(created).toHaveLength(1);
    expect(script.rememberNoVisionCalls).toHaveLength(0);
  });

  test('continue-session image rejection starts a fresh text-only session with the task', async () => {
    const claimed = imageStep(`${TASK.spec}\n\n${SPEC_TOKEN}`);
    claimed.session = { action: 'continue', sessionId: 'sess-old' };
    claimed.instruction = `继续执行\n\n${SPEC_TOKEN}`;
    const script: BackendScript = {
      eventsByCall: [[NO_VISION_400, DONE_EVENT], [DONE_EVENT]],
      modelSupportsImages: async () => null,
      rememberNoVisionCalls: [],
    };
    const { backend, created, actions } = scriptingBackend(script);
    const { client } = await runImageStep(claimed, backend);

    expect(created).toHaveLength(2);
    expect(actions).toEqual(['continue', 'create']);
    expect(created[1]?.opts.prompt).toContain(TASK.spec);
    expect(created[1]?.opts.promptImages).toBeUndefined();
    expect(created[1]?.opts.prompt).toContain('[图片附件 t1/img1.png 未被模型读取 — 该图片未下载]');
    expect(client.doneBodies[0]?.body.status).toBe('success');
  });

  test('gemini backend declares no vision: image step degrades instead of failing', async () => {
    const claimed = imageStep(`${TASK.spec}\n\n${SPEC_TOKEN}`);
    const { backend, created } = scriptingBackend({
      eventsByCall: [[DONE_EVENT]],
      modelSupportsImages: async () => false,
      rememberNoVisionCalls: [],
    });
    const { client } = await runImageStep(claimed, backend);
    expect(created[0]?.opts.promptImages).toBeUndefined();
    expect(client.doneBodies[0]?.body.status).toBe('success');
  });
});
