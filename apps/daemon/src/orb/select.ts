import { createHash } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';
import { loadMachineJson, statePaths } from '../state.js';
import { ContainerOrbProvider, type ContainerOrbProviderOptions } from './container-provider.js';
import { createE2bClient } from './e2b-client.js';
import {
  E2B_DEFAULT_SESSION_MS,
  E2B_MAX_SESSION_MS,
  E2B_MIN_SESSION_MS,
  E2bOrbProvider,
} from './e2b-provider.js';
import { ORB_EGRESS_ENV, PodmanOrbRuntime } from './podman.js';
import { HostOrbProvider, NspawnOrbProvider, type OrbProvider } from './provider.js';
import type { OrbRuntimeName } from './runtime.js';

export const ORB_RUNTIME_ENV = 'CAIRN_ORB_RUNTIME';
export const ORB_IMAGE_ENV = 'CAIRN_ORB_IMAGE';
export const E2B_API_KEY_ENV = 'E2B_API_KEY';
export const E2B_TEMPLATE_ENV = 'CAIRN_E2B_TEMPLATE';
export const E2B_TIMEOUT_ENV = 'CAIRN_E2B_TIMEOUT_MS';
export const COMPUTER_ENV = 'CAIRN_COMPUTER';

type OrbBackendName = 'nspawn' | 'e2b' | OrbRuntimeName;

const ORB_BACKENDS: readonly OrbBackendName[] = ['nspawn', 'podman', 'docker', 'apple', 'e2b'];

export function resolveOrbRuntime(env: NodeJS.ProcessEnv): OrbBackendName {
  const value = env[ORB_RUNTIME_ENV];
  if (value === undefined || value === '') return 'nspawn';
  const backend = ORB_BACKENDS.find((name) => name === value);
  if (backend === undefined)
    throw new Error(
      `${ORB_RUNTIME_ENV} must be one of ${ORB_BACKENDS.join(', ')} (got ${JSON.stringify(value)})`,
    );
  return backend;
}

export function podmanProviderOptions(
  env: NodeJS.ProcessEnv,
  home: string,
): ContainerOrbProviderOptions {
  const image = env[ORB_IMAGE_ENV];
  if (!image)
    throw new Error(
      `${ORB_IMAGE_ENV} must name the built image (cairn-orb-base:<recipe hash>) when ${ORB_RUNTIME_ENV}=podman`,
    );
  const runtimeDirectory = env.XDG_RUNTIME_DIR;
  if (!runtimeDirectory)
    throw new Error(`XDG_RUNTIME_DIR must be set when ${ORB_RUNTIME_ENV}=podman`);
  const egressSocketPath = env[ORB_EGRESS_ENV] || undefined;
  if (egressSocketPath !== undefined && !isAbsolute(egressSocketPath))
    throw new Error(`${ORB_EGRESS_ENV} must be an absolute path (got ${egressSocketPath})`);
  return {
    runtime: new PodmanOrbRuntime({
      ownerId: () => {
        const machine = loadMachineJson(statePaths(home));
        if (!machine)
          throw new Error('Orb owner machine ID is unavailable; enroll this daemon first');
        return machine.machineId;
      },
    }),
    image,
    runtimeRoot: join(
      runtimeDirectory,
      'cairn-orb',
      createHash('sha256').update(resolve(home)).digest('hex').slice(0, 16),
    ),
    distRoot: join(home, 'orb', 'dist'),
    seedRoot: join(home, 'orb', 'seed'),
    stateFile: join(home, 'orb-state', 'containers.json'),
    egressSocketPath,
  };
}

export function e2bProviderOptions(env: NodeJS.ProcessEnv): {
  apiKey: string;
  template: string;
  sessionTimeoutMs: number;
} {
  const apiKey = env[E2B_API_KEY_ENV];
  if (!apiKey)
    throw new Error(
      `${E2B_API_KEY_ENV} must be set in the daemon environment when ${ORB_RUNTIME_ENV}=e2b`,
    );
  const template = env[E2B_TEMPLATE_ENV];
  if (!template)
    throw new Error(
      `${E2B_TEMPLATE_ENV} must name the E2B template that ships node, claude and the cairn release when ${ORB_RUNTIME_ENV}=e2b`,
    );
  const timeout = env[E2B_TIMEOUT_ENV];
  const sessionTimeoutMs =
    timeout === undefined || timeout === '' ? E2B_DEFAULT_SESSION_MS : Number(timeout);
  if (
    !Number.isInteger(sessionTimeoutMs) ||
    sessionTimeoutMs < E2B_MIN_SESSION_MS ||
    sessionTimeoutMs > E2B_MAX_SESSION_MS
  )
    throw new Error(
      `${E2B_TIMEOUT_ENV} must be an integer between ${E2B_MIN_SESSION_MS} and ${E2B_MAX_SESSION_MS} (got ${JSON.stringify(timeout)})`,
    );
  return { apiKey, template, sessionTimeoutMs };
}

export function createOrbProvider(env: NodeJS.ProcessEnv, home: string): OrbProvider {
  if (env.CAIRN_EXECUTOR !== 'orb') return new HostOrbProvider();
  const runtime = resolveOrbRuntime(env);
  if (runtime === 'nspawn')
    return new NspawnOrbProvider({ stateFile: join(home, 'orb-state', 'orbs.json') });
  if (runtime === 'podman') return new ContainerOrbProvider(podmanProviderOptions(env, home));
  if (runtime === 'e2b') {
    const { apiKey, template, sessionTimeoutMs } = e2bProviderOptions(env);
    return new E2bOrbProvider({ client: createE2bClient(apiKey), template, sessionTimeoutMs });
  }
  throw new Error(
    `${ORB_RUNTIME_ENV}=${runtime} is not implemented yet; only nspawn, podman and e2b are available`,
  );
}

export function hostDesktopRequested(env: NodeJS.ProcessEnv): boolean {
  return env[COMPUTER_ENV] === 'host';
}

export function createComputerOrbProvider(
  env: NodeJS.ProcessEnv,
  executor: OrbProvider,
): NspawnOrbProvider | undefined {
  if (hostDesktopRequested(env)) return undefined;
  if (executor instanceof NspawnOrbProvider) return executor;
  const value = env[COMPUTER_ENV];
  if (value === undefined || value === '') return undefined;
  if (value !== 'orb')
    throw new Error(`${COMPUTER_ENV} must be orb or host (got ${JSON.stringify(value)})`);
  return new NspawnOrbProvider();
}
