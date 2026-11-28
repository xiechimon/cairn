import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { makeTestTempDir, releaseTestTempDir } from '../test-tmpdir.mjs';
import {
  buildLinuxSuiteCommands,
  buildWindowsSuiteCommands,
  parseArgs,
  parseUnattendPassword,
  resolveWindowsVmx,
  runCrossOs,
} from './cross-os-test.mjs';

test('parseArgs parses flags and validates target and suite', () => {
  const parsed = parseArgs([
    '--target',
    'linux',
    '--sha',
    'deadbeef1234',
    '--suite',
    'runner',
    '--ssh',
    'mini-host',
    '--repo-dir',
    '/srv/cairn',
    '--log-dir',
    '/srv/logs',
    '--state-dir',
    '/srv/state',
    '--orb-bin',
    '/opt/orb',
    '--orb-machine',
    'ubuntu-dev',
    '--vmrun-bin',
    '/opt/vmrun',
    '--vmx',
    '/vms/win11.vmx',
    '--win-guest-user',
    'runner',
    '--win-password-file',
    '/etc/win.pass',
    '--win-host-ip',
    '192.0.2.1',
  ]);
  assert.equal(parsed.target, 'linux');
  assert.equal(parsed.sha, 'deadbeef1234');
  assert.equal(parsed.suite, 'runner');
  assert.equal(parsed.ssh, 'mini-host');
  assert.equal(parsed.repoDir, '/srv/cairn');
  assert.equal(parsed.logDir, '/srv/logs');
  assert.equal(parsed.stateDir, '/srv/state');
  assert.equal(parsed.orbBin, '/opt/orb');
  assert.equal(parsed.orbMachine, 'ubuntu-dev');
  assert.equal(parsed.vmrunBin, '/opt/vmrun');
  assert.equal(parsed.vmx, '/vms/win11.vmx');
  assert.equal(parsed.winGuestUser, 'runner');
  assert.equal(parsed.winPasswordFile, '/etc/win.pass');
  assert.equal(parsed.winHostIp, '192.0.2.1');
  assert.equal(parsed.help, false);

  assert.equal(parseArgs(['--help']).help, true);
  assert.throws(() => parseArgs([]), /--target/);
  assert.throws(() => parseArgs(['--target', 'solaris']), /Invalid --target/);
  assert.throws(() => parseArgs(['--target', 'linux', '--suite', 'web']), /Invalid --suite/);
  assert.throws(() => parseArgs(['--target', 'linux', '--sha']), /Missing value/);
});

test('parseUnattendPassword extracts user password or plain text without leaking it in errors', () => {
  const xml = `
    <unattend>
      <UserAccounts>
        <LocalAccounts>
          <LocalAccount>
            <Username>runner</Username>
            <Password>
              <Value>s3cr3t-pass!</Value>
              <PlainText>true</PlainText>
            </Password>
          </LocalAccount>
        </LocalAccounts>
      </UserAccounts>
    </unattend>
  `;
  assert.equal(parseUnattendPassword(xml, 'runner'), 's3cr3t-pass!');
  assert.equal(parseUnattendPassword('plain-line-pass\n', 'runner'), 'plain-line-pass');
  assert.throws(
    () => parseUnattendPassword('<unattend><Username>other</Username></unattend>', 'runner'),
    (error) => {
      assert.match(error.message, /Cannot read Windows guest password/);
      assert.doesNotMatch(error.message, /s3cr3t-pass/);
      return true;
    },
  );
});

test('buildLinuxSuiteCommands uses frozen-lockfile ignore-scripts and CAIRN_MINI_TEST=1', () => {
  const runner = buildLinuxSuiteCommands('runner');
  assert.ok(
    runner.some((line) => line.includes('pnpm install --frozen-lockfile --ignore-scripts')),
  );
  assert.ok(runner.some((line) => line.includes('CAIRN_MINI_TEST=1')));
  assert.ok(runner.some((line) => line.includes('--filter @xiechimon/cairn-cli test')));
  assert.ok(!runner.some((line) => line.includes('@cairn/desktop')));

  const desktop = buildLinuxSuiteCommands('desktop');
  assert.ok(desktop.some((line) => line.includes('--project @cairn/desktop')));
  assert.ok(!desktop.some((line) => line.includes('apps/desktop/scripts/*.test.mjs')));
  assert.ok(!desktop.some((line) => line.includes('@xiechimon/cairn-cli')));

  const all = buildLinuxSuiteCommands('all');
  assert.ok(all.some((line) => line.includes('--filter @xiechimon/cairn-cli test')));
  assert.ok(all.some((line) => line.includes('--project @cairn/desktop')));
});

test('buildWindowsSuiteCommands avoids parenthesized cmd blocks and sets required bypass env', () => {
  const all = buildWindowsSuiteCommands('all');
  assert.ok(all.some((line) => line.includes('CAIRN_HEAVY_GATE_BYPASS=mini-test')));
  assert.ok(all.some((line) => line.includes('CAIRN_MINI_TEST=1')));
  assert.ok(
    all.some((line) => line.includes('call pnpm install --frozen-lockfile --ignore-scripts')),
  );
  assert.ok(all.some((line) => line.includes('call pnpm --filter @xiechimon/cairn-cli test')));
  assert.ok(
    all.some((line) => line.includes('call pnpm exec vitest run --project @cairn/desktop')),
  );
  for (const line of all) {
    assert.doesNotMatch(line, /^\s*\(/);
    assert.doesNotMatch(line, /\)\s*$/);
  }
});

test('resolveWindowsVmx picks explicit path or discovers running Windows VM without downloading', () => {
  assert.equal(resolveWindowsVmx('/vms/custom.vmx', ''), '/vms/custom.vmx');
  const listOut = [
    'Total running VMs: 2',
    '/Users/demo/VMs/Ubuntu.vmwarevm/Ubuntu.vmx',
    '/Users/demo/VMs/Windows 11 ARM64.vmwarevm/Windows 11 ARM64.vmx',
  ].join('\n');
  assert.equal(
    resolveWindowsVmx(undefined, listOut),
    '/Users/demo/VMs/Windows 11 ARM64.vmwarevm/Windows 11 ARM64.vmx',
  );
  assert.throws(
    () => resolveWindowsVmx(undefined, 'Total running VMs: 0\n'),
    /No running Windows VMware Fusion VM found/,
  );
});

test('runCrossOs executes Linux suite, writes SHA log, prints PASS summary, and releases lock', async () => {
  const root = makeTestTempDir('cross-os-linux-pass-');
  const calls = [];
  const lines = [];
  const fakeSha = '1111111111111111111111111111111111111111';
  try {
    const repoDir = join(root, 'repo');
    const stateDir = join(root, 'state');
    const logDir = join(root, 'logs');
    const orbBin = join(root, 'bin', 'orb');
    mkdirSync(join(repoDir, '.git'), { recursive: true });
    mkdirSync(join(root, 'bin'), { recursive: true });
    writeFileSync(orbBin, '#!/bin/sh\nexit 0\n');

    const result = await runCrossOs(
      {
        target: 'linux',
        sha: fakeSha,
        suite: 'all',
        repoDir,
        stateDir,
        logDir,
        orbBin,
        orbMachine: 'dev',
      },
      {
        exec: async (cmd, args, opts) => {
          calls.push({ cmd, args, input: opts?.input });
          if (cmd === 'git' && args.includes('rev-parse')) {
            return { status: 0, stdout: `${fakeSha}\n`, stderr: '' };
          }
          if (cmd === 'git' && args.includes('cat-file')) {
            return { status: 0, stdout: '', stderr: '' };
          }
          if (cmd === orbBin && args[0] === 'list') {
            return { status: 0, stdout: 'dev  running  ubuntu  noble  arm64\n', stderr: '' };
          }
          return { status: 0, stdout: 'suite ok\n', stderr: '' };
        },
        now: () => 1700000000000,
        stdout: (line) => lines.push(line),
      },
    );

    assert.equal(result.exitCode, 0);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].ok, true);
    const logPath = result.results[0].logPath;
    assert.ok(existsSync(logPath));
    const logBody = readFileSync(logPath, 'utf8');
    assert.match(logBody, new RegExp(fakeSha));
    assert.match(logBody, /suite ok/);
    assert.match(
      lines.at(-1),
      new RegExp(`^PASS target=linux sha=${fakeSha} suite=all duration=\\d+s log=`),
    );
    assert.equal(existsSync(join(stateDir, 'locks', 'cross-os-linux.lock')), false);
    const bashCalls = calls.filter((c) => c.cmd === orbBin && c.args.includes('bash'));
    assert.ok(bashCalls.length >= 1);
    assert.match(bashCalls[0].input, /v24\.14\.0/);
    assert.match(bashCalls[0].input, /bubblewrap/);
    assert.match(bashCalls[0].input, /sqlite3/);
    assert.match(bashCalls[0].input, /\bgh\b/);
  } finally {
    releaseTestTempDir(root);
  }
});

test('runCrossOs preserves log and prints FAIL when Linux suite fails', async () => {
  const root = makeTestTempDir('cross-os-linux-fail-');
  const lines = [];
  const fakeSha = '2222222222222222222222222222222222222222';
  try {
    const repoDir = join(root, 'repo');
    const stateDir = join(root, 'state');
    const logDir = join(root, 'logs');
    const orbBin = join(root, 'bin', 'orb');
    mkdirSync(join(repoDir, '.git'), { recursive: true });
    mkdirSync(join(root, 'bin'), { recursive: true });
    writeFileSync(orbBin, '#!/bin/sh\nexit 0\n');

    let bashRuns = 0;
    const result = await runCrossOs(
      {
        target: 'linux',
        sha: fakeSha,
        suite: 'runner',
        repoDir,
        stateDir,
        logDir,
        orbBin,
        orbMachine: 'dev',
      },
      {
        exec: async (cmd, args) => {
          if (cmd === 'git' && args.includes('rev-parse')) {
            return { status: 0, stdout: `${fakeSha}\n`, stderr: '' };
          }
          if (cmd === 'git' && args.includes('cat-file')) {
            return { status: 0, stdout: '', stderr: '' };
          }
          if (cmd === orbBin && args[0] === 'list') {
            return { status: 0, stdout: 'dev  running  ubuntu  noble  arm64\n', stderr: '' };
          }
          if (cmd === orbBin && args.includes('bash')) {
            bashRuns += 1;
            if (bashRuns === 3) {
              return { status: 1, stdout: '', stderr: 'test failed\n' };
            }
          }
          return { status: 0, stdout: '', stderr: '' };
        },
        now: () => 1700000000000,
        stdout: (line) => lines.push(line),
      },
    );

    assert.equal(result.exitCode, 1);
    assert.equal(result.results[0].ok, false);
    assert.ok(existsSync(result.results[0].logPath));
    assert.match(readFileSync(result.results[0].logPath, 'utf8'), /test failed/);
    assert.match(
      lines.at(-1),
      new RegExp(`^FAIL target=linux sha=${fakeSha} suite=runner exit=1 duration=\\d+s log=`),
    );
    assert.equal(existsSync(join(stateDir, 'locks', 'cross-os-linux.lock')), false);
  } finally {
    releaseTestTempDir(root);
  }
});

test('runCrossOs fails cleanly for missing Windows VM without downloading anything', async () => {
  const root = makeTestTempDir('cross-os-win-missing-');
  const calls = [];
  const lines = [];
  const fakeSha = '3333333333333333333333333333333333333333';
  try {
    const repoDir = join(root, 'repo');
    const stateDir = join(root, 'state');
    const logDir = join(root, 'logs');
    const vmrunBin = join(root, 'bin', 'vmrun');
    mkdirSync(join(repoDir, '.git'), { recursive: true });
    mkdirSync(join(root, 'bin'), { recursive: true });
    writeFileSync(vmrunBin, '#!/bin/sh\nexit 0\n');

    const result = await runCrossOs(
      {
        target: 'windows',
        sha: fakeSha,
        suite: 'all',
        repoDir,
        stateDir,
        logDir,
        vmrunBin,
      },
      {
        exec: async (cmd, args) => {
          calls.push({ cmd, args });
          if (cmd === 'git' && args.includes('rev-parse')) {
            return { status: 0, stdout: `${fakeSha}\n`, stderr: '' };
          }
          if (cmd === 'git' && args.includes('cat-file')) {
            return { status: 0, stdout: '', stderr: '' };
          }
          if (cmd === vmrunBin && args[0] === 'list') {
            return { status: 0, stdout: 'Total running VMs: 0\n', stderr: '' };
          }
          return { status: 0, stdout: '', stderr: '' };
        },
        now: () => 1700000000000,
        stdout: (line) => lines.push(line),
      },
    );

    assert.equal(result.exitCode, 1);
    assert.equal(result.results[0].ok, false);
    assert.ok(existsSync(result.results[0].logPath));
    assert.match(
      readFileSync(result.results[0].logPath, 'utf8'),
      /No running Windows VMware Fusion VM found/,
    );
    assert.match(lines.at(-1), /^FAIL target=windows /);
    for (const call of calls) {
      assert.doesNotMatch(`${call.cmd} ${call.args.join(' ')}`, /curl|wget|download|iso/i);
    }
  } finally {
    releaseTestTempDir(root);
  }
});

test('runCrossOs delegates cleanly over SSH and reclaims dead target locks', async () => {
  const root = makeTestTempDir('cross-os-ssh-lock-');
  const calls = [];
  const lines = [];
  const fakeSha = '4444444444444444444444444444444444444444';
  try {
    const repoDir = join(root, 'repo');
    const stateDir = join(root, 'state');
    const logDir = join(root, 'logs');
    const orbBin = join(root, 'bin', 'orb');
    mkdirSync(join(repoDir, '.git'), { recursive: true });
    mkdirSync(join(root, 'bin'), { recursive: true });
    mkdirSync(join(stateDir, 'locks', 'cross-os-linux.lock'), { recursive: true });
    writeFileSync(join(stateDir, 'locks', 'cross-os-linux.lock', 'owner'), '999999 0\n');
    writeFileSync(orbBin, '#!/bin/sh\nexit 0\n');

    const localResult = await runCrossOs(
      {
        target: 'linux',
        sha: fakeSha,
        suite: 'desktop',
        repoDir,
        stateDir,
        logDir,
        orbBin,
        orbMachine: 'dev',
      },
      {
        exec: async (cmd, args) => {
          if (cmd === 'git' && args.includes('rev-parse')) {
            return { status: 0, stdout: `${fakeSha}\n`, stderr: '' };
          }
          if (cmd === 'git' && args.includes('cat-file')) {
            return { status: 0, stdout: '', stderr: '' };
          }
          if (cmd === orbBin && args[0] === 'list') {
            return { status: 0, stdout: 'dev  running  ubuntu  noble  arm64\n', stderr: '' };
          }
          return { status: 0, stdout: 'desktop ok\n', stderr: '' };
        },
        isPidAlive: () => false,
        now: () => 1700000000000,
        stdout: (line) => lines.push(line),
      },
    );
    assert.equal(localResult.exitCode, 0);
    assert.equal(existsSync(join(stateDir, 'locks', 'cross-os-linux.lock')), false);

    const sshResult = await runCrossOs(
      {
        target: 'linux',
        sha: fakeSha,
        suite: 'all',
        ssh: 'mini-box',
        localRepoDir: repoDir,
        repoDir: '/remote/cairn',
      },
      {
        exec: async (cmd, args, opts) => {
          calls.push({ cmd, args, input: opts?.input ?? '' });
          if (cmd === 'git' && args.includes('rev-parse')) {
            return { status: 0, stdout: `${fakeSha}\n`, stderr: '' };
          }
          if (cmd === 'ssh' && args.some((a) => a.includes('cat-file'))) {
            return { status: 0, stdout: 'OK\n', stderr: '' };
          }
          return {
            status: 0,
            stdout: `PASS target=linux sha=${fakeSha} suite=all duration=4s log=/remote/logs/run.log\n`,
            stderr: '',
          };
        },
        stdout: (line) => lines.push(line),
      },
    );
    assert.equal(sshResult.exitCode, 0);
    const sshRun = calls.find(
      (c) =>
        c.cmd === 'ssh' &&
        (c.args.some((a) => a.includes('scripts/ops/cross-os-test.mjs')) ||
          c.input.includes('scripts/ops/cross-os-test.mjs')),
    );
    assert.ok(sshRun);
    assert.ok(sshRun.args.includes('-o'));
    assert.ok(sshRun.args.includes('BatchMode=yes'));
    assert.ok(!sshRun.input.includes('--ssh'));
  } finally {
    releaseTestTempDir(root);
  }
});
