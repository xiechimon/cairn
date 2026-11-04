import { HostOrbProvider, NspawnOrbProvider, type OrbProvider } from './provider.js';
import type { OrbRuntimeName } from './runtime.js';

export const ORB_RUNTIME_ENV = 'CAIRN_ORB_RUNTIME';

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

export function createOrbProvider(env: NodeJS.ProcessEnv, nspawnStateFile: string): OrbProvider {
  if (env.CAIRN_EXECUTOR !== 'orb') return new HostOrbProvider();
  const runtime = resolveOrbRuntime(env);
  if (runtime !== 'nspawn')
    throw new Error(
      `${ORB_RUNTIME_ENV}=${runtime} is not implemented yet; only nspawn is available`,
    );
  return new NspawnOrbProvider({ stateFile: nspawnStateFile });
}
