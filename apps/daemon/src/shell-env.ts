import { homedir } from 'node:os';
import { join } from 'node:path';
import { BRAND, ENV_VARS } from '@cairn/shared';
import { type ApplyLoginShellEnvOptions, applyLoginShellEnv } from '@cairn/shared/shell-env';

export async function ensureDaemonShellEnv(
  options: ApplyLoginShellEnvOptions = {},
): Promise<boolean> {
  const cacheHome = process.env[ENV_VARS.home] ?? join(homedir(), `.${BRAND.homeDirName}`);
  return applyLoginShellEnv({
    onlyWhenNonTty: true,
    cachePath: join(cacheHome, 'shell-environment-cache.json'),
    ...options,
  });
}
