import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { makeTestTempDir } from '../../test-tmpdir.mjs';

test('lane launcher puts the prompt and agent temp on disk and cleans on failure', () => {
  const home = makeTestTempDir('lane-temp-');
  const bin = join(home, 'bin');
  mkdirSync(bin);
  mkdirSync(join(home, 'lanes/logs'), { recursive: true });
  mkdirSync(join(home, 'lanes/prompts'));
  mkdirSync(join(home, '.local/state/overnight'), { recursive: true });
  writeFileSync(join(home, 'lanes/prompts/implement-head.txt'), 'implement __N__');
  copyFileSync(
    resolve('scripts/ops/host/lanes/build-prompt.sh'),
    join(home, 'lanes/build-prompt.sh'),
  );
  chmodSync(join(home, 'lanes/build-prompt.sh'), 0o755);
  const scripts = {
    gh: '#!/bin/sh\necho "## Plan stub"\n',
    pnpm: '#!/bin/sh\nexit 0\n',
    'ai-route': `#!${process.execPath}\nrequire('node:fs').writeFileSync(process.env.OBSERVED, JSON.stringify({ tmp:process.env.TMPDIR, slots:process.env.CAIRN_HEAVY_SLOTS_DIR, prompt:require('node:fs').existsSync(process.env.TMPDIR+'/issue-3630.txt') }));process.exit(19);\n`,
  };
  for (const [name, source] of Object.entries(scripts)) {
    writeFileSync(join(bin, name), source);
    chmodSync(join(bin, name), 0o755);
  }
  const env = {
    ...process.env,
    HOME: home,
    PATH: `${bin}:${process.env.PATH}`,
    OBSERVED: join(home, 'observed'),
  };
  delete env.CAIRN_TEST_TEMP_ROOT;
  delete env.CAIRN_HEAVY_SLOTS_DIR;
  const result = spawnSync(
    'bash',
    [resolve('scripts/ops/host/lanes/run-worker.sh'), '3630', 'implement', '', process.cwd()],
    { env, encoding: 'utf8' },
  );
  assert.equal(result.status, 19, result.stderr);
  const observed = JSON.parse(readFileSync(env.OBSERVED, 'utf8'));
  assert.ok(observed.tmp.startsWith(`${join(home, '.cache/lane-tmp')}/`));
  assert.equal(observed.slots, '/tmp/cairn-heavy-slots');
  assert.equal(observed.prompt, true);
  assert.equal(existsSync(observed.tmp), false);
});
