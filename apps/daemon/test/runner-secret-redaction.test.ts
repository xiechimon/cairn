import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AgentBackend,
  AgentSessionHandle,
  ClaimedStep,
  MachineDoneBody,
  MachineStreamEvent,
  MachineTokenResponse,
  SessionOpts,
  StepEvent,
  ToolCallRecord,
  TranscriptUpload,
} from '@cairn/shared';
import { SESSION_FILE_NAME } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import { StepJournal } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import type { MachineApi } from '../src/machine-client.js';
import { runStep } from '../src/runner.js';
import { GET_SECRET_TOOL_NAME } from '../src/secret-channel.js';
import { statePaths } from '../src/state.js';
import { testTempDir } from './test-temp-dir.js';

const PROVIDER_API_KEY = 'prov_api_key_opaque_9f8e7d6c5b4a';
const TEAM_SECRET = 'team_secret_opaque_1a2b3c4d5e6f';
const HTTP_SECRET = 'http_secret_opaque_7g8h9i0j1k2l';
const ESCAPED_SECRET = 'multi\\line\n"quoted\\secret_end\\';

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

function claimedStep(): ClaimedStep {
  return {
    step: { id: 's1', buildId: 'conv-1', kind: 'build', machineId: 'm1', createdAt: 1 },
    conversationId: 'conv-1',
    session: { action: 'new', sessionId: null },
    todo: { id: 't1', seqNum: 1, title: 'secret redaction', spec: 'run step' },
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

class RecordingClient implements MachineApi {
  deltas: string[] = [];
  toolCalls: ToolCallRecord[] = [];
  uploads: { name: string; body: TranscriptUpload | string }[] = [];
  uploadNames: string[][] = [];
  doneBodies: { stepId: string; body: MachineDoneBody }[] = [];

  constructor(private readonly tokenResponse: MachineTokenResponse) {}

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
  async tool(_stepId: string, call: ToolCallRecord) {
    this.toolCalls.push(call);
  }
  async transcriptDelta(_stepId: string, text: string) {
    this.deltas.push(text);
  }
  async relayTool() {
    return '{}';
  }
  async token(): Promise<MachineTokenResponse> {
    return this.tokenResponse;
  }
  async skillsManifest() {
    return { selection: 'whitelist' as const, skills: [] };
  }
  async skillFile(): Promise<Buffer> {
    throw new Error('unexpected skillFile call');
  }
  async attachment(): Promise<never> {
    throw new Error('unused');
  }
  async uploadUrls(_stepId: string, files: { name: string }[]) {
    this.uploadNames.push(files.map((f) => f.name));
    return {
      uploads: files.map((f, i) => ({
        name: f.name,
        url: `http://server/up/${i}`,
        method: 'PUT' as const,
        headers: {},
      })),
    };
  }
  async putUpload(url: string, _headers: Record<string, string>, body: TranscriptUpload | string) {
    const index = Number(url.slice('http://server/up/'.length));
    const names = this.uploadNames[this.uploadNames.length - 1] ?? [];
    const name = names[index] ?? url;
    this.uploads.push({ name, body });
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
  async shellPrecheck(): Promise<never> {
    throw new Error('unused');
  }
  async shellResult(): Promise<void> {}
  async stream(_signal: AbortSignal, _onEvent: (ev: MachineStreamEvent) => void) {}
}

async function runWithSecrets(input: {
  tokenResponse: MachineTokenResponse;
  events: StepEvent[];
  sessionFileLines?: unknown[];
}) {
  const home = testTempDir('cairn-runner-redact-');
  const workspacesDir = join(home, 'workspaces');
  const paths = statePaths(home, workspacesDir);
  const { logger, lines } = captureLogger();
  const client = new RecordingClient(input.tokenResponse);
  let sessionFile: string | undefined;
  if (input.sessionFileLines !== undefined) {
    sessionFile = join(home, 'session.jsonl');
    writeFileSync(
      sessionFile,
      `${input.sessionFileLines.map((row) => JSON.stringify(row)).join('\n')}\n`,
    );
  }
  let capturedSecrets: readonly (string | undefined)[] = [];
  let fetchedTeamSecret: string | null = null;
  const backend: AgentBackend = {
    capabilities: PI_CAPABILITIES,
    async createSession(opts: SessionOpts): Promise<AgentSessionHandle> {
      capturedSecrets = opts.secrets?.() ?? [];
      const secretTool = opts.localTools?.find((tool) => tool.name === GET_SECRET_TOOL_NAME);
      if (secretTool) {
        fetchedTeamSecret = await secretTool.execute({ name: 'TEAM_KEY' });
      }
      return {
        sessionId: 'pi-sess-redact',
        ...(sessionFile !== undefined ? { sessionFile } : {}),
        events: (async function* () {
          for (const event of input.events) yield event;
        })(),
        async steer() {},
        async stop() {},
        usage: () => [],
      };
    },
    async continueSession(): Promise<never> {
      throw new Error('unused');
    },
  };
  await runStep(
    {
      client,
      journal: new StepJournal(paths.outboxDir),
      backendFor: () => backend,
      logger,
      paths,
      workspacesDir,
      mcpConfigPath: join(home, 'claude.json'),
      heartbeatIntervalMs: 60_000,
    },
    claimedStep(),
  );
  return { client, lines, capturedSecrets, fetchedTeamSecret };
}

describe('runner CredentialRegistry redaction for provider apiKey, team secrets, and httpSecrets', () => {
  test('redacts provider apiKey, team secrets, and httpSecrets across events, transcripts, logs, and session uploads', async () => {
    const tokenResponse: MachineTokenResponse = {
      provider: {
        kind: 'api_key',
        providerId: 'openai',
        apiKey: PROVIDER_API_KEY,
        models: [{ id: 'stub-model', name: 'stub-model' }],
      },
      secrets: {
        TEAM_KEY: TEAM_SECRET,
      },
      httpSecrets: [
        {
          id: 'hs1',
          name: 'API_BEARER',
          revision: 1,
          origin: 'https://api.example.test',
          header: 'Authorization',
          template: 'Bearer {{value}}',
          value: HTTP_SECRET,
        },
      ],
      git: null,
    };

    const { client, lines, capturedSecrets, fetchedTeamSecret } = await runWithSecrets({
      tokenResponse,
      events: [
        { type: 'text_delta', text: `api=${PROVIDER_API_KEY.slice(0, 10)}` },
        {
          type: 'text_delta',
          text: `${PROVIDER_API_KEY.slice(10)} team=${TEAM_SECRET} http=${HTTP_SECRET}`,
        },
        {
          type: 'toolcall_end',
          call: {
            id: 'tc1',
            name: GET_SECRET_TOOL_NAME,
            arguments: { name: 'TEAM_KEY' },
            result: `got ${TEAM_SECRET} and ${HTTP_SECRET} and ${PROVIDER_API_KEY}`,
          },
        },
        { type: 'done', usage: [] },
      ],
      sessionFileLines: [
        { type: 'assistant', text: `provider ${PROVIDER_API_KEY}` },
        { type: 'tool_result', content: `team ${TEAM_SECRET} http ${HTTP_SECRET}` },
      ],
    });

    expect(fetchedTeamSecret).toBe(TEAM_SECRET);
    expect(capturedSecrets).toContain(PROVIDER_API_KEY);
    expect(capturedSecrets).toContain(TEAM_SECRET);
    expect(capturedSecrets).toContain(HTTP_SECRET);

    const transcriptUpload = client.uploads.find((u) => u.name === 'transcript.json');
    const sessionUpload = client.uploads.find((u) => u.name === SESSION_FILE_NAME);
    expect(transcriptUpload).toBeDefined();
    expect(sessionUpload).toBeDefined();

    const surfaces = [
      client.deltas.join(''),
      JSON.stringify(client.toolCalls),
      JSON.stringify(transcriptUpload?.body),
      String(sessionUpload?.body),
      lines.join('\n'),
      JSON.stringify(client.doneBodies),
    ];

    for (const secret of [PROVIDER_API_KEY, TEAM_SECRET, HTTP_SECRET]) {
      for (const surface of surfaces) {
        expect(surface).not.toContain(secret);
      }
    }
    expect(client.deltas.join('')).toContain('[REDACTED]');
    expect(JSON.stringify(client.toolCalls)).toContain('[REDACTED]');
    expect(JSON.stringify(transcriptUpload?.body)).toContain('[REDACTED]');
    expect(String(sessionUpload?.body)).toContain('[REDACTED]');
  });

  test('redacts secrets containing quotes, backslashes, and newlines while keeping session.jsonl valid JSON', async () => {
    const tokenResponse: MachineTokenResponse = {
      provider: {
        kind: 'http',
        providerId: 'stub-gw',
        baseUrl: 'http://127.0.0.1:9/v1',
        api: 'openai-completions',
        authHeader: true,
        models: [{ id: 'stub-model', name: 'stub-model' }],
      },
      secrets: {
        ESCAPED_KEY: ESCAPED_SECRET,
      },
      git: null,
    };

    const { client } = await runWithSecrets({
      tokenResponse,
      events: [
        { type: 'text_delta', text: `raw=${ESCAPED_SECRET}` },
        { type: 'done', usage: [] },
      ],
      sessionFileLines: [{ type: 'tool_result', content: ESCAPED_SECRET }],
    });

    const sessionUpload = client.uploads.find((u) => u.name === SESSION_FILE_NAME);
    expect(sessionUpload).toBeDefined();
    const sessionText = String(sessionUpload?.body);
    const escapedJsonFragment = JSON.stringify(ESCAPED_SECRET).slice(1, -1);
    expect(sessionText).not.toContain(ESCAPED_SECRET);
    expect(sessionText).not.toContain(escapedJsonFragment);
    expect(sessionText).toContain('[REDACTED]');
    for (const line of sessionText.split('\n').filter((row) => row !== '')) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
    const transcriptUpload = client.uploads.find((u) => u.name === 'transcript.json');
    expect(JSON.stringify(transcriptUpload?.body)).not.toContain(escapedJsonFragment);
  });

  test('handles more than 128 step secrets without hitting registry capacity limit', async () => {
    const manySecrets: Record<string, string> = {};
    for (let i = 0; i < 140; i += 1) {
      manySecrets[`SECRET_${i}`] = `bulk_secret_value_${String(i).padStart(3, '0')}_abcdef`;
    }
    const tokenResponse: MachineTokenResponse = {
      provider: {
        kind: 'api_key',
        providerId: 'openai',
        apiKey: PROVIDER_API_KEY,
        models: [{ id: 'stub-model', name: 'stub-model' }],
      },
      secrets: manySecrets,
      git: null,
    };

    const { client } = await runWithSecrets({
      tokenResponse,
      events: [
        {
          type: 'text_delta',
          text: `first=${manySecrets.SECRET_0} last=${manySecrets.SECRET_139} api=${PROVIDER_API_KEY}`,
        },
        { type: 'done', usage: [] },
      ],
    });

    expect(client.doneBodies[0]?.body.status).toBe('success');
    const transcriptUpload = client.uploads.find((u) => u.name === 'transcript.json');
    const serialized = JSON.stringify(transcriptUpload?.body);
    expect(serialized).not.toContain(manySecrets.SECRET_0!);
    expect(serialized).not.toContain(manySecrets.SECRET_139!);
    expect(serialized).not.toContain(PROVIDER_API_KEY);
    expect(serialized).toContain('[REDACTED]');
  });

  test('redacts inner password extracted from pair secrets in tokenRes.secrets', async () => {
    const pairPassword = 'db_prod_pair_password_987654';
    const pairEnvelope = JSON.stringify({ username: 'db_admin', password: pairPassword });
    const tokenResponse: MachineTokenResponse = {
      provider: {
        kind: 'http',
        providerId: 'stub-gw',
        baseUrl: 'http://127.0.0.1:9/v1',
        api: 'openai-completions',
        authHeader: true,
        models: [{ id: 'stub-model', name: 'stub-model' }],
      },
      secrets: {
        DB_CREDS: pairEnvelope,
      },
      git: null,
    };

    const { client, capturedSecrets } = await runWithSecrets({
      tokenResponse,
      events: [
        { type: 'text_delta', text: `pw=${pairPassword} env=${pairEnvelope}` },
        { type: 'done', usage: [] },
      ],
      sessionFileLines: [{ type: 'assistant', text: `connected with ${pairPassword}` }],
    });

    expect(capturedSecrets).toContain(pairPassword);
    const transcriptUpload = client.uploads.find((u) => u.name === 'transcript.json');
    const sessionUpload = client.uploads.find((u) => u.name === SESSION_FILE_NAME);
    expect(JSON.stringify(transcriptUpload?.body)).not.toContain(pairPassword);
    expect(String(sessionUpload?.body)).not.toContain(pairPassword);
    expect(JSON.stringify(transcriptUpload?.body)).toContain('[REDACTED]');
  });

  test('skips short env values under 8 chars and redacts longer secrets before shorter substrings', async () => {
    const shortSub = 'tok_12345678';
    const longFull = 'tok_12345678_prod_admin_secret';
    const tokenResponse: MachineTokenResponse = {
      provider: {
        kind: 'http',
        providerId: 'ollama',
        baseUrl: 'http://127.0.0.1:9/v1',
        api: 'openai-completions',
        authHeader: true,
        apiKey: 'ollama',
        models: [{ id: 'stub-model', name: 'stub-model' }],
      },
      secrets: {
        DEBUG: '1',
        CI: 'true',
        SHORT_TOKEN: shortSub,
        LONG_TOKEN: longFull,
      },
      git: null,
    };

    const { client, capturedSecrets } = await runWithSecrets({
      tokenResponse,
      events: [
        {
          type: 'text_delta',
          text: `step=1 ok=true provider=ollama full=${longFull} sub=${shortSub}`,
        },
        { type: 'done', usage: [] },
      ],
      sessionFileLines: [{ type: 'assistant', count: 1, ok: true, text: `full=${longFull}` }],
    });

    expect(capturedSecrets).not.toContain('ollama');
    expect(capturedSecrets).not.toContain('1');
    expect(capturedSecrets).not.toContain('true');
    expect(client.doneBodies[0]?.stepId).toBe('s1');
    expect(client.doneBodies[0]?.body.status).toBe('success');

    const transcriptUpload = client.uploads.find((u) => u.name === 'transcript.json');
    const serialized = JSON.stringify(transcriptUpload?.body);
    expect(serialized).toContain('step=1 ok=true provider=ollama full=[REDACTED] sub=[REDACTED]');
    expect(serialized).not.toContain('prod_admin_secret');

    const sessionUpload = client.uploads.find((u) => u.name === SESSION_FILE_NAME);
    expect(sessionUpload).toBeDefined();
    expect(String(sessionUpload?.body)).not.toContain('prod_admin_secret');
    expect(String(sessionUpload?.body)).toContain('[REDACTED]');
  });
});
