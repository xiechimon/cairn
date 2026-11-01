import { spawnSync } from 'node:child_process';
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { isIPv4 } from 'node:net';
import { join, resolve } from 'node:path';

export function validatePorts(ports) {
  if (
    !Array.isArray(ports) ||
    ports.length < 2 ||
    ports.length > 16 ||
    new Set(ports).size !== ports.length ||
    ports.some((port) => !Number.isInteger(port) || port < 1 || port > 65535 || port === 7890)
  )
    throw new Error('Invalid firewall check ports');
}

export function readMetadata(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 16384) throw new Error('Invalid check metadata file');
    const buffer = Buffer.alloc(16385);
    const length = readSync(fd, buffer, 0, buffer.length, 0);
    if (length > 16384) throw new Error('Invalid check metadata size');
    return JSON.parse(buffer.subarray(0, length).toString('utf8'));
  } finally {
    closeSync(fd);
  }
}

export function waitForNetwork({
  readAddresses,
  timeoutMs = 120_000,
  pollMs = 1000,
  now = () => performance.now(),
  wait = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || !Number.isFinite(pollMs) || pollMs <= 0)
    throw new Error('Invalid network wait bounds');
  const start = now();
  for (;;) {
    const ipv4 = [...readAddresses().matchAll(/\binet (\S+)\/\d+\b/g)]
      .map((match) => match[1])
      .find((address) => isIPv4(address) && !address.startsWith('169.254.'));
    const networkWaitMs = Math.max(0, Math.round(now() - start));
    if (ipv4) return { networkReady: true, networkWaitMs, ipv4 };
    if (networkWaitMs >= timeoutMs) return { networkReady: false, networkWaitMs, ipv4: null };
    wait(Math.min(pollMs, timeoutMs - networkWaitMs));
  }
}

export function runGuestCheck({
  directory = '/run/cairn',
  run = (cmd, args) =>
    spawnSync(cmd, args, {
      encoding: 'utf8',
      timeout: cmd === 'ip' ? 1000 : 30000,
      maxBuffer: 16384,
    }),
  network = {},
} = {}) {
  const request = readMetadata(join(directory, 'check-request'));
  if (
    request.version !== 1 ||
    typeof request.requestId !== 'string' ||
    !/^[a-zA-Z0-9-]{1,64}$/.test(request.requestId)
  )
    throw new Error('Invalid check request');
  validatePorts(request.blockedPorts);
  const networkResult = waitForNetwork({
    readAddresses: () => {
      const result = run('ip', ['-4', '-o', 'addr', 'show', 'dev', 'host0']);
      return result.status === 0 ? result.stdout || '' : '';
    },
    ...network,
  });
  const curl = [
    '--silent',
    '--show-error',
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
  ];
  const egress = run('curl', [
    ...curl,
    '--retry',
    '3',
    '--retry-all-errors',
    '--retry-delay',
    '1',
    '--retry-max-time',
    '20',
    '--head',
    'https://github.com',
  ]);
  const result = {
    version: 1,
    requestId: request.requestId,
    ...networkResult,
    egressCode: /^\d{3}$/.test(egress.stdout?.trim() ?? '') ? egress.stdout.trim() : '',
    egressExit: egress.status,
    privateEgress: ['http://127.0.0.1:80/', 'http://10.203.0.1:22/'].map((target) => {
      const probe = run('curl', [...curl, '--fail', target]);
      return {
        status: probe.status,
        code: /^\d{3}$/.test(probe.stdout?.trim() ?? '') ? probe.stdout.trim() : '',
      };
    }),
    firewallProbes: [7890, ...request.blockedPorts].map((port) => ({
      port,
      status: run('timeout', ['3', 'bash', '-c', `exec 3<>/dev/tcp/10.203.0.1/${port}`]).status,
    })),
    homeExit: run('test', ['!', '-e', '/home/ian']).status,
  };
  const temp = join(directory, `check-result-${request.requestId}.tmp`);
  writeFileSync(temp, `${JSON.stringify(result)}\n`, { mode: 0o600, flag: 'wx' });
  renameSync(temp, join(directory, 'check-result.json'));
  unlinkSync(join(directory, 'check-request'));
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) runGuestCheck();
