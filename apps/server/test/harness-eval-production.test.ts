import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import type { HarnessEvalDispatchRequest } from '../src/services/harness-eval-coordinator.js';
import {
  createProductionHarnessEvalDispatch,
  defaultHarnessEvalWorkerLaunch,
  type HarnessEvalWorkerLaunch,
  type HarnessEvalWorkerSpawn,
  productionHarnessEvalConfig,
  resolveHarnessEvalWorkerScript,
  resolveHarnessEvalWorkerScriptFrom,
} from '../src/services/harness-eval-production.js';

describe('production harness eval dispatch (#1979)', () => {
  test('resolved worker script exists under the src layout (tsx / vitest)', () => {
    const script = resolveHarnessEvalWorkerScript();
    expect(existsSync(script)).toBe(true);
    expect(script.endsWith('harness-eval-worker.mjs')).toBe(true);
  });

  test('bundle layout (dist/) picks packaged or repo scripts, not a path outside the repo', () => {
    const distHere = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
    const escaped = resolve(distHere, '../../../../scripts/harness-eval-worker.mjs');
    const packaged = resolve(distHere, 'harness-eval-worker.mjs');
    const repo = resolve(distHere, '../../../scripts/harness-eval-worker.mjs');
    expect(existsSync(escaped)).toBe(false);
    expect(existsSync(repo)).toBe(true);
    const resolved = resolveHarnessEvalWorkerScriptFrom(distHere);
    expect(resolved === packaged || resolved === repo).toBe(true);
    expect(existsSync(resolved)).toBe(true);
  });

  test('defaultHarnessEvalWorkerLaunch resolves an existing script before spawn', async () => {
    const calls: { command: string; args: readonly string[] }[] = [];
    const fakeSpawn = ((command: string, args: readonly string[]) => {
      calls.push({ command, args });
      const child = new EventEmitter();
      const handle: ReturnType<HarnessEvalWorkerSpawn> = {
        once: (event, listener) => {
          child.once(event, listener as (...args: unknown[]) => void);
          return handle;
        },
        unref: () => handle,
      };
      queueMicrotask(() => child.emit('spawn'));
      return handle;
    }) satisfies HarnessEvalWorkerSpawn;
    await defaultHarnessEvalWorkerLaunch(
      {
        repo: 'xiechimon/cairn',
        pr: 1979,
        ticket: '1979',
        expectedHead: 'b'.repeat(40),
        patchDigest: `pd2:${'a'.repeat(64)}`,
        workerId: 'w1',
        attemptId: 'a1',
      },
      fakeSpawn,
    );
    expect(calls).toHaveLength(1);
    const script = calls[0]?.args[0];
    expect(typeof script).toBe('string');
    expect(existsSync(script!)).toBe(true);
    expect(script!.endsWith('harness-eval-worker.mjs')).toBe(true);
    expect(calls[0]?.args).toEqual([
      script,
      '--repo',
      'xiechimon/cairn',
      '--pr',
      '1979',
      '--ticket',
      '1979',
      '--expected-head',
      'b'.repeat(40),
      '--patch-digest',
      `pd2:${'a'.repeat(64)}`,
    ]);
  });

  test('launch receives ticket, expectedHead, and digest — empty async is not enough', async () => {
    const launched: Parameters<HarnessEvalWorkerLaunch>[0][] = [];
    const dispatch = createProductionHarnessEvalDispatch(async (input) => {
      launched.push(input);
    });
    const request: HarnessEvalDispatchRequest = {
      repo: 'xiechimon/cairn',
      pr: 1979,
      patchDigest: `pd2:${'a'.repeat(64)}`,
      workerId: 'w1',
      attemptId: 'a1',
      ticket: '1979',
      expectedHead: 'b'.repeat(40),
    };
    await dispatch(request);
    expect(launched).toEqual([
      {
        repo: 'xiechimon/cairn',
        pr: 1979,
        ticket: '1979',
        expectedHead: 'b'.repeat(40),
        patchDigest: request.patchDigest,
        workerId: 'w1',
        attemptId: 'a1',
      },
    ]);
  });

  test('refuses to launch when ticket or expectedHead is missing', async () => {
    const launched: unknown[] = [];
    const dispatch = createProductionHarnessEvalDispatch(async (input) => {
      launched.push(input);
    });
    await expect(
      dispatch({
        repo: 'xiechimon/cairn',
        pr: 1979,
        patchDigest: `pd2:${'a'.repeat(64)}`,
        workerId: 'w1',
        attemptId: 'a1',
      }),
    ).rejects.toThrow(/ticket|expectedHead/i);
    expect(launched).toEqual([]);
  });

  test('productionHarnessEvalConfig defaults to a launching dispatcher', async () => {
    const cfg = productionHarnessEvalConfig();
    expect(cfg.dispatchAuthorized).toBe(true);
    expect(typeof cfg.dispatch).toBe('function');
    await expect(
      cfg.dispatch({
        repo: 'xiechimon/cairn',
        pr: 1979,
        patchDigest: `pd2:${'a'.repeat(64)}`,
        workerId: 'w1',
        attemptId: 'a1',
      }),
    ).rejects.toThrow(/ticket|expectedHead/i);
  });
});
