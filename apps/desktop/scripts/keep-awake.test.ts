import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { createKeepAwake, type SleepBlockerType } from '../src/keep-awake.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'cairn-awake-'));
  roots.push(root);
  return root;
}

function choicePath(content?: string): string {
  const path = join(tempDir(), 'keep-awake');
  if (content !== undefined) writeFileSync(path, content);
  return path;
}

function fakeBlocker() {
  const starts: SleepBlockerType[] = [];
  const stops: number[] = [];
  let next = 1;
  let failures = 0;
  return {
    starts,
    stops,
    failNext() {
      failures += 1;
    },
    blocker: {
      start(type: SleepBlockerType): number {
        if (failures > 0) {
          failures -= 1;
          throw new Error('power assertion unavailable');
        }
        starts.push(type);
        const id = next;
        next += 1;
        return id;
      },
      stop(id: number): void {
        stops.push(id);
      },
    },
  };
}

describe('the desktop keep-awake choice', () => {
  test('first launch defaults to system and holds nothing while idle', () => {
    const path = choicePath();
    const fake = fakeBlocker();
    const keepAwake = createKeepAwake(fake.blocker, path, { platform: 'linux' });
    expect(keepAwake.mode()).toBe('system');
    expect(readFileSync(path, 'utf8')).toBe('system\n');
    expect(keepAwake.isHolding()).toBe(false);
    expect(fake.starts).toEqual([]);
  });

  test('migrates legacy and invalid choices to canonical modes', () => {
    for (const [before, after] of [
      ['on\n', 'screen-on'],
      ['off\n', 'system'],
      ['sometimes\n', 'system'],
      ['screen-o', 'system'],
    ] as const) {
      const path = choicePath(before);
      const keepAwake = createKeepAwake(fakeBlocker().blocker, path, { platform: 'linux' });
      expect(keepAwake.mode()).toBe(after);
      expect(readFileSync(path, 'utf8')).toBe(`${after}\n`);
    }
    for (const mode of ['screen-on', 'system', 'lid-closed'] as const) {
      const path = choicePath(`${mode}\n`);
      expect(createKeepAwake(fakeBlocker().blocker, path, { platform: 'linux' }).mode()).toBe(mode);
    }
  });

  test('retries a failed persisted write even when the mode is unchanged', () => {
    const path = join(tempDir(), 'missing', 'keep-awake');
    const keepAwake = createKeepAwake(fakeBlocker().blocker, path, { platform: 'linux' });
    expect(keepAwake.mode()).toBe('system');
    mkdirSync(dirname(path), { recursive: true });
    keepAwake.setMode('system');
    expect(readFileSync(path, 'utf8')).toBe('system\n');
  });

  test('a failed selection write keeps the previously effective mode visible', () => {
    const path = join(tempDir(), 'missing', 'keep-awake');
    const keepAwake = createKeepAwake(fakeBlocker().blocker, path, { platform: 'linux' });
    keepAwake.setMode('screen-on');
    expect(keepAwake.mode()).toBe('system');
    mkdirSync(dirname(path), { recursive: true });
    keepAwake.setMode('screen-on');
    expect(keepAwake.mode()).toBe('screen-on');
    expect(readFileSync(path, 'utf8')).toBe('screen-on\n');
  });

  test('requires a live runner as well as in-flight journal rows', () => {
    const fake = fakeBlocker();
    const keepAwake = createKeepAwake(fake.blocker, choicePath(), { platform: 'linux' });
    keepAwake.sync({ runner: 'off', inFlight: 2 });
    expect(fake.starts).toEqual([]);
    keepAwake.sync({ runner: 'on', inFlight: 0 });
    expect(fake.starts).toEqual([]);
    keepAwake.sync({ runner: 'on', inFlight: 1 });
    expect(fake.starts).toEqual(['prevent-app-suspension']);
    expect(keepAwake.isHolding()).toBe(true);
    keepAwake.sync({ runner: 'on', inFlight: 2 });
    expect(fake.starts).toEqual(['prevent-app-suspension']);
    keepAwake.sync({ runner: 'failed', inFlight: 2 });
    expect(fake.stops).toEqual([1]);
    expect(keepAwake.isHolding()).toBe(false);
    keepAwake.sync({ runner: 'starting', inFlight: 2 });
    expect(fake.starts).toEqual(['prevent-app-suspension', 'prevent-app-suspension']);
  });

  test('screen-on wins the display blocker and switching modes stops the old blocker first', () => {
    const path = choicePath('screen-on\n');
    const fake = fakeBlocker();
    const keepAwake = createKeepAwake(fake.blocker, path, { platform: 'win32' });
    keepAwake.sync({ runner: 'on', inFlight: 1 });
    expect(fake.starts).toEqual(['prevent-display-sleep']);
    keepAwake.setMode('system');
    expect(fake.stops).toEqual([1]);
    expect(fake.starts).toEqual(['prevent-display-sleep', 'prevent-app-suspension']);
    expect(readFileSync(path, 'utf8')).toBe('system\n');
  });

  test('non-Mac desktop uses Electron blockers only', () => {
    const fake = fakeBlocker();
    const keepAwake = createKeepAwake(fake.blocker, choicePath('screen-on\n'), {
      platform: 'linux',
    });
    keepAwake.sync({ runner: 'on', inFlight: 1 });
    expect(fake.starts).toEqual(['prevent-display-sleep']);
  });

  test('macOS desktop spawns no Electron blocker because the daemon owns power there', () => {
    const fake = fakeBlocker();
    const keepAwake = createKeepAwake(fake.blocker, choicePath('lid-closed\n'), {
      platform: 'darwin',
    });
    keepAwake.sync({ runner: 'on', inFlight: 1 });
    expect(fake.starts).toEqual([]);
    expect(keepAwake.isHolding()).toBe(false);
  });

  test('blocker failure fails closed and retries', () => {
    const fake = fakeBlocker();
    const keepAwake = createKeepAwake(fake.blocker, choicePath(), { platform: 'linux' });
    fake.failNext();
    expect(() => keepAwake.sync({ runner: 'on', inFlight: 1 })).not.toThrow();
    expect(fake.starts).toEqual([]);
    expect(keepAwake.isHolding()).toBe(false);
    keepAwake.sync({ runner: 'on', inFlight: 1 });
    expect(fake.starts).toEqual(['prevent-app-suspension']);
    expect(keepAwake.isHolding()).toBe(true);
  });
});
