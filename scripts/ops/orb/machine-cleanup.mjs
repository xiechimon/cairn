import { spawnSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';

export function cleanupMachine({
  name,
  call,
  run = call,
  wait,
  directory,
  preparedDirectory = true,
  poweroff = true,
  errors = [],
}) {
  if (
    !/^cairn-orb-(?:check-)?[a-zA-Z0-9][a-zA-Z0-9-]{0,53}$/.test(name) ||
    name === 'cairn-orb-base'
  )
    throw new Error('Invalid cleanup machine name');
  let lifecycle = true;
  if (poweroff && call('machinectl', ['--no-ask-password', 'poweroff', name]).status !== 0)
    lifecycle = false;
  let stopped = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const machines = call('machinectl', ['--no-ask-password', 'list', '--no-legend', '--no-pager']);
    if (machines.status !== 0) break;
    if (!(machines.stdout || '').split('\n').some((line) => line.trim().split(/\s+/)[0] === name)) {
      stopped = true;
      break;
    }
    if (attempt === 14 && call('machinectl', ['--no-ask-password', 'terminate', name]).status !== 0)
      lifecycle = false;
    if (attempt < 29) wait();
  }
  if (stopped) {
    stopped = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const state = (
        run('systemctl', ['is-active', `systemd-nspawn@${name}.service`]).stdout || ''
      ).trim();
      if (state === 'inactive' || state === 'failed') {
        stopped = true;
        break;
      }
      if (attempt < 29) wait();
    }
  }
  if (!stopped) {
    errors.push('Timed out waiting for check machine to stop; runtime directory preserved');
    return false;
  }
  const removed = call('machinectl', ['--no-ask-password', 'remove', name]).status === 0;
  if (!removed) lifecycle = false;
  if (removed && preparedDirectory) {
    for (let attempt = 0; attempt < 30; attempt++) {
      if (!lstatSync(directory, { throwIfNoEntry: false })) break;
      if (attempt === 29) {
        lifecycle = false;
        errors.push('Timed out waiting for root stop cleanup of runtime directory');
      } else wait();
    }
  }
  return lifecycle;
}

export function cleanupCanaryMachine({
  name,
  run,
  wait,
  directory = join('/run/cairn-orb', name),
  errors = [],
}) {
  if (!/^cairn-orb-[a-f0-9-]{36}$/.test(name))
    throw new Error('Expected the scratch Thread machine name');
  const call = (cmd, args) => {
    const result = run(cmd, args);
    if (result.status !== 0) errors.push(`${cmd} ${args[0]} failed`);
    return result;
  };
  const listed = ['list', 'list-images'].map((action) =>
    call('machinectl', ['--no-ask-password', action, '--no-legend', '--no-pager']),
  );
  const present = listed.some((result) =>
    result.stdout?.split('\n').some((line) => line.trim().split(/\s+/)[0] === name),
  );
  if (present) {
    const running = listed[0].stdout
      ?.split('\n')
      .some((line) => line.trim().split(/\s+/)[0] === name);
    return (
      cleanupMachine({ name, call, run, wait, directory, errors, poweroff: running }) &&
      errors.length === 0
    );
  }
  if (lstatSync(directory, { throwIfNoEntry: false }))
    errors.push('Scratch runtime directory remains without a machine image');
  return errors.length === 0;
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  if (process.argv.length !== 3) throw new Error('Expected the scratch Thread machine name');
  const errors = [];
  const ok = cleanupCanaryMachine({
    name: process.argv[2],
    run: (cmd, args) =>
      spawnSync(cmd, args, {
        encoding: 'utf8',
        timeout: 90000,
        env: { ...process.env, SYSTEMD_ASK_PASSWORD: '0', LC_ALL: 'C' },
      }),
    wait: () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000),
    errors,
  });
  if (!ok) {
    process.stderr.write(`${errors.join('; ')}\n`);
    process.exitCode = 1;
  }
}
