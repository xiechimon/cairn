import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { StepJournal } from '../../daemon/src/journal.js';
import { LOCAL_CONNECTION_ID, runnerHomeForConnection } from '../src/connections.js';
import {
  AWAY_FROM_CAIRN_MS,
  createIdleWatch,
  type IdleSample,
  LOCKED_FOR_MS,
  NO_INPUT_FOR_MS,
  STEP_WAIT_CAP_MS,
} from '../src/idle-update.js';
import { parseRelaunchWindow, relaunchWindowOf, restoredUrl } from '../src/relaunch-window.js';
import { runnerStepsInFlight } from '../src/runner-activity.js';

const MINUTE = 60_000;
const START = 1_000_000;

function sample(at: number, change: Partial<IdleSample> = {}): IdleSample {
  return {
    now: START + at,
    ready: true,
    guardSettled: true,
    locked: false,
    inputIdleMs: 0,
    cairnFocused: true,
    turnInFlight: false,
    dialogOpen: false,
    stepsInFlight: 0,
    ...change,
  };
}

describe('when a downloaded update applies by itself', () => {
  test('never while the user types in Cairn, however long the window stays open', () => {
    const watch = createIdleWatch();
    for (let minute = 0; minute <= 24 * 60; minute += 30) {
      expect(watch.sample(sample(minute * MINUTE))).toEqual({ apply: false, hold: 'in-use' });
    }
  });

  test('a reader who does not touch the keyboard is left alone until 15 minutes pass', () => {
    const watch = createIdleWatch();
    expect(watch.sample(sample(0, { inputIdleMs: NO_INPUT_FOR_MS - MINUTE }))).toEqual({
      apply: false,
      hold: 'in-use',
    });
    expect(watch.sample(sample(MINUTE, { inputIdleMs: NO_INPUT_FOR_MS }))).toEqual({
      apply: true,
      trigger: 'no-input',
    });
  });

  test('Cairn left in the background for 10 minutes applies, and coming back restarts the clock', () => {
    const watch = createIdleWatch();
    watch.sample(sample(0, { cairnFocused: false }));
    expect(watch.sample(sample(AWAY_FROM_CAIRN_MS - MINUTE, { cairnFocused: false }))).toEqual({
      apply: false,
      hold: 'in-use',
    });
    watch.cairnUsed(START + AWAY_FROM_CAIRN_MS - 1);
    expect(watch.sample(sample(AWAY_FROM_CAIRN_MS, { cairnFocused: false }))).toEqual({
      apply: false,
      hold: 'in-use',
    });
    expect(watch.sample(sample(2 * AWAY_FROM_CAIRN_MS, { cairnFocused: false }))).toEqual({
      apply: true,
      trigger: 'away',
    });
  });

  test('a locked screen applies once it has stayed locked a minute', () => {
    const watch = createIdleWatch();
    expect(watch.sample(sample(0, { locked: true }))).toEqual({ apply: false, hold: 'in-use' });
    expect(watch.sample(sample(LOCKED_FOR_MS, { locked: true }))).toEqual({
      apply: true,
      trigger: 'locked',
    });
  });

  test('a Coordinator reply still being written holds the update until it finishes', () => {
    const watch = createIdleWatch();
    watch.sample(sample(0, { locked: true, turnInFlight: true }));
    expect(watch.sample(sample(8 * 60 * MINUTE, { locked: true, turnInFlight: true }))).toEqual({
      apply: false,
      hold: 'turn',
    });
    expect(watch.sample(sample(8 * 60 * MINUTE + MINUTE, { locked: true }))).toEqual({
      apply: true,
      trigger: 'locked',
    });
  });

  test('an open dialog holds the update', () => {
    const watch = createIdleWatch();
    watch.sample(sample(0, { cairnFocused: false, dialogOpen: true }));
    expect(
      watch.sample(sample(AWAY_FROM_CAIRN_MS, { cairnFocused: false, dialogOpen: true })),
    ).toEqual({ apply: false, hold: 'dialog' });
  });

  test('a task running on this Mac holds the update, because the restart stops its Runner', () => {
    const watch = createIdleWatch();
    watch.sample(sample(0, { locked: true, stepsInFlight: 1 }));
    expect(watch.sample(sample(LOCKED_FOR_MS, { locked: true, stepsInFlight: 1 }))).toEqual({
      apply: false,
      hold: 'steps',
    });
    expect(watch.sample(sample(2 * LOCKED_FOR_MS, { locked: true }))).toEqual({
      apply: true,
      trigger: 'locked',
    });
  });

  test('after 24 hours of tasks without a gap, the next locked screen applies anyway', () => {
    const watch = createIdleWatch();
    watch.sample(sample(0, { stepsInFlight: 2 }));
    watch.sample(sample(STEP_WAIT_CAP_MS, { cairnFocused: false, stepsInFlight: 2 }));
    expect(
      watch.sample(
        sample(STEP_WAIT_CAP_MS + AWAY_FROM_CAIRN_MS, { cairnFocused: false, stepsInFlight: 2 }),
      ),
    ).toEqual({ apply: false, hold: 'steps' });
    watch.sample(
      sample(STEP_WAIT_CAP_MS + 2 * AWAY_FROM_CAIRN_MS, { locked: true, stepsInFlight: 1 }),
    );
    expect(
      watch.sample(
        sample(STEP_WAIT_CAP_MS + 2 * AWAY_FROM_CAIRN_MS + LOCKED_FOR_MS, {
          locked: true,
          stepsInFlight: 1,
        }),
      ),
    ).toEqual({ apply: true, trigger: 'locked' });
  });

  test('a version still on probation is not replaced, so its kept copy is never lost', () => {
    const watch = createIdleWatch();
    watch.sample(sample(0, { locked: true, guardSettled: false }));
    expect(watch.sample(sample(LOCKED_FOR_MS, { locked: true, guardSettled: false }))).toEqual({
      apply: false,
      hold: 'guard',
    });
  });

  test('nothing applies before an update is downloaded', () => {
    const watch = createIdleWatch();
    watch.sample(sample(0, { locked: true, ready: false }));
    expect(watch.sample(sample(LOCKED_FOR_MS, { locked: true, ready: false }))).toEqual({
      apply: false,
      hold: 'not-ready',
    });
  });
});

describe('tasks running on this Mac are read from its Runner', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function claimIn(home: string, stepId: string): StepJournal {
    const journal = new StepJournal(join(home, 'outbox'));
    journal.claim({
      stepId,
      buildId: 'build-1',
      kind: 'build',
      conversationId: 'conversation-1',
      sessionAction: 'new',
      prompt: null,
    });
    return journal;
  }

  for (const mode of ['local server', 'remote server'] as const) {
    test(`with a ${mode}, a claimed step counts until it is reported done`, () => {
      const userData = mkdtempSync(join(tmpdir(), 'cairn-idle-'));
      dirs.push(userData);
      const home = runnerHomeForConnection(
        join(userData, 'runner-home'),
        userData,
        mode === 'local server' ? LOCAL_CONNECTION_ID : 'remote-macmini',
      );
      expect(runnerStepsInFlight(home)).toBe(0);
      const journal = claimIn(home, 'step-a');
      journal.update('step-a', { state: 'running' });
      expect(runnerStepsInFlight(home)).toBe(1);
      journal.update('step-a', { state: 'awaiting-upload' });
      expect(runnerStepsInFlight(home)).toBe(1);
      journal.update('step-a', { state: 'done' });
      expect(runnerStepsInFlight(home)).toBe(0);
    });
  }
});

describe('the window the user left is the window they come back to', () => {
  const origin = 'http://127.0.0.1:51234';

  test('position state and the open page survive the restart', () => {
    const saved = relaunchWindowOf(
      {
        isVisible: () => true,
        isMinimized: () => false,
        isMaximized: () => false,
        isFullScreen: () => true,
        url: `${origin}/app/project/p1?chat=t9#latest`,
      },
      origin,
    );
    const restored = parseRelaunchWindow(JSON.stringify(saved));
    expect(restored).toEqual({
      visible: true,
      minimized: false,
      maximized: false,
      fullScreen: true,
      path: '/app/project/p1?chat=t9#latest',
    });
    expect(restoredUrl('http://127.0.0.1:60000', restored?.path ?? '/')).toBe(
      'http://127.0.0.1:60000/app/project/p1?chat=t9#latest',
    );
  });

  test('a page from another origin is never reopened', () => {
    expect(
      relaunchWindowOf(
        {
          isVisible: () => true,
          isMinimized: () => false,
          isMaximized: () => false,
          isFullScreen: () => false,
          url: 'https://example.com/app',
        },
        origin,
      ).path,
    ).toBe('/');
    expect(restoredUrl(origin, '//example.com/app')).toBe(`${origin}/`);
    expect(restoredUrl(origin, 'https://example.com/app')).toBe(`${origin}/`);
    expect(parseRelaunchWindow('{"visible":"yes"}')).toBeNull();
    expect(parseRelaunchWindow('not json')).toBeNull();
  });
});
