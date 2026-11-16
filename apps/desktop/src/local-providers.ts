import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  type LocalProvider,
  type LocalProviderImport,
  piProviderImports,
  piProviders,
} from '@cairn/shared';

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function piFiles(): { models: unknown; auth: unknown } {
  const dir = join(homedir(), '.pi', 'agent');
  return { models: readJson(join(dir, 'models.json')), auth: readJson(join(dir, 'auth.json')) };
}

export function scanLocalProviders(): LocalProvider[] {
  const { models, auth } = piFiles();
  return piProviders(models, auth);
}

export function readLocalProviders(providerIds: unknown): LocalProviderImport[] {
  if (!Array.isArray(providerIds) || !providerIds.every((id) => typeof id === 'string')) return [];
  const { models, auth } = piFiles();
  return piProviderImports(models, auth, providerIds);
}
