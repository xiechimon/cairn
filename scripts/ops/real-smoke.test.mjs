import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { runSmoke } from './real-smoke.mjs';

const dirs = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const success = JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'CAIRN_SMOKE_OK',
  modelUsage: { 'claude-sonnet-4-6': {} },
});

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-smoke-fixture-'));
  dirs.push(dir);
  const calls = [];
  const run = (argv, options) => {
    calls.push({ argv, options });
    return argv[0] === 'claude' || argv[0] === 'systemd-run' ? success : '';
  };
  return {
    dir,
    calls,
    options: {
      env: { CAIRN_HOME: dir },
      run,
      orb: false,
      now: () => new Date('2026-10-31T12:00:00Z'),
    },
  };
}

test('host smoke uses an isolated git repo, records the actual model and removes the sandbox', () => {
  const f = fixture();
  assert.equal(runSmoke(f.options).ok, true);
  assert.equal(f.calls[0].argv[0], 'git');
  const call = f.calls.find(({ argv }) => argv[0] === 'claude');
  assert.equal(call.argv.includes('--strict-mcp-config'), true);
  assert.deepEqual(JSON.parse(readFileSync(join(f.dir, 'smoke.json'))), {
    ok: true,
    at: '2026-10-31T12:00:00.000Z',
    model: 'claude-sonnet-4-6',
  });
  assert.throws(() => readFileSync(join(call.options.cwd, 'SMOKE.txt')), /ENOENT/);
});

test('orb smoke creates, runs and destroys its own container', () => {
  const f = fixture();
  runSmoke({ ...f.options, orb: true });
  assert.deepEqual(
    f.calls.map(({ argv }) => argv.slice(0, 2)),
    [
      ['git', 'init'],
      ['machinectl', 'clone'],
      ['machinectl', 'start'],
      ['machinectl', 'bind'],
      ['systemd-run', '-M'],
      ['systemctl', 'stop'],
      ['machinectl', 'remove'],
    ],
  );
  assert.equal(f.calls.find(({ argv }) => argv[1] === 'bind').argv.includes('--read-only'), true);
  const exec = f.calls.find(({ argv }) => argv[0] === 'systemd-run').argv;
  assert.equal(exec.includes('--setenv=CAIRN_ORB=1'), true);
  assert.equal(f.calls[1].argv[3], f.calls.at(-1).argv[2]);
});

for (const failure of ['command', 'malformed', 'provider', 'model', 'cleanup']) {
  test(`${failure} failure records ok:false and cannot preserve a previous success`, () => {
    const f = fixture();
    runSmoke(f.options);
    const run = (argv, options) => {
      if (failure === 'command' && argv[0] === 'claude') throw new Error('command failed');
      if (failure === 'malformed' && argv[0] === 'claude') return '{';
      if (failure === 'provider' && argv[0] === 'claude')
        return JSON.stringify({ type: 'result', is_error: true });
      if (failure === 'model' && argv[0] === 'claude')
        return JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'CAIRN_SMOKE_OK',
        });
      if (failure === 'cleanup' && argv[0] === 'systemctl') throw new Error('cleanup failed');
      return f.options.run(argv, options);
    };
    assert.throws(() => runSmoke({ ...f.options, run, orb: failure === 'cleanup' }));
    assert.equal(JSON.parse(readFileSync(join(f.dir, 'smoke.json'))).ok, false);
  });
}
