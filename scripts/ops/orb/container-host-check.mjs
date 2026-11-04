import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { connect } from 'node:net';
import { userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { inspectEgressBoundary } from './egress-boundary.mjs';

export const EXPECTED_CAP_BND = '00000000800000eb';
export const REQUIRED_CONTROLLERS = ['cpu', 'memory', 'pids'];
const SUBID_COUNT = 65536;
const IMAGE_PATTERN = /^cairn-orb-base:(?!latest$)[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const PUBLIC_TARGET = 'github.com:443';
const REFUSED_TARGETS = [
  '10.0.0.1:443',
  '169.254.169.254:80',
  '100.64.0.1:443',
  '127.0.0.1:443',
  'github.com:25',
];
const RELAY_UNIT = 'cairn-orb-egress.service';

function relayStatus(relay) {
  if (relay.directory !== 'ok') return relay.directory;
  if (relay.socket !== 'ok') return relay.socket;
  if (relay.boundary !== 'ok') return relay.boundary ?? 'unknown-boundary';
  return relay.listening === true ? 'ok' : 'not-listening';
}

export function parseContainerHostCheck(input) {
  const errors = [];
  const probe = input.probe;
  const controllers = input.cgroupControllers?.split(/\s+/) ?? null;
  const missingControllers =
    controllers === null
      ? REQUIRED_CONTROLLERS
      : REQUIRED_CONTROLLERS.filter((name) => !controllers.includes(name));
  const relay = relayStatus(input.relay);
  const record = {
    runtime: 'podman',
    podman: input.podman?.version ?? null,
    rootless: input.podman?.rootless ?? null,
    subuid: input.subuid ? 'ok' : 'missing',
    subgid: input.subgid ? 'ok' : 'missing',
    cgroupControllers:
      missingControllers.length === 0 ? 'ok' : `missing ${missingControllers.join(',')}`,
    image: input.image.exists ? input.image.tag : null,
    relay,
    relayUnit: input.relay.unit ?? 'unknown',
    capBnd: probe?.capBnd ?? null,
    capEff: probe?.capEff ?? null,
    capAmb: probe?.capAmb ?? null,
    uid: probe?.uid ?? null,
    interfaces: probe?.interfaces ?? null,
    sudo: probe?.sudo ?? null,
    homeVisible: probe ? probe.homeVisible : null,
    egress: probe?.egress?.[PUBLIC_TARGET] === 200 ? 'ok' : 'failed',
    privateEgress: REFUSED_TARGETS.every((target) => probe?.egress?.[target] === 403)
      ? 'denied'
      : 'failed',
    spawnRemove: probe && probe.removeError === undefined ? 'ok' : 'failed',
  };
  if (record.podman === null) errors.push('podman is not installed or `podman info` failed');
  else if (record.rootless !== true) errors.push('podman is not rootless');
  if (record.subuid !== 'ok')
    errors.push(`/etc/subuid has no range of at least ${SUBID_COUNT} ids for this user`);
  if (record.subgid !== 'ok')
    errors.push(`/etc/subgid has no range of at least ${SUBID_COUNT} ids for this user`);
  if (record.cgroupControllers !== 'ok')
    errors.push(
      `cgroup v2 delegation to the user manager is incomplete: ${record.cgroupControllers}`,
    );
  if (record.image === null) errors.push(`Image ${input.image.tag} is missing; build it first`);
  if (relay !== 'ok')
    errors.push(
      `Egress relay socket check failed (${relay}); expect a live 0600 socket in a 0700 directory owned by this user`,
    );
  if (input.probeError) errors.push(`Probe container failed: ${input.probeError}`);
  if (!probe) errors.push('Probe container returned no result');
  if (probe) {
    if (probe.rootless !== true) errors.push('Probe reports a rootful runtime');
    if (probe.capBnd !== EXPECTED_CAP_BND)
      errors.push(`Container CapBnd is ${probe.capBnd}, expected ${EXPECTED_CAP_BND}`);
    if (probe.capEff !== '0000000000000000')
      errors.push(`Container user CapEff is ${probe.capEff}, expected empty`);
    if (probe.capAmb !== '0000000000000000')
      errors.push(`Container user CapAmb is ${probe.capAmb}, expected empty`);
    if (probe.uid !== 1000) errors.push(`Container user id is ${probe.uid}, expected 1000`);
    if (!(probe.interfaces?.length === 1 && probe.interfaces[0] === 'lo'))
      errors.push(`Container interfaces are [${probe.interfaces}], expected only lo`);
    if (probe.sudo !== true) errors.push('sudo -n does not work for the container user');
    if (probe.homeVisible !== false) errors.push('The host home is visible inside the container');
    if (probe.removeError !== undefined)
      errors.push(`Probe container removal failed: ${probe.removeError}`);
    if (record.egress !== 'ok') errors.push('The relay did not open a tunnel to the public target');
    if (record.privateEgress !== 'denied')
      errors.push('The relay did not refuse every private, metadata and disallowed-port target');
  }
  return { ...record, ok: errors.length === 0, errors };
}

function hasSubidRange(contents, username, uid) {
  return contents.split('\n').some((line) => {
    const [name, start, count] = line.split(':');
    return (
      (name === username || name === String(uid)) &&
      Number.isInteger(Number(start)) &&
      Number(count) >= SUBID_COUNT
    );
  });
}

function classify(stat, kind, uid) {
  if (stat === null) return 'missing';
  if (stat.isSymbolicLink() || !(kind === 'directory' ? stat.isDirectory() : stat.isSocket()))
    return `not-${kind}`;
  if (stat.uid !== uid) return 'owner';
  return (stat.mode & 0o777) === (kind === 'directory' ? 0o700 : 0o600) ? 'ok' : 'mode';
}

function socketAccepts(path) {
  return new Promise((resolveConnect) => {
    const socket = connect(path);
    socket.setTimeout(2000, () => {
      socket.destroy();
      resolveConnect(false);
    });
    socket.once('connect', () => {
      socket.destroy();
      resolveConnect(true);
    });
    socket.once('error', () => resolveConnect(false));
  });
}

function runProbeHelper({ image, orbId, egressSocketPath }) {
  const checkout = resolve(import.meta.dirname, '../../..');
  const cwd = join(checkout, 'apps/daemon');
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', join(cwd, 'scripts/orb-probe.ts'), image, orbId, egressSocketPath ?? ''],
    { cwd, encoding: 'utf8', timeout: 300_000, maxBuffer: 1024 * 1024 },
  );
  const line = (result.stdout ?? '').trim().split('\n').at(-1);
  try {
    return JSON.parse(line);
  } catch {
    return { error: `probe helper produced no result (${result.status ?? result.error?.code})` };
  }
}

export async function checkContainerHost({
  uid = process.getuid(),
  username = userInfo().username,
  env = process.env,
  run = (cmd, args) =>
    spawnSync(cmd, args, {
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, LC_ALL: 'C' },
    }),
  readFile = (path) => readFileSync(path, 'utf8'),
  stat = (path) => lstatSync(path, { throwIfNoEntry: false }) ?? null,
  entries = readdirSync,
  realpath = realpathSync,
  connect: accepts = socketAccepts,
  probe = runProbeHelper,
  orbId = `cairn-orb-check-${randomUUID().slice(0, 8)}`,
} = {}) {
  const tag = env.CAIRN_ORB_IMAGE ?? '';
  const socketPath =
    env.CAIRN_ORB_EGRESS_SOCKET ||
    (env.XDG_RUNTIME_DIR ? join(env.XDG_RUNTIME_DIR, 'cairn-orb-egress/egress.sock') : '');
  const refused = (message) => ({
    ...parseContainerHostCheck({
      podman: null,
      subuid: false,
      subgid: false,
      cgroupControllers: null,
      image: { tag, exists: false },
      relay: { directory: 'missing', socket: 'missing', listening: false },
      probe: null,
      probeError: null,
    }),
    ok: false,
    errors: [message],
  });
  if (uid === 0) return refused('Run the host check as an unprivileged user');
  if (!IMAGE_PATTERN.test(tag))
    return refused(
      'CAIRN_ORB_IMAGE must name the expected pinned image (cairn-orb-base:<recipe hash>)',
    );
  if (!socketPath.startsWith('/'))
    return refused('CAIRN_ORB_EGRESS_SOCKET or XDG_RUNTIME_DIR must locate the relay socket');
  const readOptional = (path) => {
    try {
      return readFile(path);
    } catch {
      return null;
    }
  };
  const statOptional = (path) => {
    try {
      return stat(path);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  };

  let podman = null;
  const info = run('podman', ['info', '--format', 'json']);
  if (info.status === 0) {
    try {
      const parsed = JSON.parse(info.stdout);
      podman = { version: parsed.version.Version, rootless: parsed.host.security.rootless };
    } catch {}
  }
  const subuid = hasSubidRange(readOptional('/etc/subuid') ?? '', username, uid);
  const subgid = hasSubidRange(readOptional('/etc/subgid') ?? '', username, uid);
  const cgroupControllers =
    readOptional(
      `/sys/fs/cgroup/user.slice/user-${uid}.slice/user@${uid}.service/cgroup.controllers`,
    )?.trim() ?? null;
  const exists = run('podman', ['image', 'exists', tag]).status === 0;
  const unit = (run('systemctl', ['--user', 'is-active', RELAY_UNIT]).stdout ?? '').trim();
  const relay = {
    directory: classify(statOptional(dirname(socketPath)), 'directory', uid),
    socket: classify(statOptional(socketPath), 'socket', uid),
    boundary: inspectEgressBoundary(socketPath, { uid, stat: statOptional, entries, realpath })
      .reason,
    unit: unit || 'unknown',
  };
  relay.listening =
    relay.directory === 'ok' && relay.socket === 'ok' && relay.boundary === 'ok'
      ? await accepts(socketPath)
      : false;

  let probeResult = null;
  let probeError = null;
  if (podman?.rootless === true && exists && relay.boundary === 'ok') {
    try {
      const result = probe({
        image: tag,
        orbId,
        egressSocketPath: relay.listening ? socketPath : undefined,
      });
      if (result?.error) probeError = result.error;
      else probeResult = result;
    } catch (error) {
      probeError = error.message;
    }
  }
  return parseContainerHostCheck({
    podman,
    subuid,
    subgid,
    cgroupControllers,
    image: { tag, exists },
    relay,
    probe: probeResult,
    probeError,
  });
}
