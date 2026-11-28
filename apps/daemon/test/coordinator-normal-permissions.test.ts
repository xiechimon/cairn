import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AgentBackend,
  AgentSessionHandle,
  ProviderConfig,
  RemoteToolDef,
  SessionOpts,
  StepEvent,
} from '@cairn/shared';
import { COORDINATOR_COMPACT_AT, SUBAGENT_TOOL_NAME } from '@cairn/shared';
import { afterEach, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { createAcpBackend, createGeminiBackend } from '../src/backend/acp.js';
import { acpTurnPolicy, claudeAcpSessionMeta } from '../src/backend/acp-permission-gate.js';
import { installAntigravityTurnHooks } from '../src/backend/antigravity-hooks.js';
import { buildClaudeSdkOptions } from '../src/backend/claude-code.js';
import { sessionToolNames } from '../src/backend/pi.js';
import { createDaemonSubagentExecutor } from '../src/backend/subagent.js';
import type { MachineApi } from '../src/machine-client.js';
import { composeStepSessionOpts, type StepSessionOptsInput } from '../src/step-session-opts.js';

const acpFixture = fileURLToPath(new URL('./fixtures/acp-agent.mjs', import.meta.url));
const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = makeTestTempDir(prefix);
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) releaseTestTempDir(dir);
});

function shQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function shellNodeScript(body: string): string {
  return `#!/bin/sh\nexec ${shQuote(process.execPath)} --input-type=module -e ${shQuote(body)} -- "$0" "$@"\n`;
}

async function collect(events: AsyncIterable<StepEvent>): Promise<StepEvent[]> {
  const out: StepEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

function chiefOpts(providerId: string, overrides: Partial<StepSessionOptsInput> = {}): SessionOpts {
  return composeStepSessionOpts({
    provider: {
      providerId,
      kind: 'api_key',
    } as unknown as ProviderConfig,
    modelId: 'stub-model',
    thinkingLevel: null,
    systemPrompt: 'Coordinator base prompt',
    cwd: process.cwd(),
    prompt: 'Hello',
    promptImages: undefined,
    localTools: [],
    remoteTools: [{ name: 'todos', description: 'List todos', replaySafe: true }],
    remoteExecutor: {
      client: { relayTool: async () => 'relayed' } as unknown as MachineApi,
      stepId: 'step-1',
      askChannel: { available: false, ask: async () => '' },
      attachFiles: false,
      verifyEvidence: null,
    },
    mcpServers: null,
    skillsAllowlist: ['blocked-skill'],
    injectedSkills: ['ignored-skill'],
    onSkillsResolved: () => {},
    teamSkillsDir: null,
    isChief: true,
    isReview: false,
    remoteToolsOnly: false,
    telemetry: undefined,
    env: {},
    ...overrides,
  });
}

function writeAntigravityMock(dir: string, hooksPath: string): string {
  const agent = join(dir, 'agy-coord-mock.sh');
  writeFileSync(
    agent,
    shellNodeScript(
      [
        "import { createInterface } from 'node:readline';",
        "import { execFileSync } from 'node:child_process';",
        "import { existsSync, readFileSync, statSync } from 'node:fs';",
        'const send = (obj) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...obj }) + "\\n");',
        'const gateWaiters = new Map();',
        'let currentMode = "default";',
        `const hooksFile = ${JSON.stringify(hooksPath)};`,
        'for await (const line of createInterface({ input: process.stdin })) {',
        '  const msg = JSON.parse(line);',
        '  if (msg.method === undefined && gateWaiters.has(msg.id)) {',
        '    gateWaiters.get(msg.id)(msg.result);',
        '    gateWaiters.delete(msg.id);',
        '    continue;',
        '  }',
        '  if (msg.method === "initialize") {',
        '    send({ id: msg.id, result: { protocolVersion: msg.params.protocolVersion, agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} } } } });',
        '  } else if (msg.method === "session/new" || msg.method === "session/resume") {',
        '    send({ id: msg.id, result: { sessionId: msg.params.sessionId ?? "ag-coord-1", modes: { currentModeId: currentMode, availableModes: [{ id: "default", name: "Default" }, { id: "auto", name: "Auto" }] }, configOptions: [{ id: "model", name: "Model", category: "model", type: "select", currentValue: "stub-model", options: [{ value: "stub-model", name: "Stub Model" }] }] } });',
        '  } else if (msg.method === "session/set_mode") {',
        '    currentMode = msg.params.modeId;',
        '    send({ id: msg.id, result: {} });',
        '  } else if (msg.method === "session/set_config_option") {',
        '    send({ id: msg.id, result: { configOptions: [] } });',
        '  } else if (msg.method === "session/prompt") {',
        '    void (async () => {',
        '      const hooksSnapshot = existsSync(hooksFile) && statSync(hooksFile).isFile() ? readFileSync(hooksFile, "utf8") : null;',
        '      const ask = async (id, toolCall) => new Promise((resolve) => {',
        '        gateWaiters.set(id, resolve);',
        '        send({ id, method: "session/request_permission", params: { sessionId: "ag-coord-1", toolCall, options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }, { optionId: "deny", name: "Deny", kind: "reject_once" }] } });',
        '      });',
        '      const runCheck = (toolName) => {',
        '        if (!hooksSnapshot) return "allow";',
        '        const parsed = JSON.parse(hooksSnapshot);',
        '        const cmd = parsed?.["cairn-relay-guard"]?.PreToolUse?.[0]?.hooks?.[0]?.command;',
        '        if (!cmd) return "allow";',
        '        const res = JSON.parse(execFileSync("/bin/sh", ["-c", cmd], { input: JSON.stringify({ hookEventName: "PreToolUse", toolCall: { name: toolName, args: {} } }), encoding: "utf8" }));',
        '        return res.decision;',
        '      };',
        '      const execGate = await ask("g-exec", { toolCallId: "t-exec", title: "run_command", kind: "execute", rawInput: { command: "uptime" } });',
        '      const readGate = await ask("g-read", { toolCallId: "t-read", title: "read_file", kind: "read", rawInput: { path: "README.md" } });',
        '      const cmd = msg.params.prompt.find((b) => b.type === "text")?.text ?? "";',
        '      if (cmd.includes("FAIL_CMD")) {',
        '        send({ method: "session/update", params: { sessionId: "ag-coord-1", update: { sessionUpdate: "tool_call", toolCallId: "t-fail", title: "run_command", kind: "execute", status: "pending" } } });',
        '        send({ method: "session/update", params: { sessionId: "ag-coord-1", update: { sessionUpdate: "tool_call_update", toolCallId: "t-fail", status: "failed", rawOutput: "exit 127: missing-bin" } } });',
        '      }',
        '      const summary = { mode: currentMode, hooksPresent: hooksSnapshot !== null, hookExec: runCheck("run_command"), hookRead: runCheck("read_file"), hookRelay: runCheck("mcp_cairn_todos"), execGate: execGate.outcome.optionId, readGate: readGate.outcome.optionId };',
        '      send({ method: "session/update", params: { sessionId: "ag-coord-1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: JSON.stringify(summary) } } } });',
        '      send({ id: msg.id, result: { stopReason: "end_turn" } });',
        '    })();',
        '  }',
        '}',
      ].join('\n'),
    ),
  );
  chmodSync(agent, 0o755);
  return agent;
}

describe('normal Coordinator permissions across runtimes', () => {
  test('Antigravity: normal Coordinator turn runs in auto mode, allows run_command/read_file, and surfaces command failures without read-only refusal', async () => {
    const dir = tempDir('coord-agy-normal-');
    const cwd = join(dir, 'thread-main');
    const isolatedHome = join(dir, 'agy-home');
    mkdirSync(cwd, { recursive: true });
    mkdirSync(join(isolatedHome, '.gemini', 'antigravity-acp'), { recursive: true });
    const hooksPath = join(cwd, '.agents', 'hooks.json');
    const agent = writeAntigravityMock(dir, hooksPath);

    const sessionOpts = chiefOpts('antigravity', {
      cwd,
      env: { HOME: isolatedHome },
      prompt: 'Hello run uptime FAIL_CMD',
    });
    expect(sessionOpts.lockedDown).toBeUndefined();
    expect(sessionOpts.readOnly).toBeUndefined();
    expect(sessionOpts.remoteToolsOnly).toBeUndefined();
    expect(acpTurnPolicy(sessionOpts)).toBe('normal');

    const backend = createAcpBackend({
      harness: 'antigravity',
      command: agent,
      permissions: 'allow-once',
      allowHostMcp: true,
      sessionResume: true,
    });
    const handle = await backend.createSession(sessionOpts);
    const events = await collect(handle.events);
    const msg = events.find((event) => event.type === 'message_end');
    const summary = JSON.parse(msg?.type === 'message_end' ? String(msg.message.content) : '{}');

    expect(summary).toEqual({
      mode: 'auto',
      hooksPresent: false,
      hookExec: 'allow',
      hookRead: 'allow',
      hookRelay: 'allow',
      execGate: 'allow',
      readGate: 'allow',
    });
    const failedTool = events
      .filter((event) => event.type === 'toolcall_end' && event.call.id === 't-fail')
      .at(-1);
    expect(failedTool?.type === 'toolcall_end' ? failedTool.call : null).toMatchObject({
      isError: true,
      result: 'exit 127: missing-bin',
    });
  });

  test('Antigravity: session resume and normal -> relay-only -> normal switching on reused cwd and isolated HOME', async () => {
    const dir = tempDir('coord-agy-switch-');
    const cwd = join(dir, 'thread-reused');
    const isolatedHome = join(dir, 'agy-home');
    const settingsPath = join(isolatedHome, '.gemini', 'antigravity-acp', 'settings.json');
    mkdirSync(cwd, { recursive: true });
    mkdirSync(join(isolatedHome, '.gemini', 'antigravity-acp'), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify({ auth: { type: 'oauth-personal' } }));
    const hooksPath = join(cwd, '.agents', 'hooks.json');
    const agent = writeAntigravityMock(dir, hooksPath);

    const backend = createAcpBackend({
      harness: 'antigravity',
      command: agent,
      permissions: 'allow-once',
      allowHostMcp: true,
      sessionResume: true,
    });

    const normal1 = await backend.createSession(
      chiefOpts('antigravity', { cwd, env: { HOME: isolatedHome }, prompt: 'turn 1' }),
    );
    const ev1 = await collect(normal1.events);
    const m1 = ev1.find((event) => event.type === 'message_end');
    expect(
      JSON.parse(m1?.type === 'message_end' ? String(m1.message.content) : '{}'),
    ).toMatchObject({
      mode: 'auto',
      hooksPresent: false,
      execGate: 'allow',
    });
    expect(JSON.parse(readFileSync(settingsPath, 'utf8')).toolPermission).toBeUndefined();

    const mailTurn = await backend.continueSession(
      normal1.sessionId,
      chiefOpts('antigravity', {
        cwd,
        env: { HOME: isolatedHome },
        remoteToolsOnly: true,
        prompt: 'mail turn',
      }),
    );
    const ev2 = await collect(mailTurn.events);
    const m2 = ev2.find((event) => event.type === 'message_end');
    expect(JSON.parse(m2?.type === 'message_end' ? String(m2.message.content) : '{}')).toEqual({
      mode: 'default',
      hooksPresent: true,
      hookExec: 'deny',
      hookRead: 'deny',
      hookRelay: 'allow',
      execGate: 'deny',
      readGate: 'deny',
    });
    expect(existsSync(hooksPath)).toBe(false);

    const normal2 = await backend.continueSession(
      normal1.sessionId,
      chiefOpts('antigravity', { cwd, env: { HOME: isolatedHome }, prompt: 'turn 3' }),
    );
    const ev3 = await collect(normal2.events);
    const m3 = ev3.find((event) => event.type === 'message_end');
    expect(
      JSON.parse(m3?.type === 'message_end' ? String(m3.message.content) : '{}'),
    ).toMatchObject({
      mode: 'auto',
      hooksPresent: false,
      execGate: 'allow',
      readGate: 'allow',
    });
    expect(JSON.parse(readFileSync(settingsPath, 'utf8')).toolPermission).toBeUndefined();
  });

  test('Claude Code (SDK + ACP), Devin, and Gemini normal Coordinator turns use task policy; Pi keeps existing parity', async () => {
    const claudeOpts = chiefOpts('claude-code');
    expect(claudeOpts.lockedDown).toBeUndefined();
    expect(claudeOpts.compactAt).toBe(COORDINATOR_COMPACT_AT);
    expect(claudeOpts.skillsAllowlist).toBeUndefined();
    expect(claudeOpts.injectedSkills).toBeUndefined();

    const sdkOptions = buildClaudeSdkOptions({
      cwd: '/tmp/coord-cc',
      modelId: claudeOpts.modelId,
      resumeId: null,
      sessionId: 'sess-coord',
      disallowedTools: ['AskUserQuestion'],
      lockedDown: claudeOpts.lockedDown === true,
      mcpServers: {
        cairn: { type: 'sdk', name: 'cairn', instance: {} } as never,
      },
      compactAt: claudeOpts.compactAt,
      abortController: new AbortController(),
    });
    expect(sdkOptions.permissionMode).toBe('bypassPermissions');
    expect(sdkOptions.tools).toEqual([
      'Read',
      'Glob',
      'Grep',
      'Bash',
      'PowerShell',
      'Edit',
      'Write',
      'NotebookEdit',
    ]);
    expect(sdkOptions.disallowedTools).toContain('AskUserQuestion');
    expect(sdkOptions.settingSources).toEqual(['user', 'project', 'local']);

    expect(claudeAcpSessionMeta(acpTurnPolicy(claudeOpts))).toBeUndefined();

    const bashCall = JSON.stringify([
      {
        toolCallId: 'cmd-1',
        title: 'Bash',
        kind: 'execute',
        rawInput: { command: 'uptime' },
        exec: true,
      },
    ]);

    const devinBackend = createAcpBackend({
      harness: 'devin',
      command: process.execPath,
      args: [acpFixture, 'devin-gate'],
      steering: 'mid-turn',
      allowHostMcp: true,
      initializeTimeoutMs: 3_000,
      cancelTimeoutMs: 100,
    });
    const devinSession = await devinBackend.createSession(
      chiefOpts('devin', { prompt: `Hello ${bashCall}` }),
    );
    const devinEvents = await collect(devinSession.events);
    const devinEnd = devinEvents.filter((event) => event.type === 'message_end').at(-1);
    expect(
      JSON.parse(devinEnd?.type === 'message_end' ? String(devinEnd.message.content) : '{}'),
    ).toMatchObject({
      __mode: 'bypass',
      'cmd-1': 'no-prompt',
      __executed: ['cmd-1'],
    });

    const geminiBackend = createGeminiBackend({
      executablePath: process.execPath,
      spawnProcess: (_cmd, _args, spawnOpts) =>
        spawn(process.execPath, [acpFixture, 'ask-gate'], spawnOpts),
    });
    const geminiSession = await geminiBackend.createSession(
      chiefOpts('gemini', { prompt: `Hello ${bashCall}` }),
    );
    const geminiEvents = await collect(geminiSession.events);
    const geminiEnd = geminiEvents.filter((event) => event.type === 'message_end').at(-1);
    expect(
      JSON.parse(geminiEnd?.type === 'message_end' ? String(geminiEnd.message.content) : '{}'),
    ).toMatchObject({
      'cmd-1': 'allow',
      __executed: ['cmd-1'],
    });

    const piOpts = chiefOpts('openai');
    expect(
      sessionToolNames({
        readOnly: piOpts.readOnly === true,
        remoteToolsOnly: piOpts.remoteToolsOnly === true,
        remoteTools: ['todos'],
        mcpTools: [],
      }),
    ).toContain('bash');
  });

  test('main vs project channel workspaces both omit lockedDown on normal Coordinator turns', () => {
    const mainThreadOpts = chiefOpts('antigravity', { cwd: '/tmp/ws/chief-main' });
    const projectThreadOpts = chiefOpts('antigravity', { cwd: '/tmp/ws/chief-proj-1' });
    expect(mainThreadOpts.lockedDown).toBeUndefined();
    expect(projectThreadOpts.lockedDown).toBeUndefined();
    expect(acpTurnPolicy(mainThreadOpts)).toBe('normal');
    expect(acpTurnPolicy(projectThreadOpts)).toBe('normal');
  });

  test('narrow protections stay intact for mail/memory-edit turns, review steps, readonly workspaces, and daemon subagents', async () => {
    const mailOpts = chiefOpts('antigravity', { remoteToolsOnly: true });
    expect(mailOpts.lockedDown).toBe(true);
    expect(mailOpts.remoteToolsOnly).toBe(true);
    expect(acpTurnPolicy(mailOpts)).toBe('relay-only');

    const claudeMailSdk = buildClaudeSdkOptions({
      cwd: '/tmp/mail',
      modelId: mailOpts.modelId,
      resumeId: null,
      sessionId: 'sess-mail',
      disallowedTools: ['AskUserQuestion'],
      lockedDown: mailOpts.lockedDown === true,
      builtinTools: [],
      mcpServers: {},
      abortController: new AbortController(),
    });
    expect(claudeMailSdk.permissionMode).toBe('dontAsk');
    expect(claudeMailSdk.disallowedTools).toContain('Bash');
    expect(claudeMailSdk.tools).toEqual([]);

    const reviewOpts = chiefOpts('antigravity', { isChief: false, isReview: true });
    expect(reviewOpts.readOnly).toBe(true);
    expect(reviewOpts.lockedDown).toBe(true);
    expect(acpTurnPolicy(reviewOpts)).toBe('read-only');

    const readonlyWsOpts = chiefOpts('antigravity', { isChief: false, readOnly: true });
    expect(readonlyWsOpts.readOnly).toBe(true);
    expect(acpTurnPolicy(readonlyWsOpts)).toBe('read-only');

    const seenChildOpts: SessionOpts[] = [];
    const fakeBackend: AgentBackend = {
      capabilities: {
        name: 'antigravity-acp',
        thinkingLevels: ['medium'],
        oauthProviders: [],
        compaction: true,
        sessionResume: true,
      },
      modelSupportsImages: async () => true,
      rememberNoVision: () => {},
      continueSession: async () => {
        throw new Error('unused');
      },
      createSession: async (opts: SessionOpts): Promise<AgentSessionHandle> => {
        seenChildOpts.push(opts);
        return {
          sessionId: 'child-1',
          steer: async () => {},
          stop: async () => {},
          usage: () => [],
          events: (async function* () {
            yield { type: 'text_delta', text: 'ok' };
          })(),
        };
      },
    };
    const parentNormal = chiefOpts('antigravity', {
      remoteTools: [
        { name: SUBAGENT_TOOL_NAME, description: 'subagent' },
        { name: 'todos', description: 'list todos', replaySafe: true },
      ] satisfies RemoteToolDef[],
    });
    expect(parentNormal.lockedDown).toBeUndefined();
    const runSubagent = createDaemonSubagentExecutor({
      backend: fakeBackend,
      parentSessionOpts: parentNormal,
      parentSignal: new AbortController().signal,
      untrustedTurn: false,
    });
    await runSubagent({ task: 'List todos' });
    expect(seenChildOpts[0]?.lockedDown).toBe(true);
    expect(seenChildOpts[0]?.readOnly).toBe(true);
  });
});

function runPreToolHook(hooksPath: string, toolName: string): string {
  const parsed = JSON.parse(readFileSync(hooksPath, 'utf8')) as {
    'cairn-relay-guard'?: { PreToolUse?: Array<{ hooks?: Array<{ command?: string }> }> };
  };
  const cmd = parsed['cairn-relay-guard']?.PreToolUse?.[0]?.hooks?.[0]?.command;
  if (!cmd) return 'missing';
  const result = JSON.parse(
    execFileSync('/bin/sh', ['-c', cmd], {
      input: JSON.stringify({
        hookEventName: 'PreToolUse',
        toolCall: { name: toolName, args: {} },
      }),
      encoding: 'utf8',
    }),
  ) as { decision: string };
  return result.decision;
}

describe('antigravity hooks lease ownership and stale cleanup', () => {
  test('concurrent restricted leases keep strictest policy across FIFO and LIFO release, resist normal cleanup while active, preserve mid-session user edits, and do not overwrite malformed JSON on recompute', () => {
    const cwd = tempDir('hooks-concurrent-');
    const agentsDir = join(cwd, '.agents');
    const hooksPath = join(agentsDir, 'hooks.json');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(hooksPath, JSON.stringify({ initialUser: { Stop: [] } }));

    const releaseReadOnlyFirst = installAntigravityTurnHooks(cwd, 'read-only');
    expect(runPreToolHook(hooksPath, 'read_file')).toBe('allow');
    expect(runPreToolHook(hooksPath, 'run_command')).toBe('deny');

    const releaseRelayOnlySecond = installAntigravityTurnHooks(cwd, 'relay-only');
    expect(runPreToolHook(hooksPath, 'read_file')).toBe('deny');

    installAntigravityTurnHooks(cwd, 'normal')();
    expect(runPreToolHook(hooksPath, 'read_file')).toBe('deny');

    const midSession = JSON.parse(readFileSync(hooksPath, 'utf8')) as Record<string, unknown>;
    midSession.addedDuringSession = { PostToolUse: [{ matcher: '.*' }] };
    writeFileSync(hooksPath, JSON.stringify(midSession));

    releaseReadOnlyFirst();
    releaseReadOnlyFirst();
    expect(runPreToolHook(hooksPath, 'read_file')).toBe('deny');
    expect(runPreToolHook(hooksPath, 'run_command')).toBe('deny');

    const releaseReadOnlyThird = installAntigravityTurnHooks(cwd, 'read-only');
    expect(runPreToolHook(hooksPath, 'read_file')).toBe('deny');

    releaseRelayOnlySecond();
    expect(runPreToolHook(hooksPath, 'read_file')).toBe('allow');
    expect(runPreToolHook(hooksPath, 'run_command')).toBe('deny');

    releaseReadOnlyThird();
    expect(JSON.parse(readFileSync(hooksPath, 'utf8'))).toEqual({
      initialUser: { Stop: [] },
      addedDuringSession: { PostToolUse: [{ matcher: '.*' }] },
    });

    const malformedCwd = tempDir('hooks-recompute-corrupt-');
    const malformedAgents = join(malformedCwd, '.agents');
    const malformedHooks = join(malformedAgents, 'hooks.json');
    const l1 = installAntigravityTurnHooks(malformedCwd, 'read-only');
    const l2 = installAntigravityTurnHooks(malformedCwd, 'relay-only');
    writeFileSync(malformedHooks, '{unfinished-json');
    l1();
    expect(readFileSync(malformedHooks, 'utf8')).toBe('{unfinished-json');
    l2();
    expect(readFileSync(malformedHooks, 'utf8')).toBe('{unfinished-json');
  });

  test('removes generated hooks.json and .agents dir when no prior dir/files existed after final lease exits', () => {
    const cwd = tempDir('hooks-clean-');
    const agentsDir = join(cwd, '.agents');
    const hooksPath = join(agentsDir, 'hooks.json');

    const r1 = installAntigravityTurnHooks(cwd, 'read-only');
    const r2 = installAntigravityTurnHooks(cwd, 'read-only');
    expect(existsSync(hooksPath)).toBe(true);
    r1();
    expect(existsSync(hooksPath)).toBe(true);
    r2();
    expect(existsSync(hooksPath)).toBe(false);
    expect(existsSync(agentsDir)).toBe(false);
  });

  test('normal cleanup strips stale cairn-relay-guard, preserves user hooks/empty/{}/non-JSON, and restricted refuses corrupt hooks.json', () => {
    const staleOnlyCwd = tempDir('hooks-stale-only-');
    const staleAgents = join(staleOnlyCwd, '.agents');
    const staleHooks = join(staleAgents, 'hooks.json');
    mkdirSync(staleAgents, { recursive: true });
    writeFileSync(staleHooks, JSON.stringify({ 'cairn-relay-guard': { PreToolUse: [] } }));
    installAntigravityTurnHooks(staleOnlyCwd, 'normal')();
    expect(existsSync(staleHooks)).toBe(false);
    expect(existsSync(staleAgents)).toBe(true);

    const mixedCwd = tempDir('hooks-mixed-');
    const mixedHooks = join(mixedCwd, '.agents', 'hooks.json');
    mkdirSync(join(mixedCwd, '.agents'), { recursive: true });
    writeFileSync(
      mixedHooks,
      JSON.stringify({
        userHook: { PostToolUse: [] },
        'cairn-relay-guard': { PreToolUse: [] },
      }),
    );
    installAntigravityTurnHooks(mixedCwd, 'normal')();
    expect(JSON.parse(readFileSync(mixedHooks, 'utf8'))).toEqual({
      userHook: { PostToolUse: [] },
    });

    const missingCwd = tempDir('hooks-missing-');
    installAntigravityTurnHooks(missingCwd, 'normal')();
    expect(existsSync(join(missingCwd, '.agents'))).toBe(false);

    const userEmptyCwd = tempDir('hooks-empty-');
    const userEmptyHooks = join(userEmptyCwd, '.agents', 'hooks.json');
    mkdirSync(join(userEmptyCwd, '.agents'), { recursive: true });
    writeFileSync(userEmptyHooks, '{}\n');
    installAntigravityTurnHooks(userEmptyCwd, 'normal')();
    expect(readFileSync(userEmptyHooks, 'utf8')).toBe('{}\n');

    const corruptCwd = tempDir('hooks-corrupt-');
    const corruptHooks = join(corruptCwd, '.agents', 'hooks.json');
    mkdirSync(join(corruptCwd, '.agents'), { recursive: true });
    writeFileSync(corruptHooks, '{not-json');
    installAntigravityTurnHooks(corruptCwd, 'normal')();
    expect(readFileSync(corruptHooks, 'utf8')).toBe('{not-json');
    expect(() => installAntigravityTurnHooks(corruptCwd, 'read-only')).toThrow();
    expect(readFileSync(corruptHooks, 'utf8')).toBe('{not-json');

    const arrayCwd = tempDir('hooks-array-');
    const arrayHooks = join(arrayCwd, '.agents', 'hooks.json');
    mkdirSync(join(arrayCwd, '.agents'), { recursive: true });
    writeFileSync(arrayHooks, '[]');
    installAntigravityTurnHooks(arrayCwd, 'normal')();
    expect(readFileSync(arrayHooks, 'utf8')).toBe('[]');
    expect(() => installAntigravityTurnHooks(arrayCwd, 'relay-only')).toThrow();
    expect(readFileSync(arrayHooks, 'utf8')).toBe('[]');
  });

  test('normal cleanup swallows read/write errors when .agents/hooks.json is unwritable or a directory and lets normal Antigravity turn run', async () => {
    const dir = tempDir('hooks-dir-collision-');
    const agentsDir = join(dir, '.agents');
    const hooksDirPath = join(agentsDir, 'hooks.json');
    mkdirSync(hooksDirPath, { recursive: true });
    const agent = writeAntigravityMock(dir, hooksDirPath);
    const backend = createAcpBackend({
      harness: 'antigravity',
      command: agent,
      permissions: 'allow-once',
      allowHostMcp: true,
    });
    const session = await backend.createSession(chiefOpts('antigravity', { cwd: dir }));
    const events = await collect(session.events);
    const msg = events.find((event) => event.type === 'message_end');
    expect(
      JSON.parse(msg?.type === 'message_end' ? String(msg.message.content) : '{}'),
    ).toMatchObject({
      mode: 'auto',
      execGate: 'allow',
    });
    expect(existsSync(hooksDirPath)).toBe(true);

    const roCwd = tempDir('hooks-ro-file-');
    const roAgents = join(roCwd, '.agents');
    const roHooks = join(roAgents, 'hooks.json');
    mkdirSync(roAgents, { recursive: true });
    const initial = JSON.stringify({
      userHook: { PostToolUse: [] },
      'cairn-relay-guard': { PreToolUse: [] },
    });
    writeFileSync(roHooks, initial);
    chmodSync(roHooks, 0o444);
    chmodSync(roAgents, 0o555);
    try {
      expect(() => installAntigravityTurnHooks(roCwd, 'normal')()).not.toThrow();
      expect(readFileSync(roHooks, 'utf8')).toBe(initial);
    } finally {
      chmodSync(roAgents, 0o755);
      chmodSync(roHooks, 0o644);
    }
  });
});
