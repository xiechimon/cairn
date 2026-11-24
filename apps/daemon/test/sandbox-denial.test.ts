import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type {
  ComputerCall,
  ComputerFrame,
  MachineComputerFramesBody,
  MachineComputerFramesResponse,
} from '@cairn/shared';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { createHostShellConfinement } from '../src/backend/host-shell-confinement.js';
import { detectHostShellSandboxDenial } from '../src/backend/sandbox-denial.js';
import { createComputerDispatcher } from '../src/computer/dispatch.js';
import { HostComputerProvider } from '../src/computer/host.js';

let allocatedRoot: string;
let root: string;
let home: string;

beforeEach(() => {
  allocatedRoot = makeTestTempDir('cairn-sbx-denial-');
  root = realpathSync(allocatedRoot);
  home = path.join(root, 'home');
  mkdirSync(path.join(home, '.ssh'), { recursive: true });
  writeFileSync(path.join(home, '.ssh', 'id_ed25519'), 'PRIVATE-KEY-SENTINEL\n');
});

afterEach(() => {
  expect(releaseTestTempDir(allocatedRoot)).toBe(true);
});

function fakeClient() {
  const frames: ComputerFrame[] = [];
  return {
    frames,
    client: {
      async computerFrames(
        _callId: string,
        body: MachineComputerFramesBody,
      ): Promise<MachineComputerFramesResponse> {
        frames.push(...body.frames);
        return { ok: true, cancelled: false };
      },
    },
  };
}

function shellCall(overrides: Partial<ComputerCall> & { command: string }): ComputerCall {
  const { command, ...rest } = overrides;
  return {
    callId: 'b'.repeat(64),
    stepId: 'step-sbx-1',
    tool: 'user_computer_shell',
    params: { command },
    deadlineAt: Date.now() + 30_000,
    ...rest,
  };
}

const FAST = { flushMs: 10, heartbeatMs: 5_000, retryBaseMs: 5, retryMaxMs: 20, cairnOrigins: [] };

describe('detectHostShellSandboxDenial', () => {
  test('classifies macOS nested sandbox failure (qlmanage) as sandbox denied', () => {
    const result = detectHostShellSandboxDenial({
      exitCode: 255,
      stderr: 'sandbox initialization failed: Operation not permitted\n',
      stdout: '',
      platform: 'darwin',
    });
    expect(result).not.toBeNull();
    expect(result?.reason).toMatch(/nested sandbox|sandbox initialization failed/i);
  });

  test('classifies macOS Seatbelt file read and exec EPERM as sandbox denied', () => {
    const readDenied = detectHostShellSandboxDenial({
      exitCode: 1,
      stderr: 'cat: /Users/owner/.ssh/id_ed25519: Operation not permitted\n',
      stdout: '',
      platform: 'darwin',
    });
    expect(readDenied?.reason).toContain('Operation not permitted');

    const execDenied = detectHostShellSandboxDenial({
      exitCode: 126,
      stderr: 'bash: line 1: /usr/bin/osascript: Operation not permitted\n',
      stdout: '',
      platform: 'darwin',
    });
    expect(execDenied?.reason).toContain('Operation not permitted');
  });

  test('classifies Linux bwrap, read-only, SIGSYS, and denied-path permission errors', () => {
    expect(
      detectHostShellSandboxDenial({
        exitCode: 1,
        stderr: 'bwrap: Creating new namespace failed: Operation not permitted\n',
        stdout: '',
        platform: 'linux',
      }),
    ).not.toBeNull();

    expect(
      detectHostShellSandboxDenial({
        exitCode: 1,
        stderr: 'bash: /home/owner/.npmrc: Read-only file system\n',
        stdout: '',
        platform: 'linux',
      }),
    ).not.toBeNull();

    expect(
      detectHostShellSandboxDenial({
        exitCode: 159,
        stderr: '',
        stdout: '',
        platform: 'linux',
      }),
    ).not.toBeNull();

    expect(
      detectHostShellSandboxDenial({
        exitCode: 1,
        stderr: 'connect: /var/run/docker.sock: permission denied\n',
        stdout: '',
        platform: 'linux',
        isDeniedPath: (candidate) => candidate === '/var/run/docker.sock',
      }),
    ).not.toBeNull();
  });

  test('does not misclassify ordinary failures or doc text mentioning sandbox', () => {
    expect(
      detectHostShellSandboxDenial({
        exitCode: 0,
        stderr: 'Operation not permitted\n',
        stdout: '',
        platform: 'darwin',
      }),
    ).toBeNull();

    expect(
      detectHostShellSandboxDenial({
        exitCode: 1,
        stderr: 'ls: /tmp/does-not-exist: No such file or directory\n',
        stdout: '',
        platform: 'darwin',
      }),
    ).toBeNull();

    expect(
      detectHostShellSandboxDenial({
        exitCode: 1,
        stderr: '',
        stdout: 'This document discusses sandbox design.\n',
        platform: 'darwin',
      }),
    ).toBeNull();

    expect(
      detectHostShellSandboxDenial({
        exitCode: 1,
        stderr: 'cat: /tmp/chmod000.txt: Permission denied\n',
        stdout: '',
        platform: 'darwin',
        isDeniedPath: () => false,
      }),
    ).toBeNull();
  });
});

describe('dispatcher sandbox denial & single-shot escalation boundary', () => {
  test('sandboxed denial emits sandboxDenied on done frame; params.escalate alone is ignored', async () => {
    if (process.platform !== 'darwin' || !existsSync('/usr/bin/sandbox-exec')) return;
    const confinement = createHostShellConfinement({ home, platform: 'darwin' });
    const host = new HostComputerProvider({
      home,
      env: { PATH: process.env.PATH, HOME: home },
      confinement,
      killGraceMs: 200,
    });

    const api = fakeClient();
    await createComputerDispatcher({
      client: api.client,
      host,
      hostConfinement: confinement,
      ...FAST,
    }).dispatch(
      shellCall({
        command: `cat "${path.join(home, '.ssh', 'id_ed25519')}"`,
        params: { command: `cat "${path.join(home, '.ssh', 'id_ed25519')}"`, escalate: true },
      }),
    );

    const done = api.frames.find((frame) => frame.kind === 'done');
    expect(done).toBeDefined();
    expect(done?.kind === 'done' ? done.exitCode : 0).not.toBe(0);
    expect(done?.kind === 'done' ? done.sandboxDenied : undefined).toEqual({
      reason: expect.stringContaining('Operation not permitted'),
    });
    const out = api.frames
      .filter((frame) => frame.kind === 'output')
      .map((frame) => (frame.kind === 'output' ? frame.text : ''))
      .join('');
    expect(out).not.toContain('PRIVATE-KEY-SENTINEL');
  });

  test('server-stamped hostShellEscalation=approved runs unsandboxed once while hardline stays refused', async () => {
    if (process.platform !== 'darwin' || !existsSync('/usr/bin/sandbox-exec')) return;
    const confinement = createHostShellConfinement({ home, platform: 'darwin' });
    const host = new HostComputerProvider({
      home,
      env: { PATH: process.env.PATH, HOME: home },
      confinement,
      killGraceMs: 200,
    });

    const allowedApi = fakeClient();
    await createComputerDispatcher({
      client: allowedApi.client,
      host,
      hostConfinement: confinement,
      ...FAST,
    }).dispatch(
      shellCall({
        command: `cat "${path.join(home, '.ssh', 'id_ed25519')}"`,
        hostShellEscalation: 'approved',
      }),
    );

    const allowedDone = allowedApi.frames.find((frame) => frame.kind === 'done');
    expect(allowedDone?.kind).toBe('done');
    expect(allowedDone?.kind === 'done' ? allowedDone.exitCode : -1).toBe(0);
    expect(allowedDone?.kind === 'done' ? allowedDone.sandboxDenied : 'x').toBeUndefined();
    const out = allowedApi.frames
      .filter((frame) => frame.kind === 'output')
      .map((frame) => (frame.kind === 'output' ? frame.text : ''))
      .join('');
    expect(out).toContain('PRIVATE-KEY-SENTINEL');

    const hardlineApi = fakeClient();
    await createComputerDispatcher({
      client: hardlineApi.client,
      host,
      hostConfinement: confinement,
      ...FAST,
    }).dispatch(
      shellCall({
        callId: 'c'.repeat(64),
        command: 'rm -rf ~',
        hostShellEscalation: 'approved',
      }),
    );
    expect(hardlineApi.frames).toEqual([
      expect.objectContaining({ kind: 'error', delivery: 'not_delivered' }),
    ]);
  });
});
