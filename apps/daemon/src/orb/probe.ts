import { randomUUID } from 'node:crypto';
import { unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OrbRuntime } from './runtime.js';

export const PROBE_EGRESS_TARGETS = [
  'github.com:443',
  '10.0.0.1:443',
  '169.254.169.254:80',
  '100.64.0.1:443',
  '127.0.0.1:443',
  'github.com:25',
] as const;

const EXEC_TIMEOUT_MS = 30_000;
const CONNECT_THROUGH_RELAY = [
  'printf "CONNECT %s HTTP/1.1\\r\\nHost: %s\\r\\n\\r\\n" "$1" "$1"',
  'socat -T5 - "UNIX-CONNECT:$CAIRN_ORB_EGRESS_SOCKET"',
  'head -n 1',
].join(' | ');

export interface ContainerProbeOptions {
  image: string;
  orbId: string;
  hostHome: string;
  egressSocketPath?: string;
}

export interface ContainerProbe {
  version: string;
  rootless: boolean;
  capBnd: string | null;
  capEff: string | null;
  capAmb: string | null;
  uid: number | null;
  interfaces: string[];
  sudo: boolean;
  homeVisible: boolean;
  egress: Record<string, number | null> | null;
  removeError?: string;
}

function capabilitySet(status: string, name: 'CapBnd' | 'CapEff' | 'CapAmb'): string | null {
  return new RegExp(`^${name}:\\s*([0-9a-f]{16})\\s*$`, 'm').exec(status)?.[1] ?? null;
}

export async function probeContainer(
  runtime: OrbRuntime,
  options: ContainerProbeOptions,
): Promise<ContainerProbe> {
  const { version, rootless } = await runtime.health();
  const witnessPath = join(options.hostHome, `.cairn-orb-home-probe-${randomUUID()}`);
  const witness = randomUUID();
  writeFileSync(witnessPath, witness, { flag: 'wx', mode: 0o600 });
  try {
    await runtime.spawn({
      orbId: options.orbId,
      image: options.image,
      mounts: [],
      env: {},
      limits: { cpus: 1, memoryBytes: 512 * 1024 ** 2, pids: 256 },
      egress: options.egressSocketPath ? { socketPath: options.egressSocketPath } : 'none',
    });
    const exec = (argv: string[]) =>
      runtime.exec(options.orbId, argv, { signal: AbortSignal.timeout(EXEC_TIMEOUT_MS) });
    const status = await exec(['cat', '/proc/self/status']);
    const uid = await exec(['id', '-u']);
    const interfaces = await exec(['ls', '/sys/class/net']);
    const sudo = await exec(['sudo', '-n', 'true']);
    const home = await exec([
      'sh',
      '-c',
      'if [ ! -e "$1" ]; then exit 3; fi; content=$(cat -- "$1") || exit 5; [ "$content" != "$2" ] && exit 4; exit 0',
      'probe-home',
      witnessPath,
      witness,
    ]);
    let egress: ContainerProbe['egress'] = null;
    if (options.egressSocketPath) {
      egress = {};
      for (const target of PROBE_EGRESS_TARGETS) {
        const reply = await exec(['sh', '-c', CONNECT_THROUGH_RELAY, 'probe', target]);
        const code = /^HTTP\/1\.[01] (\d{3})/.exec(reply.stdout)?.[1];
        egress[target] = reply.code === 0 && code ? Number(code) : null;
      }
    }
    return {
      version,
      rootless,
      capBnd: status.code === 0 ? capabilitySet(status.stdout, 'CapBnd') : null,
      capEff: status.code === 0 ? capabilitySet(status.stdout, 'CapEff') : null,
      capAmb: status.code === 0 ? capabilitySet(status.stdout, 'CapAmb') : null,
      uid: uid.code === 0 && /^\d+$/.test(uid.stdout.trim()) ? Number(uid.stdout.trim()) : null,
      interfaces:
        interfaces.code === 0 ? interfaces.stdout.split('\n').filter((name) => name !== '') : [],
      sudo: sudo.code === 0,
      homeVisible: home.code !== 3 && home.code !== 4,
      egress,
      ...(await removeProbe(runtime, options.orbId)),
    };
  } catch (error) {
    await runtime.remove(options.orbId).catch(() => {});
    throw error;
  } finally {
    unlinkSync(witnessPath);
  }
}

async function removeProbe(runtime: OrbRuntime, orbId: string): Promise<{ removeError?: string }> {
  try {
    await runtime.remove(orbId);
    return {};
  } catch (error) {
    return { removeError: error instanceof Error ? error.message : String(error) };
  }
}
