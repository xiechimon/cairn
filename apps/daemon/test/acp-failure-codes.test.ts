import { spawn } from 'node:child_process';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SessionOpts, StepEvent } from '@cairn/shared';
import { afterEach, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { createAcpBackend, createGeminiBackend } from '../src/backend/acp.js';
import { SessionNotResumableError, StepFailureError } from '../src/backend/errors.js';

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

function writeExecutableScript(dir: string, name: string, nodeSource: string): string {
  const file = join(dir, `${name}.sh`);
  writeFileSync(
    file,
    `#!/bin/sh\nexec ${shQuote(process.execPath)} --input-type=module -e ${shQuote(nodeSource)} -- "$0" "$@"\n`,
  );
  chmodSync(file, 0o755);
  return file;
}

function sessionOpts(cwd: string): SessionOpts {
  return {
    provider: { kind: 'api_key', providerId: 'antigravity' },
    modelId: 'gemini-4-hydrogen',
    cwd,
    prompt: 'Fix the issue.',
  };
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForPidExit(pid: number, timeoutMs = 2_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return !isPidAlive(pid);
}

describe('ACP structured failure codes (real child processes)', () => {
  test('process exit during initialize yields runtime_exited without leaking stderr into failureDetail', async () => {
    const dir = tempDir('acp-exit-init');
    const bin = writeExecutableScript(
      dir,
      'agy-exit',
      ['process.stderr.write("rate limit 429 sk-secret-token-value\\n");', 'process.exit(1);'].join(
        '\n',
      ),
    );
    const backend = createAcpBackend({
      harness: 'antigravity',
      command: bin,
      args: ['acp'],
      initializeTimeoutMs: 2_000,
    });
    let caught: unknown;
    try {
      await backend.createSession(sessionOpts(dir));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(StepFailureError);
    const failure = caught as StepFailureError;
    expect(failure.failureCode).toBe('runtime_exited');
    expect(failure.failureDetail).toEqual({ runtime: 'antigravity', exitCode: 1 });
    expect(JSON.stringify(failure.failureDetail)).not.toContain('sk-secret-token-value');
  });

  test('startup timeout during initialize yields runtime_startup_timeout with timeoutMs', async () => {
    const dir = tempDir('acp-timeout-init');
    const bin = writeExecutableScript(
      dir,
      'agy-hang',
      ['setTimeout(() => {}, 10_000);'].join('\n'),
    );
    const backend = createAcpBackend({
      harness: 'antigravity',
      command: bin,
      args: ['acp'],
      initializeTimeoutMs: 150,
    });
    let caught: unknown;
    try {
      await backend.createSession(sessionOpts(dir));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(StepFailureError);
    const failure = caught as StepFailureError;
    expect(failure.failureCode).toBe('runtime_startup_timeout');
    expect(failure.failureDetail).toEqual({ runtime: 'antigravity', timeoutMs: 150 });
  });

  test('mid-prompt crash emits runtime_exited promptly even when a grandchild holds stdout open', async () => {
    const dir = tempDir('acp-mid-crash');
    const pidFile = join(dir, 'grandchild.pid');
    const bin = writeExecutableScript(
      dir,
      'agy-grandchild',
      [
        "import { createInterface } from 'node:readline';",
        "import { spawn } from 'node:child_process';",
        "import { writeFileSync } from 'node:fs';",
        'const send = (obj) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...obj }) + "\\n");',
        'const modelConfig = [{ id: "model", name: "Model", category: "model", type: "select", currentValue: "gemini-4-hydrogen", options: [{ value: "gemini-4-hydrogen", name: "Gemini 4 Hydrogen" }] }];',
        'for await (const line of createInterface({ input: process.stdin })) {',
        '  const msg = JSON.parse(line);',
        '  if (msg.method === "initialize") {',
        '    send({ id: msg.id, result: { protocolVersion: msg.params.protocolVersion, agentCapabilities: {} } });',
        '  } else if (msg.method === "session/new") {',
        '    send({ id: msg.id, result: { sessionId: "ag-crash-1", configOptions: modelConfig } });',
        '  } else if (msg.method === "session/set_config_option") {',
        '    send({ id: msg.id, result: { configOptions: [] } });',
        '  } else if (msg.method === "session/prompt") {',
        `    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { stdio: ['ignore', 'inherit', 'ignore'] });`,
        `    writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));`,
        '    process.exit(1);',
        '  }',
        '}',
      ].join('\n'),
    );
    const backend = createAcpBackend({
      harness: 'antigravity',
      command: bin,
      args: ['acp'],
      initializeTimeoutMs: 2_000,
    });
    const handle = await backend.createSession(sessionOpts(dir));
    const events: StepEvent[] = [];
    for await (const ev of handle.events) events.push(ev);
    const errorEvent = events.find((ev) => ev.type === 'error');
    expect(errorEvent).toEqual({
      type: 'error',
      error: expect.objectContaining({
        retryable: false,
        processCrash: true,
        failureCode: 'runtime_exited',
        failureDetail: { runtime: 'antigravity', exitCode: 1 },
      }),
    });
    const grandchildPid = Number(readFileSync(pidFile, 'utf8').trim());
    expect(Number.isInteger(grandchildPid) && grandchildPid > 0).toBe(true);
    const exited = await waitForPidExit(grandchildPid);
    if (!exited) {
      try {
        process.kill(grandchildPid, 'SIGKILL');
      } catch {}
    }
    expect(exited).toBe(true);
  }, 5_000);

  test('SessionNotResumableError fallback stays intact when live child rejects resume', async () => {
    const dir = tempDir('acp-resume-miss');
    const bin = writeExecutableScript(
      dir,
      'agy-resume-miss',
      [
        "import { createInterface } from 'node:readline';",
        'const send = (obj) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...obj }) + "\\n");',
        'for await (const line of createInterface({ input: process.stdin })) {',
        '  const msg = JSON.parse(line);',
        '  if (msg.method === "initialize") {',
        '    send({ id: msg.id, result: { protocolVersion: msg.params.protocolVersion, agentCapabilities: { sessionCapabilities: { resume: {} } } } });',
        '  } else if (msg.method === "session/resume") {',
        '    send({ id: msg.id, error: { code: -32602, message: "session not found" } });',
        '  }',
        '}',
      ].join('\n'),
    );
    const backend = createAcpBackend({
      harness: 'antigravity',
      command: bin,
      args: ['acp'],
      sessionResume: true,
      initializeTimeoutMs: 2_000,
    });
    let caught: unknown;
    try {
      await backend.continueSession?.('missing-session', sessionOpts(dir));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SessionNotResumableError);
    expect(caught).not.toBeInstanceOf(StepFailureError);
  });

  test('non-interactive auth stderr followed by exit(1) during initialize emits auth, not runtime_exited', async () => {
    const dir = tempDir('acp-non-interactive-auth-init');
    const bin = writeExecutableScript(
      dir,
      'agy-auth-stderr-exit',
      [
        'process.stderr.write("Authentication required: not logged in\\n");',
        'process.exit(1);',
      ].join('\n'),
    );
    const backend = createAcpBackend({
      harness: 'antigravity',
      command: bin,
      args: ['acp'],
      initializeTimeoutMs: 2_000,
    });
    let caught: unknown;
    try {
      await backend.createSession(sessionOpts(dir));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(StepFailureError);
    const failure = caught as StepFailureError;
    expect(failure.failureCode).toBe('auth');
    expect(failure.failureDetail).toEqual({ runtime: 'antigravity' });
  });

  test('non-interactive auth stderr followed by exit(1) mid-prompt emits auth without processCrash', async () => {
    const dir = tempDir('acp-non-interactive-auth-prompt');
    const bin = writeExecutableScript(
      dir,
      'agy-auth-prompt-exit',
      [
        "import { createInterface } from 'node:readline';",
        'const send = (obj) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...obj }) + "\\n");',
        'const modelConfig = [{ id: "model", name: "Model", category: "model", type: "select", currentValue: "gemini-4-hydrogen", options: [{ value: "gemini-4-hydrogen", name: "Gemini 4 Hydrogen" }] }];',
        'for await (const line of createInterface({ input: process.stdin })) {',
        '  const msg = JSON.parse(line);',
        '  if (msg.method === "initialize") {',
        '    send({ id: msg.id, result: { protocolVersion: msg.params.protocolVersion, agentCapabilities: {} } });',
        '  } else if (msg.method === "session/new") {',
        '    send({ id: msg.id, result: { sessionId: "ag-auth-1", configOptions: modelConfig } });',
        '  } else if (msg.method === "session/set_config_option") {',
        '    send({ id: msg.id, result: { configOptions: [] } });',
        '  } else if (msg.method === "session/prompt") {',
        '    process.stderr.write("Authentication required: not logged in\\n");',
        '    process.exit(1);',
        '  }',
        '}',
      ].join('\n'),
    );
    const backend = createAcpBackend({
      harness: 'antigravity',
      command: bin,
      args: ['acp'],
      initializeTimeoutMs: 2_000,
    });
    const handle = await backend.createSession(sessionOpts(dir));
    const events: StepEvent[] = [];
    for await (const ev of handle.events) events.push(ev);
    const errorEvent = events.find((ev) => ev.type === 'error');
    expect(errorEvent).toEqual({
      type: 'error',
      error: expect.objectContaining({
        retryable: false,
        failureCode: 'auth',
        failureDetail: { runtime: 'antigravity' },
      }),
    });
    if (errorEvent?.type === 'error') {
      expect(errorEvent.error.processCrash).not.toBe(true);
    }
  });

  test('interactive browser auth stderr followed immediately by exit(1) emits auth', async () => {
    const dir = tempDir('acp-auth-then-exit');
    const bin = writeExecutableScript(
      dir,
      'agy-auth-exit',
      [
        'process.stderr.write("Open the following link to authenticate: https://example.test/auth\\n");',
        'process.exit(1);',
      ].join('\n'),
    );
    const backend = createAcpBackend({
      harness: 'antigravity',
      command: bin,
      args: ['acp'],
      initializeTimeoutMs: 2_000,
    });
    let caught: unknown;
    try {
      await backend.createSession(sessionOpts(dir));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(StepFailureError);
    const failure = caught as StepFailureError;
    expect(failure.failureCode).toBe('auth');
    expect(failure.failureDetail).toEqual({ runtime: 'antigravity' });
  });

  test('missing executable yields missing_tool with runtime and tool detail', async () => {
    const dir = tempDir('acp-missing-bin');
    const missingBin = join(dir, 'does-not-exist-agy');
    const backend = createAcpBackend({
      harness: 'antigravity',
      command: missingBin,
      args: ['acp'],
      initializeTimeoutMs: 2_000,
      spawnProcess: spawn,
    });
    let caught: unknown;
    try {
      await backend.createSession(sessionOpts(dir));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(StepFailureError);
    const failure = caught as StepFailureError;
    expect(failure.failureCode).toBe('missing_tool');
    expect(failure.failureDetail).toEqual({ runtime: 'antigravity', tool: 'does-not-exist-agy' });
  });

  test('non-adapter Gemini preserves captured stderr message when stdout closes before exit', async () => {
    const dir = tempDir('acp-gemini-eof-stderr');
    const bin = writeExecutableScript(
      dir,
      'gemini-eof-stderr',
      [
        'process.stderr.write("Authentication required: not logged in\\n");',
        'process.stdout.end();',
        'setTimeout(() => process.exit(1), 40);',
      ].join('\n'),
    );
    const backend = createGeminiBackend({
      executablePath: bin,
    });
    let caught: unknown;
    try {
      await backend.createSession({
        provider: { kind: 'api_key', providerId: 'google' },
        modelId: 'gemini-2.5-pro',
        cwd: dir,
        prompt: 'Fix it.',
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(StepFailureError);
    const failure = caught as StepFailureError;
    expect(failure.failureCode).toBe('auth');
    expect(failure.message).toContain('Authentication required: not logged in');
  });
});
