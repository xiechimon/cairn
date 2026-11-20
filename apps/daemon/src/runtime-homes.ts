import { existsSync, lstatSync, mkdirSync, readdirSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { BRAND } from '@cairn/shared';

export type RuntimeId = 'claude' | 'pi' | 'devin' | 'gemini' | 'antigravity';

export function runtimeHome(cairnHome: string, name: string): string {
  return join(cairnHome, 'homes', name);
}

export function claudeConfigHome(cairnHome: string): string {
  return runtimeHome(cairnHome, 'claude');
}

export function piHome(cairnHome: string): string {
  return runtimeHome(cairnHome, 'pi');
}

export function toolInstallRoot(cairnHome: string, name: string): string {
  return join(cairnHome, 'tools', name);
}

export function agentConfigImportMarker(cairnHome: string): string {
  return join(cairnHome, 'imports', 'agent-config.json');
}

function moveIfAbsent(from: string, to: string): boolean {
  if (!existsSync(from) || existsSync(to)) return false;
  if (lstatSync(from).isSymbolicLink()) return false;
  mkdirSync(dirname(to), { recursive: true, mode: 0o700 });
  renameSync(from, to);
  return true;
}

export function migrateRuntimeHomes(cairnHome: string, realHome = homedir()): string[] {
  const moved: string[] = [];
  const move = (from: string, to: string, label: string) => {
    try {
      if (moveIfAbsent(from, to)) moved.push(label);
    } catch {}
  };
  move(join(cairnHome, 'claude'), claudeConfigHome(cairnHome), 'claude');
  move(join(cairnHome, 'agent-runtime'), piHome(cairnHome), 'agent-runtime');
  const legacyHomes = join(cairnHome, 'agent-homes');
  try {
    for (const entry of readdirSync(legacyHomes)) {
      move(join(legacyHomes, entry), runtimeHome(cairnHome, entry), `agent-homes/${entry}`);
    }
  } catch {}
  if (resolve(cairnHome) === resolve(join(realHome, BRAND.homeDirName))) {
    const legacyTools = join(realHome, '.local', 'share', 'cairn');
    for (const name of ['devin', 'antigravity']) {
      move(join(legacyTools, name), toolInstallRoot(cairnHome, name), `tools/${name}`);
    }
  }
  move(
    join(toolInstallRoot(cairnHome, 'devin'), 'home'),
    runtimeHome(cairnHome, 'devin'),
    'devin-home',
  );
  return moved;
}
