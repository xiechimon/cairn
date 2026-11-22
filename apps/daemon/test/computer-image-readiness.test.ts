import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';

const imageDir = join(import.meta.dirname, '..', 'computer-image');
const waitDisplay = join(imageDir, 'wait-display.sh');

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function probe(answerAfter: number) {
  const root = makeTestTempDir('wait-display-');
  cleanups.push(() => releaseTestTempDir(root));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'xdotool'),
    `#!/bin/sh\necho "$DISPLAY" >> '${join(root, 'displays')}'\ncount=$(($(cat '${join(root, 'count')}' 2>/dev/null || echo 0) + 1))\necho "$count" > '${join(root, 'count')}'\n[ "$count" -ge ${answerAfter} ] && exit 0\nexit 1\n`,
    { mode: 0o755 },
  );
  writeFileSync(join(bin, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  chmodSync(join(bin, 'xdotool'), 0o755);
  chmodSync(join(bin, 'sleep'), 0o755);
  const run = (display = ':1') =>
    spawnSync('bash', [waitDisplay, display], {
      env: { PATH: `${bin}:${process.env.PATH ?? ''}` },
      encoding: 'utf8',
    });
  const attempts = () => {
    try {
      return Number(readFileSync(join(root, 'count'), 'utf8').trim());
    } catch {
      return 0;
    }
  };
  const displays = () => {
    try {
      return readFileSync(join(root, 'displays'), 'utf8').trim().split('\n');
    } catch {
      return [];
    }
  };
  return { run, attempts, displays };
}

describe('the computer image waits for the display to answer', () => {
  test('a display that answers on a later attempt is waited for, not assumed from its socket', () => {
    const display = probe(3);
    expect(display.run(':7').status).toBe(0);
    expect(display.attempts()).toBe(3);
    expect(display.displays()).toEqual([':7', ':7', ':7']);
  });

  test('a socket that never answers keeps the desktop from becoming ready', () => {
    const display = probe(1_000);
    expect(display.run().status).toBe(1);
    expect(display.attempts()).toBe(100);
  });

  test('desktop.sh publishes the ready marker only after the display answers', () => {
    const desktop = readFileSync(join(imageDir, 'desktop.sh'), 'utf8');
    expect(desktop).toContain('cairn-wait-display :1 || exit 1');
    expect(desktop).not.toContain('[[ -S /tmp/.X11-unix/X1 ]]');
    expect(desktop.indexOf('cairn-wait-display :1')).toBeLessThan(
      desktop.indexOf('touch /run/cairn/ready'),
    );
  });
});
