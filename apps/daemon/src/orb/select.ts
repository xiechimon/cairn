import { isAbsolute, join } from 'node:path';
import { ContainerOrbProvider, type ContainerOrbProviderOptions } from './container-provider.js';
import { ORB_EGRESS_ENV, PodmanOrbRuntime } from './podman.js';
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
    runtime: new PodmanOrbRuntime(),
    image,
    runtimeRoot: join(runtimeDirectory, 'cairn-orb'),
    distRoot: join(home, 'orb', 'dist'),
    seedRoot: join(home, 'orb', 'seed'),
    stateFile: join(home, 'orb-state', 'containers.json'),
    egressSocketPath,
  };
}

export function createOrbProvider(env: NodeJS.ProcessEnv, home: string): OrbProvider {
  if (env.CAIRN_EXECUTOR !== 'orb') return new HostOrbProvider();
  const runtime = resolveOrbRuntime(env);
  if (runtime === 'nspawn')
    return new NspawnOrbProvider({ stateFile: join(home, 'orb-state', 'orbs.json') });
  if (runtime === 'podman') return new ContainerOrbProvider(podmanProviderOptions(env, home));
  throw new Error(
    `${ORB_RUNTIME_ENV}=${runtime} is not implemented yet; only nspawn and podman are available`,
  );
}
