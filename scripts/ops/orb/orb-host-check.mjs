import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isIPv4 } from 'node:net';
import { userInfo } from 'node:os';
import { join, resolve } from 'node:path';

import { readMetadata, validatePorts } from './guest-check.mjs';
import { cleanupMachine } from './machine-cleanup.mjs';
import { missingUfwRules } from './ufw-rules.mjs';

export function parseHostCheck(input, { blockedPorts = [22, 5231] } = {}) {
  const statuses = [...input.headers.matchAll(/^HTTP\/\S+\s+(\d{3})([^\r\n]*)/gm)].filter(
    (match) => !/connection established/i.test(match[2]),
  );
  const memory = /^MemoryMax=(\d+)\s*$/m.exec(input.memory);
  let section = '';
  let manageForeignRules = 'yes';
  for (const line of (input.networkdConfig ?? '').split('\n')) {
    const value = line.trim();
    if (/^\[.*\]$/.test(value)) section = value;
    if (section !== '[Network]') continue;
    const setting = /^ManageForeignRoutingPolicyRules\s*=\s*(.*)$/.exec(value);
    if (setting) manageForeignRules = setting[1];
  }
  const foreignRules =
    input.networkdService === 'active' && !['no', 'false', 'off', '0'].includes(manageForeignRules)
      ? 'managed'
      : input.tunPresent
        ? /\blookup\s+2022(?=\s|$)/m.test(input.policyRules ?? '') &&
          /\biif\s+sbtun0(?=\s|$)/m.test(input.policyRules ?? '')
          ? 'ok'
          : 'lost'
        : 'no-tun';
  const record = {
    foreignRules,
    daemonRelease: input.daemonRelease ?? null,
    ufw:
      input.ufwService === 'active'
        ? missingUfwRules(input.ufwRules ?? '').length === 0
          ? 'ok'
          : 'missing-rules'
        : input.ufwService === 'inactive'
          ? 'inactive'
          : 'missing-rules',
    networkReady: input.networkReady ?? false,
    networkWaitMs: input.networkWaitMs ?? null,
    ipv4: input.ipv4 ?? null,
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
          probes.length === 1 && (port === 7890 ? probes[0].status === 0 : probes[0].status === 124)
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
      ['ok', 'no-tun'].includes(record.foreignRules) &&
      record.image !== null &&
      record.cloneStartStop === 'ok' &&
      record.egress === 'ok' &&
      record.privateEgress === 'denied' &&
      record.firewall === 'ok' &&
      ['ok', 'inactive'].includes(record.ufw) &&
      record.networkReady === true &&
      record.memoryMax === 4294967296 &&
      record.homeVisible === false &&
      record.negativeControl === 'denied',
  };
}

export function checkHost({
  run = (cmd, args, { timeout = 90_000 } = {}) =>
    spawnSync(cmd, args, {
      encoding: 'utf8',
      timeout,
      env: { ...process.env, SYSTEMD_ASK_PASSWORD: '0', LC_ALL: 'C' },
    }),
  wait = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000),
  user = userInfo().username,
  name = `cairn-orb-check-${randomUUID().slice(0, 8)}`,
  runtimeRoot = '/run/cairn-orb',
  releaseFile = '/var/lib/cairn-orb/dist/current.json',
  ufwRulesFile = '/etc/ufw/user.rules',
  networkdDirectory = '/etc/systemd',
  blockedPorts = (process.env.CAIRN_ORB_CHECK_BLOCKED_PORTS ?? '22,5231').split(',').map(Number),
} = {}) {
  if (user !== 'ian') throw new Error('Run the host check as ian without sudo');
  if (!/^cairn-orb-check-[a-zA-Z0-9-]+$/.test(name)) throw new Error('Invalid check machine name');
  validatePorts(blockedPorts);
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
  try {
    const release = readMetadata(releaseFile);
    if (
      release &&
      ['key', 'version', 'sha'].every(
        (key) => typeof release[key] === 'string' && release[key].length > 0,
      )
    )
      input.daemonRelease = { key: release.key, version: release.version, sha: release.sha };
  } catch {}
  const call = (cmd, args) => {
    const result = run(cmd, args);
    if (result.status !== 0)
      errors.push(
        `${cmd} ${args.filter((arg) => !arg.startsWith('cairn-orb-check-')).join(' ')}: ${result.stderr || result.error || result.status}`,
      );
    return result;
  };
  const networkd = run('systemctl', ['is-active', 'systemd-networkd.service']);
  input.networkdService = networkd.status === 0 ? 'active' : 'inactive';
  const configs = [join(networkdDirectory, 'networkd.conf')];
  const dropins = join(networkdDirectory, 'networkd.conf.d');
  try {
    configs.push(
      ...readdirSync(dropins)
        .filter((name) => name.endsWith('.conf'))
        .sort()
        .map((name) => join(dropins, name)),
    );
  } catch (error) {
    if (error.code !== 'ENOENT') errors.push(`Cannot read networkd drop-ins: ${error.message}`);
  }
  input.networkdConfig = '';
  for (const path of configs) {
    try {
      input.networkdConfig += `\n[]\n${readFileSync(path, 'utf8')}\n`;
    } catch (error) {
      if (error.code !== 'ENOENT')
        errors.push(`Cannot read networkd configuration: ${error.message}`);
    }
  }
  const tun = run('ip', ['link', 'show', 'dev', 'sbtun0']);
  input.tunPresent = tun.status === 0;
  if (tun.status !== 0 && tun.status !== 1)
    errors.push('Cannot inspect sing-box tun interface sbtun0');
  if (input.tunPresent) input.policyRules = call('ip', ['rule', 'show']).stdout || '';
  const { foreignRules } = parseHostCheck(input, { blockedPorts });
  if (foreignRules === 'managed')
    errors.push(
      'systemd-networkd manages foreign routing policy rules; set ManageForeignRoutingPolicyRules=no',
    );
  if (foreignRules === 'lost')
    errors.push('sing-box tun policy rules (table 2022) are missing; restart sing-box');
  const ufw = run('systemctl', ['is-active', 'ufw']);
  input.ufwService = ufw.status === 0 ? 'active' : 'inactive';
  if (input.ufwService === 'active') {
    try {
      input.ufwRules = readFileSync(ufwRulesFile, 'utf8');
    } catch {
      input.ufwRules = '';
    }
    if (missingUfwRules(input.ufwRules).length > 0)
      errors.push(
        'ufw is active without the cairn-orb DHCP and relay rules; rerun install-host.sh',
      );
  }
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
  let clone;
  try {
    clone = run('machinectl', ['--no-ask-password', 'clone', 'cairn-orb-base', name], {
      timeout: 600_000,
    });
  } catch (error) {
    clone = { status: null, error };
  }
  if (clone.status !== 0) {
    errors.push(`Clone ${name} failed: ${clone.stderr || clone.error || clone.status}`);
    const images = call('machinectl', [
      '--no-ask-password',
      'list-images',
      '--no-legend',
      '--no-pager',
    ]);
    if (
      images.status === 0 &&
      (images.stdout || '').split('\n').some((line) => line.trim().split(/\s+/)[0] === name)
    )
      call('machinectl', ['--no-ask-password', 'remove', name]);
    return { ...parseHostCheck(input, { blockedPorts }), errors };
  }
  const directory = join(runtimeRoot, name);
  const requestId = randomUUID();
  let preparedDirectory = false;
  let lifecycle = true;
  try {
    if (lstatSync(directory, { throwIfNoEntry: false }))
      throw new Error('Runtime directory already exists');
    if (call('machinectl', ['--no-ask-password', 'start', name]).status !== 0)
      throw new Error('start failed');
    for (let attempt = 0; attempt < 30; attempt++) {
      const stat = lstatSync(directory, { throwIfNoEntry: false });
      if (stat) {
        if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o7777) !== 0o700)
          throw new Error('Invalid private runtime directory');
        preparedDirectory = true;
        break;
      }
      if (attempt < 29) wait();
    }
    if (!preparedDirectory)
      throw new Error('Timed out waiting for root-prepared runtime directory');
    writeFileSync(
      join(directory, 'check-request'),
      JSON.stringify({ version: 1, requestId, blockedPorts }),
      { mode: 0o600, flag: 'wx' },
    );
    let result;
    for (let attempt = 0; attempt < 240; attempt++) {
      try {
        result = readMetadata(join(directory, 'check-result.json'));
        break;
      } catch (error) {
        if (error.code !== 'ENOENT') throw new Error('Invalid guest check result');
      }
      if (attempt < 239) wait();
    }
    if (!result) throw new Error('Timed out waiting for guest check result');
    const keys = [
      'version',
      'requestId',
      'egressCode',
      'egressExit',
      'privateEgress',
      'firewallProbes',
      'homeExit',
      'networkReady',
      'networkWaitMs',
      'ipv4',
    ];
    if (
      result.version !== 1 ||
      result.requestId !== requestId ||
      Object.keys(result).length !== keys.length ||
      Object.keys(result).some((key) => !keys.includes(key)) ||
      typeof result.networkReady !== 'boolean' ||
      !Number.isInteger(result.networkWaitMs) ||
      result.networkWaitMs < 0 ||
      (result.networkReady
        ? !isIPv4(result.ipv4) || result.ipv4.startsWith('169.254.')
        : result.ipv4 !== null) ||
      typeof result.egressCode !== 'string' ||
      !/^[0-9]{3}$/.test(result.egressCode) ||
      !Array.isArray(result.privateEgress) ||
      !Array.isArray(result.firewallProbes) ||
      !result.privateEgress.every(
        (probe) =>
          probe &&
          typeof probe === 'object' &&
          Object.keys(probe).sort().join(',') === 'code,status' &&
          typeof probe.code === 'string',
      ) ||
      !result.firewallProbes.every(
        (probe) =>
          probe &&
          typeof probe === 'object' &&
          Object.keys(probe).sort().join(',') === 'port,status',
      )
    )
      throw new Error('Invalid guest check metadata');
    input.headers = result.egressExit === 0 ? `HTTP/2 ${result.egressCode}` : '';
    input.networkReady = result.networkReady;
    input.networkWaitMs = result.networkWaitMs;
    input.ipv4 = result.ipv4;
    if (!result.networkReady)
      errors.push('Guest host0 has no non-link-local IPv4 address after network wait');
    input.privateEgress = result.privateEgress;
    input.firewallProbes = result.firewallProbes;
    input.homeExit = result.homeExit;
    input.memory =
      call('systemctl', ['show', `systemd-nspawn@${name}.service`, '-p', 'MemoryMax']).stdout || '';
  } catch (error) {
    lifecycle = false;
    errors.push(error.message);
  } finally {
    lifecycle =
      cleanupMachine({
        name,
        call,
        run,
        wait,
        directory,
        preparedDirectory,
        errors,
      }) && lifecycle;
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
