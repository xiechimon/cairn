import { EventEmitter } from 'node:events';
import { unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { StepJournal } from '../src/journal.js';
import { createTaskSleepPrevention } from '../src/task-sleep-prevention.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) releaseTestTempDir(root);
});

function tempDir(): string {
  const root = makeTestTempDir('cairn-sleep-');
  roots.push(root);
  return root;
}

class FakeCaffeinate extends EventEmitter {
  kill = vi.fn(() => true);
  unref = vi.fn();
}

function harness(opts: { modeFile?: string; platform?: NodeJS.Platform; enabled?: boolean } = {}) {
  const events: string[] = [];
  const children: FakeCaffeinate[] = [];
  let pending = false;
  const prevention = createTaskSleepPrevention({
    enabled: opts.enabled ?? true,
    platform: opts.platform ?? 'darwin',
    pid: 123,
    ...(opts.modeFile !== undefined ? { modeFile: opts.modeFile } : {}),
    hasPending: () => pending,
    spawn: (_command, args) => {
      const child = new FakeCaffeinate();
      children.push(child);
      events.push(`spawn:${args.slice(0, -2).join('')}`);
      return child;
    },
    log: (line) => events.push(`log:${line}`),
  });
  return {
    prevention,
    children,
    events,
    setPending(value: boolean) {
      pending = value;
    },
  };
}

function journal(dir: string): StepJournal {
  return new StepJournal(join(dir, 'outbox'));
}

function claim(journal: StepJournal, stepId: string): void {
  journal.claim({
    stepId,
    buildId: 'build',
    kind: 'plan',
    conversationId: 'conversation',
    sessionAction: 'new',
    prompt: null,
    claimed: null,
  });
}

describe('task-scoped caffeinate', () => {
  test('starts at claim and releases only after the last pending step', () => {
    const { prevention, children, events, setPending } = harness();
    prevention.sync();
    expect(children).toEqual([]);
    prevention.claim();
    expect(children).toHaveLength(1);
    expect(events).toEqual(['spawn:-i']);
    expect(children[0]?.kill).not.toHaveBeenCalled();
    setPending(true);
    prevention.sync();
    expect(children).toHaveLength(1);
    setPending(false);
    prevention.sync();
    expect(children[0]?.kill).toHaveBeenCalledTimes(1);
    expect(prevention.isHolding()).toBe(false);
  });

  test('claim applies power before the step launch callback returns', () => {
    const { prevention, children } = harness();
    let afterClaim = false;
    prevention.claim();
    afterClaim = children.length === 1;
    expect(afterClaim).toBe(true);
    prevention.stop();
  });

  test('unknown journal state fails closed and a readable pending row re-acquires', () => {
    const dir = tempDir();
    const steps = journal(dir);
    writeFileSync(join(dir, 'outbox', 'step-broken.json'), '{broken');
    let useJournal = false;
    const { prevention, children } = harness();
    const withJournal = createTaskSleepPrevention({
      enabled: true,
      platform: 'darwin',
      pid: 123,
      hasPending: () => useJournal && steps.pending().length > 0,
      spawn: preventionSpawn(children),
    });
    prevention.stop();
    withJournal.sync();
    expect(children).toHaveLength(0);
    useJournal = true;
    withJournal.sync();
    expect(children).toHaveLength(0);
    claim(steps, 's1');
    withJournal.sync();
    expect(children).toHaveLength(1);
    steps.remove('s1');
    withJournal.sync();
    expect(children[0]?.kill).toHaveBeenCalledTimes(1);
    withJournal.stop();
  });

  test('a throwing journal read fails closed and a later readable pending row re-acquires', () => {
    const children: FakeCaffeinate[] = [];
    const events: string[] = [];
    let journalError: Error | null = new Error('outbox unavailable');
    const prevention = createTaskSleepPrevention({
      enabled: true,
      platform: 'darwin',
      pid: 123,
      hasPending: () => {
        if (journalError !== null) throw journalError;
        return true;
      },
      spawn: preventionSpawn(children),
      log: (line) => events.push(line),
    });
    expect(() => prevention.sync()).not.toThrow();
    expect(children).toHaveLength(0);
    prevention.sync();
    expect(
      events.filter((line) => line.includes('the step journal could not be read')),
    ).toHaveLength(1);
    journalError = null;
    prevention.sync();
    expect(children).toHaveLength(1);
    prevention.stop();
  });

  test('awaiting-upload holds and terminal removal releases', () => {
    const dir = tempDir();
    const steps = journal(dir);
    claim(steps, 's1');
    const { prevention, children } = harness();
    const scoped = createTaskSleepPrevention({
      enabled: true,
      platform: 'darwin',
      pid: 123,
      hasPending: () => steps.pending().length > 0,
      spawn: preventionSpawn(children),
    });
    prevention.stop();
    steps.update('s1', { state: 'awaiting-upload' });
    scoped.sync();
    expect(children).toHaveLength(1);
    steps.remove('s1');
    scoped.sync();
    expect(children[0]?.kill).toHaveBeenCalledTimes(1);
    scoped.stop();
  });

  test('replaces the child once per mode change', () => {
    const modeFile = join(tempDir(), 'keep-awake');
    writeFileSync(modeFile, 'system\n');
    const { prevention, children, events, setPending } = harness({ modeFile });
    setPending(true);
    prevention.sync();
    writeFileSync(modeFile, 'screen-on\n');
    prevention.sync();
    expect(events).toEqual(['spawn:-i', 'spawn:-d-i']);
    expect(children[0]?.kill).toHaveBeenCalledTimes(1);
    expect(children[1]?.kill).not.toHaveBeenCalled();
    writeFileSync(modeFile, 'lid-closed\n');
    prevention.sync();
    expect(events).toEqual(['spawn:-i', 'spawn:-d-i', 'spawn:-s-i']);
    expect(children[1]?.kill).toHaveBeenCalledTimes(1);
    prevention.stop();
  });

  test('a deleted mode file falls back to system instead of the last valid mode', () => {
    const modeFile = join(tempDir(), 'keep-awake');
    writeFileSync(modeFile, 'screen-on\n');
    const { prevention, children, events, setPending } = harness({ modeFile });
    setPending(true);
    prevention.sync();
    unlinkSync(modeFile);
    prevention.sync();
    expect(events).toEqual(['spawn:-d-i', 'spawn:-i']);
    expect(children[0]?.kill).toHaveBeenCalledTimes(1);
    prevention.stop();
  });

  test('lid mode uses the AC-only system-sleep assertion flags', () => {
    const modeFile = join(tempDir(), 'keep-awake');
    writeFileSync(modeFile, 'lid-closed\n');
    const spawns: string[][] = [];
    const prevention = createTaskSleepPrevention({
      enabled: true,
      platform: 'darwin',
      pid: 123,
      modeFile,
      hasPending: () => true,
      spawn: (_command, args) => {
        spawns.push(args);
        return new FakeCaffeinate();
      },
    });
    prevention.sync();
    expect(spawns).toEqual([['-s', '-i', '-w', '123']]);
    prevention.stop();
  });

  test('async child failure is retried without clearing the replacement', () => {
    const { prevention, children, setPending } = harness();
    setPending(true);
    prevention.sync();
    children[0]?.emit('error', new Error('missing caffeinate'));
    prevention.sync();
    expect(children).toHaveLength(2);
    children[0]?.emit('exit', 1, null);
    expect(children[1]?.kill).not.toHaveBeenCalled();
    expect(prevention.isHolding()).toBe(true);
    prevention.stop();
  });

  test('stop kills the child and every spawn watches the daemon pid', () => {
    const spawns: string[][] = [];
    const child = new FakeCaffeinate();
    const prevention = createTaskSleepPrevention({
      enabled: true,
      platform: 'darwin',
      pid: 4321,
      hasPending: () => true,
      spawn: (_command, args) => {
        spawns.push(args);
        return child;
      },
    });
    prevention.sync();
    expect(spawns[0]).toEqual(['-i', '-w', '4321']);
    prevention.stop();
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  test('non-Mac or disabled prevention never spawns caffeinate', () => {
    for (const opts of [{ platform: 'linux' as const }, { enabled: false }]) {
      const { prevention, children, setPending } = harness(opts);
      setPending(true);
      prevention.claim();
      prevention.sync();
      expect(children).toEqual([]);
      prevention.stop();
    }
  });
});

function preventionSpawn(children: FakeCaffeinate[]) {
  return () => {
    const child = new FakeCaffeinate();
    children.push(child);
    return child;
  };
}
