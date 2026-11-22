import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmdirSync,
  symlinkSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

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

export function migrateRunnerHome(legacy: string, target: string): void {
  let entries: string[];
  try {
    if (lstatSync(legacy).isSymbolicLink()) return;
    entries = readdirSync(legacy);
  } catch {
    return;
  }
  const moved: string[] = [];
  for (const entry of entries) {
    const to = join(target, entry);
    try {
      if (existsSync(to) || lstatSync(join(legacy, entry)).isSymbolicLink()) continue;
      mkdirSync(target, { recursive: true, mode: 0o700 });
      renameSync(join(legacy, entry), to);
      moved.push(entry);
    } catch (error) {
      console.warn(`runner-home migration skipped ${entry}:`, error);
    }
  }
  keepLegacyPathsResolving(legacy, target, moved);
  try {
    const claudeTarget = join(target, 'homes', 'claude');
    if (
      existsSync(join(target, 'claude')) &&
      !existsSync(claudeTarget) &&
      !lstatSync(join(target, 'claude')).isSymbolicLink()
    ) {
      mkdirSync(dirname(claudeTarget), { recursive: true });
      renameSync(join(target, 'claude'), claudeTarget);
    }
  } catch (error) {
    console.warn('runner-home claude home migration failed:', error);
  }
}

function keepLegacyPathsResolving(legacy: string, target: string, moved: string[]): void {
  try {
    if (readdirSync(legacy).length === 0) {
      rmdirSync(legacy);
      symlinkSync(target, legacy);
      return;
    }
    for (const entry of moved) symlinkSync(join(target, entry), join(legacy, entry));
  } catch (error) {
    console.warn('runner-home legacy links failed:', error);
  }
}
