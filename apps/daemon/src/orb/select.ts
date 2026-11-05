import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { loadMachineJson, statePaths } from '../state.js';
import { ContainerOrbProvider } from './container-provider.js';
import { PodmanOrbRuntime } from './podman.js';
import { HostOrbProvider, NspawnOrbProvider, type OrbProvider } from './provider.js';
import type { OrbRuntimeName } from './runtime.js';

export const ORB_RUNTIME_ENV = 'CAIRN_ORB_RUNTIME';
export const ORB_IMAGE_ENV = 'CAIRN_ORB_IMAGE';

type OrbBackendName = 'nspawn' | OrbRuntimeName;

const ORB_BACKENDS: readonly OrbBackendName[] = ['nspawn', 'podman', 'docker', 'apple'];

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

function createPodmanProvider(env: NodeJS.ProcessEnv, home: string): OrbProvider {
  const image = env[ORB_IMAGE_ENV];
  if (!image)
    throw new Error(
      `${ORB_IMAGE_ENV} must name the built image (cairn-orb-base:<recipe hash>) when ${ORB_RUNTIME_ENV}=podman`,
    );
  const runtimeDirectory = env.XDG_RUNTIME_DIR;
  if (!runtimeDirectory)
    throw new Error(`XDG_RUNTIME_DIR must be set when ${ORB_RUNTIME_ENV}=podman`);
  return new ContainerOrbProvider({
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
  });
}

export function createOrbProvider(env: NodeJS.ProcessEnv, home: string): OrbProvider {
  if (env.CAIRN_EXECUTOR !== 'orb') return new HostOrbProvider();
  const runtime = resolveOrbRuntime(env);
  if (runtime === 'nspawn')
    return new NspawnOrbProvider({ stateFile: join(home, 'orb-state', 'orbs.json') });
  if (runtime === 'podman') return createPodmanProvider(env, home);
  throw new Error(
    `${ORB_RUNTIME_ENV}=${runtime} is not implemented yet; only nspawn and podman are available`,
  );
}
