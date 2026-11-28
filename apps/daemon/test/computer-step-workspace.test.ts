import { createHash } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  type ComputerCall,
  type ComputerFrame,
  type MachineComputerFramesBody,
  WORKSPACE_FILE_CWD,
} from '@cairn/shared';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { createComputerDispatcher } from '../src/computer/dispatch.js';
import { HostComputerProvider } from '../src/computer/host.js';
import {
  ensureStepWorkspace,
  stepWorkspacesRoot,
  sweepStagedUploads,
  writeStagedUpload,
} from '../src/computer/staging.js';

const INSTANCE = 'B'.repeat(48);

let allocated: string;
let root: string;
let home: string;
let staging: string;

beforeEach(() => {
  allocated = makeTestTempDir('cairn-step-ws-');
  root = realpathSync(allocated);
  home = path.join(root, 'home');
  staging = path.join(root, 'staging');
  mkdirSync(home);
  mkdirSync(staging, { mode: 0o700 });
});

afterEach(() => {
  expect(releaseTestTempDir(allocated)).toBe(true);
});

function host() {
  return new HostComputerProvider({
    home,
    env: { PATH: process.env.PATH, HOME: home },
    killGraceMs: 200,
    managedCwdRoot: stepWorkspacesRoot(staging),
  });
}

function harness(bind: (dir: string) => string | null = () => INSTANCE) {
  const frames: ComputerFrame[] = [];
  const bound: string[] = [];
  const dispatcher = createComputerDispatcher({
    client: {
      async computerFrames(_callId: string, body: MachineComputerFramesBody) {
        frames.push(...body.frames);
        return { ok: true as const, cancelled: false };
      },
    },
    host: host(),
    stagingRoot: staging,
    workspaceFiles: {
      bind: (dir) => {
        bound.push(dir);
        return bind(dir);
      },
    },
    cairnOrigins: [],
    flushMs: 20,
    heartbeatMs: 5_000,
    retryBaseMs: 5,
    retryMaxMs: 20,
  });
  return { dispatcher, frames, bound };
}

let counter = 0;
function shell(stepId: string, command: string, cwd?: string): ComputerCall {
  counter += 1;
  return {
    callId: counter.toString(16).padStart(64, '0'),
    stepId,
    tool: 'user_computer_shell',
    params: { command, ...(cwd !== undefined ? { cwd } : {}) },
    deadlineAt: Date.now() + 60_000,
  };
}

function output(frames: ComputerFrame[]): string {
  return frames.flatMap((f) => (f.kind === 'output' ? [f.text] : [])).join('');
}

function stepDirectory(stepId: string): string {
  return path.join(
    staging,
    '.step-workspaces',
    createHash('sha256').update(`cairn.step-workspace:${stepId}`).digest('hex').slice(0, 32),
  );
}

describe('managed step workspace for the own-computer shell', () => {
  test(':step-workspace runs in one private per-step directory and stamps the done frame', async () => {
    const run = harness();
    await run.dispatcher.dispatch(shell('step-a', 'pwd', WORKSPACE_FILE_CWD));
    const expected = stepDirectory('step-a');
    expect(output(run.frames).trim()).toBe(expected);
    const info = lstatSync(expected);
    expect(info.isDirectory() && !info.isSymbolicLink()).toBe(true);
    expect(info.mode & 0o077).toBe(0);
    const done = run.frames.find((f) => f.kind === 'done');
    expect(done).toMatchObject({ kind: 'done', exitCode: 0, workspace: INSTANCE });
    expect(run.bound).toEqual([expected]);

    const second = harness();
    await second.dispatcher.dispatch(shell('step-a', 'pwd', WORKSPACE_FILE_CWD));
    expect(output(second.frames).trim()).toBe(expected);
    const other = harness();
    await other.dispatcher.dispatch(shell('step-b', 'pwd', WORKSPACE_FILE_CWD));
    expect(output(other.frames).trim()).toBe(stepDirectory('step-b'));
    expect(stepDirectory('step-b')).not.toBe(expected);
  });

  test('files written there are in the managed directory', async () => {
    const run = harness();
    await run.dispatcher.dispatch(shell('step-a', 'echo hello > report.md', WORKSPACE_FILE_CWD));
    expect(readdirSync(stepDirectory('step-a'))).toEqual(['report.md']);
  });

  test('every other cwd behaves as before and is never stamped', async () => {
    const run = harness();
    await run.dispatcher.dispatch(shell('step-a', 'pwd'));
    mkdirSync(path.join(home, 'proj'));
    await run.dispatcher.dispatch(shell('step-a', 'pwd', 'proj'));
    await run.dispatcher.dispatch(shell('step-a', 'pwd', stepDirectory('step-a')));
    expect(run.bound).toEqual([]);
    expect(run.frames.some((f) => f.kind === 'done' && 'workspace' in f)).toBe(false);
    expect(output(run.frames)).toContain(path.join(home, 'proj'));
    expect(run.frames.filter((f) => f.kind === 'error').length).toBe(1);
    expect(() => lstatSync(path.join(staging, '.step-workspaces'))).toThrow();
  });

  test('a failed binding still runs the command but sends no instance', async () => {
    const run = harness(() => null);
    await run.dispatcher.dispatch(shell('step-a', 'pwd', WORKSPACE_FILE_CWD));
    const done = run.frames.find((f) => f.kind === 'done');
    expect(done).toBeDefined();
    expect(done && 'workspace' in done).toBe(false);
  });

  test('a symlinked or foreign step directory is refused and nothing runs', async () => {
    const container = path.join(staging, '.step-workspaces');
    mkdirSync(container, { mode: 0o700 });
    const outside = path.join(root, 'outside');
    mkdirSync(outside);
    symlinkSync(outside, stepDirectory('step-a'));
    const run = harness();
    await run.dispatcher.dispatch(shell('step-a', 'touch pwned.txt', WORKSPACE_FILE_CWD));
    expect(run.frames.at(-1)).toMatchObject({ kind: 'error', delivery: 'not_delivered' });
    expect(readdirSync(outside)).toEqual([]);
    expect(run.bound).toEqual([]);
  });

  test('the provider accepts a managed cwd only inside the managed root', async () => {
    const provider = host();
    const dir = ensureStepWorkspace(staging, 'step-a');
    const request = { argv: ['true'], timeoutMs: 5_000, signal: new AbortController().signal };
    await expect(provider.execute({ ...request, cwd: home, managedCwd: true })).rejects.toThrow(
      /managed workspace/,
    );
    await expect(provider.execute({ ...request, cwd: staging, managedCwd: true })).rejects.toThrow(
      /managed workspace/,
    );
    await expect(
      provider.execute({ ...request, cwd: stepWorkspacesRoot(staging), managedCwd: true }),
    ).rejects.toThrow(/managed workspace/);
    const alias = path.join(root, 'alias');
    symlinkSync(dir, alias);
    await expect(provider.execute({ ...request, cwd: alias, managedCwd: true })).rejects.toThrow(
      /managed workspace/,
    );
    await expect(provider.execute({ ...request, cwd: dir })).rejects.toThrow(/home folder/);
    const events = await provider.execute({ ...request, cwd: dir, managedCwd: true });
    for await (const event of events) expect(event).toBeDefined();
  });

  test('the staged-upload sweep never deletes managed step workspaces, whatever their age', () => {
    const workspace = ensureStepWorkspace(staging, 'old-step');
    mkdirSync(path.join(workspace, 'deep', 'er'), { recursive: true });
    const nested = path.join(workspace, 'deep', 'er', 'report.md');
    writeFileSync(nested, 'keep me');
    const longAgo = new Date(Date.now() - 1_000 * 3_600_000);
    for (const target of [
      nested,
      path.join(workspace, 'deep', 'er'),
      path.join(workspace, 'deep'),
    ]) {
      utimesSync(target, longAgo, longAgo);
    }
    for (const target of [workspace, stepWorkspacesRoot(staging)]) {
      utimesSync(target, longAgo, longAgo);
    }
    const upload = writeStagedUpload(staging, {
      threadId: 'thread-1',
      attachmentId: 'att-1',
      fileName: 'old.txt',
      bytes: Buffer.from('x'),
    });
    const uploadDirectory = path.dirname(upload.path);
    utimesSync(uploadDirectory, longAgo, longAgo);
    const removed = sweepStagedUploads(staging, { now: Date.now() });
    expect(removed).toEqual(['thread-1']);
    expect(readFileSync(nested, 'utf8')).toBe('keep me');
    expect(readdirSync(stepWorkspacesRoot(staging))).toEqual([path.basename(workspace)]);
    expect(ensureStepWorkspace(staging, 'old-step')).toBe(workspace);
    expect(readFileSync(nested, 'utf8')).toBe('keep me');
  });
});
