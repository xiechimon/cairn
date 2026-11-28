import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { ClaimedStep, RemoteToolDef, SessionOpts, StepEvent } from '@cairn/shared';
import { CHIEF_REMOTE_TOOLS } from '@cairn/shared';
import { ANTIGRAVITY_ACP_ARGS } from '@cairn/shared/antigravity-install';
import { acquireDeterministicCredentialProfile } from '@cairn/shared/credential-profile';
import { afterEach, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { createAcpBackend } from '../src/backend/acp.js';
import { computeAcpToolsDigest } from '../src/backend/acp-tools.js';
import { SessionNotResumableError } from '../src/backend/errors.js';
import { clearCredentials, pushCredential } from '../src/credentials.js';
import { StepJournal, TranscriptBuffer } from '../src/journal.js';
import { STEP_TREE_ENV } from '../src/process-tree.js';
import { prepareStepEnv } from '../src/step-env.js';
import { agentStepRefusal, antigravitySubscriptionMissingMessage } from '../src/step-preflight.js';
import { StepSessionOpener } from '../src/step-session-opener.js';

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = makeTestTempDir(prefix);
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) releaseTestTempDir(dir);
});

async function collect(events: AsyncIterable<StepEvent>): Promise<StepEvent[]> {
  const result: StepEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}

function shQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function shellNodeScript(body: string): string {
  return `#!/bin/sh\nexec ${shQuote(process.execPath)} --input-type=module -e ${shQuote(body)} -- "$0" "$@"\n`;
}

function writeResumeMock(
  dir: string,
  behavior: 'resume-ok' | 'resume-fallback-load' | 'resume-missing' | 'resume-auth-required',
): string {
  const agent = join(dir, `agy-${behavior}.sh`);
  writeFileSync(
    agent,
    shellNodeScript(
      [
        "import { createInterface } from 'node:readline';",
        'if (process.argv[2] !== "acp" || process.argv[3] !== "--app-data-dir" || process.argv[4] !== "antigravity-acp") {',
        '  process.stderr.write("bad args: " + JSON.stringify(process.argv.slice(2)) + "\\n");',
        '  process.exit(2);',
        '}',
        'if (process.env.AGY_CLI_DISABLE_AUTO_UPDATE !== "1") {',
        '  process.stderr.write("missing auto-update disable\\n");',
        '  process.exit(3);',
        '}',
        'const send = (obj) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...obj }) + "\\n");',
        'const modelConfig = [{ id: "model", name: "Model", category: "model", type: "select", currentValue: "gemini-4-neon", options: [{ value: "gemini-4-neon", name: "Gemini 4 Neon" }, { value: "gemini-3.8-flash", name: "Gemini 3.8 Flash" }] }];',
        'let activeSessionId = "fresh-session-1";',
        'let openedVia = "";',
        'for await (const line of createInterface({ input: process.stdin })) {',
        '  const msg = JSON.parse(line);',
        '  if (msg.method === "initialize") {',
        '    send({ id: msg.id, result: { protocolVersion: msg.params.protocolVersion, agentInfo: { name: "Antigravity ACP Server", version: "1.5.16" }, agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} } } } });',
        '  } else if (msg.method === "session/resume") {',
        ...(behavior === 'resume-ok'
          ? [
              '    activeSessionId = msg.params.sessionId;',
              '    openedVia = "resume";',
              '    send({ id: msg.id, result: { sessionId: activeSessionId, configOptions: modelConfig } });',
            ]
          : behavior === 'resume-auth-required'
            ? [
                '    send({ id: msg.id, error: { code: -32000, message: "Authentication required" } });',
              ]
            : [
                '    send({ id: msg.id, error: { code: -32603, message: "Failed to read session " + msg.params.sessionId + "; retry, or load it with session/load" } });',
              ]),
        '  } else if (msg.method === "session/load") {',
        ...(behavior === 'resume-fallback-load'
          ? [
              '    activeSessionId = msg.params.sessionId;',
              '    openedVia = "load";',
              '    send({ id: msg.id, result: { sessionId: activeSessionId, configOptions: modelConfig } });',
            ]
          : [
              '    send({ id: msg.id, error: { code: -32002, message: "Session not found: " + msg.params.sessionId } });',
            ]),
        '  } else if (msg.method === "session/new") {',
        '    openedVia = "new";',
        '    send({ id: msg.id, result: { sessionId: activeSessionId, configOptions: modelConfig } });',
        '  } else if (msg.method === "session/set_config_option") {',
        '    send({ id: msg.id, result: { configOptions: [] } });',
        '  } else if (msg.method === "session/prompt") {',
        '    send({ method: "session/update", params: { sessionId: activeSessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: openedVia + ":" + activeSessionId } } } });',
        '    send({ id: msg.id, result: { stopReason: "end_turn" } });',
        '  }',
        '}',
      ].join('\n'),
    ),
  );
  chmodSync(agent, 0o755);
  return agent;
}

function writeModeMock(
  dir: string,
  name: string,
  modes: {
    currentModeId: string;
    availableModes: readonly { id: string; name: string }[];
  },
): string {
  const agent = join(dir, `${name}.sh`);
  writeFileSync(
    agent,
    shellNodeScript(
      [
        "import { createInterface } from 'node:readline';",
        'if (process.argv.includes("--dangerously-skip-permissions")) process.exit(99);',
        'const send = (obj) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...obj }) + "\\n");',
        `let currentMode = ${JSON.stringify(modes.currentModeId)};`,
        'let selectedThinking = null;',
        'for await (const line of createInterface({ input: process.stdin })) {',
        '  const msg = JSON.parse(line);',
        '  if (msg.method === "initialize") {',
        '    send({ id: msg.id, result: { protocolVersion: msg.params.protocolVersion, agentCapabilities: { loadSession: true } } });',
        '  } else if (msg.method === "session/new") {',
        `    send({ id: msg.id, result: { sessionId: "ag-1", modes: ${JSON.stringify(modes)}, configOptions: [{ id: "model", name: "Model", category: "model", type: "select", currentValue: "gemini-4-carbon", options: [{ value: "gemini-4-carbon", name: "Gemini 4 Carbon" }] }, { id: "thought_level", name: "Thought Level", category: "thought_level", type: "select", currentValue: "medium", options: [{ value: "low", name: "Low" }, { value: "medium", name: "Medium" }, { value: "high", name: "High" }] }] } });`,
        '  } else if (msg.method === "session/set_mode") {',
        '    currentMode = msg.params.modeId;',
        '    send({ id: msg.id, result: {} });',
        '  } else if (msg.method === "session/set_config_option") {',
        '    if (msg.params.configId === "thought_level") selectedThinking = msg.params.value;',
        '    send({ id: msg.id, result: { configOptions: [{ id: "thought_level", name: "Thought Level", category: "thought_level", type: "select", currentValue: "medium", options: [{ value: "low", name: "Low" }, { value: "medium", name: "Medium" }, { value: "high", name: "High" }] }] } });',
        '  } else if (msg.method === "session/prompt") {',
        '    send({ method: "session/update", params: { sessionId: "ag-1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: currentMode + ":" + selectedThinking } } } });',
        '    send({ id: msg.id, result: { stopReason: "end_turn" } });',
        '  }',
        '}',
      ].join('\n'),
    ),
  );
  chmodSync(agent, 0o755);
  return agent;
}

describe('antigravity ACP runtime and credentials', () => {
  test('prefers auto mode for worker steps, default mode over plan when restricted, and never passes dangerously-skip-permissions', async () => {
    const dir = tempDir('ag-acp-');
    const agent = writeModeMock(dir, 'agy-mock', {
      currentModeId: 'default',
      availableModes: [
        { id: 'default', name: 'Default' },
        { id: 'auto', name: 'Auto' },
        { id: 'plan', name: 'Plan' },
      ],
    });

    const baseOpts: SessionOpts = {
      cwd: dir,
      provider: { kind: 'api_key', providerId: 'antigravity' },
      modelId: 'gemini-4-carbon',
      prompt: 'hi',
    };
    const backend = createAcpBackend({
      harness: 'antigravity',
      command: agent,
      permissions: 'allow-once',
      allowHostMcp: true,
      sessionResume: true,
    });

    const workerSession = await backend.createSession({ ...baseOpts, thinkingLevel: 'high' });
    const workerEvents = await collect(workerSession.events);
    expect(workerEvents).toContainEqual({
      type: 'message_end',
      message: { role: 'assistant', content: 'auto:high' },
    });
    expect(workerEvents).toContainEqual({ type: 'done', usage: [] });

    const restrictedSession = await backend.createSession({
      ...baseOpts,
      readOnly: true,
      lockedDown: true,
      thinkingLevel: 'low',
    });
    const restrictedEvents = await collect(restrictedSession.events);
    expect(restrictedEvents).toContainEqual({
      type: 'message_end',
      message: { role: 'assistant', content: 'default:low' },
    });

    const autoStartAgent = writeModeMock(dir, 'agy-auto-start', {
      currentModeId: 'auto',
      availableModes: [
        { id: 'default', name: 'Default' },
        { id: 'auto', name: 'Auto' },
        { id: 'plan', name: 'Plan' },
      ],
    });
    const autoStartBackend = createAcpBackend({
      harness: 'antigravity',
      command: autoStartAgent,
      permissions: 'allow-once',
      allowHostMcp: true,
      sessionResume: true,
    });
    const autoStartRestricted = await autoStartBackend.createSession({
      ...baseOpts,
      remoteToolsOnly: true,
      lockedDown: true,
      thinkingLevel: 'low',
    });
    const autoStartEvents = await collect(autoStartRestricted.events);
    expect(autoStartEvents).toContainEqual({
      type: 'message_end',
      message: { role: 'assistant', content: 'default:low' },
    });

    const planFallbackAgent = writeModeMock(dir, 'agy-plan-fallback', {
      currentModeId: 'auto',
      availableModes: [
        { id: 'auto', name: 'Auto' },
        { id: 'plan', name: 'Plan' },
      ],
    });
    const planFallbackBackend = createAcpBackend({
      harness: 'antigravity',
      command: planFallbackAgent,
      permissions: 'allow-once',
      allowHostMcp: true,
      sessionResume: true,
    });
    const planFallbackSession = await planFallbackBackend.createSession({
      ...baseOpts,
      readOnly: true,
      lockedDown: true,
      thinkingLevel: 'low',
    });
    const planFallbackEvents = await collect(planFallbackSession.events);
    expect(planFallbackEvents).toContainEqual({
      type: 'message_end',
      message: { role: 'assistant', content: 'plan:low' },
    });
  });

  test('reports learned Antigravity model thinking levels back through onAntigravityModels', async () => {
    const dir = tempDir('ag-learned-models-');
    const agent = join(dir, 'agy-learned.sh');
    writeFileSync(
      agent,
      shellNodeScript(
        [
          "import { createInterface } from 'node:readline';",
          'const send = (obj) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...obj }) + "\\n");',
          'for await (const line of createInterface({ input: process.stdin })) {',
          '  const msg = JSON.parse(line);',
          '  if (msg.method === "initialize") {',
          '    send({ id: msg.id, result: { protocolVersion: msg.params.protocolVersion, agentCapabilities: { loadSession: true } } });',
          '  } else if (msg.method === "session/new") {',
          '    send({ id: msg.id, result: { sessionId: "ag-learn", configOptions: [{ id: "model", name: "Model", category: "model", type: "select", currentValue: "gemini-4-neon", options: [{ value: "gemini-4-neon", name: "Gemini 4 Neon" }, { value: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)" }] }, { id: "thought_level", name: "Thinking Level", category: "thought_level", type: "select", currentValue: "high", options: [{ value: "low", name: "Low" }, { value: "medium", name: "Medium" }, { value: "high", name: "High" }, { value: "xhigh", name: "Extra" }] }] } });',
          '  } else if (msg.method === "session/set_config_option") {',
          '    const opts = msg.params.value === "gpt-oss-120b-medium" ? [] : [{ id: "thought_level", name: "Thinking Level", category: "thought_level", type: "select", currentValue: "high", options: [{ value: "low", name: "Low" }, { value: "medium", name: "Medium" }, { value: "high", name: "High" }, { value: "xhigh", name: "Extra" }] }];',
          '    send({ id: msg.id, result: { configOptions: opts } });',
          '  } else if (msg.method === "session/prompt") {',
          '    send({ id: msg.id, result: { stopReason: "end_turn" } });',
          '  }',
          '}',
        ].join('\n'),
      ),
    );
    chmodSync(agent, 0o755);

    const learned: unknown[] = [];
    const backend = createAcpBackend({
      harness: 'antigravity',
      command: agent,
      permissions: 'allow-once',
      onAntigravityModels: (models) => learned.push(models),
    });
    const session = await backend.createSession({
      cwd: dir,
      provider: { kind: 'api_key', providerId: 'antigravity' },
      modelId: 'gpt-oss-120b-medium',
      prompt: 'hi',
    });
    await collect(session.events);
    expect(learned).toEqual([
      [
        {
          id: 'gemini-4-neon',
          name: 'Gemini 4 Neon',
          thinkingLevels: ['low', 'medium', 'high', 'xhigh'],
          thinkingDefault: 'high',
        },
        {
          id: 'gpt-oss-120b-medium',
          name: 'GPT-OSS 120B (Medium)',
          thinkingLevels: [],
        },
      ],
    ]);
  });

  test('old-pack session resumes under full CLI via session/resume and falls back to session/load when resume asks for load', async () => {
    const dir = tempDir('ag-resume-ok-');
    const baseOpts: SessionOpts = {
      cwd: dir,
      provider: { kind: 'api_key', providerId: 'antigravity' },
      modelId: 'gemini-4-neon',
      prompt: 'continue',
    };

    const resumeBackend = createAcpBackend({
      harness: 'antigravity',
      command: writeResumeMock(dir, 'resume-ok'),
      args: [...ANTIGRAVITY_ACP_ARGS],
      permissions: 'allow-once',
      allowHostMcp: true,
      sessionResume: true,
    });
    const resumed = await resumeBackend.continueSession('legacy-pack-sess-1', baseOpts);
    expect(resumed.sessionId).toBe('legacy-pack-sess-1');
    expect(await collect(resumed.events)).toContainEqual({
      type: 'message_end',
      message: { role: 'assistant', content: 'resume:legacy-pack-sess-1' },
    });

    const loadBackend = createAcpBackend({
      harness: 'antigravity',
      command: writeResumeMock(dir, 'resume-fallback-load'),
      args: [...ANTIGRAVITY_ACP_ARGS],
      permissions: 'allow-once',
      allowHostMcp: true,
      sessionResume: true,
    });
    const loaded = await loadBackend.continueSession('legacy-pack-sess-2', baseOpts);
    expect(loaded.sessionId).toBe('legacy-pack-sess-2');
    expect(await collect(loaded.events)).toContainEqual({
      type: 'message_end',
      message: { role: 'assistant', content: 'load:legacy-pack-sess-2' },
    });
  });

  test('missing old-pack session throws SessionNotResumableError so StepSessionOpener starts a fresh session', async () => {
    const dir = tempDir('ag-resume-miss-');
    const baseOpts: SessionOpts = {
      cwd: dir,
      provider: { kind: 'api_key', providerId: 'antigravity' },
      modelId: 'gemini-4-neon',
      prompt: 'continue',
    };
    const backend = createAcpBackend({
      harness: 'antigravity',
      command: writeResumeMock(dir, 'resume-missing'),
      args: [...ANTIGRAVITY_ACP_ARGS],
      permissions: 'allow-once',
      allowHostMcp: true,
      sessionResume: true,
    });
    await expect(backend.continueSession('legacy-pack-gone', baseOpts)).rejects.toBeInstanceOf(
      SessionNotResumableError,
    );

    const claimed: ClaimedStep = {
      step: { id: 's-res', buildId: 'conv-1', kind: 'build', machineId: 'm1', createdAt: 1 },
      conversationId: 'conv-1',
      session: { action: 'continue', sessionId: 'legacy-pack-gone' },
      todo: { id: 't1', seqNum: 1, title: 'Resume task', spec: 'Keep going' },
      project: { id: 'p1', name: 'demo', repo: null },
      agent: {
        id: 'a1',
        displayName: 'agy',
        description: null,
        provider: 'antigravity',
        modelId: 'gemini-4-neon',
        thinkingLevel: null,
      },
    };
    const journal = new StepJournal(dir);
    journal.claim({
      stepId: 's-res',
      buildId: 'conv-1',
      kind: 'build',
      conversationId: 'conv-1',
      sessionAction: 'continue',
      sessionId: 'legacy-pack-gone',
      prompt: 'continue',
      claimed,
      stopRequest: null,
    });
    const transcript = new TranscriptBuffer(dir, 's-res');
    const opener = new StepSessionOpener({
      backend,
      sessionOpts: { ...baseOpts },
      claimed,
      stepId: 's-res',
      isChief: false,
      resume: undefined,
      prompt: 'continue',
      promptImages: undefined,
      imageSupport: null,
      freshPromptPaths: { plansDir: dir, convId: 'conv-1' },
      modelKey: 'antigravity/gemini-4-neon',
      client: {
        attachment: async () => ({ bytes: Buffer.alloc(0), mimeType: 'text/plain' }),
      } as never,
      journal,
      transcript,
      logger: { step: () => {} } as never,
      stepAttachmentsDir: dir,
      now: () => 1,
      forgetHandle: () => {},
      rememberImageSupport: () => {},
    });
    const session = await opener.open();
    expect(session.sessionId).toBe('fresh-session-1');
    expect(await collect(session.events)).toContainEqual({
      type: 'message_end',
      message: { role: 'assistant', content: 'new:fresh-session-1' },
    });
    expect(transcript.messages().some((row) => row.id === 'resume-miss-s-res')).toBe(true);
  });

  test('old-pack session resume needing sign-in surfaces the Antigravity login error instead of dropping the session', async () => {
    const dir = tempDir('ag-resume-auth-');
    const backend = createAcpBackend({
      harness: 'antigravity',
      command: writeResumeMock(dir, 'resume-auth-required'),
      args: [...ANTIGRAVITY_ACP_ARGS],
      permissions: 'allow-once',
      allowHostMcp: true,
      sessionResume: true,
    });
    const err = await backend
      .continueSession('legacy-pack-unauth', {
        cwd: dir,
        provider: { kind: 'api_key', providerId: 'antigravity' },
        modelId: 'gemini-4-neon',
        prompt: 'continue',
      })
      .catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(SessionNotResumableError);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain(
      'Antigravity login failed: sign in to Antigravity on the Runner',
    );
  });

  test('step-env injects GEMINI_API_KEY and a Cairn HOME when antigravityToken is present and omits the key for host keyring', () => {
    const cairnHome = tempDir('agy-cairn-');
    const cleanups: (() => void | Promise<void>)[] = [];
    const credsWithToken = pushCredential(
      {
        provider: null,
        antigravityToken: 'ag-secret-token-1234',
        secrets: {},
        git: null,
      } as never,
      null,
    );
    expect(credsWithToken.antigravityToken).toBe('ag-secret-token-1234');
    const withToken = prepareStepEnv(
      {
        inherited: { GEMINI_API_KEY: 'stale-key' },
        git: null,
        readonlyGit: false,
        runtimeId: 'antigravity',
        agentConfig: { cairnHome, realHome: cairnHome },
        claudeSubscriptionToken: undefined,
        antigravityToken: credsWithToken.antigravityToken,
      },
      cleanups,
    );
    expect('error' in withToken).toBe(false);
    if (!('error' in withToken)) {
      expect(withToken.env.GEMINI_API_KEY).toBe('ag-secret-token-1234');
      expect(withToken.env.GEMINI_HOME).toBeUndefined();
      expect(existsSync(withToken.env.HOME ?? '')).toBe(true);
    }
    clearCredentials(credsWithToken);
    expect(credsWithToken.antigravityToken).toBeUndefined();
    for (const fn of cleanups) void fn();

    const hostOnly = prepareStepEnv(
      {
        inherited: { GEMINI_API_KEY: 'stale-key' },
        git: null,
        readonlyGit: false,
        runtimeId: 'antigravity',
        agentConfig: { cairnHome, realHome: cairnHome },
        claudeSubscriptionToken: undefined,
        antigravityToken: undefined,
      },
      [],
    );
    expect('error' in hostOnly).toBe(false);
    if (!('error' in hostOnly)) {
      expect(hostOnly.env.GEMINI_API_KEY).toBeUndefined();
      expect(hostOnly.env.GEMINI_HOME).toBeUndefined();
      expect(hostOnly.env.HOME?.startsWith(cairnHome)).toBe(true);
    }
  });

  test('step-preflight permits antigravity when either token or host auth is present across all step kinds', () => {
    expect(
      agentStepRefusal({
        stepKind: 'build',
        agentTools: undefined,
        runtimeId: 'antigravity',
        hasSubscriptionToken: false,
        hasAntigravityToken: false,
        hasAntigravityHostAuth: false,
      }),
    ).toBe(antigravitySubscriptionMissingMessage());

    for (const stepKind of [
      'chief',
      'review',
      'digest',
      'mail',
      'build',
      'session',
      'plan',
      'merge',
    ]) {
      expect(
        agentStepRefusal({
          stepKind,
          agentTools: undefined,
          runtimeId: 'antigravity',
          hasSubscriptionToken: false,
          hasAntigravityToken: false,
          hasAntigravityHostAuth: true,
        }),
      ).toBeNull();
      expect(
        agentStepRefusal({
          stepKind,
          agentTools: undefined,
          runtimeId: 'antigravity',
          hasSubscriptionToken: false,
          hasAntigravityToken: true,
          hasAntigravityHostAuth: false,
        }),
      ).toBeNull();
    }
  });

  test('step-env materializes disposable 0600 refresh-token OAuth profile with persistent session symlinks and deletes token on cleanup', () => {
    const cairnHome = tempDir('agy-oauth-cairn-');
    const realHome = tempDir('agy-oauth-real-');
    mkdirSync(join(realHome, '.gemini', 'antigravity-cli'), { recursive: true });
    writeFileSync(
      join(realHome, '.gemini', 'antigravity-cli', 'antigravity-oauth-token'),
      'host-should-not-be-linked',
    );
    const refreshToken = `1//0gDaemonPortable_${'d'.repeat(32)}`;
    const serialized = JSON.stringify({
      kind: 'oauth-personal',
      refreshToken,
      authMethod: 'consumer',
    });
    const creds = pushCredential(
      {
        provider: null,
        antigravityToken: serialized,
        secrets: {},
        git: null,
      } as never,
      null,
    );
    expect(creds.antigravityToken).toBe(serialized);

    const cleanups: (() => void | Promise<void>)[] = [];
    const prepared = prepareStepEnv(
      {
        inherited: { GEMINI_API_KEY: 'stale-key', AGY_CLI_FORCE_FILE_TOKEN_STORAGE: '0' },
        git: null,
        readonlyGit: false,
        runtimeId: 'antigravity',
        agentConfig: { cairnHome, realHome },
        claudeSubscriptionToken: undefined,
        antigravityToken: creds.antigravityToken,
      },
      cleanups,
    );
    expect('error' in prepared).toBe(false);
    if ('error' in prepared) return;

    const stepHome = prepared.env.HOME ?? '';
    expect(prepared.env.GEMINI_API_KEY).toBeUndefined();
    expect(prepared.env.AGY_CLI_FORCE_FILE_TOKEN_STORAGE).toBe('1');
    expect(prepared.env.CAIRN_ANTIGRAVITY_AUTH_MODE).toBe('oauth-personal');
    expect(stepHome.includes('credential-profiles')).toBe(true);

    const tokenPath = join(stepHome, '.gemini', 'antigravity-acp', 'antigravity-oauth-token');
    expect(statSync(tokenPath).mode & 0o777).toBe(0o600);
    const tokenJson = JSON.parse(readFileSync(tokenPath, 'utf8')) as {
      token: { refresh_token: string; access_token: string };
      auth_method: string;
      id_token_email?: unknown;
    };
    expect(tokenJson.token.refresh_token).toBe(refreshToken);
    expect(tokenJson.token.access_token).toBe('');
    expect(tokenJson.auth_method).toBe('consumer');
    expect(tokenJson.id_token_email).toBeUndefined();

    const convLink = join(stepHome, '.gemini', 'antigravity-acp', 'conversations');
    expect(lstatSync(convLink).isSymbolicLink()).toBe(true);
    const sharedConvDir = join(
      cairnHome,
      'homes',
      'antigravity-oauth',
      '.gemini',
      'antigravity-acp',
      'conversations',
    );
    writeFileSync(join(convLink, 'sess-1.pb'), 'trajectory');
    expect(existsSync(join(sharedConvDir, 'sess-1.pb'))).toBe(true);
    expect(existsSync(join(stepHome, 'Library', 'Keychains'))).toBe(false);

    clearCredentials(creds);
    expect(creds.antigravityToken).toBeUndefined();
    for (const fn of [...cleanups].reverse()) void fn();
    expect(existsSync(tokenPath)).toBe(false);
    expect(existsSync(stepHome)).toBe(false);
    expect(existsSync(join(sharedConvDir, 'sess-1.pb'))).toBe(true);
  });

  test('fails fast when Antigravity falls back to interactive browser auth on stderr without leaking the OAuth URL', async () => {
    const dir = tempDir('ag-interactive-fallback-');
    const agent = join(dir, 'agy-interactive.sh');
    writeFileSync(
      agent,
      shellNodeScript(
        [
          "import { createInterface } from 'node:readline';",
          'const send = (obj) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...obj }) + "\\n");',
          'for await (const line of createInterface({ input: process.stdin })) {',
          '  const msg = JSON.parse(line);',
          '  if (msg.method === "initialize") {',
          '    send({ id: msg.id, result: { protocolVersion: msg.params.protocolVersion, agentCapabilities: {} } });',
          '  } else if (msg.method === "session/new") {',
          '    process.stderr.write("Open the following link to authenticate the ACP server: https://accounts.google.com/o/oauth2/auth?state=secret-state\\n");',
          '  }',
          '}',
        ].join('\n'),
      ),
    );
    chmodSync(agent, 0o755);

    const backend = createAcpBackend({
      harness: 'antigravity',
      command: agent,
      permissions: 'allow-once',
      allowHostMcp: true,
    });
    const err = await backend
      .createSession({
        cwd: dir,
        provider: { kind: 'api_key', providerId: 'antigravity' },
        modelId: 'gemini-4-carbon',
        prompt: 'hi',
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('Antigravity OAuth login expired or revoked');
    expect((err as Error).message).not.toContain('secret-state');
  });

  test('restricted antigravity turn compacts oversized tools into the prompt and allows tool_search and call_tool through the gate', async () => {
    const dir = tempDir('ag-compactor-gate-');
    const agent = join(dir, 'agy-compactor.sh');
    writeFileSync(
      agent,
      shellNodeScript(
        [
          "import { spawn } from 'node:child_process';",
          "import { createInterface } from 'node:readline';",
          'const send = (obj) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...obj }) + "\\n");',
          'const gateWaiters = new Map();',
          'let cairnServer = null;',
          'async function withCairnMcp(fn) {',
          '  const child = spawn(cairnServer.command, cairnServer.args, { stdio: ["pipe", "pipe", "pipe"] });',
          '  const waiters = new Map();',
          '  const responses = new Map();',
          '  createInterface({ input: child.stdout }).on("line", (line) => {',
          '    if (!line.trim()) return;',
          '    const msg = JSON.parse(line);',
          '    const waiter = waiters.get(msg.id);',
          '    if (waiter) { waiters.delete(msg.id); waiter(msg); } else { responses.set(msg.id, msg); }',
          '  });',
          '  let nextId = 1;',
          '  const rpc = (method, params = {}) => {',
          '    const id = nextId++;',
          '    const wait = new Promise((resolve) => {',
          '      if (responses.has(id)) { const r = responses.get(id); responses.delete(id); resolve(r); return; }',
          '      waiters.set(id, resolve);',
          '    });',
          '    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\\n");',
          '    return wait;',
          '  };',
          '  try {',
          '    await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "mock", version: "1" } });',
          '    return await fn(rpc);',
          '  } finally {',
          '    child.stdin.end();',
          '    child.kill("SIGTERM");',
          '  }',
          '}',
          'for await (const line of createInterface({ input: process.stdin })) {',
          '  const msg = JSON.parse(line);',
          '  if (msg.method === undefined && gateWaiters.has(msg.id)) {',
          '    gateWaiters.get(msg.id)(msg.result);',
          '    gateWaiters.delete(msg.id);',
          '    continue;',
          '  }',
          '  if (msg.method === "initialize") {',
          '    send({ id: msg.id, result: { protocolVersion: msg.params.protocolVersion, agentCapabilities: {} } });',
          '  } else if (msg.method === "session/new") {',
          '    cairnServer = (msg.params.mcpServers ?? []).find((s) => s.name === "cairn") ?? null;',
          '    globalThis.__sysAppend = msg.params._meta?.antigravity?.systemPrompt?.append ?? "";',
          '    send({ id: msg.id, result: { sessionId: "ag-compact", modes: { currentModeId: "default", availableModes: [{ id: "default", name: "Default" }] }, configOptions: [{ id: "model", name: "Model", category: "model", type: "select", currentValue: "gemini-4-carbon", options: [{ value: "gemini-4-carbon", name: "Gemini 4 Carbon" }] }] } });',
          '  } else if (msg.method === "session/set_config_option") {',
          '    send({ id: msg.id, result: { configOptions: [] } });',
          '  } else if (msg.method === "session/prompt") {',
          '    void (async () => {',
          '      const promptText = msg.params.prompt.find((b) => b.type === "text")?.text ?? "";',
          '      const reqPerm = (reqId, toolCall) => new Promise((resolve) => {',
          '        gateWaiters.set(reqId, resolve);',
          '        send({ id: reqId, method: "session/request_permission", params: { sessionId: "ag-compact", toolCall, options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }, { optionId: "deny", name: "Deny", kind: "reject_once" }] } });',
          '      });',
          '      const pSearch = await reqPerm("p1", { toolCallId: "t1", title: "mcp_cairn_tool_search", kind: "other" });',
          '      const pCall = await reqPerm("p2", { toolCallId: "t2", title: "mcp_cairn_call_tool", kind: "other" });',
          '      const pDirectDeferred = await reqPerm("p3", { toolCallId: "t3", title: "mcp_cairn_machines", kind: "other" });',
          '      const pRead = await reqPerm("p4", { toolCallId: "t4", title: "Read", kind: "read" });',
          '      const mcpReport = await withCairnMcp(async (rpc) => {',
          '        const list = await rpc("tools/list");',
          '        const searchRes = await rpc("tools/call", { name: "tool_search", arguments: { query: "machines" } });',
          '        const callRes = await rpc("tools/call", { name: "call_tool", arguments: { name: "machines", arguments: {} } });',
          '        return {',
          '          listedNames: list.result.tools.map((t) => t.name),',
          '          maxBytes: Math.max(...list.result.tools.map((t) => Buffer.byteLength(JSON.stringify({ name: t.name, description: t.description, inputSchema: t.inputSchema }), "utf8"))),',
          '          searchText: searchRes.result?.content?.[0]?.text ?? JSON.stringify(searchRes.error ?? null),',
          '          callText: callRes.result?.content?.[0]?.text ?? JSON.stringify(callRes.error ?? null),',
          '        };',
          '      });',
          '      const summary = {',
          '        promptText,',
          '        systemPromptAppendix: globalThis.__sysAppend,',
          '        permissions: {',
          '          search: pSearch.outcome.optionId,',
          '          call: pCall.outcome.optionId,',
          '          directDeferred: pDirectDeferred.outcome.optionId,',
          '          read: pRead.outcome.optionId,',
          '        },',
          '        mcpReport,',
          '      };',
          '      send({ method: "session/update", params: { sessionId: "ag-compact", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: JSON.stringify(summary) } } } });',
          '      send({ id: msg.id, result: { stopReason: "end_turn" } });',
          '    })();',
          '  }',
          '}',
        ].join('\n'),
      ),
    );
    chmodSync(agent, 0o755);

    const createTodoDef = CHIEF_REMOTE_TOOLS.find((tool) => tool.name === 'create_todo');
    const machinesDef = CHIEF_REMOTE_TOOLS.find((tool) => tool.name === 'machines');
    expect(createTodoDef).toBeDefined();
    expect(machinesDef).toBeDefined();
    const remoteTools: RemoteToolDef[] = [
      createTodoDef as RemoteToolDef,
      { ...(machinesDef as RemoteToolDef), deferred: true },
    ];
    const executed: Array<{ name: string; params: Record<string, unknown> }> = [];

    const backend = createAcpBackend({
      harness: 'antigravity',
      command: agent,
      permissions: 'allow-once',
      allowHostMcp: true,
    });
    const session = await backend.createSession({
      cwd: dir,
      provider: { kind: 'api_key', providerId: 'antigravity' },
      modelId: 'gemini-4-carbon',
      systemPrompt: 'Base system instructions.',
      prompt: 'Inspect machines and create a todo.',
      remoteTools,
      remoteToolsOnly: true,
      lockedDown: true,
      executeRemoteTool: async (name, params) => {
        executed.push({ name, params });
        return `executed:${name}`;
      },
    });
    const events = await collect(session.events);
    const final = events.find((event) => event.type === 'message_end');
    expect(final?.type).toBe('message_end');
    const summary = JSON.parse(
      final?.type === 'message_end' ? String(final.message.content) : '{}',
    ) as {
      promptText: string;
      systemPromptAppendix: string;
      permissions: Record<string, string>;
      mcpReport: {
        listedNames: string[];
        maxBytes: number;
        searchText: string;
        callText: string;
      };
    };

    expect(summary.permissions).toEqual({
      search: 'allow',
      call: 'allow',
      directDeferred: 'deny',
      read: 'deny',
    });
    expect(summary.mcpReport.listedNames).toEqual(['create_todo', 'tool_search', 'call_tool']);
    expect(summary.mcpReport.maxBytes).toBeLessThanOrEqual(950);
    expect(summary.mcpReport.searchText).toContain('## machines');
    expect(summary.mcpReport.callText).toBe('executed:machines');
    expect(executed).toEqual([{ name: 'machines', params: {} }]);
    expect(summary.systemPromptAppendix).toContain('Base system instructions.');
    expect(summary.systemPromptAppendix).toContain('## Cairn Tool Reference');
    expect(summary.systemPromptAppendix).toContain('### create_todo');
    expect(summary.systemPromptAppendix).toContain((createTodoDef as RemoteToolDef).description);
    expect(summary.promptText).toBe('Inspect machines and create a todo.');
  });

  test('relay-only writes toolPermission strict into isolated antigravity settings and normal mode clears it', async () => {
    const dir = tempDir('ag-tool-perm-');
    const isolatedHome = tempDir('ag-isolated-home-');
    const settingsDir = join(isolatedHome, '.gemini', 'antigravity-acp');
    const settingsPath = join(settingsDir, 'settings.json');
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify({ auth: { type: 'oauth-personal' }, gcp: { project: 'demo-proj' } }),
    );

    const agent = writeModeMock(dir, 'agy-perm', {
      currentModeId: 'default',
      availableModes: [
        { id: 'default', name: 'Default' },
        { id: 'auto', name: 'Auto' },
      ],
    });
    const backend = createAcpBackend({
      harness: 'antigravity',
      command: agent,
      permissions: 'allow-once',
      allowHostMcp: true,
    });

    const lockedSession = await backend.createSession({
      cwd: dir,
      env: { HOME: isolatedHome },
      provider: { kind: 'api_key', providerId: 'antigravity' },
      modelId: 'gemini-4-carbon',
      prompt: 'hi',
      remoteToolsOnly: true,
      lockedDown: true,
    });
    await collect(lockedSession.events);

    expect(JSON.parse(readFileSync(settingsPath, 'utf8'))).toEqual({
      auth: { type: 'oauth-personal' },
      gcp: { project: 'demo-proj' },
      toolPermission: 'strict',
    });

    const normalSession = await backend.createSession({
      cwd: dir,
      env: { HOME: isolatedHome },
      provider: { kind: 'api_key', providerId: 'antigravity' },
      modelId: 'gemini-4-carbon',
      prompt: 'hi',
    });
    await collect(normalSession.events);

    expect(JSON.parse(readFileSync(settingsPath, 'utf8'))).toEqual({
      auth: { type: 'oauth-personal' },
      gcp: { project: 'demo-proj' },
    });
  });

  test('installs PreToolUse hook in cwd/.agents/hooks.json for locked Antigravity turns, restores prior file on finish, and allows mcp_cairn_* while denying built-ins', async () => {
    const dir = tempDir('ag-hooks-guard-');
    const agentsDir = join(dir, '.agents');
    const hooksPath = join(agentsDir, 'hooks.json');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(hooksPath, JSON.stringify({ userHook: { PostToolUse: [] } }));

    let seenHooksDuringSession: Record<string, unknown> | null = null;
    const agent = join(dir, 'agy-hook-check.sh');
    writeFileSync(
      agent,
      shellNodeScript(
        [
          "import { createInterface } from 'node:readline';",
          "import { existsSync, readFileSync } from 'node:fs';",
          `import { join } from 'node:path';`,
          'const send = (obj) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...obj }) + "\\n");',
          'for await (const line of createInterface({ input: process.stdin })) {',
          '  const msg = JSON.parse(line);',
          '  if (msg.method === "initialize") {',
          '    send({ id: msg.id, result: { protocolVersion: msg.params.protocolVersion, agentCapabilities: {} } });',
          '  } else if (msg.method === "session/new") {',
          `    const raw = existsSync(${JSON.stringify(hooksPath)}) ? readFileSync(${JSON.stringify(hooksPath)}, "utf8") : "{}";`,
          '    send({ id: msg.id, result: { sessionId: "ag-hook", modes: { currentModeId: "default", availableModes: [{ id: "default", name: "Default" }] }, configOptions: [{ id: "model", name: "Model", category: "model", type: "select", currentValue: "gemini-4-hydrogen", options: [{ value: "gemini-4-hydrogen", name: "Gemini 4 Hydrogen" }] }] } });',
          '  } else if (msg.method === "session/set_config_option") {',
          '    send({ id: msg.id, result: { configOptions: [] } });',
          '  } else if (msg.method === "session/prompt") {',
          `    const content = readFileSync(${JSON.stringify(hooksPath)}, "utf8");`,
          '    send({ method: "session/update", params: { sessionId: "ag-hook", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: content } } } });',
          '    send({ id: msg.id, result: { stopReason: "end_turn" } });',
          '  }',
          '}',
        ].join('\n'),
      ),
    );
    chmodSync(agent, 0o755);

    const backend = createAcpBackend({
      harness: 'antigravity',
      command: agent,
      permissions: 'allow-once',
      allowHostMcp: true,
    });
    const session = await backend.createSession({
      cwd: dir,
      provider: { kind: 'api_key', providerId: 'antigravity' },
      modelId: 'gemini-4-hydrogen',
      prompt: 'test',
      remoteTools: [{ name: 'todos', description: 'List todos' }],
      remoteToolsOnly: true,
      lockedDown: true,
      executeRemoteTool: async () => '[]',
    });
    const events = await collect(session.events);
    const final = events.find((e) => e.type === 'message_end');
    seenHooksDuringSession =
      final?.type === 'message_end'
        ? (JSON.parse(String(final.message.content)) as Record<string, unknown>)
        : null;

    expect(seenHooksDuringSession).toMatchObject({
      userHook: { PostToolUse: [] },
      'cairn-relay-guard': {
        PreToolUse: [
          {
            matcher: '.*',
            hooks: [{ type: 'command', command: expect.any(String) }],
          },
        ],
      },
    });
    if (!seenHooksDuringSession) throw new Error('Missing hooks snapshot');
    const guardCommand = (
      seenHooksDuringSession['cairn-relay-guard'] as {
        PreToolUse: Array<{ hooks: Array<{ command: string }> }>;
      }
    ).PreToolUse[0]!.hooks[0]!.command;

    const runHook = (toolName: string, args: Record<string, unknown> = {}) =>
      JSON.parse(
        execFileSync('/bin/sh', ['-c', guardCommand], {
          input: JSON.stringify({
            hookEventName: 'PreToolUse',
            toolCall: { name: toolName, args },
          }),
          encoding: 'utf8',
        }),
      ) as { decision: string; reason?: string };

    expect(runHook('mcp_cairn_todos')).toEqual({ decision: 'allow' });
    expect(runHook('call_mcp_tool', { ServerName: 'cairn', ToolName: 'machines' })).toEqual({
      decision: 'allow',
    });
    expect(runHook('call_mcp_tool', { ServerName: 'other', ToolName: 'x' }).decision).toBe('deny');
    expect(runHook('read_file').decision).toBe('deny');
    expect(runHook('run_command').decision).toBe('deny');
    expect(JSON.parse(readFileSync(hooksPath, 'utf8'))).toEqual({ userHook: { PostToolUse: [] } });
  });

  test('recovers once when Antigravity returns empty end_turn after an ACP permission rejection', async () => {
    const dir = tempDir('ag-reject-recover-');
    const agent = join(dir, 'agy-recover.sh');
    writeFileSync(
      agent,
      shellNodeScript(
        [
          "import { createInterface } from 'node:readline';",
          'const send = (obj) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...obj }) + "\\n");',
          'const gateWaiters = new Map();',
          'let promptCount = 0;',
          'for await (const line of createInterface({ input: process.stdin })) {',
          '  const msg = JSON.parse(line);',
          '  if (msg.method === undefined && gateWaiters.has(msg.id)) {',
          '    gateWaiters.get(msg.id)(msg.result);',
          '    gateWaiters.delete(msg.id);',
          '    continue;',
          '  }',
          '  if (msg.method === "initialize") {',
          '    send({ id: msg.id, result: { protocolVersion: msg.params.protocolVersion, agentCapabilities: {} } });',
          '  } else if (msg.method === "session/new") {',
          '    send({ id: msg.id, result: { sessionId: "ag-rec", modes: { currentModeId: "default", availableModes: [{ id: "default", name: "Default" }] }, configOptions: [{ id: "model", name: "Model", category: "model", type: "select", currentValue: "gemini-4-hydrogen", options: [{ value: "gemini-4-hydrogen", name: "Gemini 4 Hydrogen" }] }] } });',
          '  } else if (msg.method === "session/set_config_option") {',
          '    send({ id: msg.id, result: { configOptions: [] } });',
          '  } else if (msg.method === "session/prompt") {',
          '    promptCount += 1;',
          '    if (promptCount === 1) {',
          '      void (async () => {',
          '        await new Promise((resolve) => {',
          '          gateWaiters.set("p-cmd", resolve);',
          '          send({ id: "p-cmd", method: "session/request_permission", params: { sessionId: "ag-rec", toolCall: { toolCallId: "t1", title: "run_command", kind: "execute" }, options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }, { optionId: "deny", name: "Deny", kind: "reject_once" }] } });',
          '        });',
          '        send({ id: msg.id, result: { stopReason: "end_turn" } });',
          '      })();',
          '    } else {',
          '      send({ method: "session/update", params: { sessionId: "ag-rec", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Recovered reply without blocked tool." } } } });',
          '      send({ id: msg.id, result: { stopReason: "end_turn" } });',
          '    }',
          '  }',
          '}',
        ].join('\n'),
      ),
    );
    chmodSync(agent, 0o755);

    const backend = createAcpBackend({
      harness: 'antigravity',
      command: agent,
      permissions: 'allow-once',
      allowHostMcp: true,
    });
    const session = await backend.createSession({
      cwd: dir,
      provider: { kind: 'api_key', providerId: 'antigravity' },
      modelId: 'gemini-4-hydrogen',
      prompt: 'Check hostname',
      remoteTools: [{ name: 'todos', description: 'List todos' }],
      remoteToolsOnly: true,
      lockedDown: true,
      executeRemoteTool: async () => '[]',
    });
    const events = await collect(session.events);
    expect(events).toContainEqual({
      type: 'message_end',
      message: { role: 'assistant', content: 'Recovered reply without blocked tool.' },
    });
    expect(events.at(-1)).toEqual({ type: 'done', usage: [] });
  });

  test('passes --include-default-customizations=false, uses _meta.systemPrompt on new only, defaults Coordinator thought_level to medium, and records result.usage', async () => {
    const dir = tempDir('ag-meta-cache-');
    const agent = join(dir, 'agy-meta.sh');
    writeFileSync(
      agent,
      shellNodeScript(
        [
          "import { createInterface } from 'node:readline';",
          'const send = (obj) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...obj }) + "\\n");',
          'const spawnArgs = process.argv.slice(2);',
          'let metaPrompt = null;',
          'let selectedThought = null;',
          'for await (const line of createInterface({ input: process.stdin })) {',
          '  const msg = JSON.parse(line);',
          '  if (msg.method === "initialize") {',
          '    send({ id: msg.id, result: { protocolVersion: msg.params.protocolVersion, agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} } } } });',
          '  } else if (msg.method === "session/new") {',
          '    metaPrompt = msg.params._meta?.antigravity?.systemPrompt?.append ?? null;',
          '    send({ id: msg.id, result: { sessionId: "ag-meta-1", modes: { currentModeId: "default", availableModes: [{ id: "default", name: "Default" }] }, configOptions: [{ id: "model", name: "Model", category: "model", type: "select", currentValue: "gemini-4-hydrogen", options: [{ value: "gemini-4-hydrogen", name: "Gemini 4 Hydrogen" }] }, { id: "thought_level", name: "Thinking Level", category: "thought_level", type: "select", currentValue: "high", options: [{ value: "low", name: "Low" }, { value: "medium", name: "Medium" }, { value: "high", name: "High" }] }] } });',
          '  } else if (msg.method === "session/resume") {',
          '    metaPrompt = msg.params._meta?.antigravity?.systemPrompt?.append ?? null;',
          '    send({ id: msg.id, result: { sessionId: msg.params.sessionId, modes: { currentModeId: "default", availableModes: [{ id: "default", name: "Default" }] }, configOptions: [{ id: "model", name: "Model", category: "model", type: "select", currentValue: "gemini-4-hydrogen", options: [{ value: "gemini-4-hydrogen", name: "Gemini 4 Hydrogen" }] }, { id: "thought_level", name: "Thinking Level", category: "thought_level", type: "select", currentValue: "high", options: [{ value: "low", name: "Low" }, { value: "medium", name: "Medium" }, { value: "high", name: "High" }] }] } });',
          '  } else if (msg.method === "session/set_config_option") {',
          '    if (msg.params.configId === "thought_level") selectedThought = msg.params.value;',
          '    send({ id: msg.id, result: { configOptions: [{ id: "thought_level", name: "Thinking Level", category: "thought_level", type: "select", currentValue: selectedThought ?? "high", options: [{ value: "low", name: "Low" }, { value: "medium", name: "Medium" }, { value: "high", name: "High" }] }] } });',
          '  } else if (msg.method === "session/prompt") {',
          '    const promptText = msg.params.prompt.find((b) => b.type === "text")?.text ?? "";',
          '    send({ method: "session/update", params: { sessionId: msg.params.sessionId, update: { sessionUpdate: "usage_update", used: 11200, size: 1048576 } } });',
          '    send({ method: "session/update", params: { sessionId: msg.params.sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: JSON.stringify({ spawnArgs, metaPrompt, selectedThought, promptText }) } } } });',
          '    send({ id: msg.id, result: { stopReason: "end_turn", usage: { inputTokens: 2500, outputTokens: 120, cachedReadTokens: 8700, cachedWriteTokens: 0, thoughtTokens: 40, totalTokens: 11320 } } });',
          '  }',
          '}',
        ].join('\n'),
      ),
    );
    chmodSync(agent, 0o755);

    const backend = createAcpBackend({
      harness: 'antigravity',
      command: agent,
      args: [...ANTIGRAVITY_ACP_ARGS],
      permissions: 'allow-once',
      allowHostMcp: true,
      sessionResume: true,
      usageEvents: true,
    });
    const s1 = await backend.createSession({
      cwd: dir,
      provider: { kind: 'api_key', providerId: 'antigravity' },
      modelId: 'gemini-4-hydrogen',
      systemPrompt: 'COORDINATOR_SYS_PROMPT',
      prompt: 'Turn 1 question',
      compactAt: 150_000,
    });
    const ev1 = await collect(s1.events);
    const msg1 = ev1.find((e) => e.type === 'message_end');
    const p1 = JSON.parse(msg1?.type === 'message_end' ? String(msg1.message.content) : '{}') as {
      spawnArgs: string[];
      metaPrompt: string | null;
      selectedThought: string | null;
      promptText: string;
    };
    expect(p1.spawnArgs).toContain('--include-default-customizations=false');
    expect(p1.metaPrompt).toContain('COORDINATOR_SYS_PROMPT');
    expect(p1.promptText).toBe('Turn 1 question');
    expect(p1.selectedThought).toBe('medium');
    expect(ev1.at(-1)).toEqual({
      type: 'done',
      usage: [
        {
          model: 'gemini-4-hydrogen',
          input: 2500,
          output: 120,
          cacheRead: 8700,
          cacheWrite: 0,
          contextTokens: 11200,
          contextWindow: 1048576,
          compactAt: 150_000,
        },
      ],
    });

    const s2 = await backend.continueSession('ag-meta-1', {
      cwd: dir,
      provider: { kind: 'api_key', providerId: 'antigravity' },
      modelId: 'gemini-4-hydrogen',
      systemPrompt: 'COORDINATOR_SYS_PROMPT',
      prompt: 'Turn 2 follow-up',
      compactAt: 150_000,
    });
    const ev2 = await collect(s2.events);
    const msg2 = ev2.find((e) => e.type === 'message_end');
    const p2 = JSON.parse(msg2?.type === 'message_end' ? String(msg2.message.content) : '{}') as {
      metaPrompt: string | null;
      promptText: string;
    };
    expect(p2.metaPrompt).toBeNull();
    expect(p2.promptText).toBe('Turn 2 follow-up');
  });

  test('resumed session after agent process restart keeps host tools callable when MCP client pipelines >256B discover with auth token', async () => {
    const dir = tempDir('ag-resume-mcp-coalesced-');
    const agent = join(dir, 'agy-resume-mcp.sh');
    writeFileSync(
      agent,
      shellNodeScript(
        [
          "import { spawn } from 'node:child_process';",
          "import { createConnection } from 'node:net';",
          "import { createInterface } from 'node:readline';",
          'const send = (obj) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...obj }) + "\\n");',
          'let cairnServer = null;',
          'let openedVia = "";',
          'let activeSid = "ag-mcp-sess-1";',
          'async function callTodosViaCoalescedTcp(server) {',
          '  const [portStr, token] = server.args.slice(-2);',
          '  const discover = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "server/discover", params: { _meta: { "io.modelcontextprotocol/clientCapabilities": { elicitation: { form: {}, url: {} }, roots: { listChanged: true } }, "io.modelcontextprotocol/clientInfo": { name: "antigravity-client", version: "v1.0.0" }, "io.modelcontextprotocol/protocolVersion": "2026-07-28" } } });',
          '  const init = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "antigravity-client", version: "v1.0.0" } } });',
          '  const list = JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} });',
          '  const call = JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "todos", arguments: {} } });',
          '  return new Promise((resolve, reject) => {',
          '    const sock = createConnection(Number(portStr), "127.0.0.1", () => {',
          '      sock.write(token + "\\n" + discover + "\\n" + init + "\\n" + list + "\\n" + call + "\\n");',
          '    });',
          '    const replies = [];',
          '    createInterface({ input: sock }).on("line", (line) => {',
          '      if (!line.trim()) return;',
          '      replies.push(JSON.parse(line));',
          '      if (replies.length === 4) { sock.destroy(); resolve(replies); }',
          '    });',
          '    sock.on("error", reject);',
          '    sock.on("close", () => { if (replies.length < 4) reject(new Error("MCP socket closed early")); });',
          '  });',
          '}',
          'async function callTodosViaRelay(server) {',
          '  const child = spawn(server.command, server.args, { stdio: ["pipe", "pipe", "pipe"] });',
          '  const waiters = new Map();',
          '  createInterface({ input: child.stdout }).on("line", (line) => {',
          '    if (!line.trim()) return;',
          '    const msg = JSON.parse(line);',
          '    const w = waiters.get(msg.id);',
          '    if (w) { waiters.delete(msg.id); w(msg); }',
          '  });',
          '  let nextId = 1;',
          '  const rpc = (method, params = {}) => new Promise((resolve) => {',
          '    const id = nextId++;',
          '    waiters.set(id, resolve);',
          '    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\\n");',
          '  });',
          '  try {',
          '    await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "mock", version: "1" } });',
          '    const list = await rpc("tools/list");',
          '    const call = await rpc("tools/call", { name: "todos", arguments: {} });',
          '    return { listed: list.result.tools.map((t) => t.name), text: call.result.content[0].text };',
          '  } finally {',
          '    child.stdin.end();',
          '    child.kill("SIGTERM");',
          '  }',
          '}',
          'for await (const line of createInterface({ input: process.stdin })) {',
          '  const msg = JSON.parse(line);',
          '  if (msg.method === "initialize") {',
          '    send({ id: msg.id, result: { protocolVersion: msg.params.protocolVersion, agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} } } } });',
          '  } else if (msg.method === "session/new" || msg.method === "session/resume") {',
          '    openedVia = msg.method;',
          '    activeSid = msg.params.sessionId ?? activeSid;',
          '    cairnServer = (msg.params.mcpServers ?? []).find((s) => s.name === "cairn") ?? null;',
          '    if (msg.method === "session/resume" && cairnServer) {',
          '      try {',
          '        const replies = await callTodosViaCoalescedTcp(cairnServer);',
          '        globalThis.__resumeMcp = { listed: replies.find((r) => r.id === 3).result.tools.map((t) => t.name), text: replies.find((r) => r.id === 4).result.content[0].text };',
          '      } catch (e) {',
          '        globalThis.__resumeMcp = { error: e.message };',
          '      }',
          '    }',
          '    send({ id: msg.id, result: { sessionId: activeSid, modes: { currentModeId: "default", availableModes: [{ id: "default", name: "Default" }] }, configOptions: [{ id: "model", name: "Model", category: "model", type: "select", currentValue: "gemini-4-hydrogen", options: [{ value: "gemini-4-hydrogen", name: "Gemini 4 Hydrogen" }] }] } });',
          '  } else if (msg.method === "session/set_config_option") {',
          '    send({ id: msg.id, result: { configOptions: [] } });',
          '  } else if (msg.method === "session/prompt") {',
          '    const report = openedVia === "session/resume" ? globalThis.__resumeMcp : await callTodosViaRelay(cairnServer);',
          '    send({ method: "session/update", params: { sessionId: activeSid, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: JSON.stringify({ openedVia, report }) } } } });',
          '    send({ id: msg.id, result: { stopReason: "end_turn" } });',
          '  }',
          '}',
        ].join('\n'),
      ),
    );
    chmodSync(agent, 0o755);

    const executed: string[] = [];
    const backend = createAcpBackend({
      harness: 'antigravity',
      command: agent,
      permissions: 'allow-once',
      allowHostMcp: true,
      sessionResume: true,
    });
    const baseOpts: SessionOpts = {
      cwd: dir,
      provider: { kind: 'api_key', providerId: 'antigravity' },
      modelId: 'gemini-4-hydrogen',
      remoteTools: [{ name: 'todos', description: 'List todos' }],
      remoteToolsOnly: true,
      lockedDown: true,
      executeRemoteTool: async (name) => {
        executed.push(name);
        return `ok:${executed.length}`;
      },
    };

    const s1 = await backend.createSession({ ...baseOpts, prompt: 'turn 1' });
    const ev1 = await collect(s1.events);
    const m1 = ev1.find((e) => e.type === 'message_end');
    expect(JSON.parse(m1?.type === 'message_end' ? String(m1.message.content) : '{}')).toEqual({
      openedVia: 'session/new',
      report: { listed: ['todos'], text: 'ok:1' },
    });

    const s2 = await backend.continueSession(s1.sessionId, { ...baseOpts, prompt: 'turn 2' });
    const ev2 = await collect(s2.events);
    const m2 = ev2.find((e) => e.type === 'message_end');
    expect(JSON.parse(m2?.type === 'message_end' ? String(m2.message.content) : '{}')).toEqual({
      openedVia: 'session/resume',
      report: { listed: ['todos'], text: 'ok:2' },
    });
    expect(executed).toEqual(['todos', 'todos']);
  });

  test('resumed Antigravity session keeps resume when MCP tools attach lazily during session/prompt', async () => {
    const dir = tempDir('ag-resume-lazy-mcp-');
    const agent = join(dir, 'agy-lazy-resume.sh');
    writeFileSync(
      agent,
      shellNodeScript(
        [
          "import { createConnection } from 'node:net';",
          "import { createInterface } from 'node:readline';",
          'const send = (obj) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...obj }) + "\\n");',
          'let cairnServer = null;',
          'const openedMethods = [];',
          'async function callTodosViaCoalescedTcp(server) {',
          '  const [portStr, token] = server.args.slice(-2);',
          '  const discover = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "server/discover", params: { _meta: { "io.modelcontextprotocol/clientCapabilities": {}, "io.modelcontextprotocol/clientInfo": { name: "antigravity-client", version: "v1.0.0" }, "io.modelcontextprotocol/protocolVersion": "2026-07-28" } } });',
          '  const init = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "antigravity-client", version: "v1.0.0" } } });',
          '  const list = JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} });',
          '  const call = JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "todos", arguments: {} } });',
          '  return new Promise((resolve, reject) => {',
          '    const sock = createConnection(Number(portStr), "127.0.0.1", () => {',
          '      sock.write(token + "\\n" + discover + "\\n" + init + "\\n" + list + "\\n" + call + "\\n");',
          '    });',
          '    const replies = [];',
          '    createInterface({ input: sock }).on("line", (line) => {',
          '      if (!line.trim()) return;',
          '      replies.push(JSON.parse(line));',
          '      if (replies.length === 4) { sock.destroy(); resolve(replies); }',
          '    });',
          '    sock.on("error", reject);',
          '    sock.on("close", () => { if (replies.length < 4) reject(new Error("MCP socket closed early")); });',
          '  });',
          '}',
          'for await (const line of createInterface({ input: process.stdin })) {',
          '  const msg = JSON.parse(line);',
          '  if (msg.method === "initialize") {',
          '    send({ id: msg.id, result: { protocolVersion: msg.params.protocolVersion, agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} } } } });',
          '  } else if (msg.method === "session/resume" || msg.method === "session/load") {',
          '    openedMethods.push(msg.method);',
          '    cairnServer = (msg.params.mcpServers ?? []).find((s) => s.name === "cairn") ?? null;',
          '    send({ id: msg.id, result: { sessionId: msg.params.sessionId, configOptions: [{ id: "model", name: "Model", category: "model", type: "select", currentValue: "gemini-4-hydrogen", options: [{ value: "gemini-4-hydrogen", name: "Gemini 4 Hydrogen" }] }] } });',
          '  } else if (msg.method === "session/set_config_option") {',
          '    send({ id: msg.id, result: { configOptions: [] } });',
          '  } else if (msg.method === "session/prompt") {',
          '    const replies = await callTodosViaCoalescedTcp(cairnServer);',
          '    const payload = { openedMethods, listed: replies.find((r) => r.id === 3).result.tools.map((t) => t.name), text: replies.find((r) => r.id === 4).result.content[0].text };',
          '    send({ method: "session/update", params: { sessionId: msg.params.sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: JSON.stringify(payload) } } } });',
          '    send({ id: msg.id, result: { stopReason: "end_turn" } });',
          '  }',
          '}',
        ].join('\n'),
      ),
    );
    chmodSync(agent, 0o755);

    const backend = createAcpBackend({
      harness: 'antigravity',
      command: agent,
      permissions: 'allow-once',
      allowHostMcp: true,
      sessionResume: true,
    });
    const session = await backend.continueSession('lazy-sess-1', {
      cwd: dir,
      provider: { kind: 'api_key', providerId: 'antigravity' },
      modelId: 'gemini-4-hydrogen',
      prompt: '列出我的待办',
      remoteTools: [{ name: 'todos', description: 'List todos' }],
      remoteToolsOnly: true,
      lockedDown: true,
      executeRemoteTool: async () => 'lazy-todo-ok',
    });
    const events = await collect(session.events);
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(events).toContainEqual({ type: 'done', usage: [] });
    const msg = events.find((e) => e.type === 'message_end');
    expect(JSON.parse(msg?.type === 'message_end' ? String(msg.message.content) : '{}')).toEqual({
      openedMethods: ['session/resume'],
      listed: ['todos'],
      text: 'lazy-todo-ok',
    });
  });

  test('resumed Antigravity session surfaces clear error when host tools never attach and call fails with unknown tool', async () => {
    const dir = tempDir('ag-resume-nomcp-err-');
    const agent = join(dir, 'agy-nomcp-resume.sh');
    writeFileSync(
      agent,
      shellNodeScript(
        [
          "import { createInterface } from 'node:readline';",
          'const send = (obj) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...obj }) + "\\n");',
          'for await (const line of createInterface({ input: process.stdin })) {',
          '  const msg = JSON.parse(line);',
          '  if (msg.method === "initialize") {',
          '    send({ id: msg.id, result: { protocolVersion: msg.params.protocolVersion, agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} } } } });',
          '  } else if (msg.method === "session/resume") {',
          '    send({ id: msg.id, result: { sessionId: msg.params.sessionId, configOptions: [{ id: "model", name: "Model", category: "model", type: "select", currentValue: "gemini-4-hydrogen", options: [{ value: "gemini-4-hydrogen", name: "Gemini 4 Hydrogen" }] }] } });',
          '  } else if (msg.method === "session/set_config_option") {',
          '    send({ id: msg.id, result: { configOptions: [] } });',
          '  } else if (msg.method === "session/prompt") {',
          '    send({ method: "session/update", params: { sessionId: msg.params.sessionId, update: { sessionUpdate: "tool_call", toolCallId: "tc-1", title: "mcp_cairn_todos", kind: "other", rawInput: {}, status: "pending" } } });',
          '    send({ method: "session/update", params: { sessionId: msg.params.sessionId, update: { sessionUpdate: "tool_call_update", toolCallId: "tc-1", status: "failed", rawOutput: "unknown tool: \\"mcp_cairn_todos\\" — check spelling" } } });',
          '    send({ id: msg.id, result: { stopReason: "end_turn" } });',
          '  }',
          '}',
        ].join('\n'),
      ),
    );
    chmodSync(agent, 0o755);

    const backend = createAcpBackend({
      harness: 'antigravity',
      command: agent,
      permissions: 'allow-once',
      allowHostMcp: true,
      sessionResume: true,
    });
    const session = await backend.continueSession('old-sess', {
      cwd: dir,
      provider: { kind: 'api_key', providerId: 'antigravity' },
      modelId: 'gemini-4-hydrogen',
      prompt: '列出我的待办',
      remoteTools: [{ name: 'todos', description: 'List todos' }],
      remoteToolsOnly: true,
      lockedDown: true,
      executeRemoteTool: async () => '[]',
    });
    const events = await collect(session.events);
    expect(events.some((e) => e.type === 'done')).toBe(false);
    expect(events).toContainEqual({
      type: 'error',
      error: {
        message: expect.stringContaining(
          'Cairn host tools did not attach to this antigravity ACP session',
        ),
        retryable: false,
      },
    });
  });

  test('skips redundant session/set_config_option RPC when resumed session already uses target model', async () => {
    const dir = tempDir('ag-skip-set-config-');
    const agent = join(dir, 'agy-skip-config.sh');
    writeFileSync(
      agent,
      shellNodeScript(
        [
          "import { createInterface } from 'node:readline';",
          'const send = (obj) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...obj }) + "\\n");',
          'const methodsSeen = [];',
          'for await (const line of createInterface({ input: process.stdin })) {',
          '  const msg = JSON.parse(line);',
          '  methodsSeen.push(msg.method);',
          '  if (msg.method === "initialize") {',
          '    send({ id: msg.id, result: { protocolVersion: msg.params.protocolVersion, agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} } } } });',
          '  } else if (msg.method === "session/resume") {',
          '    send({ id: msg.id, result: { sessionId: msg.params.sessionId, configOptions: [{ id: "model", name: "Model", category: "model", type: "select", currentValue: "gemini-4-hydrogen", options: [{ value: "gemini-4-hydrogen", name: "Gemini 4 Hydrogen" }] }] } });',
          '  } else if (msg.method === "session/set_config_option") {',
          '    send({ id: msg.id, result: { configOptions: [] } });',
          '  } else if (msg.method === "session/prompt") {',
          '    send({ method: "session/update", params: { sessionId: msg.params.sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: JSON.stringify(methodsSeen) } } } });',
          '    send({ id: msg.id, result: { stopReason: "end_turn" } });',
          '  }',
          '}',
        ].join('\n'),
      ),
    );
    chmodSync(agent, 0o755);

    const learned: string[] = [];
    const backend = createAcpBackend({
      harness: 'antigravity',
      command: agent,
      permissions: 'allow-once',
      allowHostMcp: true,
      sessionResume: true,
      onAntigravityModels: (models) => learned.push(...models.map((m) => m.id)),
    });
    const session = await backend.continueSession('sess-existing', {
      cwd: dir,
      provider: { kind: 'api_key', providerId: 'antigravity' },
      modelId: 'gemini-4-hydrogen',
      prompt: '1+1',
    });
    const events = await collect(session.events);
    const msg = events.find((e) => e.type === 'message_end') as
      | { type: 'message_end'; message: { content: string } }
      | undefined;
    expect(JSON.parse(msg?.message.content ?? '[]')).not.toContain('session/set_config_option');
    expect(learned).toContain('gemini-4-hydrogen');
  });
});

describe('warm Antigravity Coordinator session pool', () => {
  function writeWarmMock(
    dir: string,
    logFile: string,
    opts: { sessionIdPrefix?: string } = {},
  ): string {
    const agent = join(dir, 'agy-warm-mock.sh');
    const prefix = opts.sessionIdPrefix ?? 'warm-sess';
    writeFileSync(
      agent,
      shellNodeScript(
        [
          "import { spawn } from 'node:child_process';",
          "import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';",
          "import { createInterface } from 'node:readline';",
          `const logFile = ${JSON.stringify(logFile)};`,
          'const record = (ev) => appendFileSync(logFile, JSON.stringify({ pid: process.pid, ...ev }) + "\\n");',
          'const send = (obj) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...obj }) + "\\n");',
          'record({ kind: "spawn", stepTree: process.env.CAIRN_STEP_TREE ?? null, tmpdir: process.env.TMPDIR ?? null });',
          'let mcpChild = null;',
          'let mcpRpc = null;',
          'let activeSid = null;',
          'let spawnSeq = Number(process.env.CAIRN_TEST_SEQ ?? 0);',
          'function connectMcp(server) {',
          '  if (!server || mcpChild) return;',
          '  mcpChild = spawn(server.command, server.args, { stdio: ["pipe", "pipe", "pipe"] });',
          '  const waiters = new Map();',
          '  createInterface({ input: mcpChild.stdout }).on("line", (line) => {',
          '    if (!line.trim()) return;',
          '    const msg = JSON.parse(line);',
          '    const w = waiters.get(msg.id);',
          '    if (w) { waiters.delete(msg.id); w(msg); }',
          '  });',
          '  let nextId = 1;',
          '  mcpRpc = (method, params = {}) => new Promise((resolve) => {',
          '    const id = nextId++;',
          '    waiters.set(id, resolve);',
          '    mcpChild.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\\n");',
          '  });',
          '}',
          'process.on("SIGTERM", () => {',
          '  record({ kind: "sigterm", sid: activeSid });',
          '  try { mcpChild?.kill("SIGTERM"); } catch {}',
          '  process.exit(0);',
          '});',
          'for await (const line of createInterface({ input: process.stdin })) {',
          '  const msg = JSON.parse(line);',
          '  if (msg.method === "initialize") {',
          '    send({ id: msg.id, result: { protocolVersion: msg.params.protocolVersion, agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} }, promptCapabilities: { image: false } } } });',
          '  } else if (msg.method === "session/new" || msg.method === "session/resume") {',
          `    activeSid = msg.params.sessionId ?? ${JSON.stringify(prefix)} + "-" + String(process.pid);`,
          '    record({ kind: msg.method, sid: activeSid });',
          '    const cairnSrv = (msg.params.mcpServers ?? []).find((s) => s.name === "cairn");',
          '    connectMcp(cairnSrv);',
          '    if (mcpRpc) await mcpRpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "mock", version: "1" } });',
          '    if (mcpRpc) await mcpRpc("tools/list");',
          '    send({ id: msg.id, result: { sessionId: activeSid, modes: { currentModeId: "default", availableModes: [{ id: "default", name: "Default" }, { id: "auto", name: "Auto" }] }, configOptions: [{ id: "model", name: "Model", category: "model", type: "select", currentValue: "gemini-4-hydrogen", options: [{ value: "gemini-4-hydrogen", name: "Gemini 4 Hydrogen" }, { value: "gemini-4-neon", name: "Gemini 4 Neon" }] }, { id: "thought_level", name: "Thinking", category: "thought_level", type: "select", currentValue: "medium", options: [{ value: "low", name: "Low" }, { value: "medium", name: "Medium" }, { value: "high", name: "High" }] }] } });',
          '  } else if (msg.method === "session/set_config_option" || msg.method === "session/set_mode") {',
          '    record({ kind: msg.method, value: msg.params.value ?? msg.params.modeId });',
          '    send({ id: msg.id, result: { configOptions: [] } });',
          '  } else if (msg.method === "session/prompt") {',
          '    const promptText = msg.params.prompt?.[0]?.text ?? "";',
          '    record({ kind: "prompt", sid: activeSid, text: promptText });',
          '    if (promptText.includes("CALL_TODOS") && mcpRpc) {',
          '      const res = await mcpRpc("tools/call", { name: "todos", arguments: { q: promptText } });',
          '      send({ method: "session/update", params: { sessionId: activeSid, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "tool:" + (res.result?.content?.[0]?.text ?? "") } } } });',
          '      send({ id: msg.id, result: { stopReason: "end_turn" } });',
          '    } else if (promptText.includes("STRAY_WHILE_PARKED") && mcpRpc) {',
          '      send({ method: "session/update", params: { sessionId: activeSid, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "done-before-stray" } } } });',
          '      send({ id: msg.id, result: { stopReason: "end_turn" } });',
          '      setTimeout(async () => {',
          '        const stray = await mcpRpc("tools/call", { name: "todos", arguments: {} });',
          '        record({ kind: "stray_call", isError: Boolean(stray.result?.isError), text: stray.result?.content?.[0]?.text ?? "" });',
          '      }, 60);',
          '    } else if (promptText.includes("LATE_NOTIFY_WHILE_PARKED")) {',
          '      send({ method: "session/update", params: { sessionId: activeSid, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "done-before-notify" } } } });',
          '      send({ id: msg.id, result: { stopReason: "end_turn" } });',
          '      setTimeout(() => {',
          '        send({ method: "session/update", params: { sessionId: activeSid, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "unsolicited" } } } });',
          '      }, 60);',
          '    } else if (promptText.includes("INFLIGHT_AT_END_TURN") && mcpRpc) {',
          '      const pendingCall = mcpRpc("tools/call", { name: "todos", arguments: { slow: true } });',
          '      setTimeout(() => {',
          '        send({ method: "session/update", params: { sessionId: activeSid, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "ended-early" } } } });',
          '        send({ id: msg.id, result: { stopReason: "end_turn" } });',
          '        void pendingCall;',
          '      }, 40);',
          '    } else if (promptText.includes("TRIGGER_AUTH_ERROR")) {',
          '      send({ id: msg.id, error: { code: -32000, message: "Authentication required" } });',
          '    } else if (promptText.includes("HANG_UNTIL_CANCEL")) {',
          '      record({ kind: "hanging" });',
          '    } else if (promptText.includes("EXIT_AFTER_DONE")) {',
          '      send({ method: "session/update", params: { sessionId: activeSid, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "bye-soon" } } } });',
          '      send({ id: msg.id, result: { stopReason: "end_turn" } });',
          '      setTimeout(() => process.exit(0), 60);',
          '    } else {',
          '      send({ method: "session/update", params: { sessionId: activeSid, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "ok:" + promptText + ":" + process.pid } } } });',
          '      send({ id: msg.id, result: { stopReason: "end_turn" } });',
          '    }',
          '  } else if (msg.method === "session/cancel") {',
          '    if (msg.id !== undefined) send({ id: msg.id, result: null });',
          '  }',
          '}',
        ].join('\n'),
      ),
    );
    chmodSync(agent, 0o755);
    return agent;
  }

  function readLog(logFile: string): Array<Record<string, unknown>> {
    if (!existsSync(logFile)) return [];
    return readFileSync(logFile, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  function baseChiefOpts(dir: string, overrides: Partial<SessionOpts> = {}): SessionOpts {
    return {
      cwd: dir,
      provider: { kind: 'api_key', providerId: 'antigravity' },
      modelId: 'gemini-4-hydrogen',
      compactAt: 150_000,
      lockedDown: true,
      remoteToolsOnly: true,
      systemPrompt: 'COORDINATOR_SYS',
      prompt: 'hi',
      remoteTools: [{ name: 'todos', description: 'List todos' }],
      executeRemoteTool: async () => '[]',
      ...overrides,
    };
  }

  test('reuses warm process across consecutive turns on same sessionId and rebinds Turn 2 host tool executor', async () => {
    const dir = tempDir('ag-warm-reuse-');
    const logFile = join(dir, 'events.jsonl');
    const agent = writeWarmMock(dir, logFile);
    const backend = createAcpBackend({
      harness: 'antigravity',
      command: agent,
      permissions: 'allow-once',
      allowHostMcp: true,
      sessionResume: true,
      warmSessionIdleMs: 30_000,
    });

    const turn1Calls: string[] = [];
    const turn2Calls: string[] = [];
    const s1 = await backend.createSession(
      baseChiefOpts(dir, {
        prompt: 'CALL_TODOS_1',
        executeRemoteTool: async (name) => {
          turn1Calls.push(name);
          return 'from-turn-1';
        },
      }),
    );
    const ev1 = await collect(s1.events);
    expect(ev1).toContainEqual({
      type: 'message_end',
      message: { role: 'assistant', content: 'tool:from-turn-1' },
    });

    const s2 = await backend.continueSession(
      s1.sessionId,
      baseChiefOpts(dir, {
        prompt: 'CALL_TODOS_2',
        executeRemoteTool: async (name) => {
          turn2Calls.push(name);
          return 'from-turn-2';
        },
      }),
    );
    const ev2 = await collect(s2.events);
    expect(ev2).toContainEqual({
      type: 'message_end',
      message: { role: 'assistant', content: 'tool:from-turn-2' },
    });

    const entries = readLog(logFile);
    const spawns = entries.filter((e) => e.kind === 'spawn');
    expect(spawns).toHaveLength(1);
    expect(turn1Calls).toEqual(['todos']);
    expect(turn2Calls).toEqual(['todos']);
    backend.close?.();
  });

  test('terminates parked warm session on stray MCP call, late notification, or in-flight tool at end_turn', async () => {
    const dir = tempDir('ag-warm-stray-');
    const logFile = join(dir, 'events.jsonl');
    const agent = writeWarmMock(dir, logFile);
    const backend = createAcpBackend({
      harness: 'antigravity',
      command: agent,
      permissions: 'allow-once',
      allowHostMcp: true,
      sessionResume: true,
      warmSessionIdleMs: 30_000,
    });

    const s1 = await backend.createSession(baseChiefOpts(dir, { prompt: 'STRAY_WHILE_PARKED' }));
    await collect(s1.events);
    await new Promise((r) => setTimeout(r, 150));

    const entriesAfterStray = readLog(logFile);
    const stray = entriesAfterStray.find((e) => e.kind === 'stray_call');
    expect(stray?.isError).toBe(true);
    expect(String(stray?.text)).toContain('unbound');

    const s2 = await backend.continueSession(
      s1.sessionId,
      baseChiefOpts(dir, { prompt: 'LATE_NOTIFY_WHILE_PARKED' }),
    );
    await collect(s2.events);
    await new Promise((r) => setTimeout(r, 150));
    expect(readLog(logFile).filter((e) => e.kind === 'spawn')).toHaveLength(2);

    let releaseSlowTool!: () => void;
    const s3 = await backend.continueSession(
      s2.sessionId,
      baseChiefOpts(dir, {
        prompt: 'INFLIGHT_AT_END_TURN',
        executeRemoteTool: () =>
          new Promise<string>((resolve) => {
            releaseSlowTool = () => resolve('late-done');
          }),
      }),
    );
    await collect(s3.events);
    releaseSlowTool?.();
    await new Promise((r) => setTimeout(r, 50));

    const s4 = await backend.continueSession(s3.sessionId, baseChiefOpts(dir, { prompt: 'after' }));
    await collect(s4.events);
    expect(readLog(logFile).filter((e) => e.kind === 'spawn')).toHaveLength(4);
    backend.close?.();
  });

  test('evicts and terminates warm session on compatibility mismatch or createSession on same cwd', async () => {
    const dir = tempDir('ag-warm-compat-');
    const logFile = join(dir, 'events.jsonl');
    const agent = writeWarmMock(dir, logFile);
    const backend = createAcpBackend({
      harness: 'antigravity',
      command: agent,
      permissions: 'allow-once',
      allowHostMcp: true,
      sessionResume: true,
      warmSessionIdleMs: 30_000,
    });

    const optsA = baseChiefOpts(dir, { modelId: 'gemini-4-hydrogen', prompt: 't1' });
    const optsB = baseChiefOpts(dir, {
      modelId: 'gemini-4-hydrogen',
      prompt: 't2',
      remoteTools: [
        { name: 'todos', description: 'List todos' },
        { name: 'docs', description: 'Read docs' },
      ],
    });
    expect(computeAcpToolsDigest(optsA, { maxToolBytes: 950, deferTools: true })).not.toBe(
      computeAcpToolsDigest(optsB, { maxToolBytes: 950, deferTools: true }),
    );

    const s1 = await backend.createSession(optsA);
    await collect(s1.events);
    const s1Warm = await backend.continueSession(s1.sessionId, optsA);
    await collect(s1Warm.events);
    expect(readLog(logFile).filter((e) => e.kind === 'spawn')).toHaveLength(1);

    const s2 = await backend.continueSession(s1.sessionId, optsB);
    await collect(s2.events);
    expect(readLog(logFile).filter((e) => e.kind === 'spawn')).toHaveLength(2);

    const s3 = await backend.continueSession(
      s2.sessionId,
      baseChiefOpts(dir, { modelId: 'gemini-4-neon', prompt: 't3' }),
    );
    await collect(s3.events);
    expect(readLog(logFile).filter((e) => e.kind === 'spawn')).toHaveLength(3);

    const s4 = await backend.createSession(baseChiefOpts(dir, { prompt: 'fresh' }));
    await collect(s4.events);
    const logEntries = readLog(logFile);
    expect(logEntries.filter((e) => e.kind === 'spawn')).toHaveLength(4);
    expect(logEntries.filter((e) => e.kind === 'sigterm').length).toBeGreaterThanOrEqual(3);
    backend.close?.();
  });

  test('evicts warm session on stop, error, auth failure, unsupported image, or idle child exit', async () => {
    const dir = tempDir('ag-warm-evict-');
    const logFile = join(dir, 'events.jsonl');
    const agent = writeWarmMock(dir, logFile);
    const backend = createAcpBackend({
      harness: 'antigravity',
      command: agent,
      permissions: 'allow-once',
      allowHostMcp: true,
      sessionResume: true,
      warmSessionIdleMs: 30_000,
    });

    const s1 = await backend.createSession(baseChiefOpts(dir, { prompt: 't1' }));
    await collect(s1.events);
    const s1Warm = await backend.continueSession(
      s1.sessionId,
      baseChiefOpts(dir, { prompt: 't1b' }),
    );
    await collect(s1Warm.events);
    expect(readLog(logFile).filter((e) => e.kind === 'spawn')).toHaveLength(1);

    const sAuth = await backend.continueSession(
      s1.sessionId,
      baseChiefOpts(dir, { prompt: 'TRIGGER_AUTH_ERROR' }),
    );
    const authEvents = await collect(sAuth.events);
    expect(authEvents.some((e) => e.type === 'error')).toBe(true);

    const s2 = await backend.continueSession(
      s1.sessionId,
      baseChiefOpts(dir, { prompt: 'HANG_UNTIL_CANCEL' }),
    );
    expect(readLog(logFile).filter((e) => e.kind === 'spawn')).toHaveLength(2);
    const s2Collect = collect(s2.events);
    await new Promise((r) => setTimeout(r, 50));
    await s2.stop();
    await s2Collect;

    const s3 = await backend.continueSession(
      s1.sessionId,
      baseChiefOpts(dir, { prompt: 'EXIT_AFTER_DONE' }),
    );
    await collect(s3.events);
    expect(readLog(logFile).filter((e) => e.kind === 'spawn')).toHaveLength(3);
    await new Promise((r) => setTimeout(r, 150));

    const s4 = await backend.continueSession(
      s1.sessionId,
      baseChiefOpts(dir, { prompt: 'after-exit' }),
    );
    await collect(s4.events);
    expect(readLog(logFile).filter((e) => e.kind === 'spawn')).toHaveLength(4);
    backend.close?.();
  });

  test('terminates parked sessions on idle TTL, LRU cap, and backend.close without clobbering external hooks', async () => {
    const dir1 = tempDir('ag-warm-ttl-1-');
    const dir2 = tempDir('ag-warm-ttl-2-');
    const dir3 = tempDir('ag-warm-ttl-3-');
    const logFile = join(dir1, 'events.jsonl');
    const agent = writeWarmMock(dir1, logFile);

    mkdirSync(join(dir1, '.agents'), { recursive: true });
    writeFileSync(join(dir1, '.agents/hooks.json'), JSON.stringify({ existingKey: { ok: true } }));

    const backend = createAcpBackend({
      harness: 'antigravity',
      command: agent,
      permissions: 'allow-once',
      allowHostMcp: true,
      sessionResume: true,
      warmSessionIdleMs: 120,
    });

    const s1 = await backend.createSession(baseChiefOpts(dir1, { prompt: 'one' }));
    await collect(s1.events);
    const duringPark = JSON.parse(readFileSync(join(dir1, '.agents/hooks.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    writeFileSync(
      join(dir1, '.agents/hooks.json'),
      JSON.stringify({ ...duringPark, externalKey: { addedWhileParked: true } }),
    );

    await new Promise((r) => setTimeout(r, 260));
    const hooksAfterTtl = JSON.parse(
      readFileSync(join(dir1, '.agents/hooks.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(hooksAfterTtl).toHaveProperty('existingKey');
    expect(hooksAfterTtl).toHaveProperty('externalKey');
    expect(hooksAfterTtl).not.toHaveProperty('cairn-relay-guard');

    const longBackend = createAcpBackend({
      harness: 'antigravity',
      command: agent,
      permissions: 'allow-once',
      allowHostMcp: true,
      sessionResume: true,
      warmSessionIdleMs: 30_000,
    });
    const a = await longBackend.createSession(baseChiefOpts(dir1, { prompt: 'a' }));
    await collect(a.events);
    const b = await longBackend.createSession(baseChiefOpts(dir2, { prompt: 'b' }));
    await collect(b.events);
    const c = await longBackend.createSession(baseChiefOpts(dir3, { prompt: 'c' }));
    await collect(c.events);
    await new Promise((r) => setTimeout(r, 80));
    expect(readLog(logFile).filter((e) => e.kind === 'sigterm').length).toBeGreaterThanOrEqual(2);
    expect(typeof longBackend.close).toBe('function');
    longBackend.close?.();
    await new Promise((r) => setTimeout(r, 80));
    expect(readLog(logFile).filter((e) => e.kind === 'sigterm').length).toBeGreaterThanOrEqual(4);
  });

  test('strips CAIRN_STEP_TREE and isolates warm TMPDIR so per-step cleanup does not break warm reuse', async () => {
    const dir = tempDir('ag-warm-env-');
    const cairnHome = tempDir('ag-warm-cairnhome-');
    const logFile = join(dir, 'events.jsonl');
    const agent = writeWarmMock(dir, logFile);
    const backend = createAcpBackend({
      harness: 'antigravity',
      command: agent,
      permissions: 'allow-once',
      allowHostMcp: true,
      sessionResume: true,
      warmSessionIdleMs: 30_000,
    });

    const profile1 = acquireDeterministicCredentialProfile(cairnHome, 'ag-key-1');
    const stepTmpDir = tempDir('step-tmp-');
    const s1 = await backend.createSession(
      baseChiefOpts(dir, {
        prompt: 'step1',
        env: {
          ...profile1.env,
          [STEP_TREE_ENV]: 'step-1-tree-marker',
          TMPDIR: stepTmpDir,
        },
      }),
    );
    await collect(s1.events);

    profile1.cleanup();
    rmSync(stepTmpDir, { recursive: true, force: true });

    expect(existsSync(profile1.home)).toBe(true);

    const spawns = readLog(logFile).filter((e) => e.kind === 'spawn');
    expect(spawns).toHaveLength(1);
    expect(spawns[0]?.stepTree).toBeNull();
    expect(spawns[0]?.tmpdir).not.toBe(stepTmpDir);

    const profile2 = acquireDeterministicCredentialProfile(cairnHome, 'ag-key-1');
    const s2 = await backend.continueSession(
      s1.sessionId,
      baseChiefOpts(dir, {
        prompt: 'step2',
        env: {
          ...profile2.env,
          [STEP_TREE_ENV]: 'step-2-tree-marker',
        },
      }),
    );
    await collect(s2.events);
    profile2.cleanup();
    expect(readLog(logFile).filter((e) => e.kind === 'spawn')).toHaveLength(1);

    backend.close?.();
    await new Promise((r) => setTimeout(r, 100));
    expect(existsSync(profile1.home)).toBe(false);
  });
});
