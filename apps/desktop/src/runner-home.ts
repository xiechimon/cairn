import { join, resolve, sep } from 'node:path';

export function runnerHomeFor(opts: {
  userData: string;
  defaultUserData: string;
  bundle: string;
  installedBundle: string;
  home: string;
}): string {
  const shared = resolve(join(opts.home, '.cairn'));
  const installed =
    resolve(opts.userData) === resolve(opts.defaultUserData) &&
    resolve(opts.bundle) === resolve(opts.installedBundle);
  if (installed) return shared;
  const isolated = resolve(join(opts.userData, 'runner-home'));
  if (isolated === shared || isolated.startsWith(`${shared}${sep}`)) {
    throw new Error(`runner home for a non-installed instance resolved inside ${shared}`);
  }
  return isolated;
}
