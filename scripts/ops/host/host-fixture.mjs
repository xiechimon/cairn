import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const hostRoot = resolve('scripts/ops/host');

const ghStub = `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALLS, JSON.stringify(['gh', ...args]) + '\\n');
const data = JSON.parse(fs.readFileSync(process.env.GH_DATA, 'utf8'));
const line = args.join(' ');
if (line.startsWith('issue view') && line.includes('--json state')) console.log(data.state ?? 'OPEN');
else if (line.startsWith('issue view') && line.includes('--json comments')) console.log(data.comments ?? '');
else if (line.startsWith('pr list') && line.includes('createdAt')) console.log(data.agedPrs ?? '');
else if (line.startsWith('pr list')) console.log(data.prHeads ?? '');
else if (line.startsWith('issue create')) console.log('https://github.com/owner/repo/issues/900');
`;

const recorderStub = (name) => `#!${process.execPath}
require('node:fs').appendFileSync(process.env.CALLS, JSON.stringify([${JSON.stringify(name)}, ...process.argv.slice(2)]) + '\\n');
`;

const passthroughStub = `#!/bin/sh
exit 0
`;

function writeExecutable(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

export function hostFixture(t, { gh = {}, lists = {}, hostFiles = {} } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'ops-host-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const bin = join(home, 'bin');
  const state = join(home, '.local/state/overnight');
  mkdirSync(join(home, 'lanes/logs'), { recursive: true });
  mkdirSync(state, { recursive: true });
  for (const list of ['never', 'hold', 'mine', 'pending']) {
    writeFileSync(join(state, list), lists[list] ? `${lists[list].join('\n')}\n` : '');
  }
  writeExecutable(join(bin, 'gh'), ghStub);
  writeExecutable(join(bin, 'git'), recorderStub('git'));
  for (const name of ['flock', 'setsid', 'nohup'])
    writeExecutable(join(bin, name), passthroughStub);
  writeExecutable(join(home, 'lanes/test-build-prompt.sh'), passthroughStub);
  writeExecutable(
    join(home, 'lanes/dispatch-issue.sh'),
    readFileSync(join(hostRoot, 'lanes/dispatch-issue.sh'), 'utf8'),
  );
  for (const [path, content] of Object.entries(hostFiles))
    writeExecutable(join(home, path), content);
  writeFileSync(join(home, 'gh-data.json'), JSON.stringify(gh));
  const calls = join(home, 'calls');
  writeFileSync(calls, '');

  function run(script, args = [], env = {}) {
    const result = spawnSync('bash', [join(hostRoot, script), ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: home,
        PATH: `${bin}:${process.env.PATH}`,
        CALLS: calls,
        GH_DATA: join(home, 'gh-data.json'),
        ...env,
      },
    });
    const recorded = readFileSync(calls, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((entry) => JSON.parse(entry));
    return {
      ...result,
      calls: recorded,
      ghLines: recorded.filter((c) => c[0] === 'gh').map((c) => c.slice(1).join(' ')),
    };
  }

  return { home, state, run };
}

export function recordingDispatch() {
  return `#!${process.execPath}
require('node:fs').appendFileSync(process.env.CALLS, JSON.stringify(['dispatch-issue', ...process.argv.slice(2)]) + '\\n');
console.log('dispatched #' + process.argv[2]);
`;
}
