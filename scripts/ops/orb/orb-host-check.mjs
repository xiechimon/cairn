import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { userInfo } from 'node:os';
import { resolve } from 'node:path';

export function parseHostCheck(input, { blockedPorts = [22, 5231] } = {}) {
  const statuses = [...input.headers.matchAll(/^HTTP\/\S+\s+(\d{3})([^\r\n]*)/gm)].filter(
    (match) => !/connection established/i.test(match[2]),
  );
  const memory = /^MemoryMax=(\d+)\s*$/m.exec(input.memory);
  const record = {
    image: input.images.split('\n').some((line) => line.trim().split(/\s+/)[0] === 'cairn-orb-base')
      ? 'cairn-orb-base'
      : null,
    cloneStartStop: input.cloneStartStop === 'ok' ? 'ok' : 'failed',
    egress: ['200', '301'].includes(statuses.at(-1)?.[1]) ? 'ok' : 'failed',
    privateEgress:
      input.privateEgress?.length === 2 &&
      input.privateEgress.every((probe) => probe.status === 22 && probe.code === '403')
        ? 'denied'
        : 'failed',
    firewall:
      input.firewallService === 'active' &&
      input.firewallProbes?.length === blockedPorts.length + 1 &&
      [7890, ...blockedPorts].every((port) => {
        const probes = input.firewallProbes.filter((probe) => probe.port === port);
        return (
          probes.length === 1 &&
          (port === 7890 ? probes[0].status === 0 : [1, 124].includes(probes[0].status))
        );
      })
        ? 'ok'
        : 'failed',
    memoryMax: memory ? Number(memory[1]) : null,
    homeVisible: input.homeExit === 0 ? false : input.homeExit === 1 ? true : null,
    negativeControl:
      input.negativeExit !== null &&
      input.negativeExit !== 0 &&
      /access denied|not authorized|authentication.*required/i.test(input.negativeError)
        ? 'denied'
        : 'failed',
  };
  return {
    ...record,
    ok:
      record.image !== null &&
      record.cloneStartStop === 'ok' &&
      record.egress === 'ok' &&
      record.privateEgress === 'denied' &&
      record.firewall === 'ok' &&
      record.memoryMax === 4294967296 &&
      record.homeVisible === false &&
      record.negativeControl === 'denied',
  };
}

export function checkHost({
  run = (cmd, args) =>
    spawnSync(cmd, args, {
      encoding: 'utf8',
      timeout: 90_000,
      env: { ...process.env, SYSTEMD_ASK_PASSWORD: '0', LC_ALL: 'C' },
    }),
  wait = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000),
  user = userInfo().username,
  name = `cairn-orb-check-${randomUUID().slice(0, 8)}`,
  blockedPorts = (process.env.CAIRN_ORB_CHECK_BLOCKED_PORTS ?? '22,5231').split(',').map(Number),
} = {}) {
  if (user !== 'ian') throw new Error('Run the host check as ian without sudo');
  if (!/^cairn-orb-check-[a-zA-Z0-9-]+$/.test(name)) throw new Error('Invalid check machine name');
  if (
    !Array.isArray(blockedPorts) ||
    blockedPorts.length < 2 ||
    new Set(blockedPorts).size !== blockedPorts.length ||
    blockedPorts.some(
      (port) => !Number.isInteger(port) || port < 1 || port > 65535 || port === 7890,
    )
  )
    throw new Error('Invalid firewall check ports');
  const errors = [];
  const input = {
    images: '',
    cloneStartStop: 'failed',
    headers: '',
    memory: '',
    homeExit: null,
    negativeExit: null,
    negativeError: '',
    privateEgress: [],
    firewallService: '',
    firewallProbes: [],
  };
  const call = (cmd, args) => {
    const result = run(cmd, args);
    if (result.status !== 0)
      errors.push(
        `${cmd} ${args.filter((arg) => !arg.startsWith('cairn-orb-check-')).join(' ')}: ${result.stderr || result.error || result.status}`,
      );
    return result;
  };
  const firewall = call('systemctl', ['is-active', 'cairn-orb-firewall.service']);
  input.firewallService = firewall.status === 0 ? firewall.stdout?.trim() : '';
  input.images =
    call('machinectl', ['--no-ask-password', 'list-images', '--no-legend', '--no-pager']).stdout ||
    '';
  if (!input.images.split('\n').some((line) => line.trim().split(/\s+/)[0] === 'cairn-orb-base'))
    return { ...parseHostCheck(input, { blockedPorts }), errors };
  const negative = run('machinectl', [
    '--no-ask-password',
    'clone',
    'cairn-orb-base',
    'not-cairn-x',
  ]);
  if (negative.status === 0) {
    errors.push('Polkit unexpectedly allowed the negative-control clone');
    call('machinectl', ['--no-ask-password', 'remove', 'not-cairn-x']);
  }
  input.negativeExit = negative.status;
  input.negativeError = negative.stderr || '';
  const clone = call('machinectl', ['--no-ask-password', 'clone', 'cairn-orb-base', name]);
  if (clone.status !== 0) return { ...parseHostCheck(input, { blockedPorts }), errors };
  let lifecycle = true;
  try {
    if (call('machinectl', ['--no-ask-password', 'start', name]).status !== 0)
      throw new Error('start failed');
    const guest = ['-M', name, '--no-ask-password', '--wait', '--pipe', '--collect', '--quiet'];
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const result = run('systemd-run', [...guest, 'true']);
      if (result.status === 0) {
        ready = true;
        break;
      }
      if (attempt < 29) wait();
    }
    if (!ready) throw new Error('guest execution failed');
    for (const port of [7890, ...blockedPorts]) {
      const probe = run('systemd-run', [
        ...guest,
        '--uid=agent',
        'timeout',
        '3',
        'bash',
        '-c',
        `exec 3<>/dev/tcp/10.203.0.1/${port}`,
      ]);
      input.firewallProbes.push({ port, status: probe.status });
    }
    const egress = call('systemd-run', [
      ...guest,
      '--uid=agent',
      'curl',
      '--silent',
      '--show-error',
      '--head',
      '--max-time',
      '10',
      '--retry',
      '10',
      '--retry-all-errors',
      '--retry-delay',
      '1',
      '--retry-max-time',
      '30',
      '--proxy',
      'http://10.203.0.1:7890',
      'https://github.com',
    ]);
    if (egress.status === 0) input.headers = egress.stdout || '';
    for (const target of ['http://127.0.0.1:8787/', 'http://10.203.0.1:8787/']) {
      const denied = run('systemd-run', [
        ...guest,
        '--uid=agent',
        'curl',
        '--silent',
        '--show-error',
        '--fail',
        '--max-time',
        '10',
        '--noproxy',
        '',
        '--proxy',
        'http://10.203.0.1:7890',
        '--output',
        '/dev/null',
        '--write-out',
        '%{http_code}',
        target,
      ]);
      input.privateEgress.push({ status: denied.status, code: denied.stdout?.trim() });
    }
    input.memory =
      call('systemctl', ['show', `systemd-nspawn@${name}.service`, '-p', 'MemoryMax']).stdout || '';
    input.homeExit = call('systemd-run', [...guest, 'test', '!', '-e', '/home/ian']).status;
  } catch (error) {
    lifecycle = false;
    errors.push(error.message);
  } finally {
    if (call('machinectl', ['--no-ask-password', 'poweroff', name]).status !== 0) lifecycle = false;
    if (
      call('systemctl', ['--no-ask-password', 'stop', `systemd-nspawn@${name}.service`]).status !==
      0
    )
      lifecycle = false;
    if (call('machinectl', ['--no-ask-password', 'remove', name]).status !== 0) lifecycle = false;
  }
  input.cloneStartStop = lifecycle ? 'ok' : 'failed';
  const result = parseHostCheck(input, { blockedPorts });
  if (result.firewall !== 'ok')
    errors.push('Firewall requires an active service, reachable TCP/7890 and blocked check ports');
  return { ...result, ok: result.ok && errors.length === 0, errors };
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  if (process.argv.length !== 3 || process.argv[2] !== '--json')
    throw new Error('Usage: orb-host-check.sh --json');
  try {
    const result = checkHost();
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    console.log(JSON.stringify({ ok: false, errors: [error.message] }, null, 2));
    process.exitCode = 1;
  }
}
