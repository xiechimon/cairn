import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
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
import { BRIEF_MARKER_BEGIN, BRIEF_MARKER_END } from '@cairn/shared';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { describe, expect, test } from 'vitest';
import { createAcpBackend, createGeminiBackend } from '../src/backend/acp.js';
import { buildClaudeSdkOptions, createClaudeCodeBackend } from '../src/backend/claude-code.js';
import { SessionNotResumableError } from '../src/backend/errors.js';
import { createPiBackend, PI_CAPABILITIES } from '../src/backend/pi.js';
import { composeSessionBrief } from '../src/brief-file.js';
import { StepJournal } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import type { MachineApi } from '../src/machine-client.js';
import { runStep } from '../src/runner.js';
import { statePaths } from '../src/state.js';
import { stepExecutorRecord } from '../src/step-executor-record.js';
import { composeWorkerSystemPrompt } from '../src/step-prompt.js';
import { StepSessionOpener } from '../src/step-session-opener.js';
import { testTempDir } from './test-temp-dir.js';

const MAINTAINER_SENTENCE = 'You maintain this codebase long-term.';

function captureLogger(): DaemonLogger {
  return {
    raw: () => {},
    prefixed: () => {},
    supervisor: () => {},
    machine: () => {},
    step: () => {},
    workspace: () => {},
    recover: () => {},
    wake: () => {},
    skills: () => {},
    gate: () => {},
    trust: () => {},
    mcp: () => {},
  };
}

class StubClient implements MachineApi {
  doneBodies: { stepId: string; body: MachineDoneBody }[] = [];
  async enroll(): Promise<never> {
    throw new Error('unused');
  }
  async me(): Promise<never> {
    throw new Error('unused');
  }
  async presence() {
    return { ok: true as const };
  }
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
  async uploadUrls() {
    return { uploads: [] };
  }
  async putUpload(_url: string, _h: Record<string, string>, _body: TranscriptUpload | string) {}
  async done(stepId: string, body: MachineDoneBody) {
    this.doneBodies.push({ stepId, body });
  }
  async steer() {
    return null;
  }
  async stop() {
    return null;
  }
  async attachment(): Promise<never> {
    throw new Error('unused');
  }
  async shellPrecheck(): Promise<never> {
    throw new Error('unused');
  }
  async shellResult(): Promise<void> {}
  async stream(_signal: AbortSignal, _onEvent: (ev: MachineStreamEvent) => void) {}
}

function makeClaimed(opts: {
  kind?: ClaimedStep['step']['kind'];
  output?: 'code' | 'info' | 'report' | 'dataset' | 'link';
  omitTodo?: boolean;
  description?: string | null;
  memories?: { title: string; content: string }[];
}): ClaimedStep {
  const kind = opts.kind ?? 'session';
  return {
    step: { id: 's1', buildId: 'conv-1', kind, machineId: 'm1', createdAt: 1 },
    conversationId: 'conv-1',
    session: { action: 'new', sessionId: null },
    ...(kind === 'review' || kind === 'verify' || kind === 'chief'
      ? { instruction: 'step instruction' }
      : {}),
    ...(kind === 'chief'
      ? { chief: { threadId: 't-chief', systemPrompt: 'Coordinator prompt', trigger: 'user' } }
      : {}),
    ...(opts.omitTodo
      ? {}
      : {
          todo: {
            id: 't1',
            seqNum: 1,
            title: 'Fix email parser',
            spec: 'Strip plus aliases.',
            ...(opts.output !== undefined ? { output: opts.output } : {}),
          },
        }),
    project: { id: 'p1', name: 'demo', repo: null },
    agent: {
      id: 'a1',
      displayName: 'worker',
      description: opts.description === undefined ? 'Build features.' : opts.description,
      provider: null,
      modelId: 'stub-model',
      thinkingLevel: null,
      ...(opts.memories !== undefined ? { memories: opts.memories } : {}),
    },
  };
}

function makeStubBackend(brief: AgentBackend['brief']): {
  backend: AgentBackend;
  seen: SessionOpts[];
} {
  const seen: SessionOpts[] = [];
  const events: StepEvent[] = [{ type: 'done', usage: [] }];
  const handle = (): AgentSessionHandle => ({
    sessionId: 'sess-1',
    events: (async function* gen() {
      for (const ev of events) yield ev;
    })(),
    async steer() {},
    async stop() {},
    usage: () => [],
  });
  return {
    seen,
    backend: {
      capabilities: PI_CAPABILITIES,
      ...(brief !== undefined ? { brief } : {}),
      async createSession(o) {
        seen.push(o);
        return handle();
      },
      async continueSession(_id, o) {
        seen.push(o);
        return handle();
      },
    },
  };
}

async function runWithBackend(claimed: ClaimedStep, brief: AgentBackend['brief']) {
  const home = testTempDir('cairn-maintainer-prompt-');
  const workspacesDir = join(home, 'workspaces');
  const paths = statePaths(home, workspacesDir);
  mkdirSync(join(workspacesDir, claimed.conversationId), { recursive: true });
  const client = new StubClient();
  const journal = new StepJournal(paths.outboxDir);
  const { backend, seen } = makeStubBackend(brief);
  await runStep(
    {
      client,
      journal,
      backendFor: () => backend,
      logger: captureLogger(),
      paths,
      workspacesDir,
      mcpConfigPath: join(home, 'claude.json'),
      heartbeatIntervalMs: 60_000,
    },
    claimed,
  );
  return { client, seen, home };
}

function writeMockAgent(dir: string, name: string, body: string): string {
  const scriptPath = join(dir, `${name}.mjs`);
  const wrapperPath = join(dir, `${name}.sh`);
  writeFileSync(scriptPath, body);
  writeFileSync(wrapperPath, `#!/bin/sh\nexec "${process.execPath}" "${scriptPath}" "$@"\n`);
  chmodSync(wrapperPath, 0o755);
  return wrapperPath;
}

async function collectEvents(events: AsyncIterable<StepEvent>): Promise<StepEvent[]> {
  const out: StepEvent[] = [];
  for await (const ev of events) out.push(ev);
  return out;
}

describe('codebase maintainer prompt for coding tasks', () => {
  test('delivers maintainer guidance through one builder across pi, claude-code, devin, antigravity, and gemini without claiming ownership or design authority', async () => {
    const dir = testTempDir('cairn-maintainer-backends-');
    const briefs: { name: string; brief: AgentBackend['brief'] }[] = [
      {
        name: 'pi',
        brief: createPiBackend({
          agentDir: join(dir, 'pi-agent'),
          sessionDir: join(dir, 'pi-sessions'),
        }).brief,
      },
      { name: 'claude-code', brief: createClaudeCodeBackend({}).brief },
      { name: 'devin', brief: createAcpBackend({ harness: 'devin', command: 'devin' }).brief },
      {
        name: 'antigravity',
        brief: createAcpBackend({ harness: 'antigravity', command: 'agy' }).brief,
      },
      { name: 'gemini', brief: createGeminiBackend({}).brief },
    ];

    for (const kind of ['session', 'build', 'plan'] as const) {
      for (const output of [undefined, 'code'] as const) {
        for (const entry of briefs) {
          const { client, seen } = await runWithBackend(makeClaimed({ kind, output }), entry.brief);
          expect(client.doneBodies[0]?.body.status).toBe('success');
          const delivered = seen[0]?.systemPrompt ?? '';
          expect(delivered, `${entry.name}/${kind}/${output ?? 'omitted'}`).toContain(
            MAINTAINER_SENTENCE,
          );
          expect(delivered).toContain('Unless the user asks for a minimal change');
          expect(delivered).toContain(
            'consolidate duplicate logic your change touches or meets nearby into one shared path',
          );
          expect(delivered).toContain('remove dead paths your change replaces');
          expect(delivered).toContain('move every caller in the same change');
          expect(delivered).toContain('Working behavior outside the task stays unchanged');
          expect(delivered).toContain(
            'name any unavoidable change with its reason in your summary',
          );
          expect(delivered).not.toMatch(/you are the owner|design is up to you/i);
          if (entry.name === 'claude-code') {
            const sdkOpts = buildClaudeSdkOptions({
              cwd: dir,
              modelId: 'm',
              resumeId: null,
              sessionId: 's',
              disallowedTools: [],
              lockedDown: false,
              mcpServers: {},
              append: delivered,
              abortController: new AbortController(),
            });
            expect(sdkOpts.systemPrompt).toEqual({
              type: 'preset',
              preset: 'claude_code',
              append: delivered,
            });
          }
        }
      }
    }
  });

  test('omits maintainer guidance for non-coding steps, info-output todos, and missing todo while keeping coding positive case active', async () => {
    const dir = testTempDir('cairn-maintainer-exclusions-');
    const brief = createPiBackend({
      agentDir: join(dir, 'pi-agent'),
      sessionDir: join(dir, 'pi-sessions'),
    }).brief;

    const coding = await runWithBackend(makeClaimed({ kind: 'session', output: 'code' }), brief);
    expect(coding.seen[0]?.systemPrompt).toContain(MAINTAINER_SENTENCE);

    for (const kind of ['review', 'verify', 'merge', 'chief'] as const) {
      const result = await runWithBackend(makeClaimed({ kind }), brief);
      expect(result.seen[0]?.systemPrompt ?? '', kind).not.toContain(MAINTAINER_SENTENCE);
    }

    for (const output of ['info', 'report', 'dataset', 'link'] as const) {
      const result = await runWithBackend(makeClaimed({ kind: 'session', output }), brief);
      expect(result.seen[0]?.systemPrompt ?? '', output).not.toContain(MAINTAINER_SENTENCE);
    }

    const noTodo = await runWithBackend(makeClaimed({ kind: 'session', omitTodo: true }), brief);
    expect(noTodo.seen[0]?.systemPrompt ?? '').not.toContain(MAINTAINER_SENTENCE);
  });

  test('composes cleanly with empty description and no memories, and updates harness_sha', async () => {
    const dir = testTempDir('cairn-maintainer-empty-');
    const brief = createPiBackend({
      agentDir: join(dir, 'pi-agent'),
      sessionDir: join(dir, 'pi-sessions'),
    }).brief;
    const { seen } = await runWithBackend(
      makeClaimed({ description: null, memories: undefined }),
      brief,
    );
    const prompt = seen[0]?.systemPrompt ?? '';
    expect(prompt).toContain(MAINTAINER_SENTENCE);
    expect(prompt).not.toContain(`${BRIEF_MARKER_BEGIN}\n\n`);

    const withoutGuidance = composeWorkerSystemPrompt(null, undefined);
    const withGuidance = composeWorkerSystemPrompt(null, undefined, { codingTask: true });
    expect(withoutGuidance).toBeUndefined();
    expect(withGuidance).toContain(MAINTAINER_SENTENCE);
    const hashA = stepExecutorRecord({
      catalog: null,
      injectedNames: undefined,
      backend: 'pi',
      model: 'm',
      effort: null,
      systemPrompt: withoutGuidance,
      tools: [],
    }).harness_sha;
    const hashB = stepExecutorRecord({
      catalog: null,
      injectedNames: undefined,
      backend: 'pi',
      model: 'm',
      effort: null,
      systemPrompt: withGuidance,
      tools: [],
    }).harness_sha;
    expect(hashB).not.toBe(hashA);
  });

  test('antigravity sends guidance only on new session while devin prepends on prompt; session fallback delivers new guidance and failure guards abort cleanly', async () => {
    const dir = testTempDir('cairn-maintainer-acp-');
    const mockAgy = writeMockAgent(
      dir,
      'agy-mock',
      [
        "import { createInterface } from 'node:readline';",
        'const send = (obj) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...obj }) + "\\n");',
        'let lastMeta = null;',
        'for await (const line of createInterface({ input: process.stdin })) {',
        '  const msg = JSON.parse(line);',
        '  if (msg.method === "initialize") {',
        '    send({ id: msg.id, result: { protocolVersion: msg.params.protocolVersion, agentCapabilities: { loadSession: true } } });',
        '  } else if (msg.method === "session/new" || msg.method === "session/load") {',
        '    lastMeta = msg.params._meta?.antigravity?.systemPrompt?.append ?? null;',
        '    send({ id: msg.id, result: { sessionId: "ag-1", configOptions: [{ id: "model", name: "Model", category: "model", type: "select", currentValue: "m", options: [{ value: "m", name: "M" }] }] } });',
        '  } else if (msg.method === "session/set_config_option") {',
        '    send({ id: msg.id, result: { configOptions: [] } });',
        '  } else if (msg.method === "session/prompt") {',
        '    send({ method: "session/update", params: { sessionId: "ag-1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: JSON.stringify({ meta: lastMeta, prompt: msg.params.prompt[0]?.text ?? "" }) } } } });',
        '    send({ id: msg.id, result: { stopReason: "end_turn" } });',
        '  }',
        '}',
      ].join('\n'),
    );

    const agyBackend = createAcpBackend({
      harness: 'antigravity',
      command: mockAgy,
      permissions: 'allow-once',
      sessionResume: true,
    });
    const guidance = composeWorkerSystemPrompt('Build features.', undefined, {
      codingTask: true,
    })!;
    expect(guidance).toContain(MAINTAINER_SENTENCE);

    const createdAgy = await agyBackend.createSession({
      cwd: dir,
      provider: { kind: 'api_key', providerId: 'antigravity' },
      modelId: 'm',
      systemPrompt: guidance,
      prompt: 'Do task',
    });
    const createdText = (await collectEvents(createdAgy.events))
      .filter((e): e is Extract<StepEvent, { type: 'text_delta' }> => e.type === 'text_delta')
      .map((e) => e.text)
      .join('');
    expect(JSON.parse(createdText)).toEqual({ meta: guidance, prompt: 'Do task' });

    const continuedAgy = await agyBackend.continueSession('ag-1', {
      cwd: dir,
      provider: { kind: 'api_key', providerId: 'antigravity' },
      modelId: 'm',
      systemPrompt: guidance,
      prompt: 'Follow up',
    });
    const continuedText = (await collectEvents(continuedAgy.events))
      .filter((e): e is Extract<StepEvent, { type: 'text_delta' }> => e.type === 'text_delta')
      .map((e) => e.text)
      .join('');
    expect(JSON.parse(continuedText)).toEqual({ meta: null, prompt: 'Follow up' });

    const mockDevin = writeMockAgent(
      dir,
      'devin-mock',
      [
        "import { createInterface } from 'node:readline';",
        'const send = (obj) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...obj }) + "\\n");',
        'for await (const line of createInterface({ input: process.stdin })) {',
        '  const msg = JSON.parse(line);',
        '  if (msg.method === "initialize") {',
        '    send({ id: msg.id, result: { protocolVersion: msg.params.protocolVersion } });',
        '  } else if (msg.method === "session/new") {',
        '    send({ id: msg.id, result: { sessionId: "dv-1", modes: { currentModeId: "default", availableModes: [{ id: "default", name: "Default" }, { id: "bypass", name: "Bypass" }] }, configOptions: [{ id: "model", name: "Model", category: "model", type: "select", currentValue: "m", options: [{ value: "m", name: "M" }] }] } });',
        '  } else if (msg.method === "session/set_config_option" || msg.method === "session/set_mode") {',
        '    send({ id: msg.id, result: { configOptions: [] } });',
        '  } else if (msg.method === "session/prompt") {',
        '    send({ method: "session/update", params: { sessionId: "dv-1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: msg.params.prompt[0]?.text ?? "" } } } });',
        '    send({ id: msg.id, result: { stopReason: "end_turn" } });',
        '  }',
        '}',
      ].join('\n'),
    );
    const devinBackend = createAcpBackend({ harness: 'devin', command: mockDevin });
    const devinSession = await devinBackend.createSession({
      cwd: dir,
      provider: { kind: 'api_key', providerId: 'devin' },
      modelId: 'm',
      systemPrompt: guidance,
      prompt: 'Do devin task',
    });
    const devinText = (await collectEvents(devinSession.events))
      .filter((e): e is Extract<StepEvent, { type: 'text_delta' }> => e.type === 'text_delta')
      .map((e) => e.text)
      .join('');
    expect(devinText).toContain(MAINTAINER_SENTENCE);
    expect(devinText).toContain('Do devin task');

    const createdFallbackOpts: SessionOpts[] = [];
    const transcriptRows: { id: string; content: unknown }[] = [];
    const fallbackOpener = new StepSessionOpener({
      backend: {
        capabilities: PI_CAPABILITIES,
        async createSession(o) {
          createdFallbackOpts.push(o);
          return {
            sessionId: 'new-1',
            events: (async function* () {})(),
            async steer() {},
            async stop() {},
            usage: () => [],
          };
        },
        async continueSession() {
          throw new SessionNotResumableError('stale-agy');
        },
      },
      sessionOpts: {
        provider: { kind: 'api_key', providerId: 'antigravity' },
        modelId: 'm',
        cwd: dir,
        systemPrompt: guidance,
        prompt: 'Continue',
      },
      claimed: {
        ...makeClaimed({ kind: 'session', output: 'code' }),
        session: { action: 'continue', sessionId: 'stale-agy' },
      },
      stepId: 's-fb',
      isChief: false,
      resume: undefined,
      prompt: 'Continue',
      promptImages: undefined,
      imageSupport: null,
      freshPromptPaths: { plansDir: dir, convId: 'conv-1' },
      modelKey: 'antigravity/m',
      client: new StubClient(),
      journal: { update: () => {} } as unknown as StepJournal,
      transcript: {
        upsert: (row: { id: string; content: unknown }) => transcriptRows.push(row),
      } as never,
      logger: captureLogger(),
      stepAttachmentsDir: dir,
      now: () => 1,
      forgetHandle: () => {},
      rememberImageSupport: () => {},
    });
    await fallbackOpener.open();
    expect(createdFallbackOpts[0]?.systemPrompt).toContain(MAINTAINER_SENTENCE);
    expect(transcriptRows.some((r) => r.id === 'resume-miss-s-fb')).toBe(true);

    const crashOpener = new StepSessionOpener({
      backend: {
        capabilities: PI_CAPABILITIES,
        async createSession() {
          throw new Error('should not open');
        },
        async continueSession() {
          throw new SessionNotResumableError('stale-crash');
        },
      },
      sessionOpts: {
        provider: { kind: 'api_key', providerId: 'pi' },
        modelId: 'm',
        cwd: dir,
        systemPrompt: guidance,
      },
      claimed: {
        ...makeClaimed({ kind: 'session', output: 'code' }),
        session: { action: 'continue', sessionId: 'stale-crash' },
      },
      stepId: 's-crash',
      isChief: false,
      resume: { sessionId: 'stale-crash', prompt: null },
      prompt: '',
      promptImages: undefined,
      imageSupport: null,
      freshPromptPaths: { plansDir: dir, convId: 'conv-1' },
      modelKey: 'pi/m',
      client: new StubClient(),
      journal: { update: () => {} } as unknown as StepJournal,
      transcript: { upsert: () => {} } as never,
      logger: captureLogger(),
      stepAttachmentsDir: dir,
      now: () => 1,
      forgetHandle: () => {},
      rememberImageSupport: () => {},
    });
    await expect(crashOpener.open()).rejects.toThrow(/no journal prompt to resend/);

    const badDir = testTempDir('cairn-maintainer-legacy-brief-');
    writeFileSync(join(badDir, 'AGENTS.md'), `${BRIEF_MARKER_BEGIN}\nstale\n${BRIEF_MARKER_END}\n`);
    const briefErr = composeSessionBrief({
      cwd: badDir,
      brief: { backendId: 'pi', composeBody: (_o, base) => base ?? '' },
      sessionOpts: { cwd: badDir, modelId: 'm', provider: { kind: 'api_key', providerId: 'pi' } },
      systemPrompt: guidance,
    });
    expect(briefErr).toMatch(/Legacy runtime guidance remains in AGENTS\.md/);
  });

  test('pi resumed session recovers from prefix-mismatch 400 with new maintainer guidance and surfaces persistent 400 error', async () => {
    const dir = testTempDir('cairn-maintainer-pi-prefix-');
    const sessionDir = join(dir, 'sessions');
    const manager = SessionManager.create(dir, sessionDir);
    manager.appendMessage({ role: 'user', content: 'Start.', timestamp: 1 });
    manager.appendMessage({
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: '', thinkingSignature: 'old-prefix-signature' },
        { type: 'text', text: 'Started.' },
      ],
      api: 'anthropic-messages',
      provider: 'synthetic-claude',
      model: 'claude-opus-5-5',
      stopReason: 'stop',
      timestamp: 2,
      usage: {
        input: 10,
        output: 5,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 15,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    });
    const sessionFile = manager.getSessionFile();
    if (!sessionFile) throw new Error('Missing persisted session');

    const boundErr =
      'messages.1.content.0: Invalid `signature` in `thinking` block. The block is bound to a different conversation.';
    const sseOk = [
      {
        type: 'message_start',
        message: {
          id: 'm1',
          type: 'message',
          role: 'assistant',
          model: 'claude-opus-5-5',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 1 },
        },
      },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Done.' } },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 4 },
      },
      { type: 'message_stop' },
    ]
      .map((ev) => `event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`)
      .join('');

    let persistent400 = false;
    const bodies: string[] = [];
    const server = createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      bodies.push(raw);
      if (persistent400 || raw.includes('old-prefix-signature')) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            type: 'error',
            error: { type: 'invalid_request_error', message: boundErr },
          }),
        );
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(sseOk);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Missing listener');

    const guidance = composeWorkerSystemPrompt('Build features.', undefined, {
      codingTask: true,
    })!;
    expect(guidance).toContain(MAINTAINER_SENTENCE);

    const backend = createPiBackend({
      agentDir: join(dir, 'agent'),
      sessionDir,
      resolveSessionFile: () => sessionFile,
    });
    const provider = {
      kind: 'http' as const,
      providerId: 'synthetic-claude',
      api: 'anthropic-messages' as const,
      baseUrl: `http://127.0.0.1:${addr.port}`,
      apiKey: 'synthetic-key',
      models: [{ id: 'claude-opus-5-5', name: 'claude-opus-5-5' }],
    };

    try {
      const recovered = await backend.continueSession(manager.getSessionId(), {
        cwd: dir,
        systemPrompt: guidance,
        modelId: 'claude-opus-5-5',
        prompt: 'Continue.',
        provider,
      });
      const recoveredEvents = await collectEvents(recovered.events);
      expect(recoveredEvents.filter((e) => e.type === 'error')).toEqual([]);
      expect(recoveredEvents.at(-1)?.type).toBe('done');
      expect(bodies).toHaveLength(2);
      expect(bodies[1]).toContain(MAINTAINER_SENTENCE);
      await recovered.stop();

      persistent400 = true;
      const failed = await backend.continueSession(manager.getSessionId(), {
        cwd: dir,
        systemPrompt: guidance,
        modelId: 'claude-opus-5-5',
        prompt: 'Continue again.',
        provider,
      });
      const failedEvents = await collectEvents(failed.events);
      expect(failedEvents.some((e) => e.type === 'error')).toBe(true);
      await failed.stop();
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 20_000);
});
