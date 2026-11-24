import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { ClaimedStep, SessionOpts, StepEvent } from '@cairn/shared';
import { ANTIGRAVITY_ACP_ARGS } from '@cairn/shared/antigravity-install';
import { afterEach, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { createAcpBackend } from '../src/backend/acp.js';
import { SessionNotResumableError } from '../src/backend/errors.js';
import { clearCredentials, pushCredential } from '../src/credentials.js';
import { StepJournal, TranscriptBuffer } from '../src/journal.js';
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

describe('antigravity ACP runtime and credentials', () => {
  test('prefers auto mode for worker steps, plan mode when restricted, and never passes dangerously-skip-permissions', async () => {
    const dir = tempDir('ag-acp-');
    const agent = join(dir, 'agy-mock.sh');
    writeFileSync(
      agent,
      shellNodeScript(
        [
          "import { createInterface } from 'node:readline';",
          'if (process.argv.includes("--dangerously-skip-permissions")) process.exit(99);',
          'const send = (obj) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...obj }) + "\\n");',
          'let currentMode = "default";',
          'let selectedThinking = null;',
          'for await (const line of createInterface({ input: process.stdin })) {',
          '  const msg = JSON.parse(line);',
          '  if (msg.method === "initialize") {',
          '    send({ id: msg.id, result: { protocolVersion: msg.params.protocolVersion, agentCapabilities: { loadSession: true } } });',
          '  } else if (msg.method === "session/new") {',
          '    send({ id: msg.id, result: { sessionId: "ag-1", modes: { currentModeId: "default", availableModes: [{ id: "default", name: "Default" }, { id: "auto", name: "Auto" }, { id: "plan", name: "Plan" }] }, configOptions: [{ id: "model", name: "Model", category: "model", type: "select", currentValue: "gemini-4-carbon", options: [{ value: "gemini-4-carbon", name: "Gemini 4 Carbon" }] }, { id: "thought_level", name: "Thought Level", category: "thought_level", type: "select", currentValue: "medium", options: [{ value: "low", name: "Low" }, { value: "medium", name: "Medium" }, { value: "high", name: "High" }] }] } });',
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
      message: { role: 'assistant', content: 'plan:low' },
    });
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
        appCredential: null,
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
});
