import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { createAcpBackend } from '../src/backend/acp.js';
import { createDoubaoManaged } from '../src/backend/doubao-managed.js';
import {
  createDoubaoProbeController,
  isDoubaoPlatformSupported,
  parseDoubaoModelListOutput,
  probeDoubaoRuntime,
  resolveDoubaoNativeBinary,
} from '../src/backend/doubao-probe.js';
import { StepFailureError } from '../src/backend/errors.js';
import { agentStepRefusal } from '../src/step-preflight.js';

const createdDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = makeTestTempDir(prefix);
  createdDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir !== undefined) releaseTestTempDir(dir);
  }
});

function writeStubNodeScript(dir: string, name: string, source: string): string {
  const filePath = join(dir, name);
  const scriptPath = `${filePath}.mjs`;
  writeFileSync(scriptPath, `${source}\n`, 'utf8');
  writeFileSync(
    filePath,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(scriptPath)} "$@"\n`,
    'utf8',
  );
  chmodSync(filePath, 0o755);
  return filePath;
}

function makeFakeDoubaoAcpStub(
  dir: string,
  behavior:
    | 'normal'
    | 'auth-open'
    | 'auth-load'
    | 'auth-prompt'
    | 'no-modes'
    | 'no-restrictive'
    | 'setmode-fail'
    | 'hang-init'
    | 'crash-open'
    | 'resume-replay'
    | 'permission-check',
): string {
  return writeStubNodeScript(
    dir,
    `doubao-stub-${behavior}`,
    `
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const behavior = ${JSON.stringify(behavior)};
if (args[0] === '--version') { console.log('2.38.4'); process.exit(0); }
if (args[0] === 'auth' && args[1] === 'status') {
  if (behavior.startsWith('auth-')) process.exit(1);
  console.log('logged in'); process.exit(0);
}
if (args[0] === 'model' && args[1] === 'list') {
  console.log('[cli-chat] ok');
  console.log(JSON.stringify({ type: 'result', subtype: 'success', result: { type: 'model_list', models: [{ id: '4', name: 'Doubao 2.1 Turbo', available: true, efforts: ['low', 'medium'], default_effort: 'medium' }] } }));
  process.exit(0);
}
if (behavior === 'crash-open') {
  process.stderr.write('fatal crash');
  process.exit(7);
}
let buf = '';
let cancelled = false;
process.stdin.on('data', (chunk) => {
  buf += chunk.toString();
  for (;;) {
    const nl = buf.indexOf('\\n');
    if (nl < 0) break;
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    const reply = (result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\\n');
    const fail = (code, message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code, message } }) + '\\n');
    if (msg.method === 'initialize') {
      if (behavior === 'hang-init') continue;
      reply({
        protocolVersion: 1,
        agentInfo: { name: 'doubao', version: '2.38.4' },
        agentCapabilities: { loadSession: true, sessionCapabilities: { list: {} }, promptCapabilities: {}, mcpCapabilities: {} },
      });
    } else if (msg.method === 'session/new') {
      if (behavior === 'auth-open') { fail(-32000, 'Authentication required: Run doubao login in a terminal.'); continue; }
      const modes =
        behavior === 'no-modes'
          ? undefined
          : behavior === 'no-restrictive'
            ? { currentModeId: 'bypass_permissions', availableModes: [{ id: 'bypass_permissions' }] }
            : behavior === 'setmode-fail'
              ? { currentModeId: 'bypass_permissions', availableModes: [{ id: 'default' }, { id: 'bypass_permissions' }] }
              : { currentModeId: 'default', availableModes: [{ id: 'default' }, { id: 'plan' }, { id: 'bypass_permissions' }] };
      reply({
        sessionId: 'sess-doubao-1',
        ...(modes !== undefined ? { modes } : {}),
        configOptions: [{ id: 'model', category: 'model', type: 'select', currentValue: '4', options: [{ value: '4', name: 'Doubao 2.1 Turbo' }] }],
      });
    } else if (msg.method === 'session/load') {
      if (behavior === 'auth-load') { fail(-32000, 'Authentication required: Run doubao login.'); continue; }
      if (behavior === 'resume-replay') {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: msg.params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'STALE_REPLAY' } } } }) + '\\n');
      }
      reply({
        modes: { currentModeId: 'default', availableModes: [{ id: 'default' }, { id: 'bypass_permissions' }] },
        configOptions: [{ id: 'model', category: 'model', type: 'select', currentValue: '4', options: [{ value: '4', name: 'Doubao 2.1 Turbo' }] }],
      });
    } else if (msg.method === 'session/set_config_option') {
      reply({ configOptions: [] });
    } else if (msg.method === 'session/set_mode') {
      if (behavior === 'setmode-fail') { fail(-32603, 'setMode failed'); continue; }
      process.env.STUB_MODE = msg.params.modeId;
      reply({});
    } else if (msg.method === 'session/cancel') {
      cancelled = true;
      reply({});
    } else if (msg.method === 'session/prompt') {
      if (behavior === 'auth-prompt') { fail(-32000, '登录已失效，请运行 doubao login 重新登录。'); continue; }
      if (behavior === 'permission-check') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: 999,
          method: 'session/request_permission',
          params: {
            sessionId: msg.params.sessionId,
            toolCall: { toolCallId: 'tc-1', title: 'Bash', kind: 'execute', rawInput: { command: 'rm -rf /tmp/x' } },
            options: [{ optionId: 'allow_once', kind: 'allow_once', name: 'Allow' }, { optionId: 'reject_once', kind: 'reject_once', name: 'Reject' }],
          },
        }) + '\\n');
        setTimeout(() => {
          process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: msg.params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'MODE=' + (process.env.STUB_MODE ?? 'default') } } } }) + '\\n');
          reply({ stopReason: 'end_turn' });
        }, 30);
        continue;
      }
      setTimeout(() => {
        if (cancelled) { reply({ stopReason: 'cancelled' }); return; }
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: msg.params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'LIVE_REPLY:' + (process.env.STUB_MODE ?? 'default') } } } }) + '\\n');
        reply({ stopReason: 'end_turn' });
      }, behavior === 'normal' ? 40 : 250);
    }
  }
});
`,
  );
}

async function collectEvents(events: AsyncIterable<import('@cairn/shared').StepEvent>) {
  const out: import('@cairn/shared').StepEvent[] = [];
  for await (const ev of events) out.push(ev);
  return out;
}

describe('doubao probe and ACP backend', () => {
  test('resolves managed or native doubao binary and fails missing_tool when absent', async () => {
    const dir = tempDir('doubao-resolve-');
    const managedRoot = join(dir, 'tools', 'doubao');
    const managedBinDir = join(managedRoot, 'versions', '2.38.4');
    mkdirSync(managedBinDir, { recursive: true });
    const managedBin = writeStubNodeScript(
      managedBinDir,
      'doubao',
      `if (process.argv[2] === '--version') { console.log('2.38.4'); process.exit(0); }`,
    );
    writeFileSync(
      join(managedBinDir, '.install-complete'),
      JSON.stringify({
        runtime: 'doubao-cli',
        version: '2.38.4',
        url: 'https://lf-flow-web-cdn.doubao.com/obj/flow-doubao/doubao_cli/2.38.4/doubao-cli-2.38.4-darwin-arm64-signed-signed.tar.gz',
        archiveSha256: 'a'.repeat(64),
        binRelPath: 'doubao',
        binSha256: createHash('sha256').update(readFileSync(managedBin)).digest('hex'),
        args: [],
        installedAt: 1,
      }),
      'utf8',
    );
    const managed = createDoubaoManaged({ root: managedRoot, env: { PATH: '' }, realHome: dir });
    expect(managed.current()).toMatchObject({ command: managedBin, version: '2.38.4' });

    const nativeMac = join(
      dir,
      'Library',
      'Application Support',
      'doubao_cli',
      'app',
      'current',
      'doubao',
    );
    mkdirSync(join(dir, 'Library', 'Application Support', 'doubao_cli', 'app', 'current'), {
      recursive: true,
    });
    writeStubNodeScript(
      join(dir, 'Library', 'Application Support', 'doubao_cli', 'app', 'current'),
      'doubao',
      `
if (process.argv[2] === '--version') { console.log('2.38.4'); process.exit(0); }
if (process.argv[2] === 'auth') { console.log('ok'); process.exit(0); }
if (process.argv[2] === 'model') {
  console.log('[cli-chat] fetching');
  console.log(JSON.stringify({ type: 'result', subtype: 'success', result: { type: 'model_list', models: [{ id: '5', name: 'Doubao 2.1 Pro', efforts: ['low', 'medium', 'high'], default_effort: 'medium' }] } }));
  process.exit(0);
}
`,
    );

    const resolved = resolveDoubaoNativeBinary({
      realHome: dir,
      platform: 'darwin',
      env: { PATH: '' },
    });
    expect(resolved).toEqual({ command: nativeMac, source: 'native' });

    const report = await probeDoubaoRuntime({
      realHome: dir,
      platform: 'darwin',
      arch: 'arm64',
      env: { HOME: dir, PATH: '' },
    });
    expect(report).toMatchObject({
      installed: true,
      authenticated: true,
      platformSupported: true,
      version: '2.38.4',
      models: [
        {
          id: '5',
          name: 'Doubao 2.1 Pro',
          thinkingLevels: ['low', 'medium', 'high'],
          thinkingDefault: 'medium',
        },
      ],
    });
    expect(isDoubaoPlatformSupported('darwin', 'arm64')).toBe(true);
    expect(isDoubaoPlatformSupported('linux', 'arm64')).toBe(false);
    expect(
      parseDoubaoModelListOutput(
        '[cli-chat] skip\n{"type":"result","subtype":"success","result":{"type":"model_list","models":[{"id":"4","name":"Turbo","available":false}]}}',
      ),
    ).toEqual([]);

    const missingBackend = createAcpBackend({
      harness: 'doubao',
      command: join(dir, 'missing-doubao'),
      args: ['acp', 'serve'],
      resolveLaunch: () => null,
      allowHostMcp: true,
    });
    await expect(
      missingBackend.createSession({
        provider: { kind: 'http', providerId: 'doubao' },
        modelId: '4',
        cwd: dir,
        prompt: 'hi',
      }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof StepFailureError &&
        err.failureCode === 'missing_tool' &&
        !err.message.includes('`doubao login`'),
    );
    expect(
      agentStepRefusal({
        stepKind: 'build',
        agentTools: undefined,
        runtimeId: 'doubao',
        hasSubscriptionToken: false,
        hasDoubaoHostAuth: false,
      }),
    ).toContain('扫码登录');
  });

  test('maps -32000 auth error in open, session/load, and prompt to auth failure and revokes probe', async () => {
    const dir = tempDir('doubao-auth-');
    let revoked = 0;

    const openStub = makeFakeDoubaoAcpStub(dir, 'auth-open');
    const openBackend = createAcpBackend({
      harness: 'doubao',
      command: openStub,
      args: ['acp', 'serve'],
      allowHostMcp: true,
      onDoubaoAuthFailure: () => {
        revoked += 1;
      },
    });
    await expect(
      openBackend.createSession({
        provider: { kind: 'http', providerId: 'doubao' },
        modelId: '4',
        cwd: dir,
        prompt: 'hi',
      }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof StepFailureError &&
        err.failureCode === 'auth' &&
        err.message.includes('扫码登录') &&
        !err.message.includes('终端运行'),
    );
    expect(revoked).toBe(1);

    const loadStub = makeFakeDoubaoAcpStub(dir, 'auth-load');
    const loadBackend = createAcpBackend({
      harness: 'doubao',
      command: loadStub,
      args: ['acp', 'serve'],
      sessionResume: true,
      allowHostMcp: true,
      onDoubaoAuthFailure: () => {
        revoked += 1;
      },
    });
    await expect(
      loadBackend.continueSession('sess-doubao-1', {
        provider: { kind: 'http', providerId: 'doubao' },
        modelId: '4',
        cwd: dir,
        prompt: 'continue',
      }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof StepFailureError &&
        err.failureCode === 'auth' &&
        err.message.includes('扫码登录') &&
        !err.message.includes('终端运行'),
    );
    expect(revoked).toBe(2);

    const promptStub = makeFakeDoubaoAcpStub(dir, 'auth-prompt');
    const promptBackend = createAcpBackend({
      harness: 'doubao',
      command: promptStub,
      args: ['acp', 'serve'],
      allowHostMcp: true,
      onDoubaoAuthFailure: () => {
        revoked += 1;
      },
    });
    const session = await promptBackend.createSession({
      provider: { kind: 'http', providerId: 'doubao' },
      modelId: '4',
      cwd: dir,
      prompt: 'hi',
    });
    const events = await collectEvents(session.events);
    expect(events.some((e) => e.type === 'error' && e.error.failureCode === 'auth')).toBe(true);
    expect(revoked).toBe(3);
  });

  test('runs bypass_permissions with Cairn stdio MCP and tolerates null mcpServers', async () => {
    const dir = tempDir('doubao-normal-');
    const stub = makeFakeDoubaoAcpStub(dir, 'normal');
    const backend = createAcpBackend({
      harness: 'doubao',
      command: stub,
      args: ['acp', 'serve'],
      allowHostMcp: true,
      permissions: 'allow-once',
    });
    const handle = await backend.createSession({
      provider: { kind: 'http', providerId: 'doubao' },
      modelId: '4',
      cwd: dir,
      mcpServers: undefined,
      prompt: 'hello',
    });
    const events = await collectEvents(handle.events);
    expect(
      events.some(
        (e) => e.type === 'text_delta' && e.text.includes('LIVE_REPLY:bypass_permissions'),
      ),
    ).toBe(true);
    expect(events.some((e) => e.type === 'done')).toBe(true);

    const nullMcpSession = await backend.createSession({
      provider: { kind: 'http', providerId: 'doubao' },
      modelId: '4',
      cwd: dir,
      mcpServers: null as unknown as undefined,
      remoteTools: [
        {
          name: 'cairn_test',
          description: 'test tool',
          parameters: { type: 'object', properties: {} },
        },
      ],
      executeRemoteTool: async () => 'ok',
      prompt: 'hello',
    });
    const nullEvents = await collectEvents(nullMcpSession.events);
    expect(nullEvents.some((e) => e.type === 'done')).toBe(true);
  });

  test('fails closed on restricted turn when modes missing or setMode fails', async () => {
    const dir = tempDir('doubao-restricted-');
    for (const modeBehavior of ['no-modes', 'no-restrictive', 'setmode-fail'] as const) {
      const stub = makeFakeDoubaoAcpStub(dir, modeBehavior);
      const backend = createAcpBackend({
        harness: 'doubao',
        command: stub,
        args: ['acp', 'serve'],
        allowHostMcp: true,
      });
      await expect(
        backend.createSession({
          provider: { kind: 'http', providerId: 'doubao' },
          modelId: '4',
          cwd: dir,
          remoteToolsOnly: true,
          prompt: 'locked',
        }),
      ).rejects.toThrow();
    }

    const permStub = makeFakeDoubaoAcpStub(dir, 'permission-check');
    const permBackend = createAcpBackend({
      harness: 'doubao',
      command: permStub,
      args: ['acp', 'serve'],
      allowHostMcp: true,
    });
    const session = await permBackend.createSession({
      provider: { kind: 'http', providerId: 'doubao' },
      modelId: '4',
      cwd: dir,
      remoteToolsOnly: true,
      prompt: 'try bash',
    });
    const events = await collectEvents(session.events);
    expect(events.some((e) => e.type === 'text_delta' && e.text.includes('MODE=default'))).toBe(
      true,
    );
  });

  test('resumes session/load ignoring replay chunks and handles image degradation, startup timeout, exit, and cancel', async () => {
    const dir = tempDir('doubao-lifecycle-');

    const replayStub = makeFakeDoubaoAcpStub(dir, 'resume-replay');
    const replayBackend = createAcpBackend({
      harness: 'doubao',
      command: replayStub,
      args: ['acp', 'serve'],
      sessionResume: true,
      allowHostMcp: true,
    });
    const resumed = await replayBackend.continueSession('sess-doubao-1', {
      provider: { kind: 'http', providerId: 'doubao' },
      modelId: '4',
      cwd: dir,
      prompt: 'resume',
    });
    expect(resumed.sessionId).toBe('sess-doubao-1');
    const replayEvents = await collectEvents(resumed.events);
    expect(
      replayEvents.some((e) => e.type === 'text_delta' && e.text.includes('STALE_REPLAY')),
    ).toBe(false);
    expect(
      replayEvents.some(
        (e) => e.type === 'text_delta' && e.text.includes('LIVE_REPLY:bypass_permissions'),
      ),
    ).toBe(true);

    await expect(
      replayBackend.createSession({
        provider: { kind: 'http', providerId: 'doubao' },
        modelId: '4',
        cwd: dir,
        promptImages: [{ data: 'ZmFrZQ==', mimeType: 'image/png' }],
        prompt: 'describe',
      }),
    ).rejects.toThrow('doubao ACP backend: image capability is not advertised');

    const hangStub = makeFakeDoubaoAcpStub(dir, 'hang-init');
    const hangBackend = createAcpBackend({
      harness: 'doubao',
      command: hangStub,
      args: ['acp', 'serve'],
      allowHostMcp: true,
      initializeTimeoutMs: 80,
    });
    await expect(
      hangBackend.createSession({
        provider: { kind: 'http', providerId: 'doubao' },
        modelId: '4',
        cwd: dir,
        prompt: 'hang',
      }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof StepFailureError && err.failureCode === 'runtime_startup_timeout',
    );

    const crashStub = makeFakeDoubaoAcpStub(dir, 'crash-open');
    const crashBackend = createAcpBackend({
      harness: 'doubao',
      command: crashStub,
      args: ['acp', 'serve'],
      allowHostMcp: true,
    });
    await expect(
      crashBackend.createSession({
        provider: { kind: 'http', providerId: 'doubao' },
        modelId: '4',
        cwd: dir,
        prompt: 'crash',
      }),
    ).rejects.toSatisfy(
      (err: unknown) => err instanceof StepFailureError && err.failureCode === 'runtime_exited',
    );

    const cancelBackend = createAcpBackend({
      harness: 'doubao',
      command: replayStub,
      args: ['acp', 'serve'],
      allowHostMcp: true,
      cancelTimeoutMs: 80,
    });
    const cancelling = await cancelBackend.createSession({
      provider: { kind: 'http', providerId: 'doubao' },
      modelId: '4',
      cwd: dir,
      prompt: 'wait',
    });
    await cancelling.stop();
    const cancelledEvents = await collectEvents(cancelling.events);
    expect(cancelledEvents.some((e) => e.type === 'message_stop')).toBe(true);
  });

  test('stamps probe timestamp at start and discards in-flight probe across invalidateAuth()', async () => {
    const dir = tempDir('doubao-probe-race-');
    const slowBin = writeStubNodeScript(
      dir,
      'doubao',
      `
if (process.argv[2] === '--version') { console.log('2.38.4'); process.exit(0); }
if (process.argv[2] === 'auth') { setTimeout(() => { console.log('ok'); process.exit(0); }, 60); }
if (process.argv[2] === 'model') { console.log(JSON.stringify({ type: 'result', subtype: 'success', result: { type: 'model_list', models: [] } })); process.exit(0); }
`,
    );
    let tick = 1000;
    const runtimeReport = await probeDoubaoRuntime({
      command: slowBin,
      platform: 'darwin',
      arch: 'arm64',
      env: { HOME: dir, PATH: '' },
      now: () => {
        tick += 500;
        return tick;
      },
    });
    expect(runtimeReport.probedAt).toBe(1500);

    let call = 0;
    let resolveFirst: ((r: import('@cairn/shared').DoubaoReport) => void) | null = null;
    const ctrl = createDoubaoProbeController({
      now: () => 5000,
      probeFn: () => {
        call += 1;
        if (call === 1) {
          return new Promise((resolve) => {
            resolveFirst = resolve;
          });
        }
        return Promise.resolve({
          installed: true,
          authenticated: false,
          platformSupported: true,
          probedAt: 6000,
        });
      },
    });
    const slowRefresh = ctrl.refresh();
    ctrl.invalidateAuth();
    expect(ctrl.current()?.authenticated).toBe(false);
    resolveFirst!({
      installed: true,
      authenticated: true,
      platformSupported: true,
      probedAt: 9999,
    });
    await slowRefresh;
    expect(ctrl.current()?.authenticated).toBe(false);
    const freshRefresh = await ctrl.refresh();
    expect(call).toBe(2);
    expect(freshRefresh.authenticated).toBe(false);
    expect(freshRefresh.probedAt).toBe(6000);
  });
});
