import { chmodSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SessionOpts, StepEvent } from '@cairn/shared';
import { afterEach, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { createAcpBackend } from '../src/backend/acp.js';
import { clearCredentials, pushCredential } from '../src/credentials.js';
import { prepareStepEnv } from '../src/step-env.js';
import { agentStepRefusal, antigravitySubscriptionMissingMessage } from '../src/step-preflight.js';

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

describe('antigravity ACP runtime and credentials', () => {
  test('prefers auto mode for worker steps, plan mode when restricted, and never passes dangerously-skip-permissions', async () => {
    const dir = tempDir('ag-acp-');
    const agent = join(dir, 'agy-mock.mjs');
    writeFileSync(
      agent,
      [
        `#!${process.execPath}`,
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
        '    send({ id: msg.id, result: { configOptions: [] } });',
        '  } else if (msg.method === "session/prompt") {',
        '    send({ method: "session/update", params: { sessionId: "ag-1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: currentMode + ":" + selectedThinking } } } });',
        '    send({ id: msg.id, result: { stopReason: "end_turn" } });',
        '  }',
        '}',
      ].join('\n'),
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
        appCredential: null,
        readonlyGit: false,
        runtimeId: 'antigravity',
        agentConfig: { own: false, cairnHome, realHome: cairnHome },
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
        appCredential: null,
        readonlyGit: false,
        runtimeId: 'antigravity',
        agentConfig: { own: false, cairnHome, realHome: cairnHome },
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
});
