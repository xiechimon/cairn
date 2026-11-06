import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { makeTestTempDir } from '../../test-tmpdir.mjs';
import { rawAllocationSites } from '../../test-tmpdir-inventory.mjs';
import {
  policy,
  runGuard,
  shouldDelete,
  shouldWarn,
  usagePercent,
} from './tools/test-temp-guard.mjs';

const now = Date.now();
const cutoff = now - policy.maxAgeMinutes * 60_000;

for (const prefix of policy.prefixes) {
  test(`selects only stale entries for ${prefix}`, () => {
    assert.equal(shouldDelete(`${prefix}fixture`, cutoff - 1, now), true);
    assert.equal(shouldDelete(`${prefix}fixture`, cutoff, now), false);
    assert.equal(shouldDelete(`${prefix}fixture`, now, now), false);
  });
}

test('never selects unrelated names, nested paths, or slot locks', () => {
  for (const name of [
    'notes',
    'cairn-important',
    'cairn-heavy-check.lock',
    'cairn-heavy-slots',
    'vitest-user',
    'playwright-user',
    'prefix-ct-test',
    'parent/ct-test',
    '../ct-test',
    'ct-test/child',
    '.',
    '..',
    '',
  ])
    assert.equal(shouldDelete(name, 0, now), false, name);
});

test('space and inode warnings use a strict threshold and an hourly persisted cooldown', () => {
  assert.equal(shouldWarn({ space: 80, inodes: 80 }, null, now), false);
  assert.equal(shouldWarn({ space: 80.01, inodes: 0 }, null, now), true);
  assert.equal(shouldWarn({ space: 0, inodes: 80.01 }, null, now), true);
  assert.equal(shouldWarn({ space: 100, inodes: 100 }, now - 3_600_000 + 1, now), false);
  assert.equal(shouldWarn({ space: 100, inodes: 100 }, now - 3_600_000, now), true);
  assert.equal(shouldWarn({ space: 100, inodes: 100 }, now + 1, now), false);
  assert.deepEqual(usagePercent({ blocks: 100, bfree: 10, bavail: 10, files: 1000, ffree: 1 }), {
    space: 90,
    inodes: 99.9,
  });
  assert.deepEqual(usagePercent({ blocks: 0, bfree: 0, bavail: 0, files: 0, ffree: 0 }), {
    space: 0,
    inodes: 0,
  });
});

test('runs filesystem cleanup in both roots without following symlinks or descending into kept entries', () => {
  const home = makeTestTempDir('temp-guard-');
  const roots = [join(home, 'tmp'), join(home, 'cache')];
  const outside = join(home, 'outside');
  mkdirSync(outside);
  writeFileSync(join(outside, 'keep'), 'value');
  for (const root of roots) {
    mkdirSync(root);
    for (const name of ['ct-old', 'cairn-test-old', 'ct-fresh', 'unrelated']) {
      mkdirSync(join(root, name));
      writeFileSync(join(root, name, 'ct-old-child'), 'value');
      const modified = name === 'ct-fresh' ? now : cutoff - 1000;
      utimesSync(join(root, name), modified / 1000, modified / 1000);
    }
    symlinkSync(outside, join(root, 'ct-old', 'outside-link'));
    utimesSync(join(root, 'ct-old'), (cutoff - 1000) / 1000, (cutoff - 1000) / 1000);
    writeFileSync(join(root, 'ct-file'), 'old file');
    utimesSync(join(root, 'ct-file'), 0, 0);
    symlinkSync(outside, join(root, 'ct-link'));
  }
  const result = runGuard({
    roots,
    stateDir: join(home, 'state'),
    now,
    usage: () => ({ space: 20, inodes: 20 }),
    command: () => assert.fail('unexpected alert'),
  });
  assert.equal(result.deleted.length, 6);
  for (const root of roots) {
    for (const name of ['ct-old', 'cairn-test-old', 'ct-file'])
      assert.equal(existsSync(join(root, name)), false);
    for (const name of ['ct-fresh', 'unrelated', 'ct-link'])
      assert.equal(existsSync(join(root, name)), true);
    assert.equal(existsSync(join(root, 'unrelated', 'ct-old-child')), true);
  }
  assert.equal(readFileSync(join(outside, 'keep'), 'utf8'), 'value');
});

test('missing and symlinked roots are skipped; notification failure still journals and throttles', () => {
  const home = makeTestTempDir('temp-guard-alert-');
  const outside = join(home, 'outside');
  mkdirSync(outside);
  mkdirSync(join(outside, 'ct-old'));
  utimesSync(join(outside, 'ct-old'), 0, 0);
  const link = join(home, 'linked-root');
  symlinkSync(outside, link);
  const calls = [];
  const warnings = [];
  const options = {
    roots: [join(home, 'missing'), link],
    stateDir: join(home, 'state'),
    now,
    usage: () => ({ space: 0, inodes: 99 }),
    command: (...args) => {
      calls.push(args);
      return { status: 1 };
    },
    warn: (message) => warnings.push(message),
  };
  runGuard(options);
  runGuard({ ...options, now: now + 60_000 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'notify-send');
  assert.match(warnings[0], /<4>.*inodes=99/);
  assert.equal(warnings.length, 1);
  assert.equal(existsSync(join(outside, 'ct-old')), true);
  runGuard({ ...options, now: now + 3_600_000 });
  assert.equal(calls.length, 2);
});

test('cairn-heavy creates a disk default, preserves overrides and TMPDIR, and propagates failures', () => {
  const home = makeTestTempDir('heavy-home-');
  const bin = join(home, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'flock'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(bin, 'flock'), 0o755);
  const wrapper = join(import.meta.dirname, 'bin/cairn-heavy');
  for (const override of [undefined, join(home, 'custom')]) {
    const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` };
    delete env.CAIRN_TEST_TEMP_ROOT;
    if (override) env.CAIRN_TEST_TEMP_ROOT = override;
    const result = spawnSync(
      'bash',
      [
        wrapper,
        process.execPath,
        '-e',
        'console.log(JSON.stringify({root:process.env.CAIRN_TEST_TEMP_ROOT,tmp:process.env.TMPDIR}));process.exit(17)',
      ],
      { env, encoding: 'utf8' },
    );
    assert.equal(result.status, 17, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.root, override ?? join(home, '.cache/cairn-test-tmp'));
    assert.equal(output.tmp, env.TMPDIR);
    assert.equal(existsSync(output.root), true);
  }
});

test('policy covers baseline allocation prefixes and the historical test families without broad globs', () => {
  for (const prefix of [
    'ct-',
    'cairn-test-',
    'orb-fake',
    'orb-watchdog',
    'orb-worker',
    'orb-transport',
    'cairn-ws-root',
    'cairn-ws-origin',
    'cairn-step-att',
    'cairn-cfg',
    'cairn-runner-delivery',
    'agents-setup',
  ]) {
    assert.equal(shouldDelete(`${prefix}old`, 0, now), true, prefix);
  }
  for (const prefix of policy.prefixes) {
    assert.match(prefix, /^[a-z0-9-]+$/);
    assert.equal(['cairn-', 'orb-', 'vitest-', 'playwright-'].includes(prefix), false);
  }
  const baseline = JSON.parse(
    readFileSync(new URL('../../test-tmp-baseline.json', import.meta.url), 'utf8'),
  );
  for (const file of [
    ...Object.keys(baseline),
    'scripts/ops/host/host-fixture.mjs',
    'scripts/prepush-vitest.mjs',
  ]) {
    const source = readFileSync(new URL(`../../../${file}`, import.meta.url), 'utf8');
    for (const site of rawAllocationSites(source, file)) {
      const tail = source
        .split('\n')
        .slice(site.line - 1)
        .join('\n')
        .slice(site.column - 1);
      if (/^\w+\(\s*join\(homedir\(\)/.test(tail)) continue;
      const literal = tail.match(/^\w+\(\s*(?:join|resolve)\(\s*tmpdir\(\),\s*['"`]([^'"`$]+)/);
      const prefixes = literal
        ? [literal[1]]
        : file === 'scripts/escape-trace.test.mjs'
          ? [
              'escape-candidates-',
              ...[...source.matchAll(/fixture\(t, '([^']+)'/g)].map((match) => match[1]),
            ]
          : [];
      assert.ok(prefixes.length > 0, `Unclassified allocation at ${file}:${site.line}`);
      for (const prefix of prefixes)
        assert.equal(shouldDelete(`${prefix}old`, 0, now), true, `${file}: ${prefix}`);
    }
  }
});

test('wrapper refuses an unusable root before starting the command', () => {
  const home = makeTestTempDir('heavy-refusal-');
  const root = join(home, 'file');
  writeFileSync(root, 'not a directory');
  const result = spawnSync(
    'bash',
    [join(import.meta.dirname, 'bin/cairn-heavy'), 'touch', join(home, 'started')],
    {
      env: { ...process.env, HOME: home, CAIRN_TEST_TEMP_ROOT: root },
      encoding: 'utf8',
    },
  );
  assert.notEqual(result.status, 0);
  assert.equal(existsSync(join(home, 'started')), false);
});
