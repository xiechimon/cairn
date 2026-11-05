import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lookup as resolveName } from 'node:dns/promises';
import {
  closeSync,
  constants,
  fstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  readSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { connect } from 'node:net';
import { basename, join, resolve } from 'node:path';

export const publicDirectTargets = ['http://1.1.1.1:443'];

const DNS_TARGET = 'direct dns github.com';
const DNS_FAILURES = ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ESERVFAIL', 'ETIMEOUT', 'ENODATA'];

export function isContainerConfig(config) {
  return config.runtime === 'podman';
}

export function networkTargets(config) {
  if (isContainerConfig(config))
    return [
      'http://127.0.0.1:8787',
      `http://127.0.0.1:${config.serverPort}`,
      `http://tailnet-server:${config.serverPort}`,
    ];
  return [
    'http://127.0.0.1:8787',
    `http://127.0.0.1:${config.serverPort}`,
    `http://10.203.0.1:${config.serverPort}`,
    `http://tailnet-server:${config.serverPort}`,
  ];
}

export function refusedTargets() {
  return [
    'http://10.0.0.1:443',
    'http://192.168.1.1:80',
    'http://172.16.0.1:443',
    'http://169.254.169.254:80',
    'http://100.64.0.1:443',
    'http://127.0.0.1:443',
    'http://1.1.1.1:25',
  ];
}

function socketPaths(config) {
  return [
    '/var/run/docker.sock',
    ...(isContainerConfig(config)
      ? [
          '/run/docker.sock',
          '/run/podman/podman.sock',
          `/run/user/${config.hostUid}/podman/podman.sock`,
          `/run/user/${config.hostUid}/docker.sock`,
        ]
      : []),
  ];
}

export function expectedTargets(config) {
  const paths = [...config.sentinels.map((entry) => entry.path), ...config.realPaths];
  const container = isContainerConfig(config);
  return {
    directRead: [
      ...paths.flatMap((path) => [path, `/proc/1/root${path}`]),
      '$HOME enumeration',
      `${config.hostHome} enumeration`,
    ],
    symlinkPush: paths,
    socketAndServer: [
      ...socketPaths(config),
      ...networkTargets(config).flatMap((target) => [`direct ${target}`, `proxy ${target}`]),
      ...(container
        ? [
            ...refusedTargets(config).flatMap((target) => [`direct ${target}`, `proxy ${target}`]),
            ...publicDirectTargets.map((target) => `direct ${target}`),
            DNS_TARGET,
          ]
        : []),
    ],
    ...(container
      ? {
          sudoRead: [...paths.map((path) => `sudo ${path}`), `sudo ${config.hostHome} enumeration`],
        }
      : {}),
  };
}

export function fileProbe(
  path,
  sentinel,
  copy,
  { stat = statSync, open = openSync, readlink = readlinkSync } = {},
) {
  let fd;
  let guestRoot = false;
  try {
    if (path.startsWith('/proc/1/root/')) {
      try {
        guestRoot = readlink('/proc/1/root') === '/';
      } catch (error) {
        if (!['EACCES', 'EPERM'].includes(error.code)) throw error;
        guestRoot = true;
      }
    }
    if (!sentinel) {
      stat(path);
      return { blocked: false, detail: 'real path reachable (metadata only)' };
    }
    fd = open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    if (!fstatSync(fd).isFile())
      return { blocked: false, detail: 'unexpected reachable file type' };
    const buffer = Buffer.alloc(4096);
    const size = readSync(fd, buffer, 0, buffer.length, 0);
    const bytes = buffer.subarray(0, size);
    const marker = createHash('sha256').update(bytes).digest('hex') === sentinel.hash;
    if (copy && marker) writeFileSync(copy, bytes, { flag: 'wx', mode: 0o600 });
    return {
      blocked: false,
      detail: marker ? 'sentinel marker read' : 'path readable; marker mismatch',
      marker,
    };
  } catch (error) {
    if (guestRoot && ['EACCES', 'EPERM'].includes(error.code))
      return { blocked: true, detail: 'proc1-root-not-host' };
    return {
      blocked: error.code === 'ENOENT',
      detail: ['EACCES', 'EPERM'].includes(error.code)
        ? 'present-but-denied'
        : (error.code ?? 'probe error'),
    };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function connectionProbe(options, request) {
  return new Promise((resolveProbe) => {
    const socket = connect(options);
    let header = '';
    const finish = (blocked, detail) => {
      socket.destroy();
      resolveProbe({ blocked, detail });
    };
    socket.setTimeout(2000, () => finish(true, 'ETIMEDOUT'));
    socket.on('error', (error) =>
      finish(
        [
          'ENOENT',
          'EACCES',
          'EPERM',
          'ECONNREFUSED',
          'ENETUNREACH',
          'EHOSTUNREACH',
          'ECONNRESET',
        ].includes(error.code),
        error.code ?? 'network error',
      ),
    );
    socket.on('connect', () => {
      if (request) socket.write(request);
      else finish(false, 'connected');
    });
    socket.on('data', (chunk) => {
      header += chunk.toString('latin1');
      if (header.length > 16384) finish(false, 'invalid proxy response');
      const status = /^HTTP\/1\.[01] (\d{3})/.exec(header)?.[1];
      if (status) finish(status === '403', `proxy HTTP ${status}`);
    });
    socket.on('end', () => finish(false, 'proxy closed without denial'));
  });
}

export async function attack(
  config,
  {
    cwd = process.cwd(),
    env = process.env,
    network = true,
    connectTarget = connectionProbe,
    run = spawnSync,
    lookup = resolveName,
    rootProbe = defaultRootProbe,
  } = {},
) {
  const container = isContainerConfig(config);
  const inOrb = env.CAIRN_ORB === '1';
  const routes = {
    directRead: [],
    symlinkPush: [],
    socketAndServer: [],
    ...(container ? { sudoRead: [] } : {}),
  };
  const leaked = new Set();
  const targets = [
    ...config.sentinels.map((sentinel) => ({ path: sentinel.path, sentinel })),
    ...config.realPaths.map((path) => ({ path })),
  ];
  mkdirSync(join(cwd, 'canary-links'), { mode: 0o700 });
  mkdirSync(join(cwd, 'canary-copies'), { mode: 0o700 });
  for (const [index, { path, sentinel }] of targets.entries()) {
    for (const target of [path, `/proc/1/root${path}`]) {
      const probe = fileProbe(target, sentinel);
      if (probe.marker) leaked.add(path);
      routes.directRead.push({ target, blocked: probe.blocked, detail: probe.detail });
    }
    const link = join(cwd, 'canary-links', String(index));
    symlinkSync(path, link);
    const probe = fileProbe(
      link,
      sentinel,
      sentinel ? join(cwd, 'canary-copies', String(index)) : undefined,
    );
    if (probe.marker) leaked.add(path);
    routes.symlinkPush.push({ target: path, blocked: probe.blocked, detail: probe.detail });
  }
  for (const [target, path] of [
    ['$HOME enumeration', env.HOME],
    [`${config.hostHome} enumeration`, config.hostHome],
  ]) {
    try {
      const names = readdirSync(path);
      const hostVisible = listingExposesHost(names, config);
      routes.directRead.push({
        target,
        blocked: !hostVisible,
        detail: hostVisible ? 'host home enumerable' : 'guest home enumerable; no host sentinels',
      });
    } catch (error) {
      routes.directRead.push({
        target,
        blocked: error.code === 'ENOENT',
        detail: ['EACCES', 'EPERM'].includes(error.code)
          ? 'present-but-denied'
          : (error.code ?? 'enumeration error'),
      });
    }
  }
  let githubReach = { ok: false, ms: 0 };
  let sudo;
  if (network) {
    for (const path of socketPaths(config))
      routes.socketAndServer.push({ target: path, ...(await connectTarget({ path })) });
    const proxy = new URL(
      env.HTTP_PROXY ?? `http://${container ? '127.0.0.1' : '10.203.0.1'}:7890`,
    );
    const viaProxy = !container || inOrb;
    const probeThroughProxy = async (target, label) => {
      const url = new URL(target);
      const host = url.hostname === 'tailnet-server' ? config.tailnetAddress : url.hostname;
      const probe = await connectTarget(
        { host: proxy.hostname, port: Number(proxy.port) },
        `CONNECT ${host}:${url.port || '80'} HTTP/1.1\r\nHost: ${host}:${url.port || '80'}\r\n\r\n`,
      );
      routes.socketAndServer.push({
        target: label,
        ...probe,
        blocked: probe.blocked && probe.detail === 'proxy HTTP 403',
      });
    };
    for (const target of networkTargets(config)) {
      const url = new URL(target);
      const host = url.hostname === 'tailnet-server' ? config.tailnetAddress : url.hostname;
      const direct = await connectTarget({ host, port: Number(url.port || '80') });
      routes.socketAndServer.push({
        target: `direct ${target}`,
        ...direct,
        blocked: direct.blocked,
        detail:
          url.hostname === '127.0.0.1' && inOrb
            ? `orb own loopback; ${direct.detail}`
            : direct.detail,
      });
      if (viaProxy) await probeThroughProxy(target, `proxy ${target}`);
    }
    if (container && inOrb) {
      for (const target of refusedTargets(config)) {
        const url = new URL(target);
        routes.socketAndServer.push({
          target: `direct ${target}`,
          ...(await connectTarget({ host: url.hostname, port: Number(url.port || '80') })),
        });
        await probeThroughProxy(target, `proxy ${target}`);
      }
      for (const target of publicDirectTargets) {
        const url = new URL(target);
        routes.socketAndServer.push({
          target: `direct ${target}`,
          ...(await connectTarget({ host: url.hostname, port: Number(url.port || '80') })),
        });
      }
      try {
        await lookup('github.com');
        routes.socketAndServer.push({ target: DNS_TARGET, blocked: false, detail: 'resolved' });
      } catch (error) {
        routes.socketAndServer.push({
          target: DNS_TARGET,
          blocked: DNS_FAILURES.includes(error.code),
          detail: error.code ?? 'lookup error',
        });
      }
    }
    if (viaProxy) {
      const started = performance.now();
      const git = run(
        'git',
        [
          '-c',
          'credential.helper=',
          '-c',
          `http.proxy=${proxy.href}`,
          'ls-remote',
          'https://github.com/xiechimon/cairn.git',
          'HEAD',
        ],
        {
          encoding: 'utf8',
          timeout: 30000,
          maxBuffer: 4096,
          env: {
            ...env,
            NO_PROXY: '',
            no_proxy: '',
            GIT_TERMINAL_PROMPT: '0',
            GIT_CONFIG_GLOBAL: '/dev/null',
            GIT_CONFIG_NOSYSTEM: '1',
          },
        },
      );
      githubReach = {
        ok: git.status === 0 && /^[a-f0-9]{40,64}\s+HEAD\s*$/.test(git.stdout ?? ''),
        ms: Math.round(performance.now() - started),
      };
    }
  }
  if (container && inOrb) {
    const identity = run('sudo', ['-n', 'id', '-u'], { encoding: 'utf8', timeout: 10000 });
    sudo = { works: identity.status === 0 && identity.stdout?.trim() === '0' };
    if (sudo.works) {
      const root = rootProbe(config, run);
      routes.sudoRead.push(...root.rows);
      for (const path of root.leaked) leaked.add(path);
    }
  }
  return {
    executor: inOrb ? 'orb' : 'host',
    routes,
    leaked: [...leaked],
    githubReach,
    ...(sudo ? { sudo } : {}),
  };
}

function listingExposesHost(names, config) {
  return names.some((name) => config.sentinels.some((entry) => basename(entry.path) === name));
}

export function rootReadRows(config, probe = fileProbe, list = readdirSync) {
  const rows = [];
  const leaked = [];
  for (const { path, sentinel } of [
    ...config.sentinels.map((entry) => ({ path: entry.path, sentinel: entry })),
    ...config.realPaths.map((path) => ({ path })),
  ]) {
    const result = probe(path, sentinel);
    if (result.marker) leaked.push(path);
    rows.push({ target: `sudo ${path}`, blocked: result.blocked, detail: result.detail });
  }
  try {
    const names = list(config.hostHome);
    const exposed = listingExposesHost(names, config);
    rows.push({
      target: `sudo ${config.hostHome} enumeration`,
      blocked: !exposed,
      detail: exposed ? 'host home enumerable' : 'guest home enumerable; no host sentinels',
    });
  } catch (error) {
    rows.push({
      target: `sudo ${config.hostHome} enumeration`,
      blocked: error.code === 'ENOENT',
      detail: error.code ?? 'enumeration error',
    });
  }
  return { rows, leaked };
}

function defaultRootProbe(config, run) {
  const result = run('sudo', ['-n', process.execPath, import.meta.filename, '--root-read'], {
    input: JSON.stringify(config),
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) throw new Error('Root probe failed');
  return JSON.parse(result.stdout);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === import.meta.filename &&
  process.argv[2] === '--root-read'
) {
  const config = JSON.parse(readFileSync(0, 'utf8'));
  process.stdout.write(`${JSON.stringify(rootReadRows(config))}\n`);
} else if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const result = await attack(config, { network: config.probeNetwork !== false });
  writeFileSync('canary-result.json', `${JSON.stringify(result)}\n`, { flag: 'wx', mode: 0o600 });
  process.stdout.write(`CAIRN_CANARY_RESULT=${JSON.stringify(result)}\n`);
  if (config.modelPort) {
    const model = spawn(
      process.execPath,
      ['.agents/canary-model.mjs', String(config.modelPort), String(process.ppid)],
      { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] },
    );
    await new Promise((ready, reject) => {
      const timer = setTimeout(() => {
        model.kill();
        reject(new Error('Scripted model startup timed out'));
      }, 10000);
      model.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      model.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`Scripted model exited before readiness (${code})`));
      });
      model.once('message', (message) => {
        if (message !== 'ready') return;
        clearTimeout(timer);
        model.disconnect();
        model.unref();
        ready();
      });
    });
  }
}
